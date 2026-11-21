import { PDFDocument } from 'pdf-lib'

// Page-level handling of an uploaded PDF so each bill in it is scanned on its own.

export async function pdfPageCount(file) {
  const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
  return doc.getPageCount()
}

// A new PDF holding only the given 1-based pages, in order.
export async function extractPdfPages(file, pages, name) {
  const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, pages.map((p) => p - 1))
  copied.forEach((pg) => out.addPage(pg))
  const bytes = await out.save()
  return new File([bytes], name, { type: 'application/pdf' })
}

// Each page its own group: [[1], [2], ...]
export const eachPage = (count) => Array.from({ length: count }, (_, i) => [i + 1])

// The file name for part n of a split PDF: "bill.pdf" -> "bill_p2-3.pdf"
export function partName(fileName, pages) {
  const base = fileName.replace(/\.pdf$/i, '')
  const label = pages.length === 1 ? `p${pages[0]}` : `p${pages[0]}-${pages[pages.length - 1]}`
  return `${base}_${label}.pdf`
}
