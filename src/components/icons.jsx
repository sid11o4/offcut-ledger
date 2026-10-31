// A small, consistent set of hand-drawn outline icons: 18px, ~1.6px stroke, round caps/joins --
// one set, grey, per the dealt style's rail rules. Deliberately minimal rather than pulling in
// an icon library dependency.
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }

const PATHS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  log: <><path d="M4 4h16M4 10h16M4 16h10" /><circle cx="19" cy="16" r="2.5" /></>,
  project: <><path d="M3 7l9-4 9 4-9 4-9-4Z" /><path d="M3 12l9 4 9-4M3 17l9 4 9-4" /></>,
  client: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" /><circle cx="17.5" cy="7.5" r="2.5" /><path d="M16 13.2c2.9.5 5 2.9 5 5.8" /></>,
  tool: <><path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17l1 1 5.3-5.3a4 4 0 0 1 5.4-5.4l-2.7 2.7 1 1 2.7-2.7Z" /></>,
  estimate: <><path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M9 12h6M9 16h6M9 8h3" /></>,
  bill: <><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><circle cx="17" cy="14.5" r="1.3" /></>,
  recur: <><path d="M4 11a8 8 0 0 1 14.5-4.5M20 13a8 8 0 0 1-14.5 4.5" /><path d="M18.5 3v4h-4M5.5 21v-4h4" /></>,
  report: <><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></>,
  statement: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5 9-5Z" /><path d="M3 13l9 5 9-5M3 8.5v5M21 8.5v5" /></>,
  inventory: <><path d="M3 7l9-4 9 4v10l-9 4-9-4V7Z" /><path d="M3 7l9 4 9-4M12 11v10" /></>,
  transfer: <><path d="M4 7h13M13 3l4 4-4 4" /><path d="M20 17H7M11 21l-4-4 4-4" /></>,
  queue: <><rect x="3" y="4" width="18" height="4" rx="1" /><rect x="3" y="10" width="18" height="4" rx="1" /><rect x="3" y="16" width="12" height="4" rx="1" /></>,
  bank: <><path d="M3 10l9-6 9 6" /><path d="M5 10v9M9.5 10v9M14.5 10v9M19 10v9" /><path d="M3 21h18" /></>,
  compliance: <><path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6l7-3Z" /><path d="M9 12l2 2 4-4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14 2h-4l-.5 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9c.8.7 1.6 1.2 2.6 1.5L10 22h4l.5-2.4a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4-2-1.5Z" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M19 13.3c2 .7 3.5 2.9 3.5 5.7" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v4.5h4.5" /><path d="M12 7v5l3.5 2" /></>,
  ledger: <><rect x="3" y="3" width="18" height="18" rx="1.5" /><path d="M12 3v18M3 9h18M3 15h18" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevron: <path d="M8 5l8 7-8 7" />,
}

export default function Icon({ name, size = 18, className = '' }) {
  const d = PATHS[name]
  if (!d) return null
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      {d}
    </svg>
  )
}
