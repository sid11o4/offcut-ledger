import { displayDate } from './dates'
import { pdfMoney as money, qty } from './format'
import { buildTableDoc, newReportDoc, sectionLabel, summaryCards, brandTable, brandFooter, saveDoc } from './reportPdf'

// Factory reports in the Formgrid report style: the income and expense statement, the factory report
// with one table per breakdown, and the single-project report.

const RIGHT_ALIGN = (heads, names) => {
  const styles = {}
  heads.forEach((h, i) => { if (names.has(h)) styles[i] = { halign: 'right' } })
  return styles
}

export function buildIncomeExpenseStatementDoc({ start, end, statement, breakdown }) {
  const meta = [['Period', `${displayDate(start)} – ${displayDate(end)}`]]
  return buildTableDoc({
    title: 'Income / expense statement',
    subtitle: 'Factory',
    meta,
    cards: [
      ['Total income', money(statement.job_work_income)],
      ['Total expenses', money(statement.total_expenses)],
      ['Net contribution', money(statement.net_contribution)],
    ],
    sections: [
      {
        heading: 'Income',
        head: ['Item', 'Amount'],
        body: [['Machine job-work revenue', money(statement.job_work_income)]],
        foot: ['Total income', money(statement.job_work_income)],
        columnStyles: { 1: { halign: 'right' } },
      },
      {
        heading: 'Expenses',
        head: ['Item', 'Amount'],
        body: [
          ['Variable / daily expenses', money(statement.variable_expenses)],
          ['Fixed / recurring expenses', money(statement.recurring_expenses)],
        ],
        foot: ['Total expenses', money(statement.total_expenses)],
        columnStyles: { 1: { halign: 'right' } },
      },
      ...(breakdown?.length ? [{
        heading: 'Expense breakdown by category',
        head: ['Category', 'Amount'],
        body: breakdown.map((r) => [r.category_name, money(r.amount)]),
        columnStyles: { 1: { halign: 'right' } },
      }] : []),
      {
        heading: 'Net profit / net contribution',
        head: ['', 'Amount'],
        body: [
          ['Total income', money(statement.job_work_income)],
          ['Total expenses', money(statement.total_expenses)],
        ],
        foot: ['Net profit / net contribution', money(statement.net_contribution)],
        columnStyles: { 1: { halign: 'right' } },
      },
    ],
  })
}

export function generateIncomeExpenseStatementPdf(args) {
  saveDoc(buildIncomeExpenseStatementDoc(args), `income-expense-statement_${args.start}_to_${args.end}`)
}

// Every factory dimension in one document: the billing summary, then a table per breakdown.
export function buildFactoryReportDoc({ start, end, billing, sections }) {
  const RIGHT = new Set(['Entries', 'Quantity', 'Revenue', 'Amount'])
  return buildTableDoc({
    title: 'Factory report',
    subtitle: 'Factory',
    meta: [['Period', `${displayDate(start)} – ${displayDate(end)}`]],
    cards: [
      ['Total revenue', money(billing?.billed_revenue != null ? Number(billing.billed_revenue) + Number(billing.unbilled_revenue) : 0)],
      ['Billed', money(billing?.billed_revenue)],
      ['Unbilled', money(billing?.unbilled_revenue)],
      ['Job entries', String((Number(billing?.billed_count) || 0) + (Number(billing?.unbilled_count) || 0))],
    ],
    sections: sections.map((sec) => ({
      heading: sec.title,
      head: sec.head,
      body: sec.body,
      foot: sec.foot,
      columnStyles: RIGHT_ALIGN(sec.head, RIGHT),
    })),
  })
}

export function generateFactoryReportPdf(args) {
  saveDoc(buildFactoryReportDoc(args), `factory-report_${args.start}_to_${args.end}`)
}

// One project: its client and rate details, the financial summary, and the work for the period.
export function buildProjectReportDoc({ start, end, project, financials, entries, periodTotal }) {
  const meta = [
    ['Project code', project?.code || '—'],
    ['Period', `${displayDate(start)} – ${displayDate(end)}`],
  ]
  const { doc, y: top } = newReportDoc({ title: 'Project report', subtitle: project?.name || '', meta })
  let y = top
  y = summaryCards(doc, y, [
    ['Actual work revenue', money(financials?.actual_revenue)],
    ['Billed', money(financials?.billed_revenue)],
    ['Unbilled', money(financials?.unbilled_revenue)],
    ['Project expenses', money(financials?.total_expenses)],
    ['Estimated value', money(financials?.estimated_value)],
  ])

  y = sectionLabel(doc, y, 'Project')
  y = brandTable(doc, y, {
    body: [
      ['Client', project?.clients?.name || '—'],
      ['Rate category', project?.rate_categories?.name || '—'],
      ['Status', String(project?.status || '').replace(/_/g, ' ')],
    ],
    columnStyles: { 0: { cellWidth: 45 } },
  })

  y = sectionLabel(doc, y, 'Date-wise work')
  brandTable(doc, y, {
    head: ['Date', 'Job work', 'Quantity', 'Unit', 'Amount', 'Billing'],
    body: (entries || []).map((r) => [
      displayDate(r.entry_date),
      r.job_work_services?.name || '—',
      qty(r.base_quantity),
      r.units?.code || '—',
      money(r.total_amount),
      r.status === 'cancelled' ? 'Cancelled' : r.billed ? 'Billed' : 'Unbilled',
    ]),
    foot: ['', 'Period total', '', '', money(periodTotal), ''],
    columnStyles: { 2: { halign: 'right' }, 4: { halign: 'right' } },
  })

  brandFooter(doc)
  return doc
}

export function generateProjectReportPdf(args) {
  saveDoc(buildProjectReportDoc(args), `project-report_${args.project?.code || 'project'}_${args.start}_to_${args.end}`)
}
