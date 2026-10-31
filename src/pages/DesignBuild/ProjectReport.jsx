import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { PageHeader, Card, StatCard, EmptyState, LoadingBlock } from '../../components/ui'
import { useAppSettings } from '../../lib/queries'
import { downloadDesignProjectReport } from '../../lib/designProjectReportPdf'
import { displayDate } from '../../lib/dates'
import { money, qty } from '../../lib/format'

const FAR_PAST = '2000-01-01'
const FAR_FUTURE = '2100-01-01'

// Everything the project report needs, gathered once so the page and the PDF show the same numbers.
async function loadProjectReport(id) {
  const [projectR, financialsR, ledgerR, expensesR, locationR, billsR] = await Promise.all([
    supabase.from('design_projects').select('*, clients(name)').eq('id', id).single(),
    supabase.rpc('report_design_project_financials', { p_design_project_id: id }),
    supabase.rpc('design_build_ledger', { p_start: FAR_PAST, p_end: FAR_FUTURE }),
    supabase.from('design_build_expenses').select('amount, expense_date, description, source, expense_categories(name)')
      .eq('design_project_id', id).eq('status', 'active'),
    supabase.from('inventory_locations').select('id').eq('design_project_id', id).maybeSingle(),
    supabase.from('supplier_bills').select('id, bill_date, supplier_text, remarks, grand_total, expense_nature, suppliers(name)')
      .eq('design_project_id', id).eq('status', 'approved'),
  ])
  for (const r of [projectR, financialsR, ledgerR, expensesR, locationR, billsR]) {
    if (r.error) throw r.error
  }

  const project = projectR.data
  const f = financialsR.data?.[0] || {}
  const expenses = expensesR.data || []
  const bills = billsR.data || []
  const ledger = (ledgerR.data || []).filter((r) => r.design_project_id === id)

  // Expenses by category: the two bill-driven lines first, then each expense category.
  const byCategory = new Map()
  const add = (name, amount) => byCategory.set(name, (byCategory.get(name) || 0) + Number(amount))
  add('Supplier bills', f.supplier_bills_total || 0)
  add('Internal Order (Factory job-work)', f.internal_order_total || 0)
  for (const x of expenses) add(x.expense_categories?.name || 'Uncategorised', x.amount)
  const categories = [...byCategory.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)

  const spent = Number(f.supplier_bills_total || 0) + Number(f.internal_order_total || 0) + Number(f.direct_expenses_total || 0)
  const budget = Number(f.budget || 0)
  const headroom = budget - spent
  const ledgerTotal = ledger.reduce((s, r) => s + Number(r.amount), 0)

  // Materials consumed from this project's stock, at average cost.
  let materials = []
  if (locationR.data?.id) {
    const { data, error } = await supabase
      .from('inventory_transactions')
      .select('quantity, total_cost, inventory_items(name, units(code))')
      .eq('location_id', locationR.data.id)
      .eq('txn_type', 'consumption')
    if (error) throw error
    const grouped = new Map()
    for (const t of data || []) {
      const key = t.inventory_items?.name || 'Unknown item'
      const row = grouped.get(key) || { name: key, unit: t.inventory_items?.units?.code, quantity: 0, cost: 0 }
      row.quantity += Math.abs(Number(t.quantity))
      row.cost += Math.abs(Number(t.total_cost))
      grouped.set(key, row)
    }
    materials = [...grouped.values()].sort((a, b) => b.cost - a.cost)
  }

  // Labour: approved bills tagged labour, plus expenses whose category is labour.
  const labour = [
    ...bills.filter((b) => b.expense_nature === 'labour').map((b) => ({
      date: b.bill_date, description: b.remarks || 'Labour bill', party: b.suppliers?.name || b.supplier_text || '—', amount: Number(b.grand_total),
    })),
    ...expenses.filter((x) => /labour/i.test(x.expense_categories?.name || '')).map((x) => ({
      date: x.expense_date, description: x.description || 'Labour', party: x.expense_categories?.name, amount: Number(x.amount),
    })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)))

  return {
    project, budget, spent, headroom, categories, materials, labour, ledger, ledgerTotal,
    financials: f,
    mixedBillCount: bills.filter((b) => b.expense_nature === 'both').length,
  }
}

export default function DesignProjectReport() {
  const { id } = useParams()
  const settingsQ = useAppSettings()
  const reportQ = useQuery({
    queryKey: ['design_project_report', id],
    queryFn: () => loadProjectReport(id),
  })

  if (reportQ.isLoading) return <LoadingBlock />
  if (reportQ.error) return <EmptyState title="Could not load the report" hint={reportQ.error.message} />
  const r = reportQ.data
  const { project, financials: f } = r

  function downloadPdf() {
    downloadDesignProjectReport({ settings: settingsQ.data, project, data: r })
  }

  return (
    <div>
      <PageHeader
        title={`${project.name} · Report`}
        subtitle={`${project.code || ''} · ${project.clients?.name || 'No client set'}`}
        actions={
          <div className="flex gap-2">
            <Link className="btn-secondary" to={`/design-build/projects/${id}`}>Back to dashboard</Link>
            <button className="btn-primary" onClick={downloadPdf}>Download PDF</button>
          </div>
        }
      />

      <Card title="Dashboard" className="mb-5">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard label="Budget" value={r.budget ? money(r.budget) : '—'} money />
          <StatCard label="Supplier bills" value={money(f.supplier_bills_total)} money />
          <StatCard label="Internal Order" value={money(f.internal_order_total)} money />
          <StatCard label="Direct expenses" value={money(f.direct_expenses_total)} money />
          <StatCard label="Inventory on hand" value={money(f.current_inventory_value)} money />
        </div>
      </Card>

      <Card title="Overall details and cash position" className="mb-5">
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-ink-500">Total spent</dt><dd className="num font-medium">{money(r.spent)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-500">Budget</dt><dd className="num font-medium">{r.budget ? money(r.budget) : 'No budget set'}</dd></div>
          <div className="flex justify-between">
            <dt className="text-ink-500">Budget headroom</dt>
            <dd className={`num font-medium ${r.headroom >= 0 ? 'text-ok' : 'text-bad'}`}>
              {r.budget ? `${money(r.headroom)} (${r.headroom >= 0 ? 'positive' : 'negative'})` : '—'}
            </dd>
          </div>
          <div className="flex justify-between"><dt className="text-ink-500">Paid out in the ledger</dt><dd className="num font-medium">{money(r.ledgerTotal)}</dd></div>
          <div className="flex justify-between md:col-span-2"><dt className="text-ink-500">Client receipts</dt><dd className="text-ink-500">Not recorded for Design Build projects yet, so cash in is not shown.</dd></div>
        </dl>
      </Card>

      <Card title="Expenses by category" className="mb-5">
        {!r.categories.length ? <EmptyState title="No expenses recorded" /> : (
          <table className="table-base">
            <thead><tr><th>Category</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {r.categories.map((c) => (
                <tr key={c.name}><td>{c.name}</td><td className="num">{money(c.amount)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td className="font-medium">Total</td><td className="num font-medium">{money(r.spent)}</td></tr></tfoot>
          </table>
        )}
      </Card>

      <Card title="Materials consumed" className="mb-5">
        {!r.materials.length ? <EmptyState title="No materials consumed" /> : (
          <table className="table-base">
            <thead><tr><th>Material</th><th className="num">Quantity</th><th className="num">Cost</th></tr></thead>
            <tbody>
              {r.materials.map((m) => (
                <tr key={m.name}><td>{m.name}</td><td className="num">{qty(m.quantity)} {m.unit}</td><td className="num">{money(m.cost)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td className="font-medium">Total</td><td /><td className="num font-medium">{money(r.materials.reduce((s, m) => s + m.cost, 0))}</td></tr></tfoot>
          </table>
        )}
      </Card>

      <Card title="Labour" className="mb-5">
        {!r.labour.length ? <EmptyState title="No labour recorded" /> : (
          <table className="table-base">
            <thead><tr><th>Date</th><th>Description</th><th>Supplier / category</th><th className="num">Cost</th></tr></thead>
            <tbody>
              {r.labour.map((l, i) => (
                <tr key={i}><td>{displayDate(l.date)}</td><td>{l.description}</td><td>{l.party}</td><td className="num">{money(l.amount)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3} className="font-medium">Total</td><td className="num font-medium">{money(r.labour.reduce((s, l) => s + l.amount, 0))}</td></tr></tfoot>
          </table>
        )}
        {r.mixedBillCount > 0 && (
          <p className="text-xs text-ink-500 mt-3">{r.mixedBillCount} bill(s) are marked material and labour together, so they are counted in supplier bills, not labour.</p>
        )}
      </Card>

      <Card title="Ledger statement (all payments)" className="mb-5">
        {!r.ledger.length ? <EmptyState title="No transactions yet" /> : (
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Reference</th><th className="num">Out</th></tr></thead>
              <tbody>
                {r.ledger.map((x) => (
                  <tr key={`${x.reference_type}-${x.reference_id}`}>
                    <td>{displayDate(x.txn_date)}</td><td>{x.category}</td><td>{x.description}</td><td>{x.reference}</td>
                    <td className="num">{money(x.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={4} className="font-medium">Total</td><td className="num font-medium">{money(r.ledgerTotal)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
