// Client print pipeline — SERVER-RENDERED VECTOR PDFs for the ERP's
// printable documents.
//
// Every print surface renders a `.print-area` (a stack of fixed A4
// `.doc-page` sheets, or one flowing document). Instead of rasterizing that
// markup with html2canvas (which froze text into a low-resolution image and
// broke Arabic shaping), the DOM is serialized as-is and sent to
// POST /api/print-pdf. A headless Chromium on the server lays it out with the
// app's own compiled CSS + webfonts and exports it with
// page.pdf({ format:'A4', printBackground:true, margin:0, scale:1,
// preferCSSPageSize:true }) — real, selectable, infinitely-sharp vector text
// with embedded fonts, and images kept at their original resolution.
//
//   downloadPrintAreaAsPdf(filename, anchor)  → direct PDF download
//   printPrintArea(anchor)                   → print the server PDF (the
//                                              Print buttons use this)
//
// All callers pass the clicked button as `anchor` so the helper can scope the
// search when several print-areas exist in the DOM (an open dialog's document
// wins over the page behind it).
import { toast } from 'sonner'

import { getAuthToken } from './api-client'

type Orientation = 'portrait' | 'landscape'
type PageMode = 'sheets' | 'flow'

/** Module-level busy guard — prevents double-click double jobs. */
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

/**
 * Serialize the print root for the server:
 *   • canvases (QR codes) become <img data:…> — outerHTML loses canvas pixels
 *   • live input/textarea values are written into the markup
 *   • a preview zoom transform (scale-only) on the root is dropped; stamp
 *     rotations (rotate) are always kept
 */
function serializeRoot(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement

  // canvases → data-URL images (same document order)
  const liveCanvases = [...root.querySelectorAll('canvas')] as HTMLCanvasElement[]
  const cloneCanvases = [...clone.querySelectorAll('canvas')]
  liveCanvases.forEach((canvas, i) => {
    const target = cloneCanvases[i]
    if (!target) return
    try {
      const img = document.createElement('img')
      img.src = canvas.toDataURL('image/png')
      img.style.width = `${canvas.width}px`
      img.style.height = `${canvas.height}px`
      target.replaceWith(img)
    } catch {}
  })

  // form control values (print views rarely use them, but be safe)
  const liveInputs = [
    ...root.querySelectorAll('input, textarea'),
  ] as Array<HTMLInputElement | HTMLTextAreaElement>
  const cloneInputs = [...clone.querySelectorAll('input, textarea')]
  liveInputs.forEach((el, i) => {
    const target = cloneInputs[i] as HTMLInputElement | HTMLTextAreaElement
    if (!target) return
    if (el instanceof HTMLTextAreaElement) target.textContent = el.value
    else target.setAttribute('value', el.value)
  })

  // drop a preview zoom on the root itself (never a rotation)
  const style = clone.getAttribute('style') ?? ''
  if (/transform\s*:[^;]*scale/.test(style) && !/rotate/.test(style)) {
    clone.style.transform = ''
  }

  return clone.outerHTML
}

/** Orientation + pagination mode for the payload. */
function describePayload(root: HTMLElement): {
  orientation: Orientation
  pageMode: PageMode
} {
  const pages = [...root.querySelectorAll<HTMLElement>('.doc-page')].filter(
    (el) => el.offsetWidth > 0 && el.offsetHeight > 0
  )
  if (pages.length > 0) {
    // Explicit A4 sheets carry their orientation in their aspect ratio.
    const first = pages[0]
    return {
      orientation: first.offsetWidth > first.offsetHeight ? 'landscape' : 'portrait',
      pageMode: 'sheets',
    }
  }
  // Flowing documents: the print stylesheet decides — `.print-landscape`
  // marks landscape surfaces (salary sheet, advances, summaries), and a
  // `data-orientation="landscape"` attribute covers dynamic cases (the
  // expense statement flips per mode). Everything else prints portrait.
  if (root.classList.contains('print-landscape')) {
    return { orientation: 'landscape', pageMode: 'flow' }
  }
  const attr = root
    .closest('[data-orientation]')
    ?.getAttribute('data-orientation')
  return {
    orientation: attr === 'landscape' ? 'landscape' : 'portrait',
    pageMode: 'flow',
  }
}

async function buildServerPdf(
  root: HTMLElement
): Promise<Blob> {
  const { orientation, pageMode } = describePayload(root)
  const html = serializeRoot(root)
  const token = getAuthToken()
  const res = await fetch('/api/print-pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ html, orientation, pageMode }),
  })
  if (!res.ok) {
    throw new Error(`print-pdf failed (${res.status})`)
  }
  return await res.blob()
}

function sanitizeFilename(name: string): string {
  const clean = name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return clean || 'document'
}

/**
 * Capture the active `.print-area` and download it as an exact A4 vector PDF
 * rendered on the server. Shows progress via toasts; busy-guarded.
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
  try {
    const blob = await buildServerPdf(root)
    if (blob.size === 0) throw new Error('empty pdf')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${sanitizeFilename(filename)}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
    toast.success('PDF downloaded.', { id: toastId })
  } catch (e) {
    console.error('[print-to-pdf]', e)
    toast.error('Could not generate the PDF — try again in a moment.', {
      id: toastId,
    })
  } finally {
    busy = false
  }
}

/**
 * Print the active `.print-area` by rendering the SERVER PDF and handing it
 * to the browser's print pipeline — vector text on paper, exactly the letter
 * the screen preview shows. Falls back to the browser's own print when the
 * PDF viewer cannot be driven programmatically.
 */
export async function printPrintArea(anchor?: HTMLElement | null): Promise<void> {
  if (busy) return
  const root = findPrintRoot(anchor)
  if (!root) {
    toast.error('Nothing to print — open the document first.')
    return
  }

  busy = true
  const toastId = toast.loading('Preparing print…')
  try {
    const blob = await buildServerPdf(root)
    if (blob.size === 0) throw new Error('empty pdf')
    const url = URL.createObjectURL(blob)

    // Hidden iframe → Chrome's PDF viewer → print dialog on the PDF itself.
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.src = url
    document.body.appendChild(iframe)

    let printed = false
    const doPrint = () => {
      try {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
        printed = true
      } catch {}
    }
    iframe.addEventListener('load', () => {
      // PDF viewer needs a beat to lay out the document before printing.
      setTimeout(doPrint, 350)
    })
    // Safety: if the load event never fires (blocked viewer), open a tab.
    setTimeout(() => {
      if (!printed) {
        window.open(url, '_blank', 'noopener')
        toast.info('PDF opened in a new tab — press Ctrl+P to print.', { id: toastId })
      } else {
        toast.success('Sent to printer.', { id: toastId })
      }
      setTimeout(() => {
        iframe.remove()
        URL.revokeObjectURL(url)
      }, 60_000)
      busy = false
    }, 4_000)
  } catch (e) {
    console.error('[print-to-pdf]', e)
    toast.error('Could not prepare the print — try again in a moment.', {
      id: toastId,
    })
    busy = false
  }
}
