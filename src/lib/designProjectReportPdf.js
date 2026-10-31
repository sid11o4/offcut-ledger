import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { displayDate } from './dates'
import { pdfMoney as money, qty } from './format'

// One Design Build project report, as a single PDF: dashboard, expenses by category, budget and cash
// position, materials consumed, labour, then the full ledger. Same layout rules as the Factory PDFs.
function sectionHeading(doc, y, text) {
  if (y > 262) { doc.addPage(); y = 18 }
  doc.setFont(undefined, 'bold')
  doc.setFontSize(11)
  doc.text(text, 14, y)
  doc.setFont(undefined, 'normal')
  return y + 3
}

// Totals rows: the label stays left, every figure column is right-aligned like its body rows.
const numericFoot = {
  didParseCell: (d) => {
    if (d.section === 'foot' && d.column.index > 0) d.cell.styles.halign = 'right'
  },
}

function pageFooter(doc) {
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(120)
    doc.text(`Page ${i} of ${pages}`, 196, 290, { align: 'right' })
    doc.setTextColor(0)
  }
}

export function buildDesignProjectReportDoc({ settings, project, data }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const { financials: f, budget, spent, headroom, categories, materials, labour, ledger, ledgerTotal } = data

  // Header
  doc.setFontSize(14)
  doc.setFont(undefined, 'bold')
  doc.text(settings?.company_name || 'Formgrid Design Build', 14, 18)
  doc.setFont(undefined, 'normal')
  doc.setFontSize(16)
  doc.text('Project Report', 196, 18, { align: 'right' })
  doc.setFontSize(9)
  doc.text(`Project: ${project.name}`, 14, 25)
  doc.text(`Code: ${project.code || '—'}`, 14, 30)
  doc.text(`Client: ${project.clients?.name || '—'}`, 14, 35)
  doc.text(`Status: ${project.status}`, 196, 25, { align: 'right' })
  if (project.start_date) doc.text(`Start: ${displayDate(project.start_date)}`, 196, 30, { align: 'right' })
  if (project.expected_completion_date) doc.text(`Expected: ${displayDate(project.expected_completion_date)}`, 196, 35, { align: 'right' })

  let y = 44

  // 1. Dashboard
  y = sectionHeading(doc, y, 'Project Dashboard')
  autoTable(doc, {
    startY: y,
    head: [['Budget', 'Supplier bills', 'Internal Order', 'Direct expenses', 'Inventory on hand']],
    body: [[
      budget ? money(budget) : '—', money(f?.supplier_bills_total), money(f?.internal_order_total),
      money(f?.direct_expenses_total), money(f?.current_inventory_value),
    ]],
    styles: { fontSize: 9, halign: 'right' },
    headStyles: { fillColor: [245, 245, 245], textColor: 30, halign: 'right' },
    theme: 'grid',
  })
  y = doc.lastAutoTable.finalY + 8

  // 2. Overall details and budget / cash position
  y = sectionHeading(doc, y, 'Overall Details and Cash Position')
  autoTable(doc, {
    startY: y,
    body: [
      ['Total spent (all costs)', money(spent)],
      ['Budget', budget ? money(budget) : 'No budget set'],
      ['Budget headroom', budget ? `${money(headroom)} (${headroom >= 0 ? 'positive, under budget' : 'negative, over budget'})` : '—'],
      ['Paid out in the ledger', money(ledgerTotal)],
      ['Client receipts', 'Not recorded for Design Build projects'],
    ],
    styles: { fontSize: 9 },
    columnStyles: { 0: { cellWidth: 70 }, 1: { halign: 'right' } },
    theme: 'striped',
  })
  y = doc.lastAutoTable.finalY + 8

  // 3. Expenses by category
  y = sectionHeading(doc, y, 'Expenses by Category')
  autoTable(doc, {
    startY: y,
    head: [['Category', 'Amount']],
    body: categories.length ? categories.map((c) => [c.name, money(c.amount)]) : [['No expenses recorded', '—']],
    foot: [['Total', money(spent)]],
    styles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right' } },
    headStyles: { fillColor: [245, 245, 245], textColor: 30 },
    footStyles: { fillColor: [245, 245, 245], textColor: 30, fontStyle: 'bold' },
    didParseCell: numericFoot.didParseCell,
    theme: 'grid',
  })
  y = doc.lastAutoTable.finalY + 8

  // 4. Materials consumed
  y = sectionHeading(doc, y, 'Materials Consumed')
  autoTable(doc, {
    startY: y,
    head: [['Material', 'Quantity', 'Cost']],
    body: materials.length ? materials.map((m) => [m.name, `${qty(m.quantity)} ${m.unit || ''}`.trim(), money(m.cost)]) : [['No materials consumed', '', '—']],
    foot: materials.length ? [['Total', '', money(materials.reduce((s, m) => s + m.cost, 0))]] : undefined,
    styles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    headStyles: { fillColor: [245, 245, 245], textColor: 30 },
    footStyles: { fillColor: [245, 245, 245], textColor: 30, fontStyle: 'bold' },
    didParseCell: numericFoot.didParseCell,
    theme: 'grid',
  })
  y = doc.lastAutoTable.finalY + 8

  // 5. Labour
  y = sectionHeading(doc, y, 'Labour')
  autoTable(doc, {
    startY: y,
    head: [['Date', 'Description', 'Supplier / category', 'Cost']],
    body: labour.length ? labour.map((l) => [displayDate(l.date), l.description || '—', l.party || '—', money(l.amount)]) : [['', 'No labour recorded', '', '—']],
    foot: labour.length ? [['', '', 'Total', money(labour.reduce((s, l) => s + l.amount, 0))]] : undefined,
    styles: { fontSize: 9 },
    columnStyles: { 3: { halign: 'right' } },
    headStyles: { fillColor: [245, 245, 245], textColor: 30 },
    footStyles: { fillColor: [245, 245, 245], textColor: 30, fontStyle: 'bold' },
    didParseCell: numericFoot.didParseCell,
    theme: 'grid',
  })
  y = doc.lastAutoTable.finalY + 8

  // 6. Full ledger
  y = sectionHeading(doc, y, 'Ledger Statement (all payments)')
  let running = 0
  autoTable(doc, {
    startY: y,
    head: [['Date', 'Category', 'Description', 'Reference', 'Out', 'Running']],
    body: ledger.length ? ledger.map((r) => {
      running += Number(r.amount)
      return [displayDate(r.txn_date), r.category, r.description || '', r.reference || '', money(r.amount), money(running)]
    }) : [['', 'No transactions', '', '', '', '']],
    foot: ledger.length ? [['', '', '', 'Total', money(ledgerTotal), '']] : undefined,
    styles: { fontSize: 8 },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' } },
    headStyles: { fillColor: [245, 245, 245], textColor: 30 },
    footStyles: { fillColor: [245, 245, 245], textColor: 30, fontStyle: 'bold' },
    didParseCell: numericFoot.didParseCell,
    theme: 'grid',
  })

  pageFooter(doc)
  return doc
}

export function downloadDesignProjectReport(args) {
  const doc = buildDesignProjectReportDoc(args)
  const safeName = (args.project.code || args.project.name).replace(/[^a-z0-9-_]+/gi, '-')
  doc.save(`project-report-${safeName}.pdf`)
}
