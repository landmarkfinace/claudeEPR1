// Client-side "Download PDF" for the ERP's printable documents.
//
// Every print surface in the app renders a `.print-area` (either an explicit
// stack of A4 `.doc-page` elements or one flowing document). This helper
// captures exactly that markup with html2canvas-pro and assembles a real A4
// PDF via jsPDF — one PDF page per `.doc-page`, or smart white-row slices for
// flowing documents — so users get a direct download instead of opening the
// browser print dialog and choosing "Save as PDF" manually.
//
// Fidelity notes:
//   • screen-only decorations (`.print:hidden`) are hidden during capture;
//   • print-only content (`.print:block`, `.print:table-row`) is revealed,
//   so the PDF matches what paper would show;
//   • orientation is derived per page (portrait default, landscape when the
//     captured element is wider than tall, e.g. the salary sheet);
//   • captures run at 2× scale (~190 DPI) for crisp text.
//
// All callers pass the clicked button as `anchor` so the helper can scope the
// search when several print-areas exist in the DOM (an open dialog's document
// wins over the page behind it).
import { toast } from 'sonner'

/** A4 page size in mm. */
const A4 = { w: 210, h: 297 } as const

type Orientation = 'portrait' | 'landscape'

/** One assembled PDF page: the image and where it sits on the A4 sheet. */
type PdfPage = {
  dataUrl: string
  orientation: Orientation
  x: number
  y: number
  w: number
  h: number
}

/** Module-level busy guard — prevents double-click double downloads. */
let busy = false

/** Find the print-area the user is looking at. */
function findPrintRoot(anchor?: HTMLElement | null): HTMLElement | null {
  // When triggered from inside a dialog, scope to that dialog's content —
  // the page behind it may have its own (visible) inline print-area.
  const dialog = anchor?.closest('[data-slot="dialog-content"]')
  const scopes: ParentNode[] = []
  if (dialog) scopes.push(dialog)
  scopes.push(document)

  for (const scope of scopes) {
    const candidates = [...scope.querySelectorAll<HTMLElement>('.print-area')]
    for (const el of candidates) {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) return el
    }
    if (candidates.length > 0) return candidates[0]
  }
  return null
}

/** The capture targets: explicit A4 `.doc-page`s, or the flowing document. */
function captureTargets(root: HTMLElement): HTMLElement[] {
  const pages = [...root.querySelectorAll<HTMLElement>('.doc-page')].filter(
    (el) => el.offsetWidth > 0 && el.offsetHeight > 0
  )
  if (pages.length > 0) return pages
  // A scrollable print-area wraps the document as its first child
  // (VAT return · name list · agreement dialogs) — capture the document.
  const style = getComputedStyle(root)
  if (
    (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
    root.firstElementChild instanceof HTMLElement
  ) {
    return [root.firstElementChild]
  }
  return [root]
}

type Restore = () => void

/** Emulate the print stylesheet's display rules during capture. */
function applyPrintDisplay(root: HTMLElement): Restore {
  const tweaks: Array<{ el: HTMLElement; prev: string; next: string }> = []
  const hide = root.querySelectorAll<HTMLElement>('.print\\:hidden')
  for (const el of hide) {
    if (el.closest('.print-area') !== root && el !== root) continue
    tweaks.push({ el, prev: el.style.display, next: 'none' })
  }
  const show = root.querySelectorAll<HTMLElement>('.print\\:block, .print\\:table-row')
  for (const el of show) {
    if (el.closest('.print-area') !== root && el !== root) continue
    tweaks.push({
      el,
      prev: el.style.display,
      next: el.tagName === 'TR' ? 'table-row' : 'block',
    })
  }
  for (const t of tweaks) t.el.style.display = t.next
  return () => {
    for (const t of tweaks) t.el.style.display = t.prev
  }
}

/** True when a horizontal pixel row is (near) blank — a safe page-cut point. */
function isBlankRow(ctx: CanvasRenderingContext2D, w: number, y: number): boolean {
  const row = ctx.getImageData(0, y, w, 1).data
  let dirty = 0
  let samples = 0
  for (let x = 0; x < w; x += 6) {
    const i = x * 4
    samples++
    if (row[i] < 246 || row[i + 1] < 246 || row[i + 2] < 246) dirty++
  }
  return samples > 0 && dirty / samples <= 0.005
}

/**
 * Slice a tall capture into A4-height pages, snapping each cut to the nearest
 * blank row (within a small window) so text lines and table rows survive.
 */
function sliceFlowingCapture(
  canvas: HTMLCanvasElement,
  pageWmm: number,
  pageHmm: number
): PdfPage[] {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return [
      {
        dataUrl: canvas.toDataURL('image/png'),
        orientation: pageWmm > pageHmm ? 'landscape' : 'portrait',
        x: 0,
        y: 0,
        w: pageWmm,
        h: canvas.height / (canvas.width / pageWmm),
      },
    ]
  }

  const pxPerMm = canvas.width / pageWmm
  const docHmm = canvas.height / pxPerMm
  const orientation: Orientation = pageWmm > pageHmm ? 'landscape' : 'portrait'

  // Fits one page (with a little slack) — place it as-is, shrink slightly.
  if (docHmm <= pageHmm * 1.08) {
    const s = Math.min(1, pageHmm / docHmm)
    const w = pageWmm * s
    const h = docHmm * s
    return [
      {
        dataUrl: canvas.toDataURL('image/png'),
        orientation,
        x: (pageWmm - w) / 2,
        y: 0,
        w,
        h,
      },
    ]
  }

  const pageHpx = Math.round(pageHmm * pxPerMm)
  const minPagePx = Math.round(pageHpx * 0.55)
  const scanPx = Math.round(pageHpx * 0.12)

  const cuts: number[] = [0]
  let y = 0
  while (y + pageHpx < canvas.height) {
    let cut = y + pageHpx
    const scanFloor = Math.max(y + minPagePx, cut - scanPx)
    if (scanFloor < cut) {
      for (let cy = cut; cy >= scanFloor; cy--) {
        if (isBlankRow(ctx, canvas.width, cy)) {
          cut = cy
          break
        }
      }
    }
    cuts.push(cut)
    y = cut
  }
  cuts.push(canvas.height)

  const pages: PdfPage[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const h = cuts[i + 1] - cuts[i]
    if (h <= 0) continue
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = h
    const sctx = slice.getContext('2d')
    if (!sctx) continue
    sctx.drawImage(canvas, 0, cuts[i], canvas.width, h, 0, 0, canvas.width, h)
    pages.push({
      dataUrl: slice.toDataURL('image/png'),
      orientation,
      x: 0,
      y: 0,
      w: pageWmm,
      h: h / pxPerMm,
    })
  }
  return pages
}

function sanitizeFilename(name: string): string {
  const clean = name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return clean || 'document'
}

/** Orientation for a captured element, matching the print stylesheet. */
function orientationFor(el: HTMLElement, root: HTMLElement): Orientation {
  if (el.classList.contains('doc-page')) {
    // Explicit A4 sheets carry their orientation in their aspect ratio.
    return el.offsetWidth > el.offsetHeight ? 'landscape' : 'portrait'
  }
  // Flowing documents: the print stylesheet decides — `.print-landscape`
  // marks landscape surfaces (salary sheet, advances, summaries), and a
  // `data-orientation="landscape"` attribute covers dynamic cases (the
  // expense statement flips per mode). Everything else prints portrait.
  if (root.classList.contains('print-landscape')) return 'landscape'
  const attr = el.closest('[data-orientation]')?.getAttribute('data-orientation')
  if (attr === 'landscape') return 'landscape'
  return 'portrait'
}

/**
 * Capture the active `.print-area` and download it as an A4 PDF.
 * Shows progress via toasts; safe to fire repeatedly (busy-guarded).
 */
export async function downloadPrintAreaAsPdf(
  filename: string,
  anchor?: HTMLElement | null
): Promise<void> {
  if (busy) return
  const root = findPrintRoot(anchor)
  if (!root) {
    toast.error('Nothing to export — open the document first.')
    return
  }

  busy = true
  const toastId = toast.loading('Preparing PDF…')
  const restore = applyPrintDisplay(root)

  try {
    // Wait for webfonts so Arabic/bilingual labels render correctly.
    if (document.fonts?.ready) await document.fonts.ready

    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas-pro'),
      import('jspdf'),
    ])

    const targets = captureTargets(root)
    const pages: PdfPage[] = []

    for (const el of targets) {
      const canvas = await html2canvas(el, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      })
      if (canvas.width === 0 || canvas.height === 0) continue

      const orientation = orientationFor(el, root)
      const pageWmm = orientation === 'landscape' ? A4.h : A4.w
      const pageHmm = orientation === 'landscape' ? A4.w : A4.h

      if (el.classList.contains('doc-page')) {
        // Explicit A4 sheet — one PDF page, aspect-true.
        const w = pageWmm
        const h = (canvas.height / canvas.width) * pageWmm
        pages.push({
          dataUrl: canvas.toDataURL('image/png'),
          orientation,
          x: 0,
          y: h > pageHmm ? (pageHmm - h) / 2 : 0,
          w,
          h: Math.min(h, pageHmm),
        })
      } else {
        // Flowing document — sliced into A4 pages with smart white-row cuts.
        pages.push(...sliceFlowingCapture(canvas, pageWmm, pageHmm))
      }
    }

    if (pages.length === 0) {
      toast.error('Could not capture the document.', { id: toastId })
      return
    }

    const pdf = new jsPDF({
      orientation: pages[0].orientation,
      unit: 'mm',
      format: 'a4',
      compress: true,
    })
    pages.forEach((p, i) => {
      if (i > 0) pdf.addPage('a4', p.orientation)
      pdf.addImage(p.dataUrl, 'PNG', p.x, p.y, p.w, p.h)
    })
    pdf.save(`${sanitizeFilename(filename)}.pdf`)

    toast.success('PDF downloaded.', { id: toastId })
  } catch (e) {
    console.error('[print-to-pdf]', e)
    toast.error('Could not generate the PDF — try the Print option instead.', {
      id: toastId,
    })
  } finally {
    restore()
    busy = false
  }
}
