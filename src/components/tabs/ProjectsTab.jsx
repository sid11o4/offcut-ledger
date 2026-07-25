import { useState } from 'react';
import { useApp } from '../../state/AppContext';

export default function ProjectsTab() {
  const { state, openProject, deleteProjectAction } = useApp();
  const [confirmId, setConfirmId] = useState(null);

  return (
    <div>
      <h1 className="page">Projects</h1>
      <p className="sub">Every saved project keeps its own matched panels, remaining panels, and settings — labels and the cutting schedule regenerate from that saved data anytime. Inventory itself is shared and always reflects current live stock, not a per-project snapshot.</p>

      <div className="card">
        <h2>Saved projects ({state.projects.length})</h2>
        {!state.projects.length ? (
          <div className="empty">No projects saved yet. Run a match and use &quot;Save to project history&quot; on the Results tab.</div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead><tr>
                <th>Name</th><th>Saved</th><th>Cutlist File</th><th>Matched</th><th>Remaining</th><th>Kerf</th><th></th>
              </tr></thead>
              <tbody>
                {state.projects.map((p) => {
                  const remainingQty = (p.remaining || []).reduce((s, r) => s + (parseInt(r['ITEM-QTY']) || 1), 0);
                  return (
                    <tr key={p.id}>
                      <td style={{ whiteSpace: 'normal', maxWidth: 220 }}>{p.name}</td>
                      <td>{new Date(p.savedAt).toLocaleString()}</td>
                      <td style={{ whiteSpace: 'normal', maxWidth: 200 }}>{p.cutlistFileName || ''}</td>
                      <td>{(p.matched || []).length}</td>
                      <td>{remainingQty}</td>
                      <td>{p.kerf}mm</td>
                      <td style={{ display: 'flex', gap: 6 }}>
                        <button className="btn secondary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => openProject(p)}>Open</button>
                        {confirmId !== p.id ? (
                          <button className="icon-del" onClick={() => setConfirmId(p.id)}>✕</button>
                        ) : (
                          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            <button className="btn" style={{ padding: '5px 10px', fontSize: 12, background: 'var(--rust)', borderColor: 'var(--rust)' }} onClick={async () => { await deleteProjectAction(p.id); setConfirmId(null); }}>Delete</button>
                            <button className="btn secondary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setConfirmId(null)}>Cancel</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
