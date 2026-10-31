import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { displayDate } from './dates'
import { pdfMoney } from './format'

// Formgrid report PDFs, in the house style of the Formgrid quotation template: a charcoal header band
// with the stylised F mark and the spaced FORMGRID wordmark, tracked small-caps labels, hairline rules
// and a footer with the studio name and page numbers. Every report and ledger goes through here, so
// they all look like one family.

export const BRAND = {
  charcoal: [51, 48, 43], // #33302b, the header band and table rules
  ink: [42, 39, 35], // #2a2723, body text
  mute: [85, 80, 74], // #55504a, secondary text
  label: [125, 118, 109], // #7d766d, tracked labels
  rule: [220, 216, 208], // #dcd8d0, hairlines between rows
  tint: [243, 241, 236], // #f3f1ec, total rows and summary cards
  paper: [251, 250, 247], // #fbfaf7
  white: [255, 255, 255],
}

const MARGIN = 14
const PAGE_RIGHT = 196
const FONT = 'helvetica'

// The Formgrid symbol, from the quotation template's own path data (viewBox 77 x 78).
const SYMBOL = [
  [[44, 0], [76, 0], [76, 21], [29, 21], [25, 25], [25, 42], [1, 42]],
  [[46, 33], [76, 33], [76, 55], [29, 55], [25, 60], [25, 77], [0, 77]],
]

function drawSymbol(doc, x, y, size, color) {
  doc.setFillColor(...color)
  const scale = size / 77
  for (const poly of SYMBOL) {
    const pts = poly.map(([px, py]) => [x + px * scale, y + py * scale])
    const [sx, sy] = pts[0]
    // jsPDF's lines() takes relative vectors from the start point.
    const vectors = pts.slice(1).map(([px, py], i) => {
      const [prevX, prevY] = pts[i]
      return [px - prevX, py - prevY]
    })
    doc.lines(vectors, sx, sy, [1, 1], 'F', true)
  }
}

// Tracked text. Right alignment is measured here, because jsPDF's own right alignment ignores the
// letter spacing and lets the text run past its margin.
function tracked(doc, text, x, y, { size = 7, color = BRAND.label, align = 'left', spacing = 0.22 } = {}) {
  doc.setFont(FONT, 'normal')
  doc.setFontSize(size)
  doc.setTextColor(...color)
  doc.setCharSpace(spacing)
  const width = doc.getTextWidth(text) + Math.max(text.length - 1, 0) * spacing
  const left = align === 'right' ? x - width : x
  doc.text(text, left, y)
  doc.setCharSpace(0)
  doc.setTextColor(...BRAND.ink)
}

// Header band: logo and wordmark on the left, report title and period on the right.
// Returns the y where the body starts.
export function brandHeader(doc, { title, subtitle, meta = [] }) {
  const top = 12
  const height = 40
  doc.setFillColor(...BRAND.charcoal)
  doc.rect(MARGIN, top, PAGE_RIGHT - MARGIN, height, 'F')

  drawSymbol(doc, MARGIN + 9, top + 10, 14, BRAND.paper)
  doc.setFont(FONT, 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...BRAND.paper)
  doc.setCharSpace(0.9)
  doc.text('FORMGRID', MARGIN + 27, top + 19)
  doc.setCharSpace(0)
  tracked(doc, 'INTERIOR DESIGN AND BUILD STUDIO', MARGIN + 27, top + 25, { size: 6.2, color: [200, 196, 188], spacing: 0.4 })

  tracked(doc, title.toUpperCase(), PAGE_RIGHT - 9, top + 14, { size: 9, color: BRAND.paper, align: 'right', spacing: 0.5 })
  if (subtitle) tracked(doc, subtitle.toUpperCase(), PAGE_RIGHT - 9, top + 20, { size: 6.2, color: [200, 196, 188], align: 'right', spacing: 0.4 })
  let my = top + 27
  for (const [label, value] of meta) {
    doc.setFont(FONT, 'normal')
    doc.setFontSize(7.4)
    doc.setTextColor(200, 196, 188)
    doc.text(`${label}  ${value}`, PAGE_RIGHT - 9, my, { align: 'right' })
    my += 4.2
  }
  doc.setTextColor(...BRAND.ink)
  return top + height + 9
}

// Small-caps section label with a hairline under it, as the quotation template sets its sections.
export function sectionLabel(doc, y, text) {
  if (y > 262) { doc.addPage(); y = 20 }
  tracked(doc, text.toUpperCase(), MARGIN, y, { size: 7, spacing: 0.4 })
  doc.setDrawColor(...BRAND.rule)
  doc.setLineWidth(0.25)
  doc.line(MARGIN, y + 2.2, PAGE_RIGHT, y + 2.2)
  return y + 7
}

// A row of summary figures, drawn as tinted cards.
export function summaryCards(doc, y, cards) {
  const gap = 3
  const height = 22
  const width = (PAGE_RIGHT - MARGIN - gap * (cards.length - 1)) / cards.length
  cards.forEach(([label, value], i) => {
    const x = MARGIN + i * (width + gap)
    doc.setFillColor(...BRAND.tint)
    doc.rect(x, y, width, height, 'F')
    // Labels wrap inside the card rather than running past its edge, so the value always sits below them.
    doc.setFont(FONT, 'normal')
    doc.setFontSize(5.8)
    doc.setTextColor(...BRAND.label)
    const lines = doc.splitTextToSize(label.toUpperCase(), width - 6)
    doc.text(lines, x + 3, y + 5)
    doc.setFont(FONT, 'bold')
    doc.setTextColor(...BRAND.ink)
    // A large figure steps down in size so it stays inside the card.
    doc.setFontSize(10)
    let size = 10
    while (size > 7 && doc.getTextWidth(value) * (size / 10) > width - 6) size -= 0.5
    doc.setFontSize(size)
    doc.text(value, x + 3, y + height - 4)
  })
  return y + height + 5
}

// Footer on every page: studio name on the left, page x of y on the right.
export function brandFooter(doc) {
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p)
    doc.setDrawColor(...BRAND.rule)
    doc.setLineWidth(0.25)
    doc.line(MARGIN, 284, PAGE_RIGHT, 284)
    tracked(doc, 'FORMGRID — INTERIOR DESIGN AND BUILD STUDIO', MARGIN, 289, { size: 6, spacing: 0.3 })
    tracked(doc, `PAGE ${p} / ${pages}`, PAGE_RIGHT, 289, { size: 6, align: 'right', spacing: 0.3 })
  }
}

// The table style every report uses: tracked header row, hairline body rows, a tinted total row.
export function brandTable(doc, y, { head, body, foot, columnStyles = {} }) {
  autoTable(doc, {
    startY: y,
    head: head ? [head] : undefined,
    body,
    foot: foot ? [foot] : undefined,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'plain',
    styles: { font: FONT, fontSize: 8, cellPadding: { top: 2.2, bottom: 2.2, left: 2, right: 2 }, textColor: BRAND.ink, lineColor: BRAND.rule, lineWidth: { bottom: 0.2 } },
    headStyles: { font: FONT, fontStyle: 'normal', fontSize: 6.4, textColor: BRAND.label, lineColor: BRAND.charcoal, lineWidth: { bottom: 0.5 }, fillColor: BRAND.white },
    footStyles: { font: FONT, fontStyle: 'bold', fontSize: 8, textColor: BRAND.ink, fillColor: BRAND.tint, lineColor: BRAND.charcoal, lineWidth: { top: 0.4 } },
    columnStyles,
    alternateRowStyles: { fillColor: BRAND.white },
    rowPageBreak: 'avoid',
    // Headers and totals take their column's alignment, so a right-aligned figure column has a right-aligned title.
    didParseCell: (d) => {
      const align = columnStyles[d.column.index]?.halign
      if (align && d.section !== 'body') d.cell.styles.halign = align
    },
  })
  return doc.lastAutoTable.finalY + 8
}

// Shared money formatting for the reports.
export const money = pdfMoney
export const date = displayDate

// A new document with the brand header already drawn, plus the period line the reports print under it.
export function newReportDoc({ title, subtitle, meta }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const y = brandHeader(doc, { title, subtitle, meta })
  return { doc, y }
}

// Bank-style statement: summary cards, then Date / Details / Reference / Debit / Credit / Balance with
// the opening and closing balances. Rows are oldest first, already signed as debit or credit.
// categories (optional): [{ name, amount }] drawn as a breakdown table above the ledger, with its total.
export function buildStatementDoc({ title, subtitle, meta, opening = 0, rows: rawRows, footerNote, categories }) {
  // Each row is either already split (debit / credit) or carries direction 'in' | 'out' and an amount.
  const rows = rawRows.map((r) => {
    const amount = Number(r.amount || 0)
    return {
      ...r,
      debit: r.debit ?? (r.direction === 'out' ? amount : 0),
      credit: r.credit ?? (r.direction === 'in' ? amount : 0),
    }
  })
  const out = newReportDoc({ title, subtitle, meta })
  let y = out.y
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0)
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0)
  const closing = Number(opening) + totalCredit - totalDebit

  y = summaryCards(out.doc, y, [
    ['Opening balance', money(opening)],
    ['Credits (in)', money(totalCredit)],
    ['Debits (out)', money(totalDebit)],
    ['Closing balance', money(closing)],
  ])
  if (categories?.length) {
    const catTotal = categories.reduce((s, c) => s + c.amount, 0)
    y = sectionLabel(out.doc, y, 'Category breakdown')
    y = brandTable(out.doc, y, {
      head: ['Category', 'Amount', 'Share'],
      body: categories.map((c) => [c.name, money(c.amount), catTotal ? `${((c.amount / catTotal) * 100).toFixed(1)}%` : '—']),
      foot: ['Total', money(catTotal), '100%'],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    })
  }
  y = sectionLabel(out.doc, y, 'Ledger')

  let running = Number(opening)
  const body = rows.map((r) => {
    running += r.credit - r.debit
    return [date(r.date), [r.category, r.description].filter(Boolean).join(' — '), r.reference || '', r.debit ? money(r.debit) : '', r.credit ? money(r.credit) : '', money(running)]
  })
  y = brandTable(out.doc, y, {
    head: ['Date', 'Details', 'Reference', 'Debit (out)', 'Credit (in)', 'Balance'],
    body: [['', 'Opening balance', '', '', '', money(opening)], ...body],
    foot: ['', 'Closing balance', '', money(totalDebit), money(totalCredit), money(closing)],
    columnStyles: { 0: { cellWidth: 20 }, 2: { cellWidth: 28 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
  })
  if (footerNote) {
    out.doc.setFont(FONT, 'normal')
    out.doc.setFontSize(7.2)
    out.doc.setTextColor(...BRAND.mute)
    out.doc.text(footerNote, MARGIN, y, { maxWidth: PAGE_RIGHT - MARGIN * 2 })
  }
  brandFooter(out.doc)
  return out.doc
}

// Generic report table: summary cards, then one or more titled tables.
// sections: [{ heading, head, body, foot, columnStyles }]
export function buildTableDoc({ title, subtitle, meta, cards = [], sections }) {
  const out = newReportDoc({ title, subtitle, meta })
  let y = out.y
  if (cards.length) y = summaryCards(out.doc, y, cards)
  for (const s of sections) {
    y = sectionLabel(out.doc, y, s.heading)
    y = brandTable(out.doc, y, { head: s.head, body: s.body, foot: s.foot, columnStyles: s.columnStyles })
  }
  brandFooter(out.doc)
  return out.doc
}

export function saveDoc(doc, filename) {
  doc.save(`${filename}.pdf`)
}
