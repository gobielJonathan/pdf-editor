<script setup>
import { useToast } from '@/composables/useToast.js'

const { toasts, dismiss } = useToast()

const icons = {
    success: `<path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>`,
    error: `<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>`,
    warning: `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
    info: `<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>`,
}
</script>

<template>
    <Teleport to="body">
        <div class="toast-container" aria-live="polite" aria-atomic="false">
            <TransitionGroup name="toast">
                <div v-for="toast in toasts" :key="toast.id" class="toast"
                    :class="[`toast--${toast.type}`, { leaving: toast.leaving }]" role="alert">
                    <span class="toast-icon" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2.2" v-html="icons[toast.type] || icons.info"></svg>
                    </span>
                    <span class="toast-msg">{{ toast.message }}</span>
                    <button class="toast-close" :aria-label="`Dismiss: ${toast.message}`" @click="dismiss(toast.id)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2.5">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>
            </TransitionGroup>
        </div>
    </Teleport>
</template>

<style scoped>
.toast-container {
    position: fixed;
    bottom: 28px;
    right: 28px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 9999;
    pointer-events: none;
}

.toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-radius: var(--radius-md);
    background: var(--color-surface);
    border: 1.5px solid var(--color-border);
    box-shadow: var(--shadow-lg);
    min-width: 260px;
    max-width: 420px;
    pointer-events: all;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text);
}

.toast--success {
    border-left: 4px solid var(--color-success);
}

.toast--success .toast-icon {
    color: var(--color-success);
}

.toast--error {
    border-left: 4px solid var(--color-danger);
}

.toast--error .toast-icon {
    color: var(--color-danger);
}

.toast--warning {
    border-left: 4px solid var(--color-warning);
}

.toast--warning .toast-icon {
    color: var(--color-warning);
}

.toast--info {
    border-left: 4px solid var(--color-accent);
}

.toast--info .toast-icon {
    color: var(--color-accent);
}

.toast-icon {
    flex-shrink: 0;
    display: flex;
}

.toast-msg {
    flex: 1;
    line-height: 1.4;
}

.toast-close {
    flex-shrink: 0;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 2px;
    border-radius: var(--radius-sm);
    transition: color var(--transition-fast), background var(--transition-fast);
    display: flex;
}

.toast-close:hover {
    color: var(--color-text);
    background: var(--color-accent-light);
}

/* TransitionGroup */
.toast-enter-active {
    animation: toastSlide 0.35s var(--transition-bounce) both;
}

.toast-leave-active {
    animation: toastOut 0.4s ease forwards;
}

.toast-move {
    transition: transform 0.3s ease;
}
</style>
