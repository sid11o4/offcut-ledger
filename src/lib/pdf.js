import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { displayDate } from './dates'
import { pdfMoney as money, qty } from './format'
import { computeGst } from './gst'

// Deterministic, reproducible document generation (spec section 49): same data always
// produces the same PDF -- no random ids, no "generated at" timestamp affecting layout.
function documentHeader(doc, settings, docTitle, meta) {
  doc.setFontSize(14)
  doc.setFont(undefined, 'bold')
  doc.text(settings?.company_name || 'Formgrid Factory', 14, 18)
  doc.setFont(undefined, 'normal')
  doc.setFontSize(9)
  let y = 24
  // company_address may hold several lines (embedded newlines) and/or a long line that needs
  // wrapping -- splitTextToSize handles both, and y advances by the real line count so the
  // phone / email / GSTIN lines below never overlap it.
  if (settings?.company_address) {
    const lines = doc.splitTextToSize(settings.company_address, 95)
    doc.text(lines, 14, y)
    y += lines.length * 4.6
  }
  const contactBits = [settings?.company_phone, settings?.company_email].filter(Boolean).join('  ·  ')
  if (contactBits) { doc.text(contactBits, 14, y); y += 5 }
  if (settings?.company_gst_number) { doc.text(`GSTIN: ${settings.company_gst_number}`, 14, y); y += 5 }

  doc.setFontSize(16)
  doc.setFont(undefined, 'bold')
  doc.text(docTitle, 196, 18, { align: 'right' })
  doc.setFont(undefined, 'normal')
  doc.setFontSize(9)
  let my = 26
  for (const [label, value] of meta) {
    doc.text(`${label}: ${value}`, 196, my, { align: 'right' })
    my += 5
  }
  return Math.max(y, my) + 4
}

function billToBlock(doc, y, client, project) {
  doc.setFontSize(9)
  doc.setFont(undefined, 'bold')
  doc.text('Bill To', 14, y)
  doc.setFont(undefined, 'normal')
  y += 5
  doc.text(client?.name || '—', 14, y)
  y += 5
  if (client?.address) {
    const lines = doc.splitTextToSize(client.address, 90)
    doc.text(lines, 14, y)
    y += lines.length * 4.6
  }
  if (client?.gst_number) { doc.text(`GSTIN: ${client.gst_number}`, 14, y); y += 5 }
  if (project) { doc.text(`Project: ${project.name}`, 14, y); y += 5 }
  return y + 4
}

// taxLines: array of [label, formattedValue] (e.g. CGST / SGST rows, or a single GST row).
function totalsBlock(doc, y, { subtotal, taxLines = [], adjustments, grandTotal, note }) {
  const lines = [['Subtotal', money(subtotal)], ...taxLines]
  if (Number(adjustments)) lines.push(['Adjustments', money(adjustments)])
  lines.push(['Grand Total', money(grandTotal)])

  let ty = y
  for (const [label, value] of lines) {
    const bold = label === 'Grand Total'
    if (bold) { doc.setDrawColor(180); doc.line(128, ty - 3, 196, ty - 3) }
    doc.setFont(undefined, bold ? 'bold' : 'normal')
    doc.setFontSize(bold ? 11 : 9)
    doc.text(label, 128, ty)
    doc.text(value, 196, ty, { align: 'right' })
    ty += bold ? 7 : 5.5
  }
  doc.setFont(undefined, 'normal')
  if (note) {
    doc.setFontSize(8)
    doc.setTextColor(90)
    doc.text(note, 196, ty, { align: 'right', maxWidth: 120 })
    doc.setTextColor(0)
    ty += 5
  }
  return ty
}

const BRAND = [15, 76, 129]
const TABLE = { styles: { fontSize: 9 }, headStyles: { fillColor: BRAND }, margin: { left: 14, right: 14 } }

function sectionHeading(doc, y, text) {
  doc.setFont(undefined, 'bold')
  doc.setFontSize(11)
  doc.text(text, 14, y)
  doc.setFont(undefined, 'normal')
  return y + 3
}

function pageFooter(doc) {
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p)
    doc.setFontSize(8)
    doc.setTextColor(140)
    doc.text(`Page ${p} of ${pages}`, 196, 289, { align: 'right' })
    doc.setTextColor(0)
  }
}

function notesBlock(doc, ty, notes) {
  if (!notes) return
  doc.setFontSize(9)
  doc.setFont(undefined, 'bold')
  doc.text('Notes', 14, ty + 8)
  doc.setFont(undefined, 'normal')
  doc.text(notes, 14, ty + 13, { maxWidth: 180 })
}

export function buildEstimateDoc({ settings, estimate, client, project, rateCategory, items }) {
  const doc = new jsPDF()
  let y = documentHeader(doc, settings, 'ESTIMATE', [
    ['Estimate #', estimate.estimate_number],
    ['Date', displayDate(estimate.estimate_date)],
    ['Validity', estimate.validity_date ? displayDate(estimate.validity_date) : '—'],
    ['Rate Category', rateCategory?.name || '—'],
  ])
  y = billToBlock(doc, y, client, project)

  autoTable(doc, {
    ...TABLE, startY: y,
    head: [['Job Work', 'Quantity', 'Unit', 'Rate', 'Amount']],
    columnStyles: { 1: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', cellWidth: 34 } },
    body: items.map((it) => [it.service_name, qty(it.quantity), it.unit_name, money(it.rate), money(it.amount)]),
  })

  const ty = totalsBlock(doc, doc.lastAutoTable.finalY + 8, {
    subtotal: estimate.subtotal,
    taxLines: Number(estimate.tax_percent) > 0 ? [[`GST (${estimate.tax_percent}%)`, money(estimate.tax_amount)]] : [],
    adjustments: 0, grandTotal: estimate.grand_total,
  })
  notesBlock(doc, ty, estimate.notes)
  pageFooter(doc)
  return doc
}

export function generateEstimatePdf(args) {
  buildEstimateDoc(args).save(`${args.estimate.estimate_number}.pdf`)
}

export function buildBillDoc({ settings, bill, client, project, items }) {
  const doc = new jsPDF()
  let y = documentHeader(doc, settings, 'BILL', [
    ['Bill #', bill.bill_number],
    ['Date', displayDate(bill.bill_date)],
    ['Period', bill.billing_period_start ? `${displayDate(bill.billing_period_start)} – ${displayDate(bill.billing_period_end)}` : '—'],
    ['Status', String(bill.status).toUpperCase()],
  ])
  y = billToBlock(doc, y, client, project)

  autoTable(doc, {
    ...TABLE, startY: y,
    head: [['Date', 'Job Work', 'Quantity', 'Unit', 'Amount']],
    columnStyles: { 0: { cellWidth: 24 }, 2: { halign: 'right' }, 4: { halign: 'right', cellWidth: 36 } },
    body: items.map((it) => [displayDate(it.entry_date), it.service_name, qty(it.quantity), it.unit_name, money(it.amount)]),
  })

  const g = computeGst(bill.subtotal, bill.tax_percent, bill.gst_treatment || 'full')
  const taxLines = g.effectivePct > 0
    ? [[`CGST (${g.halfPct}%)`, money(g.cgst)], [`SGST (${g.halfPct}%)`, money(g.sgst)]]
    : (Number(bill.tax_percent) > 0 ? [['GST', money(0)]] : [])
  const ty = totalsBlock(doc, doc.lastAutoTable.finalY + 8, {
    subtotal: bill.subtotal, taxLines,
    adjustments: bill.adjustments, grandTotal: bill.grand_total, note: g.note,
  })
  if (bill.payment_status) {
    doc.setFontSize(9)
    doc.text(`Payment status: ${String(bill.payment_status).replace(/_/g, ' ')}`, 14, ty)
  }
  notesBlock(doc, ty, bill.notes)
  pageFooter(doc)
  return doc
}

export function generateBillPdf(args) {
  buildBillDoc(args).save(`${args.bill.bill_number}.pdf`)
}
