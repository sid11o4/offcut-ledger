import { displayDate } from './dates'
import { pdfMoney as money, qty } from './format'
import { newReportDoc, sectionLabel, summaryCards, brandTable, brandFooter, saveDoc } from './reportPdf'

// One Design Build project report as a single branded PDF: dashboard, overall details and cash
// position, expenses by category, materials consumed, labour, then the full ledger statement.
export function buildDesignProjectReportDoc({ project, data }) {
  const { financials: f = {}, budget, spent, headroom, categories, materials, labour, ledger, ledgerTotal } = data
  const meta = [
    ['Code', project.code || '—'],
    ['Client', project.clients?.name || '—'],
    ['Status', project.status],
  ]
  if (project.start_date) meta.push(['Start', displayDate(project.start_date)])
  if (project.expected_completion_date) meta.push(['Expected', displayDate(project.expected_completion_date)])

  const { doc, y: top } = newReportDoc({ title: 'Project report', subtitle: project.name, meta })
  let y = top

  y = summaryCards(doc, y, [
    ['Budget', budget ? money(budget) : '—'],
    ['Supplier bills', money(f.supplier_bills_total)],
    ['Internal Order', money(f.internal_order_total)],
    ['Direct expenses', money(f.direct_expenses_total)],
    ['Inventory on hand', money(f.current_inventory_value)],
  ])

  y = sectionLabel(doc, y, 'Overall details and cash position')
  y = brandTable(doc, y, {
    body: [
      ['Total spent (all costs)', money(spent)],
      ['Budget', budget ? money(budget) : 'No budget set'],
      ['Budget headroom', budget ? `${money(headroom)} (${headroom >= 0 ? 'positive, under budget' : 'negative, over budget'})` : '—'],
      ['Paid out in the ledger', money(ledgerTotal)],
      ['Client receipts', 'Not recorded for Design Build projects'],
    ],
    columnStyles: { 0: { cellWidth: 70 }, 1: { halign: 'right' } },
  })

  y = sectionLabel(doc, y, 'Expenses by category')
  y = brandTable(doc, y, {
    head: ['Category', 'Amount'],
    body: categories.length ? categories.map((c) => [c.name, money(c.amount)]) : [['No expenses recorded', '—']],
    foot: ['Total', money(spent)],
    columnStyles: { 1: { halign: 'right' } },
  })

  y = sectionLabel(doc, y, 'Materials consumed')
  y = brandTable(doc, y, {
    head: ['Material', 'Quantity', 'Cost'],
    body: materials.length ? materials.map((m) => [m.name, `${qty(m.quantity)} ${m.unit || ''}`.trim(), money(m.cost)]) : [['No materials consumed', '', '—']],
    foot: materials.length ? ['Total', '', money(materials.reduce((s, m) => s + m.cost, 0))] : undefined,
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
  })

  y = sectionLabel(doc, y, 'Labour')
  y = brandTable(doc, y, {
    head: ['Date', 'Description', 'Supplier / category', 'Cost'],
    body: labour.length ? labour.map((l) => [displayDate(l.date), l.description || '—', l.party || '—', money(l.amount)]) : [['', 'No labour recorded', '', '—']],
    foot: labour.length ? ['', '', 'Total', money(labour.reduce((s, l) => s + l.amount, 0))] : undefined,
    columnStyles: { 3: { halign: 'right' } },
  })

  y = sectionLabel(doc, y, 'Account statement (all payments)')
  let running = 0
  brandTable(doc, y, {
    head: ['Date', 'Details', 'Reference', 'Out', 'Balance'],
    body: ledger.length ? ledger.map((r) => {
      running -= Number(r.amount)
      return [displayDate(r.txn_date), [r.category, r.description].filter(Boolean).join(' — '), r.reference || '', money(r.amount), money(running)]
    }) : [['', 'No transactions', '', '', '']],
    foot: ledger.length ? ['', 'Total', '', money(ledgerTotal), money(running)] : undefined,
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
  })

  brandFooter(doc)
  return doc
}

export function downloadDesignProjectReport(args) {
  const doc = buildDesignProjectReportDoc(args)
  saveDoc(doc, `project-report-${args.project.code || args.project.name}`.replace(/[^a-z0-9-_]+/gi, '-'))
}
