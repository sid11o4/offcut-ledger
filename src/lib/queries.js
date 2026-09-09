import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabaseClient'

function list(table, { select = '*', order = 'name', ascending = true, filters } = {}) {
  return async () => {
    let q = supabase.from(table).select(select)
    if (filters) q = filters(q)
    q = q.order(order, { ascending })
    const { data, error } = await q
    if (error) throw error
    return data
  }
}

export function useUnits() {
  return useQuery({ queryKey: ['units'], queryFn: list('units') })
}
export function useMachines() {
  return useQuery({ queryKey: ['machines'], queryFn: list('machines') })
}
export function useProcesses() {
  return useQuery({
    queryKey: ['processes'],
    queryFn: list('processes', { select: '*, machines(name), units(name,code)' }),
  })
}
export function useRateCategories() {
  return useQuery({ queryKey: ['rate_categories'], queryFn: list('rate_categories') })
}
export function useExpenseCategories() {
  return useQuery({ queryKey: ['expense_categories'], queryFn: list('expense_categories') })
}
export function useJobWorkServices() {
  return useQuery({
    queryKey: ['job_work_services'],
    queryFn: list('job_work_services', { select: '*, units(name,code), processes(name, machines(name))' }),
  })
}
export function useJobWorkComponents() {
  return useQuery({ queryKey: ['job_work_components'], queryFn: list('job_work_components', { order: 'sort_order' }) })
}
export function useClients() {
  return useQuery({ queryKey: ['clients'], queryFn: list('clients') })
}
export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: list('projects', { select: '*, clients(name, code), rate_categories(name)' }),
  })
}
export function useRates() {
  return useQuery({ queryKey: ['rates'], queryFn: list('rates', { order: 'effective_from' }) })
}
export function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: list('roles') })
}
export function usePermissions() {
  return useQuery({ queryKey: ['permissions'], queryFn: list('permissions', { order: 'label' }) })
}
export function useAppSettings() {
  return useQuery({
    queryKey: ['app_settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('*').single()
      if (error) throw error
      return data
    },
  })
}
