import { useApp } from '../state/AppContext';

const TABS = [
  { id: 'inventory', idx: '01', label: 'Inventory' },
  { id: 'cutlist', idx: '02', label: 'Match Cutlist' },
  { id: 'results', idx: '03', label: 'Results' },
  { id: 'labels', idx: '04', label: 'Labels' },
  { id: 'projects', idx: '05', label: 'Projects' },
];

export default function Nav() {
  const { state, setTab } = useApp();
  return (
    <nav>
      <div className="brand">
        <div className="t1">OFFCUT<br />LEDGER</div>
        <div className="t2">STOCK-FIRST CUTTING</div>
      </div>
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`tab${state.tab === t.id ? ' active' : ''}`}
          onClick={() => setTab(t.id)}
        >
          <span className="idx">{t.idx}</span> {t.label}
        </button>
      ))}
      <div className="footnote">Inventory persists<br />across all projects.<br /><br />© Formgrid Interior<br />Solutions — proprietary</div>
    </nav>
  );
}
