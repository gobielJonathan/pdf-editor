<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const emit = defineEmits(['done', 'cancel'])

const canvasRef = ref(null)
const isDrawing = ref(false)
const hasStrokes = ref(false)
let ctx = null
let lastX = 0
let lastY = 0

onMounted(() => {
    ctx = canvasRef.value.getContext('2d')
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 2.5
    ctx.strokeStyle = '#1A3263'
    window.addEventListener('keydown', onGlobalKey)
})

onUnmounted(() => {
    window.removeEventListener('keydown', onGlobalKey)
})

function onGlobalKey(e) {
    if (e.key === 'Escape') emit('cancel')
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') confirmSignature()
}

// ── Drawing ───────────────────────────────────────────────────────────────────
function getPos(e) {
    const rect = canvasRef.value.getBoundingClientRect()
    const touch = e.touches?.[0]
    const clientX = touch ? touch.clientX : e.clientX
    const clientY = touch ? touch.clientY : e.clientY
    return [clientX - rect.left, clientY - rect.top]
}

function startDraw(e) {
    e.preventDefault()
    isDrawing.value = true
        ;[lastX, lastY] = getPos(e)
    ctx.beginPath()
    ctx.moveTo(lastX, lastY)
}

function draw(e) {
    e.preventDefault()
    if (!isDrawing.value) return
    const [x, y] = getPos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x, y)
    lastX = x
    lastY = y
    hasStrokes.value = true
}

function endDraw(e) {
    e.preventDefault()
    isDrawing.value = false
    ctx.beginPath()
}

function clearCanvas() {
    ctx.clearRect(0, 0, canvasRef.value.width, canvasRef.value.height)
    hasStrokes.value = false
}

function confirmSignature() {
    if (!hasStrokes.value) return
    // Crop to the drawn area's bounding box for a tight export
    const dataUrl = canvasRef.value.toDataURL('image/png')
    emit('done', dataUrl)
}
</script>

<template>
    <Teleport to="body">
        <div class="sig-backdrop" @click.self="$emit('cancel')">
            <div class="sig-modal" role="dialog" aria-modal="true" aria-label="Draw your signature">

                <div class="sig-header">
                    <div class="sig-title">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
                            <path
                                d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                        </svg>
                        <span>Draw Signature</span>
                    </div>
                    <button class="sig-close" @click="$emit('cancel')" aria-label="Close">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2.5">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                <div class="sig-body">
                    <p class="sig-hint">Draw your signature below using your mouse or touch</p>

                    <div class="sig-canvas-wrap">
                        <canvas ref="canvasRef" class="sig-canvas" width="560" height="200" @mousedown="startDraw"
                            @mousemove="draw" @mouseup="endDraw" @mouseleave="endDraw" @touchstart="startDraw"
                            @touchmove="draw" @touchend="endDraw" />
                        <div v-if="!hasStrokes" class="sig-placeholder" aria-hidden="true">Sign here…</div>
                    </div>
                </div>

                <div class="sig-footer">
                    <button class="sig-btn secondary" @click="clearCanvas" :disabled="!hasStrokes">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
                            <polyline points="1 4 1 10 7 10" />
                            <path d="M3.51 15a9 9 0 1 0 .49-4.93" />
                        </svg>
                        Clear
                    </button>
                    <div class="sig-footer-right">
                        <button class="sig-btn ghost" @click="$emit('cancel')">Cancel</button>
                        <button class="sig-btn primary" :disabled="!hasStrokes" @click="confirmSignature">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                stroke-width="2.5">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                            Use Signature
                        </button>
                    </div>
                </div>

            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.sig-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(26, 50, 99, 0.55);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
    animation: fadeIn 0.2s ease;
}

.sig-modal {
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg), 0 0 0 1px var(--color-border);
    width: min(600px, 96vw);
    display: flex;
    flex-direction: column;
    animation: scaleIn 0.25s var(--transition-bounce) both;
    overflow: hidden;
}

.sig-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 22px 14px;
    border-bottom: 1px solid var(--color-border);
}

.sig-title {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--color-text);
}

.sig-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    transition: background var(--transition-fast), color var(--transition-fast);
}

.sig-close:hover {
    background: var(--color-accent-light);
    color: var(--color-accent);
}

.sig-body {
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.sig-hint {
    font-size: 0.82rem;
    color: var(--color-text-muted);
    text-align: center;
}

.sig-canvas-wrap {
    position: relative;
    border: 2px dashed var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: #fdfaf5;
    cursor: crosshair;
    transition: border-color var(--transition-fast);
}

.sig-canvas-wrap:hover {
    border-color: var(--color-accent);
}

.sig-canvas {
    display: block;
    width: 100%;
    height: 200px;
    touch-action: none;
}

.sig-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.4rem;
    color: var(--color-border);
    font-style: italic;
    pointer-events: none;
    user-select: none;
    font-family: Georgia, serif;
}

.sig-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 22px 18px;
    border-top: 1px solid var(--color-border);
    gap: 10px;
}

.sig-footer-right {
    display: flex;
    align-items: center;
    gap: 8px;
}

/* ── Buttons ── */
.sig-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border-radius: var(--radius-full);
    font-size: 0.84rem;
    font-weight: 600;
    transition:
        background var(--transition-fast),
        transform var(--transition-fast),
        box-shadow var(--transition-fast);
}

.sig-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.sig-btn.primary {
    background: var(--color-accent);
    color: #fff;
    box-shadow: var(--shadow-accent);
}

.sig-btn.primary:hover:not(:disabled) {
    background: var(--color-accent-hover);
    transform: translateY(-1px);
    box-shadow: 0 6px 20px var(--color-accent-glow);
}

.sig-btn.secondary {
    background: var(--color-accent-light);
    color: var(--color-accent);
    border: 1.5px solid var(--color-accent-light);
}

.sig-btn.secondary:hover:not(:disabled) {
    background: rgba(84, 119, 146, 0.2);
}

.sig-btn.ghost {
    color: var(--color-text-muted);
    border: 1.5px solid var(--color-border);
}

.sig-btn.ghost:hover {
    background: var(--color-accent-light);
    color: var(--color-accent);
    border-color: var(--color-accent-light);
}
</style>
