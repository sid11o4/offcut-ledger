import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { displayDate } from './dates'
import { money, qty } from './format'

// Deterministic, reproducible document generation (spec section 49): same data always
// produces the same PDF -- no random ids, no "generated at" timestamp affecting layout.
function documentHeader(doc, settings, docTitle, meta) {
  doc.setFontSize(14)
  doc.setFont(undefined, 'bold')
  doc.text(settings?.company_name || 'Formgrid Factory', 14, 18)
  doc.setFont(undefined, 'normal')
  doc.setFontSize(9)
  let y = 24
  if (settings?.company_address) { doc.text(settings.company_address, 14, y); y += 5 }
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
  if (client?.address) { doc.text(client.address, 14, y, { maxWidth: 90 }); y += 5 }
  if (client?.gst_number) { doc.text(`GSTIN: ${client.gst_number}`, 14, y); y += 5 }
  if (project) { doc.text(`Project: ${project.name}`, 14, y); y += 5 }
  return y + 4
}

function totalsBlock(doc, y, { subtotal, taxPercent, taxAmount, adjustments, grandTotal }) {
  const lines = [['Subtotal', money(subtotal)]]
  if (Number(taxPercent) > 0) lines.push([`Tax (${taxPercent}%)`, money(taxAmount)])
  if (Number(adjustments)) lines.push(['Adjustments', money(adjustments)])
  lines.push(['Grand Total', money(grandTotal)])

  let ty = y
  for (const [label, value] of lines) {
    const bold = label === 'Grand Total'
    doc.setFont(undefined, bold ? 'bold' : 'normal')
    doc.setFontSize(bold ? 11 : 9)
    doc.text(label, 150, ty)
    doc.text(value, 196, ty, { align: 'right' })
    ty += bold ? 7 : 5.5
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

// Income / Expense Statement (spec sections 33-34, 49): letterhead, period, income and expense
// sections, category breakdown, and the net-profit summary -- reconciling with the on-screen
// figures exactly.
export function generateIncomeExpenseStatementPdf({ settings, start, end, statement, breakdown }) {
  const doc = new jsPDF()
  let y = documentHeader(doc, settings, 'INCOME / EXPENSE STATEMENT', [
    ['Period', `${displayDate(start)} – ${displayDate(end)}`],
  ])

  y = sectionHeading(doc, y + 2, 'Income')
  autoTable(doc, {
    ...TABLE, startY: y,
    head: [['', 'Amount']],
    body: [['Machine job-work revenue', money(statement.job_work_income)]],
    foot: [['Total Income', money(statement.job_work_income)]],
    footStyles: { fontStyle: 'bold', fillColor: [240, 240, 240], textColor: 20 },
  })

  y = sectionHeading(doc, doc.lastAutoTable.finalY + 8, 'Expenses')
  autoTable(doc, {
    ...TABLE, startY: y,
    head: [['', 'Amount']],
    body: [
      ['Variable / daily expenses', money(statement.variable_expenses)],
      ['Fixed / recurring expenses', money(statement.recurring_expenses)],
    ],
    foot: [['Total Expenses', money(statement.total_expenses)]],
    footStyles: { fontStyle: 'bold', fillColor: [240, 240, 240], textColor: 20 },
  })

  if (breakdown?.length) {
    y = sectionHeading(doc, doc.lastAutoTable.finalY + 8, 'Expense Breakdown by Category')
    autoTable(doc, {
      ...TABLE, startY: y,
      head: [['Category', 'Amount']],
      body: breakdown.map((r) => [r.category_name, money(r.amount)]),
    })
  }

  let ty = doc.lastAutoTable.finalY + 10
  doc.setFontSize(9)
  const sum = [
    ['Total Income', money(statement.job_work_income)],
    ['Total Expenses', `(${money(statement.total_expenses)})`],
  ]
  for (const [label, value] of sum) {
    doc.text(label, 150, ty); doc.text(value, 196, ty, { align: 'right' }); ty += 5.5
  }
  doc.setFont(undefined, 'bold'); doc.setFontSize(11)
  doc.text('Net Profit / Net Contribution', 150, ty + 2)
  doc.text(money(statement.net_contribution), 196, ty + 2, { align: 'right' })
  doc.setFont(undefined, 'normal')

  pageFooter(doc)
  doc.save(`income-expense-statement_${start}_to_${end}.pdf`)
}

// Factory Reports (spec sections 17-19, 43): every dimension in one document -- billing
// summary, then a table per breakdown (project / job work / process / machine / rate category
// / date).
export function generateFactoryReportPdf({ settings, start, end, billing, sections }) {
  const doc = new jsPDF()
  let y = documentHeader(doc, settings, 'FACTORY REPORT', [
    ['Period', `${displayDate(start)} – ${displayDate(end)}`],
  ])

  y = sectionHeading(doc, y + 2, 'Summary')
  autoTable(doc, {
    ...TABLE, startY: y,
    head: [['', 'Amount / Count']],
    body: [
      ['Total revenue', money(billing?.billed_revenue != null ? Number(billing.billed_revenue) + Number(billing.unbilled_revenue) : 0)],
      ['Billed', money(billing?.billed_revenue)],
      ['Unbilled', money(billing?.unbilled_revenue)],
      ['Job entries', String((Number(billing?.billed_count) || 0) + (Number(billing?.unbilled_count) || 0))],
    ],
  })
  y = doc.lastAutoTable.finalY + 8

  for (const sec of sections) {
    if (y > 250) { doc.addPage(); y = 20 }
    y = sectionHeading(doc, y, sec.title)
    autoTable(doc, {
      ...TABLE, startY: y,
      head: [sec.head],
      body: sec.body,
      foot: sec.foot ? [sec.foot] : undefined,
      footStyles: sec.foot ? { fontStyle: 'bold', fillColor: [240, 240, 240], textColor: 20 } : undefined,
    })
    y = doc.lastAutoTable.finalY + 8
  }

  pageFooter(doc)
  doc.save(`factory-report_${start}_to_${end}.pdf`)
}

// Single-project report (spec section 18): project + client info, financial reconciliation,
// and the date-wise work table with billing status for the chosen period.
export function generateProjectReportPdf({ settings, start, end, project, financials, entries, periodTotal }) {
  const doc = new jsPDF()
  let y = documentHeader(doc, settings, 'PROJECT REPORT', [
    ['Project', project?.code || '—'],
    ['Period', `${displayDate(start)} – ${displayDate(end)}`],
  ])

  doc.setFontSize(9)
  doc.text(`Project: ${project?.name || '—'}`, 14, y); y += 5
  doc.text(`Client: ${project?.clients?.name || '—'}`, 14, y); y += 5
  doc.text(`Rate Category: ${project?.rate_categories?.name || '—'}`, 14, y); y += 5
  doc.text(`Status: ${String(project?.status || '').replace(/_/g, ' ')}`, 14, y); y += 8

  y = sectionHeading(doc, y, 'Financial Summary (all time)')
  autoTable(doc, {
    ...TABLE, startY: y,
    head: [['', 'Amount']],
    body: [
      ['Actual work revenue', money(financials?.actual_revenue)],
      ['Billed', money(financials?.billed_revenue)],
      ['Unbilled', money(financials?.unbilled_revenue)],
      ['Project expenses', money(financials?.total_expenses)],
      ['Estimated value', money(financials?.estimated_value)],
    ],
  })

  y = sectionHeading(doc, doc.lastAutoTable.finalY + 8, 'Date-wise Work')
  autoTable(doc, {
    ...TABLE, startY: y,
    head: [['Date', 'Job Work', 'Quantity', 'Unit', 'Amount', 'Billing']],
    body: (entries || []).map((r) => [
      displayDate(r.entry_date),
      r.job_work_services?.name || '—',
      qty(r.base_quantity),
      r.units?.code || '—',
      money(r.total_amount),
      r.status === 'cancelled' ? 'Cancelled' : r.billed ? 'Billed' : 'Unbilled',
    ]),
    foot: [['', '', '', 'Period Total', money(periodTotal), '']],
    footStyles: { fontStyle: 'bold', fillColor: [240, 240, 240], textColor: 20 },
  })

  pageFooter(doc)
  doc.save(`project-report_${project?.code || 'project'}_${start}_to_${end}.pdf`)
}

export function generateEstimatePdf({ settings, estimate, client, project, rateCategory, items }) {
  const doc = new jsPDF()
  let y = documentHeader(doc, settings, 'ESTIMATE', [
    ['Estimate #', estimate.estimate_number],
    ['Date', displayDate(estimate.estimate_date)],
    ['Validity', estimate.validity_date ? displayDate(estimate.validity_date) : '—'],
    ['Rate Category', rateCategory?.name || '—'],
  ])
  y = billToBlock(doc, y, client, project)

  autoTable(doc, {
    startY: y,
    head: [['Job Work', 'Quantity', 'Unit', 'Rate', 'Amount']],
    body: items.map((it) => [it.service_name, qty(it.quantity), it.unit_name, money(it.rate), money(it.amount)]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [15, 76, 129] },
    margin: { left: 14, right: 14 },
  })

  let ty = doc.lastAutoTable.finalY + 8
  ty = totalsBlock(doc, ty, {
    subtotal: estimate.subtotal, taxPercent: estimate.tax_percent, taxAmount: estimate.tax_amount,
    adjustments: 0, grandTotal: estimate.grand_total,
  })

  if (estimate.notes) {
    ty += 8
    doc.setFontSize(9)
    doc.setFont(undefined, 'bold')
    doc.text('Notes', 14, ty)
    doc.setFont(undefined, 'normal')
    doc.text(estimate.notes, 14, ty + 5, { maxWidth: 180 })
  }

  doc.save(`${estimate.estimate_number}.pdf`)
}

export function generateBillPdf({ settings, bill, client, project, items }) {
  const doc = new jsPDF()
  let y = documentHeader(doc, settings, 'BILL', [
    ['Bill #', bill.bill_number],
    ['Date', displayDate(bill.bill_date)],
    ['Period', bill.billing_period_start ? `${displayDate(bill.billing_period_start)} – ${displayDate(bill.billing_period_end)}` : '—'],
    ['Status', String(bill.status).toUpperCase()],
  ])
  y = billToBlock(doc, y, client, project)

  autoTable(doc, {
    startY: y,
    head: [['Date', 'Job Work', 'Quantity', 'Unit', 'Amount']],
    body: items.map((it) => [displayDate(it.entry_date), it.service_name, qty(it.quantity), it.unit_name, money(it.amount)]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [15, 76, 129] },
    margin: { left: 14, right: 14 },
  })

  let ty = doc.lastAutoTable.finalY + 8
  ty = totalsBlock(doc, ty, {
    subtotal: bill.subtotal, taxPercent: bill.tax_percent, taxAmount: bill.tax_amount,
    adjustments: bill.adjustments, grandTotal: bill.grand_total,
  })

  if (bill.notes) {
    ty += 8
    doc.setFontSize(9)
    doc.setFont(undefined, 'bold')
    doc.text('Notes', 14, ty)
    doc.setFont(undefined, 'normal')
    doc.text(bill.notes, 14, ty + 5, { maxWidth: 180 })
  }

  doc.save(`${bill.bill_number}.pdf`)
}
