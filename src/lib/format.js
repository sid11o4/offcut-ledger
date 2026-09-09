const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

export function money(value) {
  const n = Number(value ?? 0)
  return inr.format(n)
}

export function qty(value) {
  const n = Number(value ?? 0)
  return num.format(n)
}
