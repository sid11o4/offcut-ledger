import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, Card, Badge, EmptyState, LoadingBlock } from '../components/ui'
import { useJobWorkServices, useJobWorkComponents, useRateCategories, useRates } from '../lib/queries'
import { useAuth } from '../context/AuthContext'
import { findEffectiveRate } from '../lib/calc'
import { today } from '../lib/dates'
import { money } from '../lib/format'

export default function JobWork() {
  const servicesQ = useJobWorkServices()
  const componentsQ = useJobWorkComponents()
  const categoriesQ = useRateCategories()
  const ratesQ = useRates()
  const { hasPermission } = useAuth()

  const services = (servicesQ.data || []).filter((s) => s.active)
  const components = componentsQ.data || []
  const categories = (categoriesQ.data || []).filter((c) => c.active)
  const rates = ratesQ.data || []

  const componentSummary = useMemo(() => {
    const map = {}
    for (const s of services) {
      if (!s.is_composite) continue
      map[s.id] = components
        .filter((c) => c.service_id === s.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => {
          const cs = services.find((x) => x.id === c.component_service_id)
          return { name: cs?.name || '?', multiplier: c.multiplier }
        })
    }
    return map
  }, [services, components])

  const isLoading = servicesQ.isLoading || componentsQ.isLoading || categoriesQ.isLoading || ratesQ.isLoading

  return (
    <div>
      <PageHeader
        title="Job Work Catalog"
        subtitle="What can be logged in the Daily Log, and today's rate by client type."
        actions={hasPermission('master_data') && <Link to="/masters" className="btn-secondary">Manage in Masters →</Link>}
      />
      {isLoading ? <LoadingBlock /> : !services.length ? <EmptyState title="No job-work configured yet" /> : (
        <Card>
          <div className="overflow-x-auto -mx-4">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Job Work</th>
                  <th>Unit</th>
                  <th>Made of</th>
                  {categories.map((c) => <th key={c.id}>{c.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">
                      {s.name} {s.is_composite && <Badge tone="brand">combination</Badge>}
                    </td>
                    <td>{s.units?.name}</td>
                    <td className="text-xs text-ink-500">
                      {s.is_composite
                        ? componentSummary[s.id]?.map((c) => `${c.name} ×${c.multiplier}`).join(' + ')
                        : s.processes?.machines?.name}
                    </td>
                    {categories.map((cat) => (
                      <td key={cat.id}>
                        {s.is_composite ? (
                          <CompositeRate service={s} category={cat} components={componentSummary[s.id]} services={services} rates={rates} />
                        ) : (
                          (() => {
                            const r = findEffectiveRate(rates, s.id, cat.id, today())
                            return r === null ? <span className="text-ink-300">—</span> : money(r)
                          })()
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

function CompositeRate({ category, components, services, rates }) {
  if (!components?.length) return <span className="text-ink-300">—</span>
  let total = 0
  for (const c of components) {
    const svc = services.find((s) => s.name === c.name)
    if (!svc) return <span className="text-ink-300">—</span>
    const r = findEffectiveRate(rates, svc.id, category.id, today())
    if (r === null) return <span className="text-ink-300">—</span>
    total += r * c.multiplier
  }
  return <span>{money(total)} <span className="text-ink-400 text-xs">/unit</span></span>
}
