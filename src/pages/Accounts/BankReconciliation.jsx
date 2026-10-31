import { useState } from 'react'
import Papa from 'papaparse'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Card, Badge, EmptyState, LoadingBlock } from '../../components/ui'
import { money } from '../../lib/format'
import { displayDate } from '../../lib/dates'

// Bank statement import (CSV) + candidate matching against RTGS/NEFT allocations. The +/-1%
// tolerance match is computed in SQL (suggest_bank_matches) -- reliable for exact amount/UTR/
// date comparison, which an LLM would only approximate.
export default function BankReconciliation() {
  const toast = useToast()
  const qc = useQueryClient()
  const { profile } = useAuth()
  const [importing, setImporting] = useState(false)

  const unmatchedQ = useQuery({
    queryKey: ['bank_unmatched'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bank_transactions').select('*').eq('matched', false).gt('debit_amount', 0).order('txn_date', { ascending: false })
      if (error) throw error
      return data
    },
  })

  function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (results) => {
        try {
          const { data: imp, error: impErr } = await supabase.from('bank_statement_imports').insert({
            file_name: file.name, row_count: results.data.length, imported_by: profile.id,
          }).select().single()
          if (impErr) throw impErr

          const rows = results.data.map((r) => ({
            import_id: imp.id,
            txn_date: r['Txn Date'] || r['Date'] || r['date'],
            description: r['Description'] || r['Narration'] || r['description'],
            debit_amount: Number(r['Debit'] || r['Withdrawal Amt.'] || r['debit'] || 0) || 0,
            credit_amount: Number(r['Credit'] || r['Deposit Amt.'] || r['credit'] || 0) || 0,
            balance: Number(r['Balance'] || r['balance'] || 0) || null,
            utr_reference: r['Reference No.'] || r['UTR'] || r['Chq./Ref.No.'] || null,
            raw_row: r,
          })).filter((r) => r.txn_date)

          const { error: insErr } = await supabase.from('bank_transactions').insert(rows)
          if (insErr && insErr.code !== '23505') throw insErr // 23505 = duplicate dedupe_key, expected on re-import

          toast.success(`Imported ${rows.length} rows (duplicates skipped automatically).`)
          qc.invalidateQueries({ queryKey: ['bank_unmatched'] })
        } catch (err) {
          toast.error(err.message || String(err))
        } finally {
          setImporting(false)
        }
      },
    })
  }

  return (
    <div>
      <PageHeader
        title="Bank Reconciliation"
        subtitle="Import the SBI statement; confirm each proposed match before it counts as paid."
        actions={
          <label className="btn-primary cursor-pointer">
            {importing ? 'Importing…' : '+ Import statement (CSV)'}
            <input type="file" accept=".csv" className="hidden" disabled={importing} onChange={handleFile} />
          </label>
        }
      />
      <Card>
        {unmatchedQ.isLoading ? <LoadingBlock /> : !unmatchedQ.data?.length ? (
          <EmptyState title="Nothing unmatched" hint="Import a statement to see debits here." />
        ) : (
          <div className="space-y-3">
            {unmatchedQ.data.map((bt) => <BankRow key={bt.id} txn={bt} />)}
          </div>
        )}
      </Card>
    </div>
  )
}

function BankRow({ txn }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const candidatesQ = useQuery({
    queryKey: ['bank_matches', txn.id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('suggest_bank_matches', { p_bank_transaction_id: txn.id })
      if (error) throw error
      return data
    },
  })

  async function confirm(paymentId) {
    const { error } = await supabase.rpc('confirm_bank_match', { p_bank_transaction_id: txn.id, p_payment_id: paymentId })
    if (error) return toast.error(error.message)
    toast.success('Matched.')
    qc.invalidateQueries({ queryKey: ['bank_unmatched'] })
  }

  return (
    <div className="border border-ink-100 rounded-md p-3">
      <button className="w-full flex items-center justify-between text-left" onClick={() => setOpen((o) => !o)}>
        <div>
          <div className="text-sm text-ink-900">{txn.description}</div>
          <div className="text-xs text-ink-500">{displayDate(txn.txn_date)} {txn.utr_reference && `· ${txn.utr_reference}`}</div>
        </div>
        <span className="tnum font-medium">{money(txn.debit_amount)}</span>
      </button>
      {open && (
        <div className="mt-2 pt-2 border-t border-ink-100">
          {candidatesQ.isLoading ? <LoadingBlock /> : !candidatesQ.data?.length ? (
            <div className="text-xs text-ink-500">No candidate within 1% of this amount.</div>
          ) : (
            <div className="space-y-1.5">
              {candidatesQ.data.map((c) => (
                <div key={c.payment_id} className="flex items-center justify-between text-sm">
                  <span>{c.internal_bill_number} · {c.supplier_name}</span>
                  <span className="tnum">{money(c.allocated_amount)}</span>
                  {c.utr_matches && <Badge tone="ok">UTR matches</Badge>}
                  <button className="btn-secondary text-xs" onClick={() => confirm(c.payment_id)}>Confirm match</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
