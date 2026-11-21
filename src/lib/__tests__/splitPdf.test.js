// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { pdfPageCount, extractPdfPages, eachPage, partName } from '../splitPdf'

async function makePdf(pages) {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]).drawText(`page ${i + 1}`)
  return new File([await doc.save()], 'scan.pdf', { type: 'application/pdf' })
}

describe('splitPdf', () => {
  it('counts pages', async () => {
    expect(await pdfPageCount(await makePdf(5))).toBe(5)
  })
  it('extracts the chosen pages in order into a new PDF', async () => {
    const f = await makePdf(5)
    const part = await extractPdfPages(f, [2, 3], partName('scan.pdf', [2, 3]))
    expect(part.name).toBe('scan_p2-3.pdf')
    expect(part.type).toBe('application/pdf')
    expect(await pdfPageCount(part)).toBe(2)
    expect(await pdfPageCount(f)).toBe(5)
  })
  it('splits every page', async () => {
    const f = await makePdf(3)
    const parts = await Promise.all(eachPage(3).map((g) => extractPdfPages(f, g, partName('scan.pdf', g))))
    expect(parts.map((p) => p.name)).toEqual(['scan_p1.pdf', 'scan_p2.pdf', 'scan_p3.pdf'])
    for (const p of parts) expect(await pdfPageCount(p)).toBe(1)
  })
})
