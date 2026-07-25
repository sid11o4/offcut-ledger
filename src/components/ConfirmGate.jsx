import { useState } from 'react';

// A "I've reviewed this" checkbox that gates one or more action buttons — a deliberate
// re-audit step before costly real-world actions (cutting, stock changes).
export default function ConfirmGate({ label, children }) {
  const [checked, setChecked] = useState(false);
  return (
    <>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, margin: '12px 0', cursor: 'pointer', lineHeight: 1.4 }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ marginTop: 2 }} />
        <span dangerouslySetInnerHTML={{ __html: label }} />
      </label>
      {children(checked)}
    </>
  );
}
