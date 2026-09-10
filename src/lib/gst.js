// GST helpers shared by New Bill, Bill Detail and the bill PDF so all three show the same
// numbers. A bill stores the NOMINAL statutory rate (tax_percent) plus a gst_treatment; the
// CGST/SGST split is always half + half of the effective rate and is derived here, not stored.

export const GST_TREATMENTS = [
  { value: 'full', label: 'Full GST' },
  { value: 'half_waiver', label: '50% GST waiver' },
  { value: 'full_waiver', label: 'Full GST waiver' },
]

export function gstMultiplier(treatment) {
  if (treatment === 'full_waiver') return 0
  if (treatment === 'half_waiver') return 0.5
  return 1
}

export function gstTreatmentLabel(treatment) {
  return GST_TREATMENTS.find((t) => t.value === treatment)?.label || 'Full GST'
}

// subtotal in rupees, nominalPct e.g. 18, treatment one of the values above.
// Returns effective/half rates, the CGST & SGST amounts (which always sum to the total tax),
// the total, and a human note when a waiver applies.
export function computeGst(subtotal, nominalPct, treatment = 'full') {
  const sub = Number(subtotal) || 0
  const nominal = Number(nominalPct) || 0
  const mult = gstMultiplier(treatment)
  const effectivePct = nominal * mult
  const halfPct = effectivePct / 2
  const total = Math.round(sub * effectivePct) / 100
  const cgst = Math.round(sub * halfPct) / 100
  const sgst = Math.round((total - cgst) * 100) / 100

  let note = null
  if (treatment === 'full_waiver') note = `GST fully waived (statutory ${nominal}%).`
  else if (treatment === 'half_waiver') note = `50% GST waiver applied (statutory ${nominal}%, effective ${effectivePct}%).`

  return { nominalPct: nominal, treatment, mult, effectivePct, halfPct, cgst, sgst, total, note }
}
