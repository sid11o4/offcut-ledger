import { AppProvider, useApp } from './state/AppContext';
import Nav from './components/Nav';
import Watermark from './components/Watermark';
import Toast from './components/Toast';
import InventoryTab from './components/tabs/InventoryTab';
import CutlistTab from './components/tabs/CutlistTab';
import ResultsTab from './components/tabs/ResultsTab';
import LabelsTab from './components/tabs/LabelsTab';
import ProjectsTab from './components/tabs/ProjectsTab';

const TAB_COMPONENTS = {
  inventory: InventoryTab,
  cutlist: CutlistTab,
  results: ResultsTab,
  labels: LabelsTab,
  projects: ProjectsTab,
};

function Shell() {
  const { state } = useApp();
  const ActiveTab = TAB_COMPONENTS[state.tab] || InventoryTab;

  return (
    <>
      <Watermark />
      <div id="shell">
        <Nav />
        <main id="main">
          {state.loading ? <p className="sub">Loading…</p> : <ActiveTab />}
        </main>
      </div>
      <Toast />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
