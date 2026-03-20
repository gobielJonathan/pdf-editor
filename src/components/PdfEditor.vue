<script setup>
/**
 * PdfEditor — main editing canvas:
 *   • toolbar (zoom, page nav, edit toggle, download)
 *   • scrollable pages column
 *   • page thumbnail strip on the left
 */
import { ref, computed, nextTick, reactive, watch } from 'vue'
import PdfPage from './PdfPage.vue'
import SignatureModal from './SignatureModal.vue'
import { useToast } from '@/composables/useToast.js'

const props = defineProps({
    pageCount: { type: Number, required: true },
    pages: { type: Object, required: true },
    renderFn: { type: Function, required: true },
    exportFn: { type: Function, required: true },
    hasEdits: { type: Function, required: true },
    fileName: { type: String, default: 'document' },
    thumbFn: { type: Function, required: false, default: null },
    recordAdditionFn: { type: Function, required: true },
    removeAdditionFn: { type: Function, required: true },
    updateAdditionFn: { type: Function, required: true },
    clearEditsFn: { type: Function, required: true },
    applyEditsFn: { type: Function, required: true },
    addBlankPageFn: { type: Function, required: true },
    loadAllTextContentFn: { type: Function, required: true },
})

const emit = defineEmits(['close', 'edit'])

const { success, error, info } = useToast()

// ─── State ────────────────────────────────────────────────────────────────────
const zoom = ref(1.0)
const editMode = ref(true)
const activePage = ref(1)
const isExporting = ref(false)
const showSidebar = ref(true)
const resetKey = ref(0)   // bumped on cancel to force PdfPage remount
const isSaving = ref(false)
const activeFontInfo = ref(null)  // { fontName, fontSize, pageNum, id } when text is focused

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.5
const ZOOM_STEP = 0.1

const pagesRef = ref(null)   // scroll container

// ─── Zoom helpers ─────────────────────────────────────────────────────────────
function zoomIn() { zoom.value = Math.min(zoom.value + ZOOM_STEP, ZOOM_MAX) }
function zoomOut() { zoom.value = Math.max(zoom.value - ZOOM_STEP, ZOOM_MIN) }
function zoomReset() { zoom.value = 1.0 }

const zoomPct = computed(() => `${Math.round(zoom.value * 100)}%`)

// ─── Page navigation ──────────────────────────────────────────────────────────
function goToPage(n) {
    activePage.value = n
    nextTick(() => {
        const el = pagesRef.value?.querySelector(`[data-page="${n}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
}

// ─── Edit handler ─────────────────────────────────────────────────────────────
function handleEdit(pageNum, itemId, newText) {
    emit('edit', pageNum, itemId, newText)
}

// ─── Font info (from focused text item) ────────────────────────────────────
function cleanFontName(raw) {
    if (!raw) return 'Unknown'
    // Strip PDF subset prefix like "ABCDEF+" and normalize
    const cleaned = raw.replace(/^[A-Z]{6}\+/, '').replace(/[-_]/g, ' ')
    return cleaned.length > 30 ? cleaned.slice(0, 30) + '…' : cleaned
}

function handleTextFocus(info) {
    activeFontInfo.value = info
}

function handleTextBlur() {
    activeFontInfo.value = null
}

// ─── Save (apply edits in-place) ──────────────────────────────────────────────
async function handleSave() {
    if (isSaving.value) return
    if (!props.hasEdits()) {
        info('No changes to save.')
        return
    }
    isSaving.value = true
    try {
        await props.applyEditsFn()
        // Force all pages to remount and re-render from updated rawBytes
        resetKey.value++
        // Regenerate thumbnails
        thumbnails.clear()
        for (let p = 1; p <= props.pageCount; p++) {
            await generateThumbnail(p)
        }
        success('Changes saved to PDF!')
    } catch (err) {
        console.error(err)
        error('Save failed. Please try again.')
    } finally {
        isSaving.value = false
    }
}

// ─── Export ───────────────────────────────────────────────────────────────────
async function handleExport() {
    if (isExporting.value) return
    if (!props.hasEdits()) {
        info('No edits to save. Make some changes first!')
        return
    }
    isExporting.value = true
    try {
        const blob = await props.exportFn()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${props.fileName}-edited.pdf`
        a.click()
        URL.revokeObjectURL(url)
        success(`"${props.fileName}-edited.pdf" saved!`)
    } catch (err) {
        console.error(err)
        error('Export failed. Please try again.')
    } finally {
        isExporting.value = false
    }
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
function onKeydown(e) {
    if (e.target.isContentEditable || e.target.tagName === 'INPUT') return
    if ((e.ctrlKey || e.metaKey) && e.key === '+') { e.preventDefault(); zoomIn() }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoomOut() }
    if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); zoomReset() }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave() }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'e')) { e.preventDefault(); handleExport() }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); showSearch.value ? closeSearch() : openSearch() }
    if (e.key === 'e' && !e.ctrlKey && !e.metaKey) editMode.value = !editMode.value
    if (e.key === 'Escape') exitTool()
}

// ─── Thumbnails ─────────────────────────────────────────────────────────────
const thumbnails = reactive(new Map())

async function generateThumbnail(pageNum) {
    if (!props.thumbFn || thumbnails.has(pageNum)) return
    const dataUrl = await props.thumbFn(pageNum)
    if (dataUrl) thumbnails.set(pageNum, dataUrl)
}

// Eagerly render all thumbnails whenever a new PDF is loaded
watch(
    () => props.pageCount,
    async (count) => {
        if (!count || !props.thumbFn) return
        thumbnails.clear()
        for (let p = 1; p <= count; p++) {
            await generateThumbnail(p)
        }
    },
    { immediate: true },
)

function handleRendered(pn) {
    if (pn === 1) activePage.value = 1
    // Thumbnail may already be ready from the eager watcher; generateThumbnail is a no-op
    // if already cached, so this is harmless.
    generateThumbnail(pn)
}

// ─── Insert tools ───────────────────────────────────────────────────────────
const activeTool = ref(null)   // 'text' | 'image' | 'signature' | null
const pendingDataUrl = ref(null)   // data URL queued for image/signature placement
const showSignatureModal = ref(false)
const imageFileInput = ref(null)

function exitTool() {
    activeTool.value = null
    pendingDataUrl.value = null
}

function startAddText() {
    activeTool.value = activeTool.value === 'text' ? null : 'text'
    pendingDataUrl.value = null
    if (activeTool.value) info('Click anywhere on a page to place a text box')
}

function startAddImage() {
    imageFileInput.value?.click()
}

function onImageFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''   // reset so same file can be re-selected
    const reader = new FileReader()
    reader.onload = (ev) => {
        pendingDataUrl.value = ev.target.result
        activeTool.value = 'image'
        info('Click on a page to place the image')
    }
    reader.readAsDataURL(file)
}

function startAddSignature() {
    showSignatureModal.value = true
}

function onSignatureDone(dataUrl) {
    showSignatureModal.value = false
    pendingDataUrl.value = dataUrl
    activeTool.value = 'signature'
    info('Click on a page to place the signature')
}

function onAddElement(pageNum, additionData) {
    props.recordAdditionFn(pageNum, additionData)
    // After placing, deactivate tool (one-shot) except for text (allow multi-place)
    if (activeTool.value !== 'text') exitTool()
}

function onUpdateAddition(pageNum, id, changes) {
    props.updateAdditionFn(pageNum, id, changes)
}

function onRemoveAddition(pageNum, id) {
    props.removeAdditionFn(pageNum, id)
}

// ─── Page count array ─────────────────────────────────────────────────────────
const pageNums = computed(() => Array.from({ length: props.pageCount }, (_, i) => i + 1))

// ─── Edit count per page (for thumbnail badge) ────────────────────────────────
function editCount(pageNum) {
    if (typeof props.pages?.get !== 'function') return 0
    return props.pages.get(pageNum)?.edits?.size ?? 0
}
function totalEdits() {
    if (typeof props.pages?.values !== 'function') return 0
    let n = 0
    for (const s of props.pages.values()) {
        n += s.edits?.size ?? 0
        n += s.additions?.length ?? 0
    }
    return n
}

// ─── Cancel edits ────────────────────────────────────────────────────
function cancelEdits() {
    props.clearEditsFn()
    resetKey.value++           // forces every PdfPage to remount → re-reads original text
    exitTool()
    info('All changes discarded.')
}

// ─── Add blank page ───────────────────────────────────────────────────────────
const isAddingPage = ref(false)

async function handleAddPage() {
    if (isAddingPage.value) return
    isAddingPage.value = true
    try {
        const insertAfter = activePage.value
        await props.addBlankPageFn(insertAfter)
        // Force all pages to remount so shifted pages re-render with new page numbers
        resetKey.value++
        thumbnails.clear()
        for (let p = 1; p <= props.pageCount; p++) {
            await generateThumbnail(p)
        }
        await nextTick()
        goToPage(insertAfter + 1)
        success('Blank page added.')
    } catch (err) {
        console.error(err)
        error('Could not add page. Please try again.')
    } finally {
        isAddingPage.value = false
    }
}

// ─── Search ───────────────────────────────────────────────────────────────────
const showSearch = ref(false)
const searchQuery = ref('')
const searchResults = ref([])   // [{ pageNum, itemId }]
const searchIndex = ref(-1)
const isLoadingSearch = ref(false)
const searchInputRef = ref(null)

const searchCurrentMatch = computed(() => searchResults.value[searchIndex.value] ?? null)

function searchMatchIdsForPage(pageNum) {
    const ids = new Set()
    for (const r of searchResults.value) {
        if (r.pageNum === pageNum) ids.add(r.itemId)
    }
    return ids
}

function searchCurrentIdForPage(pageNum) {
    const cur = searchCurrentMatch.value
    return cur?.pageNum === pageNum ? cur.itemId : null
}

async function openSearch() {
    showSearch.value = true
    isLoadingSearch.value = true
    await props.loadAllTextContentFn()
    isLoadingSearch.value = false
    await nextTick()
    searchInputRef.value?.focus()
}

function closeSearch() {
    showSearch.value = false
    searchQuery.value = ''
    searchResults.value = []
    searchIndex.value = -1
}

watch(searchQuery, (q) => {
    const trimmed = q.trim().toLowerCase()
    if (!trimmed) {
        searchResults.value = []
        searchIndex.value = -1
        return
    }
    const results = []
    for (let p = 1; p <= props.pageCount; p++) {
        const slot = props.pages.get(p)
        if (!slot) continue
        for (const item of slot.textItems) {
            if (item.str.toLowerCase().includes(trimmed)) {
                results.push({ pageNum: p, itemId: item.id })
            }
        }
    }
    searchResults.value = results
    searchIndex.value = results.length > 0 ? 0 : -1
    if (results.length > 0) jumpToMatch(0)
})

function jumpToMatch(idx) {
    const match = searchResults.value[idx]
    if (!match) return
    goToPage(match.pageNum)
}

function searchNext() {
    if (!searchResults.value.length) return
    const next = (searchIndex.value + 1) % searchResults.value.length
    searchIndex.value = next
    jumpToMatch(next)
}

function searchPrev() {
    if (!searchResults.value.length) return
    const prev = (searchIndex.value - 1 + searchResults.value.length) % searchResults.value.length
    searchIndex.value = prev
    jumpToMatch(prev)
}

function onSearchKeydown(e) {
    if (e.key === 'Enter') { e.shiftKey ? searchPrev() : searchNext() }
    if (e.key === 'Escape') closeSearch()
}
</script>

<template>
    <div class="editor-root" tabindex="-1" @keydown="onKeydown">

        <!-- ── Sidebar (page thumbnails) ── -->
        <Transition name="sidebar-slide">
            <nav v-if="showSidebar" class="sidebar" aria-label="Page thumbnails">
                <div class="sidebar-header">
                    <span class="sidebar-title">Pages</span>
                    <span class="sidebar-count">{{ pageCount }}</span>
                </div>
                <ul class="thumb-list" role="listbox">
                    <li v-for="n in pageNums" :key="n" class="thumb-item" :class="{ active: activePage === n }"
                        role="option" :aria-selected="activePage === n" @click="goToPage(n)">
                        <div class="thumb-preview">
                            <img v-if="thumbnails.get(n)" :src="thumbnails.get(n)" class="thumb-img"
                                :alt="`Page ${n}`" />
                            <div v-else class="thumb-skeleton">
                                <span class="thumb-skeleton-line" />
                                <span class="thumb-skeleton-line short" />
                                <span class="thumb-skeleton-line" />
                            </div>
                        </div>
                        <div class="thumb-footer">
                            <span class="thumb-page-num">{{ n }}</span>
                            <span v-if="editCount(n) > 0" class="thumb-badge">{{ editCount(n) }}</span>
                        </div>
                    </li>
                </ul>
            </nav>
        </Transition>

        <!-- ── Main area ── -->
        <div class="editor-main">

            <!-- ── Toolbar ── -->
            <header class="toolbar">
                <!-- Left: sidebar toggle + title -->
                <div class="toolbar-left">
                    <button class="toolbar-btn" :class="{ active: showSidebar }" title="Toggle sidebar (panels)"
                        @click="showSidebar = !showSidebar">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <line x1="9" y1="3" x2="9" y2="21" />
                        </svg>
                    </button>

                    <div class="toolbar-title">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <span class="toolbar-filename">{{ fileName }}.pdf</span>
                        <Transition name="badge-pop">
                            <span v-if="totalEdits() > 0" class="edit-badge">{{ totalEdits() }} edit{{ totalEdits() !==
                                1 ? 's' : '' }}</span>
                        </Transition>
                    </div>
                </div>

                <!-- Center: zoom controls -->
                <div class="toolbar-center">
                    <button class="toolbar-btn" title="Zoom out (Ctrl/⌘–)" @click="zoomOut"
                        :disabled="zoom <= ZOOM_MIN">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2.2">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            <line x1="8" y1="11" x2="14" y2="11" />
                        </svg>
                    </button>
                    <button class="zoom-display" title="Reset zoom (Ctrl/⌘0)" @click="zoomReset">
                        {{ zoomPct }}
                    </button>
                    <button class="toolbar-btn" title="Zoom in (Ctrl/⌘+)" @click="zoomIn" :disabled="zoom >= ZOOM_MAX">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2.2">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            <line x1="11" y1="8" x2="11" y2="14" />
                            <line x1="8" y1="11" x2="14" y2="11" />
                        </svg>
                    </button>
                </div>

                <!-- Right: edit mode toggle + export + close -->
                <div class="toolbar-right">
                    <!-- Insert tools group -->
                    <div class="toolbar-insert-group" :class="{ 'has-active': activeTool }">
                        <span class="insert-label">Insert</span>
                        <!-- Add Text -->
                        <button class="toolbar-btn insert-btn" :class="{ active: activeTool === 'text' }"
                            title="Add text box (click page to place)" @click="startAddText">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                stroke-width="2">
                                <polyline points="4 7 4 4 20 4 20 7" />
                                <line x1="9" y1="20" x2="15" y2="20" />
                                <line x1="12" y1="4" x2="12" y2="20" />
                            </svg>
                            <span>Text</span>
                        </button>
                        <!-- Add Image -->
                        <button class="toolbar-btn insert-btn" :class="{ active: activeTool === 'image' }"
                            title="Insert image" @click="startAddImage">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                stroke-width="2">
                                <rect x="3" y="3" width="18" height="18" rx="2" />
                                <circle cx="8.5" cy="8.5" r="1.5" />
                                <polyline points="21 15 16 10 5 21" />
                            </svg>
                            <span>Image</span>
                        </button>
                        <!-- Add Signature -->
                        <button class="toolbar-btn insert-btn" :class="{ active: activeTool === 'signature' }"
                            title="Draw &amp; insert signature" @click="startAddSignature">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                stroke-width="2">
                                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" />
                                <path
                                    d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z" />
                            </svg>
                            <span>Signature</span>
                        </button>
                        <!-- Cancel active tool -->
                        <button v-if="activeTool" class="toolbar-btn insert-cancel" title="Cancel (Esc)"
                            @click="exitTool">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                stroke-width="2.5">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>

                    <!-- Add Page -->
                    <button class="toolbar-btn" :class="{ loading: isAddingPage }" :disabled="isAddingPage"
                        title="Add blank page after current page" @click="handleAddPage">
                        <span v-if="isAddingPage" class="spinner" aria-hidden="true" />
                        <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="12" y1="13" x2="12" y2="19" />
                            <line x1="9" y1="16" x2="15" y2="16" />
                        </svg>
                        <span>Add Page</span>
                    </button>

                    <!-- Search -->
                    <button class="toolbar-btn" :class="{ active: showSearch }" title="Search text (Ctrl/⌘F)"
                        @click="showSearch ? closeSearch() : openSearch()">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <span>Search</span>
                    </button>

                    <!-- Edit toggle -->
                    <button class="toolbar-btn pill" :class="{ 'active-edit': editMode }" title="Toggle edit mode (E)"
                        @click="editMode = !editMode">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        <span>{{ editMode ? 'Editing' : 'Viewing' }}</span>
                    </button>

                    <!-- Save (apply in-place) -->
                    <!-- <button class="toolbar-btn save-apply-btn" :class="{ loading: isSaving }"
                        :disabled="isSaving || !props.hasEdits()" title="Save changes to PDF (Ctrl/⌘S)"
                        @click="handleSave">
                        <span v-if="isSaving" class="spinner" aria-hidden="true" />
                        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2.2">
                            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                            <polyline points="17 21 17 13 7 13 7 21" />
                            <polyline points="7 3 7 8 15 8" />
                        </svg>
                        <span>{{ isSaving ? 'Saving…' : 'Save' }}</span>
                    </button> -->

                    <!-- Download -->
                    <button class="toolbar-btn download-btn" :class="{ loading: isExporting }" :disabled="isExporting"
                        title="Download PDF (Ctrl/⌘D)" @click="handleExport">
                        <span v-if="isExporting" class="spinner" aria-hidden="true" />
                        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2.2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        <span>{{ isExporting ? 'Downloading…' : 'Download' }}</span>
                    </button>

                    <!-- Close / open new file -->
                    <button class="toolbar-btn" title="Open another file" @click="$emit('close')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
                            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                            <polyline points="9 22 9 12 15 12 15 22" />
                        </svg>
                    </button>
                </div>
            </header>

            <!-- ── Keyboard hint bar ── -->
            <Transition name="fade-fast">
                <div v-if="editMode" class="hint-bar">
                    <kbd>Click</kbd> text to edit &nbsp;·&nbsp;
                    <kbd>Esc</kbd> deselect &nbsp;·&nbsp;
                    <kbd>⌘S</kbd> save &nbsp;·&nbsp;
                    <kbd>⌘D</kbd> download
                </div>
            </Transition>

            <!-- ── Font info bar (shown when a text item is focused) ── -->
            <Transition name="fade-fast">
                <div v-if="activeFontInfo" class="font-info-bar">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="4 7 4 4 20 4 20 7" />
                        <line x1="9" y1="20" x2="15" y2="20" />
                        <line x1="12" y1="4" x2="12" y2="20" />
                    </svg>
                    <span class="font-info-name">{{ cleanFontName(activeFontInfo.fontName) }}</span>
                    <span class="font-info-sep">·</span>
                    <span class="font-info-size">{{ activeFontInfo.fontSize }}pt</span>
                    <span class="font-info-note">Editing this text block</span>
                </div>
            </Transition>

            <!-- ── Search bar ── -->
            <Transition name="fade-fast">
                <div v-if="showSearch" class="search-bar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                        class="search-icon">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input ref="searchInputRef" v-model="searchQuery" class="search-input"
                        placeholder="Search text… (Enter ↓  Shift+Enter ↑)" @keydown="onSearchKeydown" />
                    <span v-if="isLoadingSearch" class="search-status">Loading…</span>
                    <span v-else-if="searchQuery.trim() && searchResults.length === 0"
                        class="search-status search-no-result">No results</span>
                    <span v-else-if="searchResults.length > 0" class="search-status">
                        {{ searchIndex + 1 }} / {{ searchResults.length }}
                    </span>
                    <button class="search-nav-btn" title="Previous (Shift+Enter)" :disabled="searchResults.length === 0"
                        @click="searchPrev">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2.5">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>
                    <button class="search-nav-btn" title="Next (Enter)" :disabled="searchResults.length === 0"
                        @click="searchNext">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2.5">
                            <polyline points="9 18 15 12 9 6" />
                        </svg>
                    </button>
                    <button class="search-close-btn" title="Close search (Esc)" @click="closeSearch">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2.5">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>
            </Transition>

            <!-- ── Pages scroll area ── -->
            <div ref="pagesRef" class="pages-scroll" @scroll.passive="() => { }">
                <div class="pages-column">
                    <div v-for="n in pageNums" :key="`${n}-${resetKey}`" :data-page="n" class="page-wrapper">
                        <PdfPage :page-num="n" :render-fn="renderFn" :pages="pages" :zoom="zoom" :edit-mode="editMode"
                            :is-active="activePage === n" :active-tool="activeTool" :pending-data-url="pendingDataUrl"
                            :search-match-ids="searchMatchIdsForPage(n)" :search-current-id="searchCurrentIdForPage(n)"
                            @edit="handleEdit" @rendered="handleRendered" @add-element="onAddElement"
                            @update-addition="onUpdateAddition" @remove-addition="onRemoveAddition"
                            @text-focus="handleTextFocus" @text-blur="handleTextBlur" />
                    </div>
                </div>
            </div>

            <!-- ── Floating edit action bar ── -->
            <Transition name="action-bar">
                <div v-if="totalEdits() > 0" class="edit-action-bar" role="status" aria-live="polite">
                    <div class="edit-action-inner">
                        <div class="edit-action-info">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                            <span>
                                <strong>{{ totalEdits() }}</strong>
                                unsaved change{{ totalEdits() !== 1 ? 's' : '' }}
                            </span>
                        </div>
                        <div class="edit-action-btns">
                            <button class="action-btn cancel-btn" @click="cancelEdits" :disabled="isExporting">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                    stroke-width="2.5">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                                Discard
                            </button>
                            <button class="action-btn save-btn" @click="handleSave" :disabled="isSaving">
                                <span v-if="isSaving" class="action-spinner" aria-hidden="true" />
                                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                    stroke-width="2.5">
                                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                                    <polyline points="17 21 17 13 7 13 7 21" />
                                    <polyline points="7 3 7 8 15 8" />
                                </svg>
                                {{ isSaving ? 'Saving…' : 'Save' }}
                            </button>
                        </div>
                    </div>
                </div>
            </Transition>
        </div>
    </div>

    <!-- Hidden image file input -->
    <input ref="imageFileInput" type="file" accept="image/*" class="visually-hidden" @change="onImageFileChange" />

    <!-- Signature modal -->
    <Transition name="fade-fast">
        <SignatureModal v-if="showSignatureModal" @done="onSignatureDone" @cancel="showSignatureModal = false" />
    </Transition>
</template>

<style scoped>
/* ── Root ── */
.editor-root {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
    animation: fadeIn 0.3s ease;
    outline: none;
}

/* ── Sidebar ── */
.sidebar {
    width: var(--sidebar-width);
    flex-shrink: 0;
    background: var(--color-sidebar);
    border-right: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 18px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.sidebar-title {
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-sidebar-muted);
}

.sidebar-count {
    background: rgba(255, 255, 255, 0.08);
    color: var(--color-text-sidebar-muted);
    font-size: 0.72rem;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: var(--radius-full);
}

.thumb-list {
    list-style: none;
    padding: 8px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.thumb-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px;
    border-radius: var(--radius-md);
    cursor: pointer;
    color: var(--color-text-sidebar);
    transition: background var(--transition-fast), box-shadow var(--transition-fast);
    user-select: none;
    border: 2px solid transparent;
}

.thumb-item:hover {
    background: rgba(255, 255, 255, 0.06);
}

.thumb-item.active {
    background: rgba(84, 119, 146, 0.18);
    border-color: var(--color-accent);
}

/* ── Thumbnail image/skeleton ── */
.thumb-preview {
    width: 100%;
    aspect-ratio: 210 / 297;
    /* A4 portrait default */
    border-radius: 3px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    position: relative;
}

.thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: opacity 0.3s ease;
}

.thumb-skeleton {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 5px;
    justify-content: center;
    padding: 10px 8px;
}

.thumb-skeleton-line {
    display: block;
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(90deg,
            rgba(255, 255, 255, 0.06) 0%,
            rgba(255, 255, 255, 0.14) 50%,
            rgba(255, 255, 255, 0.06) 100%);
    background-size: 800px 100%;
    animation: shimmer 1.4s infinite linear;
}

.thumb-skeleton-line.short {
    width: 65%;
}

/* ── Thumbnail footer (page number + badge) ── */
.thumb-footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: 100%;
}

.thumb-page-num {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--color-text-sidebar-muted);
    letter-spacing: 0.03em;
}

.thumb-item.active .thumb-page-num {
    color: var(--color-text-sidebar);
}

.thumb-badge {
    background: var(--color-warning);
    color: #fff;
    font-size: 0.68rem;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: var(--radius-full);
    animation: scaleIn 0.3s var(--transition-bounce);
}

/* ── Editor main ── */
.editor-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--color-bg);
    position: relative;
    /* anchor for floating action bar */
}

/* ── Toolbar ── */
.toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--header-height);
    padding: 0 16px;
    gap: 12px;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    box-shadow: var(--shadow-sm);
    z-index: 10;
    flex-shrink: 0;
}

.toolbar-left,
.toolbar-center,
.toolbar-right {
    display: flex;
    align-items: center;
    gap: 6px;
}

.toolbar-left {
    flex: 1;
}

.toolbar-right {
    flex: 1;
    justify-content: flex-end;
}

.toolbar-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-soft);
    font-size: 0.9rem;
    font-weight: 500;
    padding: 0 6px;
}

.toolbar-filename {
    max-width: 200px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--color-text);
    font-weight: 600;
}

.edit-badge {
    font-size: 0.72rem;
    font-weight: 700;
    background: rgba(255, 177, 66, 0.15);
    color: var(--color-warning);
    border: 1px solid rgba(255, 177, 66, 0.3);
    padding: 2px 8px;
    border-radius: var(--radius-full);
}

/* ── Toolbar buttons ── */
.toolbar-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 10px;
    border-radius: var(--radius-md);
    color: var(--color-text-soft);
    font-size: 0.82rem;
    font-weight: 500;
    transition:
        background var(--transition-fast),
        color var(--transition-fast),
        transform var(--transition-fast),
        box-shadow var(--transition-fast);
    white-space: nowrap;
}

.toolbar-btn:hover:not(:disabled) {
    background: var(--color-accent-light);
    color: var(--color-accent);
    transform: translateY(-1px);
}

.toolbar-btn:active:not(:disabled) {
    transform: translateY(0);
}

.toolbar-btn.active {
    background: var(--color-accent-light);
    color: var(--color-accent);
}

.toolbar-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

/* Edit pill */
.toolbar-btn.pill {
    padding: 7px 14px;
    border-radius: var(--radius-full);
    border: 1.5px solid var(--color-border);
}

.toolbar-btn.pill.active-edit {
    background: var(--color-accent);
    color: #fff;
    border-color: var(--color-accent);
    box-shadow: var(--shadow-accent);
}

.toolbar-btn.pill.active-edit:hover {
    background: var(--color-accent-hover);
    color: #fff;
}

/* Download button */
.toolbar-btn.download-btn {
    background: var(--color-accent);
    color: #fff;
    padding: 7px 16px;
    border-radius: var(--radius-full);
    font-weight: 600;
    box-shadow: var(--shadow-accent);
}

.toolbar-btn.download-btn:hover:not(:disabled) {
    background: var(--color-accent-hover);
    color: #fff;
    transform: translateY(-2px);
    box-shadow: 0 6px 24px var(--color-accent-glow);
}

/* Save (apply-in-place) button */
.toolbar-btn.save-apply-btn {
    background: var(--color-warning);
    color: #1A3263;
    padding: 7px 16px;
    border-radius: var(--radius-full);
    font-weight: 700;
    box-shadow: 0 4px 16px rgba(255, 197, 112, 0.35);
}

.toolbar-btn.save-apply-btn:hover:not(:disabled) {
    background: #ffb840;
    color: #1A3263;
    transform: translateY(-2px);
    box-shadow: 0 6px 24px rgba(255, 197, 112, 0.55);
}

.toolbar-btn.save-apply-btn:disabled {
    background: var(--color-border);
    color: var(--color-text-muted);
    box-shadow: none;
    opacity: 0.6;
}

/* Zoom display */
.zoom-display {
    min-width: 58px;
    text-align: center;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--color-text);
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    border: 1.5px solid var(--color-border);
    cursor: pointer;
    transition: background var(--transition-fast);
}

.zoom-display:hover {
    background: var(--color-accent-light);
    border-color: var(--color-accent);
    color: var(--color-accent);
}

/* ── Hint bar ── */
.hint-bar {
    padding: 6px 20px;
    background: var(--color-accent-light);
    border-bottom: 1px solid var(--color-border-soft);
    font-size: 0.76rem;
    color: var(--color-text-muted);
    text-align: center;
    flex-shrink: 0;
}

/* ── Font info bar (shown when editing a text item) ── */
.font-info-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 20px;
    background: rgba(255, 197, 112, 0.1);
    border-bottom: 1px solid rgba(255, 197, 112, 0.3);
    font-size: 0.75rem;
    color: var(--color-text-soft);
    flex-shrink: 0;
    animation: fadeInDown 0.15s ease;
}

.font-info-name {
    font-weight: 700;
    color: var(--color-text);
    font-family: Georgia, serif;
    font-style: italic;
}

.font-info-sep {
    opacity: 0.4;
}

.font-info-size {
    font-weight: 600;
    color: var(--color-accent);
    font-variant-numeric: tabular-nums;
}

.font-info-note {
    margin-left: auto;
    opacity: 0.55;
    font-style: italic;
}

kbd {
    display: inline-block;
    padding: 1px 5px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    font-size: 0.72rem;
    font-family: var(--font-sans);
    font-weight: 600;
    color: var(--color-text-soft);
}

/* ── Spinner ── */
.spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
}

/* ── Pages scroll ── */
.pages-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: auto;
}

.pages-column {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 40px;
    padding: 48px 32px;
    min-height: 100%;
}

.page-wrapper {
    scroll-margin-top: 32px;
}

/* ── Transitions ── */
.sidebar-slide-enter-active,
.sidebar-slide-leave-active {
    transition: width 0.28s ease, opacity 0.2s ease;
    overflow: hidden;
}

.sidebar-slide-enter-from,
.sidebar-slide-leave-to {
    width: 0 !important;
    opacity: 0;
}

.fade-fast-enter-active,
.fade-fast-leave-active {
    transition: opacity 0.2s ease;
}

.fade-fast-enter-from,
.fade-fast-leave-to {
    opacity: 0;
}

/* ── Visually hidden (for hidden inputs) ── */
.visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
}

/* ── Insert tool group ── */
.toolbar-insert-group {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px 6px;
    border-radius: var(--radius-md);
    border: 1.5px solid var(--color-border);
    background: var(--color-surface);
    transition: border-color var(--transition-fast), background var(--transition-fast);
}

.toolbar-insert-group.has-active {
    border-color: var(--color-accent);
    background: var(--color-accent-light);
}

.insert-label {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--color-text-muted);
    padding: 0 4px 0 2px;
    border-right: 1px solid var(--color-border);
    margin-right: 2px;
    user-select: none;
}

.insert-btn {
    font-size: 0.78rem;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
}

.insert-btn.active {
    background: var(--color-accent);
    color: #fff !important;
}

.insert-btn.active:hover {
    background: var(--color-accent-hover) !important;
    color: #fff !important;
    transform: none;
}

.insert-cancel {
    padding: 5px 7px;
    color: var(--color-danger) !important;
    border-radius: var(--radius-sm);
}

.insert-cancel:hover {
    background: rgba(217, 95, 95, 0.1) !important;
    color: var(--color-danger) !important;
}

.badge-pop-enter-active {
    animation: scaleIn 0.25s var(--transition-bounce);
}

.badge-pop-leave-active {
    animation: scaleIn 0.2s ease reverse;
}

/* ── Floating edit action bar ── */
.edit-action-bar {
    position: absolute;
    bottom: 28px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
    pointer-events: all;
}

.edit-action-inner {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 18px;
    background: var(--color-sidebar);
    border-radius: var(--radius-full);
    box-shadow: 0 8px 32px rgba(26, 50, 99, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.08);
    white-space: nowrap;
}

.edit-action-info {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--color-text-sidebar);
    font-size: 0.84rem;
    opacity: 0.9;
}

.edit-action-info svg {
    flex-shrink: 0;
    color: var(--color-warning);
}

.edit-action-info strong {
    color: var(--color-warning);
}

.edit-action-btns {
    display: flex;
    align-items: center;
    gap: 6px;
}

.action-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 16px;
    border-radius: var(--radius-full);
    font-size: 0.83rem;
    font-weight: 600;
    transition:
        background var(--transition-fast),
        transform var(--transition-fast),
        box-shadow var(--transition-fast);
}

.action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.cancel-btn {
    color: rgba(239, 210, 176, 0.75);
    border: 1.5px solid rgba(255, 255, 255, 0.1);
}

.cancel-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    color: var(--color-text-sidebar);
    transform: translateY(-1px);
}

.save-btn {
    background: var(--color-warning);
    color: #1A3263;
    box-shadow: 0 4px 16px rgba(255, 197, 112, 0.4);
}

.save-btn:hover:not(:disabled) {
    background: #ffb840;
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(255, 197, 112, 0.55);
}

.action-spinner {
    display: inline-block;
    width: 13px;
    height: 13px;
    border: 2px solid rgba(26, 50, 99, 0.3);
    border-top-color: #1A3263;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
}

/* Slide-up / slide-down transition */
.action-bar-enter-active {
    animation: actionBarIn 0.3s var(--transition-bounce) both;
}

.action-bar-leave-active {
    animation: actionBarOut 0.25s ease forwards;
}

@keyframes actionBarIn {
    from {
        opacity: 0;
        transform: translateX(-50%) translateY(20px) scale(0.95);
    }

    to {
        opacity: 1;
        transform: translateX(-50%) translateY(0) scale(1);
    }
}

@keyframes actionBarOut {
    from {
        opacity: 1;
        transform: translateX(-50%) translateY(0) scale(1);
    }

    to {
        opacity: 0;
        transform: translateX(-50%) translateY(16px) scale(0.95);
    }
}

/* ── Search bar ── */
.search-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 16px;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
    animation: fadeInDown 0.15s ease;
}

.search-icon {
    color: var(--color-text-muted);
    flex-shrink: 0;
}

.search-input {
    flex: 1;
    max-width: 340px;
    padding: 5px 10px;
    border-radius: var(--radius-md);
    border: 1.5px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: 0.84rem;
    outline: none;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.search-input:focus {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px var(--color-accent-glow);
}

.search-status {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--color-text-muted);
    min-width: 52px;
    text-align: center;
    font-variant-numeric: tabular-nums;
}

.search-no-result {
    color: var(--color-danger);
}

.search-nav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    color: var(--color-text-soft);
    transition: background var(--transition-fast), color var(--transition-fast);
}

.search-nav-btn:hover:not(:disabled) {
    background: var(--color-accent-light);
    color: var(--color-accent);
}

.search-nav-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}

.search-close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    margin-left: 2px;
    transition: background var(--transition-fast), color var(--transition-fast);
}

.search-close-btn:hover {
    background: rgba(217, 95, 95, 0.1);
    color: var(--color-danger);
}
</style>
