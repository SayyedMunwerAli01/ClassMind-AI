/**
 * Background Timer Worker for ClassMind AudioRecorder.
 *
 * Browsers throttle setInterval/setTimeout to once-per-minute when a tab is
 * hidden (background). This worker runs on its own thread and is NOT throttled,
 * so the 15-second segment timer keeps firing even when the teacher switches
 * to another app or minimises the browser on mobile.
 *
 * Protocol:
 *   Main → Worker:  { type: 'start', intervalMs: number }
 *   Main → Worker:  { type: 'stop' }
 *   Worker → Main:  { type: 'tick' }
 */

let timerId: ReturnType<typeof setInterval> | null = null

self.onmessage = (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'start') {
    // Clear any existing timer first
    if (timerId !== null) {
      clearInterval(timerId)
    }
    timerId = setInterval(() => {
      self.postMessage({ type: 'tick' })
    }, msg.intervalMs)
  }

  if (msg.type === 'stop') {
    if (timerId !== null) {
      clearInterval(timerId)
      timerId = null
    }
  }
}
