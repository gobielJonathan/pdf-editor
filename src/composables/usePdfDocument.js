/**
 * usePdfDocument
 * Handles loading, rendering, and exporting PDFs.
 * Rendering  : pdfjs-dist  (read-only canvas render + text extraction)
 * Exporting  : pdf-lib     (write modified text back into the PDF)
 */

import { ref, shallowRef, reactive, readonly } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

// Point pdfjs to the worker file (copied into /public by vite-plugin-static-copy)
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

// ─── Constants ───────────────────────────────────────────────────────────────
const RENDER_SCALE = 1.8   // canvas resolution multiplier
const DISPLAY_SCALE = 1.0  // CSS display scale (100 %)

// ─── Composable ──────────────────────────────────────────────────────────────
export function usePdfDocument() {
  const pdfDoc        = shallowRef(null)   // pdfjs PDFDocumentProxy — must NOT be deep-proxied
  const rawBytes      = shallowRef(null)   // owned Uint8Array — never shared with pdfjs worker
  const pageCount     = ref(0)
  const currentPage   = ref(1)
  const isLoading     = ref(false)
  const loadError     = ref(null)
  const fileName      = ref('')

  // Per-page state: Map<pageNum, { canvas, textItems, edits }>
  const pages = reactive(new Map())

  // ── load ────────────────────────────────────────────────────────────────────
  async function loadFile(file) {
    isLoading.value = true
    loadError.value = null
    pages.clear()

    try {
      fileName.value = file.name.replace(/\.pdf$/i, '')
      const buffer   = await file.arrayBuffer()
      // Store our own Uint8Array copy; give pdfjs a separate copy so its worker
      // can freely transfer that buffer without detaching ours.
      rawBytes.value = new Uint8Array(buffer.slice(0))
      const data     = new Uint8Array(buffer)
      pdfDoc.value   = await pdfjsLib.getDocument({ data }).promise
      pageCount.value = pdfDoc.value.numPages
      currentPage.value = 1

      // Pre-populate page slots
      for (let p = 1; p <= pageCount.value; p++) {
        pages.set(p, { rendered: false, textItems: [], edits: new Map(), additions: [], formats: new Map() })
      }
    } catch (err) {
      loadError.value = err.message || 'Failed to load PDF'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // ── renderPage ──────────────────────────────────────────────────────────────
  /**
   * Renders a PDF page onto a <canvas> element and returns extracted text items.
   * @param {number}           pageNum     1-based page number
   * @param {HTMLCanvasElement} canvas     target canvas
   * @returns {Promise<TextItem[]>}
   */
  async function renderPage(pageNum, canvas) {
    if (!pdfDoc.value) return []

    const page     = await pdfDoc.value.getPage(pageNum)
    const viewport = page.getViewport({ scale: RENDER_SCALE })

    canvas.width  = viewport.width
    canvas.height = viewport.height
    canvas.style.width  = `${viewport.width  * DISPLAY_SCALE}px`
    canvas.style.height = `${viewport.height * DISPLAY_SCALE}px`

    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise

    // Extract text
    const content   = await page.getTextContent()
    const textItems = buildTextItems(content.items, viewport)

    // Cache
    const slot = pages.get(pageNum) || { rendered: false, textItems: [], edits: new Map(), additions: [], formats: new Map() }
    slot.rendered   = true
    slot.viewport   = viewport
    slot.pageWidth  = page.view[2]   // in user units (points)
    slot.pageHeight = page.view[3]
    slot.textItems  = textItems
    pages.set(pageNum, slot)

    return textItems
  }

  // ── buildTextItems ──────────────────────────────────────────────────────────
  /**
   * Convert raw pdfjs text content items into UI-ready objects with CSS geometry.
   * NOTE: In pdfjs-dist v5 Util.applyTransform mutates in place → we clone first.
   */
  function buildTextItems(rawItems, viewport) {
    const items = []
    const vt = viewport.transform   // [a,b,c,d,e,f]

    for (const item of rawItems) {
      if (!item.str || !item.str.trim()) continue

      const tx = item.transform[4]
      const ty = item.transform[5]

      // Apply viewport transform (clone array because applyTransform mutates)
      const pt = [tx, ty]
      pdfjsLib.Util.applyTransform(pt, vt)
      const [px, py] = pt

      // Font end-point to compute pixel font-size
      const fontSizeUser = Math.abs(item.transform[3] || item.transform[0] || 12)
      const ptFontEnd = [tx, ty + fontSizeUser]
      pdfjsLib.Util.applyTransform(ptFontEnd, vt)
      const fontSizePx = Math.abs(ptFontEnd[1] - py)

      // Text pixel width
      const widthPx = Math.max(
        item.width * Math.abs(item.transform[0] || 1) * viewport.scale,
        fontSizePx * 0.5,
      )

      items.push({
        id:          `${items.length}`,
        str:         item.str,
        fontName:    item.fontName ?? '',
        // PDF user-space coords (for pdf-lib export)
        pdfX:        tx,
        pdfY:        ty,
        pdfFontSize: fontSizeUser,
        pdfWidth:    item.width,
        // CSS coords on canvas overlay
        left:        px,
        top:         py - fontSizePx,
        width:       widthPx,
        height:      fontSizePx * 1.3,
        fontSize:    fontSizePx,
      })
    }
    return items
  }

  // ── recordEdit ──────────────────────────────────────────────────────────────
  function recordEdit(pageNum, itemId, newText) {
    const slot = pages.get(pageNum)
    if (!slot) return
    if (newText === null || newText === undefined) {
      slot.edits.delete(itemId)
    } else {
      slot.edits.set(itemId, newText)
    }
  }

  function hasEdits() {
    for (const slot of pages.values()) {
      if (slot.edits?.size > 0) return true
      if (slot.additions?.length > 0) return true
      if (slot.formats?.size > 0) return true
    }
    return false
  }

  // ── additions mutators ───────────────────────────────────────────────────────
  function recordAddition(pageNum, addition) {
    const slot = pages.get(pageNum)
    if (!slot) return
    if (!slot.additions) slot.additions = []
    slot.additions.push(addition)
  }

  function removeAddition(pageNum, id) {
    const slot = pages.get(pageNum)
    if (!slot?.additions) return
    const idx = slot.additions.findIndex(a => a.id === id)
    if (idx !== -1) slot.additions.splice(idx, 1)
  }

  function updateAddition(pageNum, id, changes) {
    const slot = pages.get(pageNum)
    if (!slot?.additions) return
    const addition = slot.additions.find(a => a.id === id)
    if (addition) Object.assign(addition, changes)
  }

  // ── clearAllEdits ────────────────────────────────────────────────────────────
  function clearAllEdits() {
    for (const slot of pages.values()) {
      slot.edits?.clear()
      slot.formats?.clear()
      if (slot.additions) slot.additions.splice(0)
    }
  }

  // ── recordTextFormat ────────────────────────────────────────────────────────
  /**
   * Records bold/italic/underline/fontFamily for an existing PDF text item.
   * Also ensures the item appears in slot.edits so applyEdits will redraw it.
   */
  function recordTextFormat(pageNum, itemId, format) {
    const slot = pages.get(pageNum)
    if (!slot) return
    if (!slot.formats) slot.formats = new Map()
    slot.formats.set(itemId, { ...format })
    // Ensure applyEdits will redraw this item even if text hasn't changed
    if (!slot.edits.has(itemId)) {
      const item = slot.textItems.find(t => t.id === itemId)
      if (item) slot.edits.set(itemId, item.str)
    }
  }

  // ── font helpers ─────────────────────────────────────────────────────────────
  async function embedAllFonts(doc) {
    const [
      Helvetica, HelveticaBold, HelveticaOblique, HelveticaBoldOblique,
      TimesRoman,
      Courier, CourierBold, CourierOblique, CourierBoldOblique,
    ] = await Promise.all([
      doc.embedFont(StandardFonts.Helvetica),
      doc.embedFont(StandardFonts.HelveticaBold),
      doc.embedFont(StandardFonts.HelveticaOblique),
      doc.embedFont(StandardFonts.HelveticaBoldOblique),
      doc.embedFont(StandardFonts.TimesRoman),
      doc.embedFont(StandardFonts.Courier),
      doc.embedFont(StandardFonts.CourierBold),
      doc.embedFont(StandardFonts.CourierOblique),
      doc.embedFont(StandardFonts.CourierBoldOblique),
    ])
    return { Helvetica, HelveticaBold, HelveticaOblique, HelveticaBoldOblique,
             TimesRoman,
             Courier, CourierBold, CourierOblique, CourierBoldOblique }
  }

  function pickFont(fonts, fontFamily, bold, italic) {
    const fam = fontFamily || 'Helvetica'
    if (fam === 'TimesRoman') {
      if (bold && italic) return fonts.TimesBoldItalic
      if (bold)           return fonts.TimesBold
      if (italic)         return fonts.TimesItalic
      return fonts.TimesRoman
    }
    if (fam === 'Courier') {
      if (bold && italic) return fonts.CourierBoldOblique
      if (bold)           return fonts.CourierBold
      if (italic)         return fonts.CourierOblique
      return fonts.Courier
    }
    // Helvetica (default)
    if (bold && italic) return fonts.HelveticaBoldOblique
    if (bold)           return fonts.HelveticaBold
    if (italic)         return fonts.HelveticaOblique
    return fonts.Helvetica
  }

  function drawUnderline(libPage, x, y, text, font, fs) {
    const tw = font.widthOfTextAtSize(text, fs)
    libPage.drawLine({
      start: { x, y: y - fs * 0.12 },
      end:   { x: x + tw, y: y - fs * 0.12 },
      thickness: Math.max(fs * 0.05, 0.5),
      color: rgb(0, 0, 0),
    })
  }

  // ── applyEdits ─────────────────────────────────────────────────────────────
  /**
   * Bakes all current edits into rawBytes (in-memory PDF), then reloads pdfjs
   * so subsequent renders reflect the updated content.
   * Does NOT trigger a download.
   */
  async function applyEdits() {
    if (!rawBytes.value) throw new Error('No PDF loaded')

    // rawBytes.value is a Uint8Array; .slice() gives a fresh owned copy for pdf-lib
    const pdfLibDoc   = await PDFDocument.load(rawBytes.value.slice())
    const fonts       = await embedAllFonts(pdfLibDoc)
    const pdfLibPages = pdfLibDoc.getPages()

    for (const [pageNum, slot] of pages.entries()) {
      if ((!slot.edits || slot.edits.size === 0) && (!slot.additions || slot.additions.length === 0)) continue

      const libPage = pdfLibPages[pageNum - 1]
      const pageH   = libPage.getHeight()

      for (const item of slot.textItems) {
        if (!slot.edits.has(item.id)) continue
        const newText = slot.edits.get(item.id)
        const fmt  = slot.formats?.get(item.id) ?? {}
        const font = pickFont(fonts, fmt.fontFamily, fmt.bold, fmt.italic)
        const fs   = Math.min(Math.max(item.pdfFontSize, 5), 72)

        libPage.drawRectangle({
          x: item.pdfX - 1, y: item.pdfY - fs * 0.2,
          width: item.pdfWidth + 2, height: fs * 1.3,
          color: rgb(1, 1, 1), opacity: 1,
        })
        if (newText.trim()) {
          libPage.drawText(newText, {
            x: item.pdfX, y: item.pdfY,
            size: fs, font, color: rgb(0, 0, 0),
            maxWidth: item.pdfWidth * 2,
          })
          if (fmt.underline) drawUnderline(libPage, item.pdfX, item.pdfY, newText, font, fs)
        }
      }

      for (const addition of (slot.additions ?? [])) {
        if (!slot.viewport) continue
        const scale = slot.viewport.scale

        if (addition.type === 'text' && addition.text?.trim()) {
          const addFont = pickFont(fonts, addition.fontFamily, addition.bold, addition.italic)
          const fs   = Math.min(Math.max((addition.fontSize ?? 26) / scale, 4), 144)
          const pdfX = addition.left / scale
          const pdfY = pageH - addition.top / scale - fs * 1.1
          libPage.drawText(addition.text, {
            x: Math.max(pdfX, 0), y: Math.max(pdfY, 0),
            size: fs, font: addFont, color: rgb(0, 0, 0),
          })
          if (addition.underline) drawUnderline(libPage, Math.max(pdfX, 0), Math.max(pdfY, 0), addition.text, addFont, fs)
        } else if ((addition.type === 'image' || addition.type === 'signature') && addition.dataUrl) {
          const pdfX    = addition.left   / scale
          const pdfW    = addition.width  / scale
          const pdfH_el = addition.height / scale
          const pdfY    = pageH - addition.top / scale - pdfH_el
          const b64      = addition.dataUrl.split(',')[1]
          const imgBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
          const isPng    = addition.dataUrl.startsWith('data:image/png')
          const embedded = isPng ? await pdfLibDoc.embedPng(imgBytes) : await pdfLibDoc.embedJpg(imgBytes)
          libPage.drawImage(embedded, {
            x: Math.max(pdfX, 0), y: Math.max(pdfY, 0),
            width: Math.max(pdfW, 1), height: Math.max(pdfH_el, 1),
          })
        }
      }
    }

    // — Write back into rawBytes and reload pdfjs —
    // .slice() on the pdf-lib Uint8Array gives us an owned copy with its own
    // buffer.  pdfjs gets a *separate* copy so its worker can transfer that
    // buffer without ever touching (and detaching) rawBytes.value.
    const newBytes    = await pdfLibDoc.save()
    rawBytes.value    = newBytes.slice()            // our owned copy
    pdfDoc.value      = await pdfjsLib.getDocument({ data: new Uint8Array(newBytes) }).promise

    // Reset page slots so every page re-renders from the new bytes
    for (const [, slot] of pages.entries()) {
      slot.rendered  = false
      slot.textItems = []
      slot.viewport  = null
      slot.edits.clear()
      slot.formats?.clear()
      if (slot.additions) slot.additions.splice(0)
    }
  }

  // ── exportPdf ───────────────────────────────────────────────────────────────
  /**
   * Creates a modified PDF using pdf-lib:
   *   1. For each edited text item: cover the original text with a white rect,
   *      then draw the new text in place.
   *   2. Return a Blob ready to download.
   */
  async function exportPdf() {
    if (!rawBytes.value) throw new Error('No PDF loaded')

    const pdfLibDoc = await PDFDocument.load(rawBytes.value.slice())
    const fonts = await embedAllFonts(pdfLibDoc)
    const pdfLibPages = pdfLibDoc.getPages()

    for (const [pageNum, slot] of pages.entries()) {
      if ((!slot.edits || slot.edits.size === 0) && (!slot.additions || slot.additions.length === 0)) continue

      const libPage = pdfLibPages[pageNum - 1]
      const pageH   = libPage.getHeight()   // pdf-lib uses y-from-bottom

      for (const item of slot.textItems) {
        if (!slot.edits.has(item.id)) continue
        const newText = slot.edits.get(item.id)
        const fmt  = slot.formats?.get(item.id) ?? {}
        const font = pickFont(fonts, fmt.fontFamily, fmt.bold, fmt.italic)
        const fs   = Math.min(Math.max(item.pdfFontSize, 5), 72)

        // White rectangle to cover old text
        libPage.drawRectangle({
          x:      item.pdfX - 1,
          y:      item.pdfY - fs * 0.2,
          width:  item.pdfWidth + 2,
          height: fs * 1.3,
          color:  rgb(1, 1, 1),
          opacity: 1,
        })

        // Draw replacement text
        if (newText.trim()) {
          libPage.drawText(newText, {
            x:        item.pdfX,
            y:        item.pdfY,
            size:     fs,
            font,
            color:    rgb(0, 0, 0),
            maxWidth: item.pdfWidth * 2,
          })
          if (fmt.underline) drawUnderline(libPage, item.pdfX, item.pdfY, newText, font, fs)
        }
      }

      // ── Additions (new text / images / signatures) ──
      for (const addition of (slot.additions ?? [])) {
        if (!slot.viewport) continue
        const scale   = slot.viewport.scale

        if (addition.type === 'text' && addition.text?.trim()) {
          const addFont = pickFont(fonts, addition.fontFamily, addition.bold, addition.italic)
          const fs    = Math.min(Math.max((addition.fontSize ?? 26) / scale, 4), 144)
          const pdfX  = addition.left / scale
          const pdfY  = pageH - addition.top / scale - fs * 1.1
          libPage.drawText(addition.text, {
            x:    Math.max(pdfX, 0),
            y:    Math.max(pdfY, 0),
            size: fs,
            font: addFont,
            color: rgb(0, 0, 0),
          })
          if (addition.underline) drawUnderline(libPage, Math.max(pdfX, 0), Math.max(pdfY, 0), addition.text, addFont, fs)

        } else if ((addition.type === 'image' || addition.type === 'signature') && addition.dataUrl) {
          const pdfX    = addition.left   / scale
          const pdfW    = addition.width  / scale
          const pdfH_el = addition.height / scale
          const pdfY    = pageH - addition.top / scale - pdfH_el

          const b64      = addition.dataUrl.split(',')[1]
          const imgBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
          const isPng    = addition.dataUrl.startsWith('data:image/png')
          const embedded = isPng
            ? await pdfLibDoc.embedPng(imgBytes)
            : await pdfLibDoc.embedJpg(imgBytes)
          libPage.drawImage(embedded, {
            x:      Math.max(pdfX, 0),
            y:      Math.max(pdfY, 0),
            width:  Math.max(pdfW, 1),
            height: Math.max(pdfH_el, 1),
          })
        }
      }
    }

    const bytes = await pdfLibDoc.save()
    return new Blob([bytes], { type: 'application/pdf' })
  }

  // ── renderThumbnail ─────────────────────────────────────────────────────────
  /**
   * Renders a page at small scale (0.2×) and returns a JPEG data URL.
   * Used by the sidebar thumbnail strip — separate from the main canvas render.
   */
  async function renderThumbnail(pageNum) {
    if (!pdfDoc.value) return null
    const page     = await pdfDoc.value.getPage(pageNum)
    const viewport = page.getViewport({ scale: 0.2 })
    const canvas   = document.createElement('canvas')
    canvas.width   = viewport.width
    canvas.height  = viewport.height
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise
    return canvas.toDataURL('image/jpeg', 0.8)
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  return {
    pdfDoc:       readonly(pdfDoc),
    rawBytes:     readonly(rawBytes),
    pageCount:    readonly(pageCount),
    currentPage,
    isLoading:    readonly(isLoading),
    loadError:    readonly(loadError),
    fileName:     readonly(fileName),
    pages,

    loadFile,
    renderPage,
    renderThumbnail,
    recordEdit,
    recordTextFormat,
    hasEdits,
    applyEdits,
    exportPdf,
    recordAddition,
    removeAddition,
    updateAddition,
    clearAllEdits,
  }
}
