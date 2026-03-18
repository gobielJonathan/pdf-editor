/**
 * useToast — lightweight toast notification system
 */
import { ref } from 'vue'

const toasts = ref([])
let uid = 0

export function useToast() {
  function show(message, type = 'info', duration = 3500) {
    const id = ++uid
    toasts.value.push({ id, message, type, leaving: false })

    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }

    return id
  }

  function dismiss(id) {
    const index = toasts.value.findIndex(t => t.id === id)
    if (index === -1) return
    toasts.value[index].leaving = true
    setTimeout(() => {
      toasts.value = toasts.value.filter(t => t.id !== id)
    }, 420)
  }

  const success = (msg, dur) => show(msg, 'success', dur)
  const error   = (msg, dur) => show(msg, 'error',   dur)
  const info    = (msg, dur) => show(msg, 'info',    dur)
  const warning = (msg, dur) => show(msg, 'warning', dur)

  return { toasts, show, dismiss, success, error, info, warning }
}
