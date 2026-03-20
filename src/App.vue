<script setup>
import { ref } from 'vue'
import { Analytics } from '@vercel/analytics/vue';

import { usePdfDocument } from '@/composables/usePdfDocument.js'
import { useToast } from '@/composables/useToast.js'
import UploadZone from '@/components/UploadZone.vue'
import PdfEditor from '@/components/PdfEditor.vue'
import ToastContainer from '@/components/ToastContainer.vue'

const { error } = useToast()

const {
  pageCount,
  isLoading,
  fileName,
  pages,
  loadFile,
  renderPage,
  renderThumbnail,
  recordEdit,
  hasEdits,
  exportPdf,
  recordAddition,
  removeAddition,
  updateAddition,
  clearAllEdits,
  applyEdits,
} = usePdfDocument()

// ── State ──────────────────────────────────────────────────────────────────────
const stage = ref('upload')   // 'upload' | 'editor'

// ── Upload handler ─────────────────────────────────────────────────────────────
async function onFileSelected(file) {
  try {
    await loadFile(file)
    stage.value = 'editor'
  } catch (err) {
    error(`Could not open file: ${err.message}`)
  }
}

// ── Edit handler ───────────────────────────────────────────────────────────────
function onEdit(pageNum, itemId, newText) {
  recordEdit(pageNum, itemId, newText)
}

// ── Back to upload ─────────────────────────────────────────────────────────────
function closeEditor() {
  stage.value = 'upload'
}
</script>

<template>
  <div class="app-shell">
    <Analytics />

    <!-- ── Screen transition ── -->
    <Transition name="screen" mode="out-in">

      <!-- Upload screen -->
      <div v-if="stage === 'upload'" class="upload-screen" key="upload">
        <!-- Header -->
        <header class="app-header">
          <div class="app-logo">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect width="28" height="28" rx="7" fill="#547792" />
              <path d="M7 8h9.5a3.5 3.5 0 0 1 0 7H7V8Z" fill="white" opacity=".9" />
              <rect x="7" y="17" width="7" height="2.5" rx="1.25" fill="white" opacity=".7" />
            </svg>
            <span>PDF<strong>Edit</strong></span>
          </div>
        </header>

        <!-- Main content -->
        <main class="upload-main">
          <div class="hero-text">
            <h1 class="hero-title">
              Edit your PDF<br />
              <span class="hero-accent">right in the browser</span>
            </h1>
            <p class="hero-sub">
              Click on any text to edit it, then download your updated PDF.
              No signup, no server — everything stays on your device.
            </p>
          </div>

          <!-- Upload zone -->
          <Transition name="fade" mode="out-in">
            <div v-if="!isLoading" key="zone">
              <UploadZone @file-selected="onFileSelected" />
            </div>
            <div v-else class="loading-state" key="loading">
              <div class="loading-ring" />
              <p>Loading PDF…</p>
            </div>
          </Transition>

          <!-- Features row -->
          <div class="features">
            <div class="feature">
              <div class="feature-icon">✏️</div>
              <p>Edit any text</p>
            </div>
            <div class="feature">
              <div class="feature-icon">🔒</div>
              <p>100% private</p>
            </div>
            <div class="feature">
              <div class="feature-icon">⚡</div>
              <p>Instant export</p>
            </div>
          </div>
        </main>
      </div>

      <!-- Editor screen -->
      <div v-else class="editor-screen" key="editor">
        <PdfEditor :page-count="pageCount" :pages="pages" :render-fn="renderPage" :thumb-fn="renderThumbnail"
          :export-fn="exportPdf" :has-edits="hasEdits" :file-name="fileName" :record-addition-fn="recordAddition"
          :remove-addition-fn="removeAddition" :update-addition-fn="updateAddition" :clear-edits-fn="clearAllEdits"
          :apply-edits-fn="applyEdits" @close="closeEditor" @edit="onEdit" />
      </div>

    </Transition>

    <!-- Toast notifications -->
    <ToastContainer />
  </div>
</template>

<style scoped>
/* ── Shell ── */
.app-shell {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

/* ── Screens ── */
.upload-screen,
.editor-screen {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.upload-screen {
  background: var(--color-bg);
  overflow-y: auto;
}

/* ── Header ── */
.app-header {
  display: flex;
  align-items: center;
  height: var(--header-height);
  padding: 0 28px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  box-shadow: var(--shadow-sm);
  flex-shrink: 0;
}

.app-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.15rem;
  font-weight: 500;
  color: var(--color-text);
  letter-spacing: -0.01em;
}

.app-logo strong {
  color: var(--color-accent);
  font-weight: 700;
}

/* ── Upload main ── */
.upload-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 40px;
  padding: 60px 24px;
}

/* ── Hero ── */
.hero-text {
  text-align: center;
  animation: fadeInUp 0.5s ease both;
}

.hero-title {
  font-size: clamp(2rem, 5vw, 3rem);
  font-weight: 700;
  line-height: 1.2;
  color: var(--color-text);
  letter-spacing: -0.03em;
}

.hero-accent {
  background: linear-gradient(135deg, var(--color-accent), var(--color-teal));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-sub {
  margin-top: 14px;
  font-size: 1rem;
  color: var(--color-text-soft);
  max-width: 480px;
  margin-left: auto;
  margin-right: auto;
  line-height: 1.6;
}

/* ── Loading ── */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: var(--color-text-soft);
}

.loading-ring {
  width: 44px;
  height: 44px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* ── Features ── */
.features {
  display: flex;
  gap: 32px;
  flex-wrap: wrap;
  justify-content: center;
  animation: fadeInUp 0.6s 0.1s ease both;
}

.feature {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
  color: var(--color-text-muted);
  font-weight: 500;
}

.feature-icon {
  font-size: 1.5rem;
  background: var(--color-surface);
  width: 50px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  border: 1.5px solid var(--color-border);
  box-shadow: var(--shadow-sm);
}

/* ── Editor screen ── */
.editor-screen {
  background: var(--color-bg);
}

/* ── Screen transitions ── */
.screen-enter-active {
  animation: fadeIn 0.3s ease;
}

.screen-leave-active {
  animation: fadeIn 0.2s ease reverse;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
