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

// For PDFs: jsPDF's built-in fonts (Helvetica/Times/Courier) are WinAnsi-encoded and have no
// glyph for the Indian Rupee sign (₹), which renders as garbage. Use the standard "Rs."
// prefix instead -- conventional and readable on Indian invoices/statements. Always two
// decimal places, like a proper financial document.
const inrPlain = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export function pdfMoney(value) {
  const n = Number(value ?? 0)
  return `Rs. ${inrPlain.format(n)}`
}
