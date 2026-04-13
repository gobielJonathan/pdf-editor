<script setup>
import { ref } from 'vue'

const emit = defineEmits(['file-selected'])

const isDragging = ref(false)
const isHovering = ref(false)
const fileInput = ref(null)
const fileError = ref('')

function handleDrop(e) {
    isDragging.value = false
    fileError.value = ''
    const file = e.dataTransfer?.files?.[0]
    if (file) validateAndEmit(file)
}

function handleFileInput(e) {
    fileError.value = ''
    const file = e.target.files?.[0]
    if (file) validateAndEmit(file)
}

function validateAndEmit(file) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        fileError.value = 'Please select a valid PDF file.'
        return
    }
    if (file.size > 100 * 1024 * 1024) {
        fileError.value = 'File size must be under 100 MB.'
        return
    }
    emit('file-selected', file)
}

function openPicker() {
    if (window.electronAPI) {
        window.electronAPI.openFile().then((result) => {
            if (!result) return
            const blob = new Blob([result.buffer], { type: 'application/pdf' })
            const file = new File([blob], result.name, { type: 'application/pdf' })
            validateAndEmit(file)
        })
    } else {
        fileInput.value?.click()
    }
}
</script>

<template>
    <div class="upload-wrapper">
        <div class="upload-zone" :class="{ dragging: isDragging, hovering: isHovering }" role="button" tabindex="0"
            aria-label="Upload PDF — click or drag & drop" @click="openPicker" @keydown.enter.space.prevent="openPicker"
            @dragenter.prevent="isDragging = true" @dragleave.prevent="isDragging = false" @dragover.prevent
            @drop.prevent="handleDrop" @mouseenter="isHovering = true" @mouseleave="isHovering = false">
            <!-- Animated background blobs -->
            <div class="blob blob-1" aria-hidden="true" />
            <div class="blob blob-2" aria-hidden="true" />

            <!-- Icon -->
            <div class="upload-icon" :class="{ bounce: isDragging }">
                <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="8" y="4" width="34" height="44" rx="4" fill="currentColor" opacity=".1" />
                    <rect x="8" y="4" width="34" height="44" rx="4" stroke="currentColor" stroke-width="2.5"
                        stroke-linejoin="round" />
                    <path d="M42 4l10 10H42V4Z" fill="currentColor" opacity=".25" />
                    <path d="M42 4l10 10H42V4Z" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" />
                    <text x="15" y="32" font-family="Arial" font-size="11" font-weight="700"
                        fill="currentColor">PDF</text>
                    <!-- Arrow up -->
                    <circle cx="48" cy="48" r="12" fill="currentColor" opacity=".2" />
                    <path d="M48 54v-12M44 46l4-4 4 4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
                        stroke-linejoin="round" />
                </svg>
            </div>

            <!-- Text -->
            <div class="upload-text">
                <p class="upload-title">
                    <span v-if="isDragging">Drop it here!</span>
                    <span v-else>Drop your PDF here</span>
                </p>
                <p class="upload-sub">or <span class="upload-link">click to browse</span></p>
                <p class="upload-hint">Supports PDF up to 100 MB</p>
            </div>

            <!-- Hidden input -->
            <input ref="fileInput" type="file" accept=".pdf,application/pdf" class="visually-hidden" tabindex="-1"
                @change="handleFileInput" />
        </div>

        <!-- Error message -->
        <Transition name="error-fade">
            <p v-if="fileError" class="upload-error" role="alert">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {{ fileError }}
            </p>
        </Transition>
    </div>
</template>

<style scoped>
.upload-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    animation: fadeInUp 0.5s var(--transition-bounce) both;
}

/* ── Zone ── */
.upload-zone {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    width: clamp(320px, 62vw, 580px);
    padding: 60px 40px;
    border-radius: 20px;
    border: 1.5px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    backdrop-filter: blur(18px);
    cursor: pointer;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.28), inset 0 0 0 1px rgba(255, 255, 255, 0.06);
    transition:
        border-color var(--transition-base),
        background var(--transition-base),
        box-shadow var(--transition-base),
        transform var(--transition-fast);
    outline: none;
    user-select: none;
}

.upload-zone:hover,
.upload-zone:focus-visible,
.upload-zone.hovering {
    border-color: rgba(84, 119, 146, 0.55);
    background: rgba(84, 119, 146, 0.09);
    box-shadow: 0 0 0 5px rgba(84, 119, 146, 0.14), 0 12px 48px rgba(0, 0, 0, 0.32), inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    transform: translateY(-3px);
}

.upload-zone.dragging {
    border-color: var(--color-teal);
    background: rgba(0, 209, 178, 0.04);
    box-shadow: 0 0 0 6px rgba(0, 209, 178, 0.15), var(--shadow-lg);
    transform: scale(1.015);
    animation: borderPulse 1.4s ease-in-out infinite;
}

/* ── Background blobs ── */
.blob {
    position: absolute;
    border-radius: 50%;
    filter: blur(60px);
    opacity: 0.55;
    transition: opacity 0.6s ease;
    pointer-events: none;
}

.upload-zone:hover .blob,
.upload-zone.dragging .blob {
    opacity: 1;
}

.blob-1 {
    width: 260px;
    height: 260px;
    top: -80px;
    left: -80px;
    background: radial-gradient(circle, rgba(84, 119, 146, 0.18), transparent 70%);
    animation: drift 8s ease-in-out infinite alternate;
}

.blob-2 {
    width: 200px;
    height: 200px;
    bottom: -60px;
    right: -40px;
    background: radial-gradient(circle, rgba(255, 197, 112, 0.2), transparent 70%);
    animation: drift 10s ease-in-out infinite alternate-reverse;
}

@keyframes drift {
    from {
        transform: translate(0, 0) scale(1);
    }

    to {
        transform: translate(20px, 20px) scale(1.08);
    }
}

/* ── Icon ── */
.upload-icon {
    color: var(--color-accent);
    width: 80px;
    height: 80px;
    transition: transform var(--transition-bounce);
}

.upload-icon svg {
    width: 100%;
    height: 100%;
}

.upload-zone:hover .upload-icon,
.upload-zone.hovering .upload-icon {
    transform: translateY(-4px) scale(1.04);
}

.upload-icon.bounce {
    animation: iconBounce 0.5s var(--transition-bounce) infinite alternate;
}

@keyframes iconBounce {
    from {
        transform: translateY(0);
    }

    to {
        transform: translateY(-10px);
    }
}

/* ── Text ── */
.upload-text {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    text-align: center;
    position: relative;
    z-index: 1;
}

.upload-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--color-text);
    letter-spacing: -0.01em;
}

.upload-sub {
    font-size: 0.88rem;
    color: var(--color-text-muted);
}

.upload-link {
    color: var(--color-accent);
    font-weight: 500;
    text-decoration: underline;
    text-decoration-color: transparent;
    transition: text-decoration-color var(--transition-fast);
}

.upload-zone:hover .upload-link {
    text-decoration-color: currentColor;
}

.upload-hint {
    font-size: 0.78rem;
    color: var(--color-text-muted);
    margin-top: 4px;
}

/* ── Error ── */
.upload-error {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
    color: var(--color-danger);
    animation: shake 0.4s ease;
}

@keyframes shake {

    0%,
    100% {
        transform: translateX(0);
    }

    20% {
        transform: translateX(-6px);
    }

    40% {
        transform: translateX(6px);
    }

    60% {
        transform: translateX(-4px);
    }

    80% {
        transform: translateX(4px);
    }
}

/* ── Transitions ── */
.error-fade-enter-active {
    animation: fadeInDown 0.2s ease;
}

.error-fade-leave-active {
    animation: fadeIn 0.2s ease reverse;
}
</style>
