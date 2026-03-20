<script setup>
/**
 * PdfPage — renders one PDF page to canvas and overlays an editable text layer.
 *
 * KEY DESIGN: contenteditable elements are managed imperatively (via domRefs).
 * Vue NEVER updates their inner content after initial mount — this is the only
 * way to preserve cursor position while keeping edits reactive.
 */
import { ref, computed, onMounted, nextTick } from 'vue'

const props = defineProps({
    pageNum: { type: Number, required: true },
    renderFn: { type: Function, required: true },
    pages: { type: Object, required: true },
    zoom: { type: Number, default: 1 },
    editMode: { type: Boolean, default: true },
    isActive: { type: Boolean, default: false },
    activeTool: { type: String, default: null },   // 'text' | 'image' | 'signature' | null
    pendingDataUrl: { type: String, default: null }, // data URL for image/signature placement
    searchMatchIds: { type: Object, default: () => new Set() },   // Set<itemId>
    searchCurrentId: { type: String, default: null },             // currently focused match
})

const emit = defineEmits(['edit', 'rendered', 'add-element', 'update-addition', 'remove-addition', 'text-focus', 'text-blur'])

// ── Refs ─────────────────────────────────────────────────────────────────────
const canvasRef = ref(null)
const containerRef = ref(null)
const isRendered = ref(false)
const textItems = ref([])
const activeItemId = ref(null)
const canvasW = ref(0)
const canvasH = ref(0)

// Per-item DOM element map — keyed by item.id
// Vue does NOT manage the innerText of these elements.
const domRefs = new Map()

// Addition DOM refs (for text additions — imperative innerText)
const additionTextRefs = new Map()
const selectedAdditionId = ref(null)

// ── Slot from pages map ───────────────────────────────────────────────────────
const slot = computed(() => props.pages.get(props.pageNum) ?? { edits: new Map(), textItems: [], additions: [] })
const pageAdditions = computed(() => slot.value.additions ?? [])

// ── Render ────────────────────────────────────────────────────────────────────
async function doRender() {
    if (!canvasRef.value || isRendered.value) return
    try {
        const items = await props.renderFn(props.pageNum, canvasRef.value)
        textItems.value = items
        canvasW.value = canvasRef.value.width
        canvasH.value = canvasRef.value.height
        isRendered.value = true
        emit('rendered', props.pageNum)
    } catch (err) {
        console.error(`Error rendering page ${props.pageNum}:`, err)
    }
}

// Intersection observer — lazy render only when visible
let observer
onMounted(() => {
    observer = new IntersectionObserver(
        (entries) => {
            if (entries[0].isIntersecting) {
                doRender()
                observer.disconnect()
            }
        },
        { rootMargin: '300px' },
    )
    if (containerRef.value) observer.observe(containerRef.value)
})

// ── Imperative DOM ref management ────────────────────────────────────────────
/**
 * Called by Vue's :ref callback on each text-item div.
 * Sets the initial innerText ONCE (on first mount) from saved edits or original.
 * After that, we never touch the DOM content from Vue — the user owns it.
 */
function setDomRef(el, item) {
    if (!el) {
        domRefs.delete(item.id)
        return
    }
    const alreadySet = domRefs.has(item.id)
    domRefs.set(item.id, el)
    if (!alreadySet) {
        // Initial content: prefer saved edit, fall back to original
        const saved = slot.value.edits?.get(item.id)
        el.innerText = saved !== undefined ? saved : item.str
    }
}

// ── Text utilities ────────────────────────────────────────────────────────────
const isEdited = (item) => slot.value.edits?.has(item.id)

// ── Page click — place new addition ──────────────────────────────────────────
function onPageClick(e) {
    if (!props.activeTool) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / props.zoom
    const y = (e.clientY - rect.top) / props.zoom
    const RENDER_SCALE = 1.8
    const id = `add-${Date.now()}-${Math.random().toString(36).slice(2)}`

    if (props.activeTool === 'text') {
        emit('add-element', props.pageNum, {
            id, type: 'text',
            left: x, top: y,
            text: 'New text',
            fontSize: Math.round(14 * RENDER_SCALE),
            color: '#1A3263',
        })
    } else if ((props.activeTool === 'image' || props.activeTool === 'signature') && props.pendingDataUrl) {
        const img = new Image()
        img.onload = () => {
            const maxW = canvasW.value * 0.45
            const w = Math.min(img.naturalWidth || 200, maxW)
            const h = img.naturalHeight && img.naturalWidth
                ? (img.naturalHeight / img.naturalWidth) * w
                : w * 0.35
            emit('add-element', props.pageNum, {
                id, type: props.activeTool,
                left: x - w / 2, top: y - h / 2,
                dataUrl: props.pendingDataUrl,
                width: w, height: h,
            })
        }
        img.src = props.pendingDataUrl
    }
}

// ── Addition DOM ref (text additions only — set innerText once) ───────────────
function setAdditionTextRef(el, addition) {
    if (!el) { additionTextRefs.delete(addition.id); return }
    const alreadySet = additionTextRefs.has(addition.id)
    additionTextRefs.set(addition.id, el)
    if (!alreadySet) {
        el.innerText = addition.text ?? ''
        nextTick(() => {
            el.focus()
            try { document.execCommand('selectAll', false, null) } catch (_) { }
        })
    }
}

// ── Addition dragging ─────────────────────────────────────────────────────────
function onAdditionMousedown(e, addition) {
    if (props.activeTool) return   // placement mode — don't steal click
    e.stopPropagation()
    selectedAdditionId.value = addition.id
    // Click inside text contenteditable — let it handle itself
    if (e.target.closest('.addition-text-inner')) return

    const startX = e.clientX
    const startY = e.clientY
    const origLeft = addition.left
    const origTop = addition.top

    function onMove(ev) {
        const dx = (ev.clientX - startX) / props.zoom
        const dy = (ev.clientY - startY) / props.zoom
        emit('update-addition', props.pageNum, addition.id, {
            left: origLeft + dx,
            top: origTop + dy,
        })
    }
    function onUp() {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
}

function onAdditionTextBlur(e, addition) {
    emit('update-addition', props.pageNum, addition.id, { text: e.target.innerText ?? '' })
}

function onAdditionDelete(addition) {
    selectedAdditionId.value = null
    emit('remove-addition', props.pageNum, addition.id)
}

// ── Edit handlers ─────────────────────────────────────────────────────────────
function onTextClick(item) {
    if (!props.editMode) return
    activeItemId.value = item.id
}

function scrollCaretIntoView() {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0).cloneRange()
    range.collapse(false)
    const rects = range.getClientRects()
    if (!rects.length) return
    const rect = rects[rects.length - 1]
    const sentinel = document.createElement('span')
    sentinel.style.cssText =
        'position:fixed;top:' + rect.top + 'px;left:' + rect.left +
        'px;width:1px;height:' + Math.max(rect.height, 16) + 'px;pointer-events:none;'
    document.body.appendChild(sentinel)
    sentinel.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    document.body.removeChild(sentinel)
}

function onFocus(item) {
    if (!props.editMode) return
    activeItemId.value = item.id
    emit('text-focus', {
        pageNum: props.pageNum,
        id: item.id,
        fontName: item.fontName ?? '',
        fontSize: Math.round(item.pdfFontSize ?? item.fontSize ?? 12),
        str: item.str,
    })
    requestAnimationFrame(() => scrollCaretIntoView())
}

function onInput(item, e) {
    // Save to reactive store — does NOT cause re-render of this element
    // because we are not binding {{ }} inside the contenteditable.
    emit('edit', props.pageNum, item.id, e.target.innerText ?? '')
    scrollCaretIntoView()
}

function onBlur(item, e) {
    const text = e.target.innerText ?? ''
    const newVal = text === item.str ? null : text
    emit('edit', props.pageNum, item.id, newVal)
    if (activeItemId.value === item.id) activeItemId.value = null
    emit('text-blur')
}

function onKeydown(e) {
    if (e.key === 'Escape') e.target.blur()
}</script>

<template>
    <div ref="containerRef" class="pdf-page" :class="{ 'is-active': isActive, 'edit-mode': editMode }">
        <!-- Page number badge -->
        <div class="page-badge">{{ pageNum }}</div>

        <!-- Zoom wrapper: overflow visible so caret is never clipped -->
        <div class="page-zoom-wrap" :style="{ zoom: zoom }">
            <!-- canvas-clip: clips only the PDF bitmap, not the text overlay -->
            <div class="canvas-clip">
                <canvas ref="canvasRef" class="pdf-canvas"
                    :style="{ width: canvasW ? `${canvasW}px` : '794px', height: canvasH ? `${canvasH}px` : '1123px', display: 'block' }" />

                <Transition name="fade-fast">
                    <div v-if="!isRendered" class="canvas-placeholder"
                        :style="{ width: canvasW ? `${canvasW}px` : '794px', height: canvasH ? `${canvasH}px` : '1123px' }">
                        <div class="loading-spinner" />
                    </div>
                </Transition>
            </div>

            <!-- Text overlay lives outside canvas-clip so active items can overflow freely -->
            <Transition name="fade-fast">
                <div v-if="isRendered && editMode" class="text-overlay"
                    :style="{ width: `${canvasW}px`, height: `${canvasH}px` }"
                    :aria-label="`Editable text layer for page ${pageNum}`">
                    <div v-for="item in textItems" :key="item.id" :ref="(el) => setDomRef(el, item)" class="text-item"
                        :class="{
                            active: activeItemId === item.id,
                            edited: isEdited(item),
                            'search-match': searchMatchIds.has(item.id) && searchCurrentId !== item.id,
                            'search-match-current': searchCurrentId === item.id,
                        }" :style="{
                            left: `${item.left}px`,
                            top: `${item.top}px`,
                            width: `${item.width}px`,
                            minHeight: `${item.height}px`,
                            fontSize: `${item.fontSize}px`,
                            lineHeight: `${item.height / Math.max(item.fontSize, 1)}`,
                        }" contenteditable="true" spellcheck="false" :data-id="item.id" @click.stop="onTextClick(item)"
                        @focus="onFocus(item)" @input="onInput(item, $event)" @blur="onBlur(item, $event)"
                        @keydown="onKeydown" />
                </div>
            </Transition>

            <!-- Additions overlay — new text boxes, images, signatures -->
            <div v-if="isRendered" class="additions-overlay" :style="{ width: `${canvasW}px`, height: `${canvasH}px` }">
                <div v-for="addition in pageAdditions" :key="addition.id" class="addition-wrapper" :class="[
                    `addition-${addition.type}`,
                    { selected: selectedAdditionId === addition.id }
                ]" :style="addition.type !== 'text'
                    ? {
                        left: `${addition.left}px`, top: `${addition.top}px`,
                        width: `${addition.width}px`, height: `${addition.height}px`
                    }
                    : { left: `${addition.left}px`, top: `${addition.top}px` }"
                    @mousedown="onAdditionMousedown($event, addition)" @click.stop="selectedAdditionId = addition.id">
                    <!-- Text content -->
                    <div v-if="addition.type === 'text'" :ref="el => setAdditionTextRef(el, addition)"
                        class="addition-text-inner"
                        :style="{ fontSize: `${addition.fontSize}px`, color: addition.color }" contenteditable="true"
                        spellcheck="false" @mousedown.stop @blur="onAdditionTextBlur($event, addition)" @keydown.stop />
                    <!-- Image / signature -->
                    <img v-else :src="addition.dataUrl" class="addition-img" draggable="false" alt="" />
                    <!-- Delete button -->
                    <button v-if="selectedAdditionId === addition.id" class="addition-delete-btn" title="Remove"
                        @click.stop="onAdditionDelete(addition)">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="3">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>
            </div>

            <!-- Placement overlay — captures clicks when a tool is active -->
            <div v-if="activeTool && isRendered" class="page-click-layer"
                :style="{ width: `${canvasW}px`, height: `${canvasH}px` }"
                :title="activeTool === 'text' ? 'Click to place text' : 'Click to place'" @click="onPageClick" />
        </div>
    </div>
</template>

<style scoped>
/* ── Page container ── */
.pdf-page {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    animation: fadeInUp 0.4s ease both;
}

/* ── Page badge ── */
.page-badge {
    position: absolute;
    top: -10px;
    left: -10px;
    background: var(--color-sidebar);
    color: var(--color-text-sidebar);
    font-size: 0.7rem;
    font-weight: 600;
    padding: 3px 9px;
    border-radius: var(--radius-full);
    letter-spacing: 0.06em;
    z-index: 10;
    box-shadow: var(--shadow-sm);
}

/* ── Zoom wrapper — overflow visible so caret is never clipped ── */
.page-zoom-wrap {
    position: relative;
    transform-origin: top left;
    box-shadow: var(--shadow-lg);
    border-radius: var(--radius-sm);
    overflow: visible;
    background: transparent;
    transition: box-shadow var(--transition-base);
}

.pdf-page.is-active .page-zoom-wrap {
    box-shadow: 0 0 0 3px var(--color-accent), var(--shadow-lg);
}

/* ── Canvas clip — clips only the bitmap + applies border-radius ── */
.canvas-clip {
    position: relative;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: #fff;
    display: inline-block;
    line-height: 0;
}

/* ── Canvas ── */
.pdf-canvas {
    display: block;
    image-rendering: crisp-edges;
}

/* ── Loading placeholder ── */
.canvas-placeholder {
    position: absolute;
    inset: 0;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
}

.loading-spinner {
    width: 36px;
    height: 36px;
    border: 3px solid var(--color-border);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

/* ── Text overlay — overflow visible, sits on top of canvas-clip ── */
.text-overlay {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    overflow: visible;
}

/* ── Editable text items ── */
.text-item {
    position: absolute;
    cursor: text;
    white-space: pre;
    overflow: visible;
    outline: none;
    border-radius: 3px;
    padding: 0 2px;
    margin: 0 -2px;

    /* Transparent by default — doesn't obscure the rendered PDF text */
    color: transparent;
    background: transparent;
    caret-color: var(--color-accent);
    pointer-events: all;

    transition:
        color var(--transition-fast),
        background var(--transition-fast),
        box-shadow var(--transition-fast);
}

/* Hover: tinted halo signals "this is editable" */
.edit-mode .text-item:hover {
    background: var(--color-accent-light);
    box-shadow: 0 0 0 1.5px var(--color-accent-glow);
}

/* Active / focused — always on top, expands with content so caret is never clipped */
.text-item.active,
.text-item:focus {
    color: var(--color-text) !important;
    background: rgba(255, 255, 255, 0.97) !important;
    box-shadow: 0 0 0 2.5px var(--color-accent), var(--shadow-md) !important;
    z-index: 9999 !important;
    /* always in front of everything */
    position: absolute !important;
    width: max-content !important;
    /* expands as the user types */
    min-width: 60px;
    max-width: 80vw;
    /* prevent off-screen bleed */
    white-space: pre-wrap;
    word-break: break-word;
    overflow: visible !important;
}

/* Modified but not focused */
.text-item.edited:not(:focus):not(.active) {
    background: rgba(255, 197, 112, 0.12);
    box-shadow: 0 0 0 1.5px rgba(255, 197, 112, 0.5);
}

/* Search highlights */
.text-item.search-match {
    background: rgba(255, 230, 40, 0.38) !important;
    box-shadow: 0 0 0 1.5px rgba(220, 180, 0, 0.55) !important;
    color: #1a1a1a !important;
    border-radius: 3px;
}

.text-item.search-match-current {
    background: rgba(255, 170, 0, 0.65) !important;
    box-shadow: 0 0 0 2px rgba(220, 140, 0, 0.85) !important;
    color: #1a1a1a !important;
    border-radius: 3px;
    z-index: 50;
}

/* ── Fade transition ── */
.fade-fast-enter-active,
.fade-fast-leave-active {
    transition: opacity 0.25s ease;
}

.fade-fast-enter-from,
.fade-fast-leave-to {
    opacity: 0;
}

/* ── Additions layer ── */
.additions-overlay {
    position: absolute;
    top: 0;
    left: 0;
    overflow: visible;
    pointer-events: none;
}

.addition-wrapper {
    position: absolute;
    pointer-events: all;
    cursor: move;
    border: 1.5px dashed transparent;
    border-radius: 3px;
    transition: border-color var(--transition-fast);
}

.addition-wrapper:hover,
.addition-wrapper.selected {
    border-color: var(--color-accent);
}

.addition-wrapper.selected {
    box-shadow: 0 0 0 2px var(--color-accent-glow);
}

.addition-text-inner {
    cursor: text;
    outline: none;
    white-space: pre;
    padding: 2px 4px;
    min-width: 60px;
    min-height: 1.2em;
    line-height: 1.4;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.85);
}

.addition-text-inner:focus {
    background: rgba(255, 255, 255, 0.98);
}

.addition-img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
    user-select: none;
}

.addition-delete-btn {
    position: absolute;
    top: -11px;
    right: -11px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--color-danger);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: var(--shadow-sm);
    z-index: 10;
    transition: transform var(--transition-fast), background var(--transition-fast);
}

.addition-delete-btn:hover {
    background: #c04444;
    transform: scale(1.15);
}

/* ── Page click layer (placement mode) ── */
.page-click-layer {
    position: absolute;
    top: 0;
    left: 0;
    cursor: crosshair;
    z-index: 200;
    background: rgba(84, 119, 146, 0.06);
    border: 2px dashed rgba(84, 119, 146, 0.4);
    border-radius: var(--radius-sm);
    animation: borderPulse 1.6s ease-in-out infinite;
}
</style>
