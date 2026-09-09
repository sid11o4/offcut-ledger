import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card } from '../../components/ui'
import MasterCrudTable from '../../components/MasterCrudTable'
import { useUnits, useMachines, useProcesses, useRateCategories, useExpenseCategories, useAppSettings } from '../../lib/queries'
import JobWorkServicesTab from './JobWorkServicesTab'
import RatesTab from './RatesTab'

const TABS = [
  'Machines', 'Processes', 'Units', 'Job Work & Combinations', 'Rate Categories', 'Rates', 'Expense Categories', 'Company Info',
]

export default function Masters() {
  const [tab, setTab] = useState(TABS[0])

  return (
    <div>
      <PageHeader title="Masters / Settings" subtitle="Configurable factory setup — nothing here is hard-coded into the app." />
      <div className="flex flex-wrap gap-1 mb-4 border-b border-ink-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Machines' && <MachinesTab />}
      {tab === 'Processes' && <ProcessesTab />}
      {tab === 'Units' && <UnitsTab />}
      {tab === 'Job Work & Combinations' && <JobWorkServicesTab />}
      {tab === 'Rate Categories' && <RateCategoriesTab />}
      {tab === 'Rates' && <RatesTab />}
      {tab === 'Expense Categories' && <ExpenseCategoriesTab />}
      {tab === 'Company Info' && <CompanyInfoTab />}
    </div>
  )
}

function CompanyInfoTab() {
  const settingsQ = useAppSettings()
  const toast = useToast()
  const qc = useQueryClient()
  const { profile } = useAuth()
  const [form, setForm] = useState(null)
  const s = form || settingsQ.data

  async function save(e) {
    e.preventDefault()
    const { error } = await supabase.from('app_settings').update({
      company_name: s.company_name, company_address: s.company_address, company_phone: s.company_phone,
      company_email: s.company_email, company_gst_number: s.company_gst_number,
      default_tax_percent: Number(s.default_tax_percent) || 0, updated_by: profile?.id,
    }).eq('id', true)
    if (error) return toast.error(error.message)
    toast.success('Company info updated. New estimates/bills will use this.')
    qc.invalidateQueries({ queryKey: ['app_settings'] })
  }

  if (!s) return null
  return (
    <Card title="Company Info" className="max-w-lg">
      <p className="text-xs text-ink-500 mb-3">Appears on the letterhead of printed estimates and bills.</p>
      <form onSubmit={save} className="space-y-3">
        <div><label className="field-label">Company Name</label><input className="field-input" value={s.company_name || ''} onChange={(e) => setForm({ ...s, company_name: e.target.value })} /></div>
        <div><label className="field-label">Address</label><textarea className="field-input" rows={2} value={s.company_address || ''} onChange={(e) => setForm({ ...s, company_address: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="field-label">Phone</label><input className="field-input" value={s.company_phone || ''} onChange={(e) => setForm({ ...s, company_phone: e.target.value })} /></div>
          <div><label className="field-label">Email</label><input className="field-input" value={s.company_email || ''} onChange={(e) => setForm({ ...s, company_email: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="field-label">GST Number</label><input className="field-input" value={s.company_gst_number || ''} onChange={(e) => setForm({ ...s, company_gst_number: e.target.value })} /></div>
          <div><label className="field-label">Default Tax %</label><input className="field-input" type="number" step="0.01" value={s.default_tax_percent ?? 0} onChange={(e) => setForm({ ...s, default_tax_percent: e.target.value })} /></div>
        </div>
        <button type="submit" className="btn-primary">Save</button>
      </form>
    </Card>
  )
}

function MachinesTab() {
  const query = useMachines()
  return (
    <MasterCrudTable
      table="machines" queryKey={['machines']} title="Machines" query={query}
      fields={[
        { name: 'code', label: 'Code', required: true },
        { name: 'name', label: 'Name', required: true },
        { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
    />
  )
}

function ProcessesTab() {
  const query = useProcesses()
  const machines = useMachines()
  const units = useUnits()
  return (
    <MasterCrudTable
      table="processes" queryKey={['processes']} title="Processes" query={query}
      fields={[
        { name: 'code', label: 'Code', required: true },
        { name: 'name', label: 'Name', required: true },
        {
          name: 'machine_id', label: 'Machine', type: 'select', required: true,
          options: (machines.data || []).map((m) => ({ value: m.id, label: m.name })),
          render: (row) => row.machines?.name || '—',
        },
        {
          name: 'default_unit_id', label: 'Default Unit', type: 'select',
          options: (units.data || []).map((u) => ({ value: u.id, label: u.name })),
          render: (row) => row.units?.name || '—',
        },
        { name: 'description', label: 'Description', type: 'textarea' },
      ]}
    />
  )
}

function UnitsTab() {
  const query = useUnits()
  return (
    <MasterCrudTable
      table="units" queryKey={['units']} title="Units of Measurement" query={query}
      fields={[
        { name: 'code', label: 'Code', required: true },
        { name: 'name', label: 'Name', required: true },
        { name: 'description', label: 'Description', type: 'textarea' },
      ]}
    />
  )
}

function RateCategoriesTab() {
  const query = useRateCategories()
  return (
    <MasterCrudTable
      table="rate_categories" queryKey={['rate_categories']} title="Rate Categories" query={query}
      fields={[
        { name: 'code', label: 'Code', required: true },
        { name: 'name', label: 'Name', required: true },
        { name: 'description', label: 'Description', type: 'textarea' },
      ]}
    />
  )
}

function ExpenseCategoriesTab() {
  const query = useExpenseCategories()
  return (
    <MasterCrudTable
      table="expense_categories" queryKey={['expense_categories']} title="Expense Categories" query={query}
      fields={[
        { name: 'code', label: 'Code', required: true },
        { name: 'name', label: 'Name', required: true },
        { name: 'description', label: 'Description', type: 'textarea' },
      ]}
    />
  )
}
