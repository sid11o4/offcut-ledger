import { Routes, Route } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { ProtectedRoute, RequirePermission } from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import DailyLog from './pages/DailyLog'
import ProjectsList from './pages/Projects/ProjectsList'
import ProjectDetail from './pages/Projects/ProjectDetail'
import ClientsList from './pages/Clients/ClientsList'
import JobWork from './pages/JobWork'
import EstimatesList from './pages/Estimates/EstimatesList'
import EstimateDetail from './pages/Estimates/EstimateDetail'
import BillingHome from './pages/Billing/BillingHome'
import NewBill from './pages/Billing/NewBill'
import BillDetail from './pages/Billing/BillDetail'
import ExpensesList from './pages/Expenses/ExpensesList'
import RecurringExpenses from './pages/Expenses/RecurringExpenses'
import Reports from './pages/Reports/Reports'
import ProjectReport from './pages/Reports/ProjectReport'
import IncomeExpenseStatement from './pages/IncomeExpenseStatement'
import Masters from './pages/Masters/Masters'
import UsersPermissions from './pages/UsersPermissions'
import AuditLog from './pages/AuditLog'

export default function App() {
  const { session } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={session ? <Dashboard /> : <Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="daily-log" element={<DailyLog />} />
        <Route path="projects" element={<ProjectsList />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="clients" element={<ClientsList />} />
        <Route path="job-work" element={<JobWork />} />
        <Route path="estimates" element={<EstimatesList />} />
        <Route path="estimates/:id" element={<EstimateDetail />} />
        <Route path="billing" element={<RequirePermission perm="billing"><BillingHome /></RequirePermission>} />
        <Route path="billing/new" element={<RequirePermission perm="billing"><NewBill /></RequirePermission>} />
        <Route path="billing/:id" element={<RequirePermission perm="billing"><BillDetail /></RequirePermission>} />
        <Route path="expenses" element={<ExpensesList />} />
        <Route
          path="recurring-expenses"
          element={<RequirePermission perm="expense_manage"><RecurringExpenses /></RequirePermission>}
        />
        <Route path="reports" element={<Reports />} />
        <Route path="reports/projects/:id" element={<ProjectReport />} />
        <Route
          path="statement"
          element={<RequirePermission perm="financial_reports"><IncomeExpenseStatement /></RequirePermission>}
        />
        <Route path="masters" element={<RequirePermission perm="master_data"><Masters /></RequirePermission>} />
        <Route path="users" element={<RequirePermission perm="user_manage"><UsersPermissions /></RequirePermission>} />
        <Route
          path="audit-log"
          element={<RequirePermission perm="financial_reports"><AuditLog /></RequirePermission>}
        />
      </Route>
    </Routes>
  )
}
