import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { displayDate } from './dates'
import { money, qty } from './format'

// Deterministic, reproducible document generation (spec section 49): same data always
// produces the same PDF -- no random ids, no "generated at" timestamp affecting layout.
function documentHeader(doc, settings, docTitle, meta) {
  doc.setFontSize(14)
  doc.setFont(undefined, 'bold')
  doc.text(settings?.company_name || 'Formgrid Factory', 14, 18)
  doc.setFont(undefined, 'normal')
  doc.setFontSize(9)
  let y = 24
  if (settings?.company_address) { doc.text(settings.company_address, 14, y); y += 5 }
  const contactBits = [settings?.company_phone, settings?.company_email].filter(Boolean).join('  ·  ')
  if (contactBits) { doc.text(contactBits, 14, y); y += 5 }
  if (settings?.company_gst_number) { doc.text(`GSTIN: ${settings.company_gst_number}`, 14, y); y += 5 }

  doc.setFontSize(16)
  doc.setFont(undefined, 'bold')
  doc.text(docTitle, 196, 18, { align: 'right' })
  doc.setFont(undefined, 'normal')
  doc.setFontSize(9)
  let my = 26
  for (const [label, value] of meta) {
    doc.text(`${label}: ${value}`, 196, my, { align: 'right' })
    my += 5
  }
  return Math.max(y, my) + 4
}

function billToBlock(doc, y, client, project) {
  doc.setFontSize(9)
  doc.setFont(undefined, 'bold')
  doc.text('Bill To', 14, y)
  doc.setFont(undefined, 'normal')
  y += 5
  doc.text(client?.name || '—', 14, y)
  y += 5
  if (client?.address) { doc.text(client.address, 14, y, { maxWidth: 90 }); y += 5 }
  if (client?.gst_number) { doc.text(`GSTIN: ${client.gst_number}`, 14, y); y += 5 }
  if (project) { doc.text(`Project: ${project.name}`, 14, y); y += 5 }
  return y + 4
}

function totalsBlock(doc, y, { subtotal, taxPercent, taxAmount, adjustments, grandTotal }) {
  const lines = [['Subtotal', money(subtotal)]]
  if (Number(taxPercent) > 0) lines.push([`Tax (${taxPercent}%)`, money(taxAmount)])
  if (Number(adjustments)) lines.push(['Adjustments', money(adjustments)])
  lines.push(['Grand Total', money(grandTotal)])

  let ty = y
  for (const [label, value] of lines) {
    const bold = label === 'Grand Total'
    doc.setFont(undefined, bold ? 'bold' : 'normal')
    doc.setFontSize(bold ? 11 : 9)
    doc.text(label, 150, ty)
    doc.text(value, 196, ty, { align: 'right' })
    ty += bold ? 7 : 5.5
  }
  return ty
}

export function generateEstimatePdf({ settings, estimate, client, project, rateCategory, items }) {
  const doc = new jsPDF()
  let y = documentHeader(doc, settings, 'ESTIMATE', [
    ['Estimate #', estimate.estimate_number],
    ['Date', displayDate(estimate.estimate_date)],
    ['Validity', estimate.validity_date ? displayDate(estimate.validity_date) : '—'],
    ['Rate Category', rateCategory?.name || '—'],
  ])
  y = billToBlock(doc, y, client, project)

  autoTable(doc, {
    startY: y,
    head: [['Job Work', 'Quantity', 'Unit', 'Rate', 'Amount']],
    body: items.map((it) => [it.service_name, qty(it.quantity), it.unit_name, money(it.rate), money(it.amount)]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [15, 76, 129] },
    margin: { left: 14, right: 14 },
  })

  let ty = doc.lastAutoTable.finalY + 8
  ty = totalsBlock(doc, ty, {
    subtotal: estimate.subtotal, taxPercent: estimate.tax_percent, taxAmount: estimate.tax_amount,
    adjustments: 0, grandTotal: estimate.grand_total,
  })

  if (estimate.notes) {
    ty += 8
    doc.setFontSize(9)
    doc.setFont(undefined, 'bold')
    doc.text('Notes', 14, ty)
    doc.setFont(undefined, 'normal')
    doc.text(estimate.notes, 14, ty + 5, { maxWidth: 180 })
  }

  doc.save(`${estimate.estimate_number}.pdf`)
}

export function generateBillPdf({ settings, bill, client, project, items }) {
  const doc = new jsPDF()
  let y = documentHeader(doc, settings, 'BILL', [
    ['Bill #', bill.bill_number],
    ['Date', displayDate(bill.bill_date)],
    ['Period', bill.billing_period_start ? `${displayDate(bill.billing_period_start)} – ${displayDate(bill.billing_period_end)}` : '—'],
    ['Status', String(bill.status).toUpperCase()],
  ])
  y = billToBlock(doc, y, client, project)

  autoTable(doc, {
    startY: y,
    head: [['Date', 'Job Work', 'Quantity', 'Unit', 'Amount']],
    body: items.map((it) => [displayDate(it.entry_date), it.service_name, qty(it.quantity), it.unit_name, money(it.amount)]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [15, 76, 129] },
    margin: { left: 14, right: 14 },
  })

  let ty = doc.lastAutoTable.finalY + 8
  ty = totalsBlock(doc, ty, {
    subtotal: bill.subtotal, taxPercent: bill.tax_percent, taxAmount: bill.tax_amount,
    adjustments: bill.adjustments, grandTotal: bill.grand_total,
  })

  if (bill.notes) {
    ty += 8
    doc.setFontSize(9)
    doc.setFont(undefined, 'bold')
    doc.text('Notes', 14, ty)
    doc.setFont(undefined, 'normal')
    doc.text(bill.notes, 14, ty + 5, { maxWidth: 180 })
  }

  doc.save(`${bill.bill_number}.pdf`)
}
