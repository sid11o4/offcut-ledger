// FORMGRID symbol, from the studio's quotation template. Colour comes from CSS (fill/stroke).
export function Symbol({ className = 'fg-symbol', title = 'FORMGRID' }) {
  return (
    <svg className={className} viewBox="0 0 77 78" role="img" aria-label={title}>
      <path d="M44 0H76V21H29L25 25V42H1Z" />
      <path d="M46 33H76V55H29L25 60V77H0Z" />
    </svg>
  )
}
