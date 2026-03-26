<script setup>
/**
 * PdfPage — renders one PDF page to canvas and overlays an editable text layer.
 *
 * KEY DESIGN: contenteditable elements are managed imperatively (via domRefs).
 * Vue NEVER updates their inner content after initial mount — this is the only
 * way to preserve cursor position while keeping edits reactive.
 */
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'

const RENDER_SCALE = 1.8   // must match composable

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
    recordFormatFn: { type: Function, default: null },            // (pageNum, itemId, fmt) → void
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
    document.addEventListener('keydown', onGlobalKeydown)
})

onUnmounted(() => {
    document.removeEventListener('keydown', onGlobalKeydown)
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

// Active text item reference & format
const activeItem = computed(() => textItems.value.find(i => i.id === activeItemId.value) ?? null)
const activeItemFormat = computed(() => slot.value.formats?.get(activeItemId.value) ?? {})

function updateTextFormat(changes) {
    if (!activeItemId.value || !props.recordFormatFn) return
    const updated = { ...activeItemFormat.value, ...changes }
    props.recordFormatFn(props.pageNum, activeItemId.value, updated)
}

function discardTextEdit(item) {
    // Clear edit + format from store
    emit('edit', props.pageNum, item.id, null)
    props.recordFormatFn?.(props.pageNum, item.id, null)
    // Reset DOM to original text
    const el = domRefs.get(item.id)
    if (el) el.innerText = item.str
    activeItemId.value = null
    el?.blur()
}

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

    startDrag(e, addition)
}

function onDragHandleMousedown(e, addition) {
    if (props.activeTool) return
    e.stopPropagation()
    e.preventDefault()   // prevent text selection while dragging handle
    selectedAdditionId.value = addition.id
    startDrag(e, addition)
}

function startDrag(e, addition) {
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

// ── Keyboard delete for selected additions ────────────────────────────────────
function onGlobalKeydown(e) {
    if (!selectedAdditionId.value) return
    if (e.target.isContentEditable || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    const addition = pageAdditions.value.find(a => a.id === selectedAdditionId.value)
    if (!addition) return
    e.preventDefault()
    onAdditionDelete(addition)
}

// ── Resize (image / signature) ────────────────────────────────────────────────
function onResizeMousedown(e, addition, dir) {
    e.stopPropagation()
    e.preventDefault()
    selectedAdditionId.value = addition.id
    const startX = e.clientX
    const startY = e.clientY
    const origLeft = addition.left
    const origTop = addition.top
    const origW = addition.width ?? 100
    const origH = addition.height ?? 100

    function onMove(ev) {
        const dx = (ev.clientX - startX) / props.zoom
        const dy = (ev.clientY - startY) / props.zoom
        const changes = {}
        if (dir.includes('e')) changes.width = Math.max(20, origW + dx)
        if (dir.includes('s')) changes.height = Math.max(20, origH + dy)
        if (dir.includes('w')) {
            const w = Math.max(20, origW - dx)
            changes.width = w
            changes.left = origLeft + (origW - w)
        }
        if (dir.includes('n')) {
            const h = Math.max(20, origH - dy)
            changes.height = h
            changes.top = origTop + (origH - h)
        }
        emit('update-addition', props.pageNum, addition.id, changes)
    }
    function onUp() {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
}

// ── Resize (text → drag bottom-right to change font-size) ──────────────────────
function onTextResizeMousedown(e, addition) {
    e.stopPropagation()
    e.preventDefault()
    selectedAdditionId.value = addition.id
    const startY = e.clientY
    const origSize = addition.fontSize
    const minSize = Math.round(RENDER_SCALE * 6)   // ~6 pt minimum

    function onMove(ev) {
        const dy = (ev.clientY - startY) / props.zoom
        const newSize = Math.max(minSize, Math.round(origSize + dy))
        emit('update-addition', props.pageNum, addition.id, { fontSize: newSize })
    }
    function onUp() {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
}

// ── Deselect addition when clicking canvas background ─────────────────────
function onCanvasClick() {
    selectedAdditionId.value = null
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
            <div class="canvas-clip" @click="onCanvasClick">
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
                            width: 'fit-content',
                            minHeight: `${item.height}px`,
                            fontSize: `${activeItemId === item.id && activeItemFormat.fontSize ? activeItemFormat.fontSize : item.fontSize}px`,
                            lineHeight: `${item.height / Math.max(item.fontSize, 1)}`,
                        }" contenteditable="true" spellcheck="false" :data-id="item.id" @click.stop="onTextClick(item)"
                        @focus="onFocus(item)" @input="onInput(item, $event)" @blur="onBlur(item, $event)"
                        @keydown="onKeydown" />

                    <!-- Format bar: shown when a text item is focused -->
                    <Transition name="txt-fmt-pop">
                        <div v-if="activeItemId && activeItem" class="text-item-format-bar"
                            :style="{ left: `${activeItem.left}px`, top: `${Math.max(0, activeItem.top - 54)}px` }"
                            @mousedown.prevent.stop @click.stop>
                            <button class="fmt-btn" :class="{ active: activeItemFormat.bold }" title="Bold"
                                @click="updateTextFormat({ bold: !activeItemFormat.bold })">
                                <strong>B</strong>
                            </button>
                            <button class="fmt-btn fmt-italic" :class="{ active: activeItemFormat.italic }"
                                title="Italic" @click="updateTextFormat({ italic: !activeItemFormat.italic })">
                                <em>I</em>
                            </button>
                            <div class="fmt-sep"></div>
                            <button class="fmt-btn fmt-step" title="Decrease size"
                                @click="updateTextFormat({ fontSize: Math.max(Math.round(RENDER_SCALE * 4), (activeItemFormat.fontSize || activeItem.fontSize) - 2) })">&#8722;</button>
                            <span class="fmt-size-val">{{ Math.round((activeItemFormat.fontSize || activeItem.fontSize)
                                / RENDER_SCALE) }}pt</span>
                            <button class="fmt-btn fmt-step" title="Increase size"
                                @click="updateTextFormat({ fontSize: (activeItemFormat.fontSize || activeItem.fontSize) + 2 })">+</button>
                            <div class="fmt-sep"></div>
                            <select class="fmt-select" :value="activeItemFormat.fontFamily || ''"
                                @change.stop="updateTextFormat({ fontFamily: $event.target.value || undefined })">
                                <option value="">Original</option>
                                <option value="Helvetica">Sans</option>
                                <option value="TimesRoman">Serif</option>
                                <option value="Courier">Mono</option>
                            </select>
                            <div class="fmt-sep"></div>
                            <label class="fmt-color-wrap" title="Text color">
                                <input type="color" class="fmt-color" :value="activeItemFormat.color || '#000000'"
                                    @input.stop="updateTextFormat({ color: $event.target.value })" />
                            </label>
                            <div class="fmt-sep"></div>
                            <button class="fmt-btn fmt-delete-btn" title="Discard edit for this item"
                                @click="discardTextEdit(activeItem)">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                    stroke-width="2.5">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6l-1 14H6L5 6" />
                                    <path d="M10 11v6M14 11v6" />
                                    <path d="M9 6V4h6v2" />
                                </svg>
                            </button>
                        </div>
                    </Transition>
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

                    <!-- Drag handle -->
                    <div class="addition-drag-handle" @mousedown.stop="onDragHandleMousedown($event, addition)">
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                            <circle cx="5" cy="4" r="1.4" />
                            <circle cx="11" cy="4" r="1.4" />
                            <circle cx="5" cy="8" r="1.4" />
                            <circle cx="11" cy="8" r="1.4" />
                            <circle cx="5" cy="12" r="1.4" />
                            <circle cx="11" cy="12" r="1.4" />
                        </svg>
                    </div>

                    <!-- Format toolbar (text additions only, when selected) -->
                    <Transition name="fmt-pop">
                        <div v-if="addition.type === 'text' && selectedAdditionId === addition.id"
                            class="addition-format-bar" @mousedown.stop @click.stop>
                            <button class="fmt-btn" :class="{ active: addition.bold }" title="Bold (700)"
                                @click.stop="emit('update-addition', pageNum, addition.id, { bold: !addition.bold })">
                                <strong>B</strong>
                            </button>
                            <button class="fmt-btn fmt-italic" :class="{ active: addition.italic }" title="Italic"
                                @click.stop="emit('update-addition', pageNum, addition.id, { italic: !addition.italic })">
                                <em>I</em>
                            </button>
                            <div class="fmt-sep"></div>
                            <button class="fmt-btn fmt-step" title="Decrease size"
                                @click.stop="emit('update-addition', pageNum, addition.id, { fontSize: Math.max(Math.round(RENDER_SCALE * 6), addition.fontSize - 2) })">&#8722;</button>
                            <span class="fmt-size-val">{{ Math.round(addition.fontSize / RENDER_SCALE) }}pt</span>
                            <button class="fmt-btn fmt-step" title="Increase size"
                                @click.stop="emit('update-addition', pageNum, addition.id, { fontSize: addition.fontSize + 2 })">+</button>
                            <div class="fmt-sep"></div>
                            <select class="fmt-select" :value="addition.fontFamily || 'Helvetica'"
                                @change.stop="emit('update-addition', pageNum, addition.id, { fontFamily: $event.target.value })">
                                <option value="Helvetica">Sans</option>
                                <option value="TimesRoman">Serif</option>
                                <option value="Courier">Mono</option>
                            </select>
                            <div class="fmt-sep"></div>
                            <label class="fmt-color-wrap" title="Text color">
                                <input type="color" class="fmt-color" :value="addition.color || '#1A3263'"
                                    @input.stop="emit('update-addition', pageNum, addition.id, { color: $event.target.value })" />
                            </label>
                            <div class="fmt-sep"></div>
                            <button class="fmt-btn fmt-delete-btn" title="Delete (Del)"
                                @click.stop="onAdditionDelete(addition)">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                    stroke-width="2.5">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6l-1 14H6L5 6" />
                                    <path d="M10 11v6M14 11v6" />
                                    <path d="M9 6V4h6v2" />
                                </svg>
                            </button>
                        </div>
                    </Transition>

                    <!-- Text content -->
                    <div v-if="addition.type === 'text'" :ref="el => setAdditionTextRef(el, addition)"
                        class="addition-text-inner" :style="{
                            fontSize: `${addition.fontSize}px`,
                            color: addition.color,
                            fontWeight: addition.bold ? '700' : '400',
                            fontStyle: addition.italic ? 'italic' : 'normal',
                            fontFamily: addition.fontFamily === 'TimesRoman' ? 'Georgia, serif'
                                : addition.fontFamily === 'Courier' ? 'Courier New, monospace'
                                    : 'system-ui, sans-serif',
                        }" contenteditable="true" spellcheck="false" @mousedown.stop
                        @blur="onAdditionTextBlur($event, addition)" @keydown.stop />

                    <!-- Image / signature -->
                    <img v-else :src="addition.dataUrl" class="addition-img" draggable="false" alt="" />

                    <!-- 8-point resize handles (image / signature) -->
                    <template v-if="selectedAdditionId === addition.id && addition.type !== 'text'">
                        <div class="resize-handle rh-nw" @mousedown.stop="onResizeMousedown($event, addition, 'nw')">
                        </div>
                        <div class="resize-handle rh-n" @mousedown.stop="onResizeMousedown($event, addition, 'n')">
                        </div>
                        <div class="resize-handle rh-ne" @mousedown.stop="onResizeMousedown($event, addition, 'ne')">
                        </div>
                        <div class="resize-handle rh-e" @mousedown.stop="onResizeMousedown($event, addition, 'e')">
                        </div>
                        <div class="resize-handle rh-se" @mousedown.stop="onResizeMousedown($event, addition, 'se')">
                        </div>
                        <div class="resize-handle rh-s" @mousedown.stop="onResizeMousedown($event, addition, 's')">
                        </div>
                        <div class="resize-handle rh-sw" @mousedown.stop="onResizeMousedown($event, addition, 'sw')">
                        </div>
                        <div class="resize-handle rh-w" @mousedown.stop="onResizeMousedown($event, addition, 'w')">
                        </div>
                    </template>

                    <!-- Font-size resize handle (text) -->
                    <div v-if="selectedAdditionId === addition.id && addition.type === 'text'"
                        class="text-resize-handle" title="Drag to resize text"
                        @mousedown.stop="onTextResizeMousedown($event, addition)"></div>

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

/* ── Drag handle ── */
.addition-drag-handle {
    position: absolute;
    top: -22px;
    left: 50%;
    transform: translateX(-50%);
    height: 20px;
    padding: 0 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-accent);
    border-radius: 6px 6px 0 0;
    color: #fff;
    cursor: grab;
    opacity: 0;
    transition: opacity var(--transition-fast);
    z-index: 20;
    user-select: none;
}

.addition-drag-handle:active {
    cursor: grabbing;
}

.addition-wrapper:hover .addition-drag-handle,
.addition-wrapper.selected .addition-drag-handle {
    opacity: 1;
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

/* delete button inside format toolbar */
.fmt-delete-btn {
    color: var(--color-danger) !important;
}

.fmt-delete-btn:hover {
    background: rgba(217, 95, 95, 0.18) !important;
    color: var(--color-danger) !important;
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

/* ── 8-point resize handles (image / signature) ── */
.resize-handle {
    position: absolute;
    width: 10px;
    height: 10px;
    background: #fff;
    border: 2px solid var(--color-accent);
    border-radius: 2px;
    z-index: 30;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

.rh-nw {
    top: -5px;
    left: -5px;
    cursor: nw-resize;
}

.rh-n {
    top: -5px;
    left: calc(50% - 5px);
    cursor: n-resize;
}

.rh-ne {
    top: -5px;
    right: -5px;
    cursor: ne-resize;
}

.rh-e {
    top: calc(50% - 5px);
    right: -5px;
    cursor: e-resize;
}

.rh-se {
    bottom: -5px;
    right: -5px;
    cursor: se-resize;
}

.rh-s {
    bottom: -5px;
    left: calc(50% - 5px);
    cursor: s-resize;
}

.rh-sw {
    bottom: -5px;
    left: -5px;
    cursor: sw-resize;
}

.rh-w {
    top: calc(50% - 5px);
    left: -5px;
    cursor: w-resize;
}

/* ── Text font-size resize handle (bottom-right corner) ── */
.text-resize-handle {
    position: absolute;
    bottom: -5px;
    right: -5px;
    width: 10px;
    height: 10px;
    background: var(--color-accent);
    border-radius: 2px;
    cursor: se-resize;
    z-index: 30;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
    opacity: 0.85;
}

.text-resize-handle:hover {
    opacity: 1;
    transform: scale(1.2);
}

/* ── Format toolbar (text additions) ── */
.addition-format-bar {
    position: absolute;
    top: -58px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 7px;
    background: var(--color-sidebar);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(255, 255, 255, 0.09);
    white-space: nowrap;
    z-index: 40;
    user-select: none;
}

/* ── Format toolbar (existing text items) ── */
.text-item-format-bar {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 7px;
    background: var(--color-sidebar);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(255, 255, 255, 0.09);
    white-space: nowrap;
    z-index: 50;
    user-select: none;
    pointer-events: all;
}

.fmt-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 24px;
    padding: 0 5px;
    border-radius: 4px;
    font-size: 0.8rem;
    color: var(--color-text-sidebar);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
}

.fmt-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
}

.fmt-btn.active {
    background: var(--color-accent);
    color: #fff;
}

.fmt-btn strong {
    font-weight: 900;
    font-size: 0.85rem;
    line-height: 1;
}

.fmt-btn.fmt-italic em {
    font-style: italic;
    font-size: 0.85rem;
}

.fmt-step {
    font-size: 1rem;
    font-weight: 500;
    line-height: 1;
}

.fmt-size-val {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-sidebar);
    min-width: 34px;
    text-align: center;
    font-variant-numeric: tabular-nums;
}

.fmt-sep {
    width: 1px;
    height: 16px;
    background: rgba(255, 255, 255, 0.15);
    margin: 0 3px;
    flex-shrink: 0;
}

.fmt-select {
    background: rgba(255, 255, 255, 0.08);
    color: var(--color-text-sidebar);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    font-size: 0.75rem;
    padding: 2px 4px;
    cursor: pointer;
    height: 24px;
    outline: none;
}

.fmt-select:focus {
    border-color: var(--color-accent);
}

.fmt-select option {
    background: #1e293b;
    color: #fff;
}

.fmt-color-wrap {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
}

.fmt-color {
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    padding: 1px;
    cursor: pointer;
    background: transparent;
}

/* format bar pop transition */
.fmt-pop-enter-active {
    animation: fmtIn 0.15s ease both;
}

.fmt-pop-leave-active {
    animation: fmtIn 0.1s ease reverse;
}

@keyframes fmtIn {
    from {
        opacity: 0;
        transform: translateX(-50%) translateY(4px) scale(0.95);
    }

    to {
        opacity: 1;
        transform: translateX(-50%) translateY(0) scale(1);
    }
}

/* text item format bar pop (no translateX centering) */
.txt-fmt-pop-enter-active {
    animation: txtFmtIn 0.15s ease both;
}

.txt-fmt-pop-leave-active {
    animation: txtFmtIn 0.1s ease reverse;
}

@keyframes txtFmtIn {
    from {
        opacity: 0;
        transform: translateY(4px) scale(0.97);
    }

    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}
</style>
