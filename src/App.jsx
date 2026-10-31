import { Routes, Route, Navigate } from 'react-router-dom'
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
import Ledger from './pages/Reports/Ledger'
import ProjectReport from './pages/Reports/ProjectReport'
import IncomeExpenseStatement from './pages/IncomeExpenseStatement'
import Masters from './pages/Masters/Masters'
import UsersPermissions from './pages/UsersPermissions'
import AuditLog from './pages/AuditLog'
import DesignBuildDashboard from './pages/DesignBuild/DesignBuildDashboard'
import DesignProjectsList from './pages/DesignBuild/ProjectsList'
import DesignProjectDashboard from './pages/DesignBuild/ProjectDashboard'
import CompanyInventory from './pages/DesignBuild/CompanyInventory'
import AccountsLedger from './pages/DesignBuild/AccountsLedger'
import ManualSlip from './pages/DesignBuild/ManualSlip'
import DesignExpensesList from './pages/DesignBuild/DesignExpensesList'
import DesignRecurringExpenses from './pages/DesignBuild/DesignRecurringExpenses'
import DesignProjectReport from './pages/DesignBuild/ProjectReport'
import DesignReports from './pages/DesignBuild/DesignReports'
import { ConsolidatedReport, SupplierList, SupplierStatement } from './pages/DesignBuild/StatementPages'
import AccountsOverview from './pages/Accounts/AccountsOverview'
import BillAuditQueue from './pages/Accounts/BillAuditQueue'
import BankReconciliation from './pages/Accounts/BankReconciliation'
import GstFollowUp from './pages/Accounts/GstFollowUp'

export default function App() {
  const { session } = useAuth()

  return (
    <Routes>
      {/* Was `session ? <Dashboard/> : <Login/>` -- rendered Dashboard in place, still at
          the /login URL and outside <Layout>, so every successful first login landed the
          user on a dead-end page with no sidebar, header, nav, search, or sign-out button.
          Redirect instead, so a fresh login goes through the normal Layout-wrapped tree. */}
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
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
        <Route path="ledger" element={<RequirePermission perm="financial_reports"><Ledger /></RequirePermission>} />
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

        <Route path="design-build" element={<RequirePermission perm="design_build_manage"><DesignBuildDashboard /></RequirePermission>} />
        <Route path="design-build/projects" element={<RequirePermission perm="design_build_manage"><DesignProjectsList /></RequirePermission>} />
        <Route path="design-build/projects/:id" element={<RequirePermission perm="design_build_manage"><DesignProjectDashboard /></RequirePermission>} />
        <Route path="design-build/projects/:id/report" element={<RequirePermission perm="design_build_manage"><DesignProjectReport /></RequirePermission>} />
        <Route path="design-build/reports/projects" element={<RequirePermission perm="design_build_manage"><DesignReports section="projects" /></RequirePermission>} />
        <Route path="design-build/reports/expenses" element={<RequirePermission perm="design_build_manage"><DesignReports section="expenses" /></RequirePermission>} />
        <Route path="design-build/reports/materials" element={<RequirePermission perm="design_build_manage"><DesignReports section="materials" /></RequirePermission>} />
        <Route path="design-build/reports/consolidated" element={<RequirePermission perm="design_build_manage"><ConsolidatedReport /></RequirePermission>} />
        <Route path="design-build/suppliers" element={<RequirePermission perm="supplier_bills_manage"><SupplierList /></RequirePermission>} />
        <Route path="design-build/suppliers/:id" element={<RequirePermission perm="supplier_bills_manage"><SupplierStatement /></RequirePermission>} />
        <Route path="design-build/reports/labour" element={<RequirePermission perm="design_build_manage"><DesignReports section="labour" /></RequirePermission>} />
        <Route path="design-build/inventory" element={<RequirePermission perm="inventory_operate"><CompanyInventory /></RequirePermission>} />
        <Route path="design-build/ledger" element={<RequirePermission perm="supplier_bills_manage"><AccountsLedger /></RequirePermission>} />
        <Route path="design-build/slip"element={<RequirePermission perm="inventory_operate"><ManualSlip /></RequirePermission>} />
        <Route path="design-build/expenses" element={<RequirePermission perm="design_build_manage"><DesignExpensesList /></RequirePermission>} />
        <Route path="design-build/recurring-expenses" element={<RequirePermission perm="design_build_manage"><DesignRecurringExpenses /></RequirePermission>} />

        <Route path="accounts" element={<RequirePermission perm="supplier_bills_manage"><AccountsOverview /></RequirePermission>} />
        <Route path="accounts/bills" element={<RequirePermission perm="supplier_bills_manage"><BillAuditQueue /></RequirePermission>} />
        <Route path="accounts/bank" element={<RequirePermission perm="bank_reconciliation"><BankReconciliation /></RequirePermission>} />
        <Route path="accounts/gst" element={<RequirePermission perm="gst_compliance"><GstFollowUp /></RequirePermission>} />
      </Route>
    </Routes>
  )
}
