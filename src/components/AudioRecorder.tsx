import { useState, useRef, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/constants'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'
import { Mic, Square, Pause, Play, Radio, Wifi, WifiOff, MonitorUp } from 'lucide-react'
import { clsx } from 'clsx'
import SegmentTimerWorker from '@/workers/segment-timer.worker.ts?worker'

/* ── Types ── */
interface AudioRecorderProps {
  subjectId: string
  teacherId: string
  /** Continue an existing session (crash recovery) instead of starting a new one. */
  sessionId?: string
  /** Start recording immediately on mount (used when the teacher taps the live mic). */
  autoStart?: boolean
  /** Increment to command an automatic stop (scheduled class time ran out). */
  stopSignal?: number
  onTranscriptionUpdate?: (text: string, chunkCount: number) => void
  onRecordingComplete?: (sessionId: string) => void
  onStatusChange?: (status: RecordingState['status']) => void
}

interface RecordingState {
  status: 'idle' | 'recording' | 'paused' | 'processing'
  sessionId: string | null
  duration: number
  chunkCount: number
  accumulatedText: string
  error: string | null
}

type PendingChunk = {
  sessionId: string
  chunkNumber: number
  b64: string
  mime: string
  attempts: number
}

/* ── Constants ── */
const SEGMENT_INTERVAL_MS = 15000 // 15 seconds per segment
const MAX_RETRY_ATTEMPTS = 8
const PENDING_STORAGE_KEY = 'classmind_pending_audio_chunks'
const FLUSH_INTERVAL_MS = 10000
const LOCAL_STORAGE_WARN_MB = 3 // warn when queued data exceeds this

/* ── Component ── */
export default function AudioRecorder({
  subjectId,
  teacherId,
  sessionId,
  autoStart = false,
  stopSignal = 0,
  onTranscriptionUpdate,
  onRecordingComplete,
  onStatusChange,
}: AudioRecorderProps) {
  const [state, setState] = useState<RecordingState>({
    status: 'idle',
    sessionId: null,
    duration: 0,
    chunkCount: 0,
    accumulatedText: '',
    error: null,
  })

  const [pendingCount, setPendingCount] = useState(0)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [audioStatus, setAudioStatus] = useState('')
  const [offlineSeconds, setOfflineSeconds] = useState(0)
  const [lostChunks, setLostChunks] = useState(0)
  const [queueSizeKB, setQueueSizeKB] = useState(0)

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const workerRef = useRef<Worker | null>(null) // background segment timer
  const segmentTimerRef = useRef<ReturnType<typeof setInterval> | null>(null) // fallback
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionIdRef = useRef<string>(sessionId || '')
  const chunkCounterRef = useRef(0)
  const flushingRef = useRef(false)
  const pendingChunksRef = useRef<PendingChunk[]>([])
  const recordingRef = useRef(false) // tracks if we're actively recording segments
  const autoStartedRef = useRef(false) // guard so autoStart fires exactly once
  const wakeLockRef = useRef<any>(null) // Wake Lock sentinel
  const tabHiddenRef = useRef(false) // tracks if user switched away
  const offlineSinceRef = useRef<number | null>(null) // timestamp when internet went down
  const uploadedCountRef = useRef(0)
  const lostCountRef = useRef(0)
  const offlineTickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Stable refs for callbacks
  const subjectIdRef = useRef(subjectId)
  const teacherIdRef = useRef(teacherId)
  const onTranscriptionUpdateRef = useRef(onTranscriptionUpdate)
  const onRecordingCompleteRef = useRef(onRecordingComplete)
  const onStatusChangeRef = useRef(onStatusChange)

  useEffect(() => { subjectIdRef.current = subjectId }, [subjectId])
  useEffect(() => { teacherIdRef.current = teacherId }, [teacherId])
  useEffect(() => { onTranscriptionUpdateRef.current = onTranscriptionUpdate }, [onTranscriptionUpdate])
  useEffect(() => { onRecordingCompleteRef.current = onRecordingComplete }, [onRecordingComplete])
  useEffect(() => { onStatusChangeRef.current = onStatusChange }, [onStatusChange])

  // Report status transitions to the parent (drives the part-lock heartbeat)
  useEffect(() => {
    onStatusChangeRef.current?.(state.status)
  }, [state.status])

  /* ── Web Worker for background-safe segment timer ── */
  useEffect(() => {
    try {
      const w = new SegmentTimerWorker()
      w.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'tick' && recordingRef.current) {
          try { mediaRecorderRef.current?.stop() } catch { /* already stopped */ }
        }
      }
      workerRef.current = w
    } catch {
      // Worker not supported — will fall back to setInterval
      workerRef.current = null
    }
    return () => { workerRef.current?.terminate() }
  }, [])

  /* ── Visibility change: warn user when tab goes hidden during recording ── */
  useEffect(() => {
    const handler = () => {
      tabHiddenRef.current = document.hidden
      if (document.hidden && recordingRef.current) {
        console.warn('[AudioRecorder] Tab hidden — recording continues via Web Worker')
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  /* ── Wake Lock: prevent screen from sleeping while recording (mobile) ── */
  const acquireWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen')
        wakeLockRef.current?.addEventListener('release', () => {
          // Re-acquire if we're still recording (e.g. tab was hidden and came back)
          if (recordingRef.current) {
            acquireWakeLock().catch(() => {})
          }
        })
      }
    } catch { /* Wake Lock not available or denied */ }
  }, [])

  const releaseWakeLock = useCallback(async () => {
    try { await wakeLockRef.current?.release() } catch { /* */ }
    wakeLockRef.current = null
  }, [])

  /* ── Pending chunk queue (localStorage persistence) ── */
  const loadPending = (): PendingChunk[] => {
    try {
      const raw = localStorage.getItem(PENDING_STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  }

  const savePending = (chunks: PendingChunk[]) => {
    try {
      const json = JSON.stringify(chunks)
      localStorage.setItem(PENDING_STORAGE_KEY, json)
      setQueueSizeKB(Math.round(json.length / 1024))
    }
    catch { /* storage full — keep in-memory copy */ }
  }

  useEffect(() => {
    pendingChunksRef.current = loadPending()
    setPendingCount(pendingChunksRef.current.length)
    // Estimate queue size from loaded chunks
    try {
      const raw = localStorage.getItem(PENDING_STORAGE_KEY)
      if (raw) setQueueSizeKB(Math.round(raw.length / 1024))
    } catch { /* */ }
  }, [])

  /* ── Upload a single chunk to edge function ── */
  const uploadChunk = async (sessionId: string, chunkNumber: number, b64: string, mime: string) => {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token || SUPABASE_ANON_KEY

    const response = await fetch(`${SUPABASE_URL}/functions/v1/process-audio-chunk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        sessionId,
        teacherId: teacherIdRef.current,
        subjectId: subjectIdRef.current,
        audioData: b64,
        mimeType: mime,
        chunkIndex: chunkNumber,
        isFinal: false,
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      throw new Error(data?.error || `HTTP ${response.status}`)
    }
    if (!data.success) {
      throw new Error(data.error || 'Upload failed')
    }

    // Track successful upload
    uploadedCountRef.current++

    // Only update UI for the current session — stale chunks from previous
    // lectures still upload to the correct backend session, but silently.
    if (sessionId === sessionIdRef.current) {
      if (data.fullText) {
        setState(prev => ({ ...prev, accumulatedText: data.fullText }))
      }
      if (data.transcript && onTranscriptionUpdateRef.current) {
        onTranscriptionUpdateRef.current(data.transcript, chunkNumber)
      }
    }

    return data
  }

  /* ── Retry queue management ── */
  const enqueuePending = (item: PendingChunk) => {
    pendingChunksRef.current = [...pendingChunksRef.current, item]
    savePending(pendingChunksRef.current)
    setPendingCount(pendingChunksRef.current.length)
  }

  const flushPending = useCallback(async () => {
    if (flushingRef.current || pendingChunksRef.current.length === 0) return
    // Don't flush while offline — avoid burning retries on network failures
    if (!navigator.onLine) return
    flushingRef.current = true
    try {
      const remaining: PendingChunk[] = []
      for (const item of pendingChunksRef.current) {
        try {
          await uploadChunk(item.sessionId, item.chunkNumber, item.b64, item.mime)
        } catch {
          // Only count as a real retry when online — if the network dropped
          // mid-request, keep the chunk without incrementing attempts.
          if (!navigator.onLine) {
            remaining.push(item) // preserve as-is, retry later
          } else if (item.attempts + 1 < MAX_RETRY_ATTEMPTS) {
            remaining.push({ ...item, attempts: item.attempts + 1 })
          } else {
            // Server rejected this chunk 8 times while online — truly lost
            lostCountRef.current++
            setLostChunks(lostCountRef.current)
          }
        }
      }
      pendingChunksRef.current = remaining
      savePending(remaining)
      setPendingCount(remaining.length)
    } finally {
      flushingRef.current = false
    }
  }, [])

  /** Wait for all pending chunks to flush (with timeout) */
  const flushWithTimeout = async (sessionId: string, timeoutMs: number): Promise<number> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const relevant = pendingChunksRef.current.filter(c => c.sessionId === sessionId)
      if (relevant.length === 0) return 0
      await flushPending()
      await new Promise(r => setTimeout(r, 800))
    }
    return pendingChunksRef.current.filter(c => c.sessionId === sessionId).length
  }

  /* ── Online/offline detection + auto-flush + auto-stop ── */
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true)
      offlineSinceRef.current = null
      setOfflineSeconds(0)
      if (offlineTickRef.current) { clearInterval(offlineTickRef.current); offlineTickRef.current = null }
      setAudioStatus('Connection restored — flushing queued segments...')
      void flushPending()
    }
    const onOffline = () => {
      setIsOnline(false)
      offlineSinceRef.current = Date.now()
      setAudioStatus('Internet lost — segments queued locally')
      // Tick every second to show offline duration
      offlineTickRef.current = setInterval(() => {
        if (offlineSinceRef.current) {
          const elapsed = Math.floor((Date.now() - offlineSinceRef.current) / 1000)
          setOfflineSeconds(elapsed)
        }
      }, 1000)
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const interval = setInterval(() => { void flushPending() }, FLUSH_INTERVAL_MS)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      clearInterval(interval)
      if (offlineTickRef.current) clearInterval(offlineTickRef.current)
    }
  }, [flushPending])

  /* ── Prevent accidental tab close during recording ── */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (recordingRef.current || pendingChunksRef.current.length > 0) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  /* ── Send a complete segment blob ── */
  const sendChunk = useCallback(async (blob: Blob) => {
    if (!blob || blob.size === 0) return
    const sessionId = sessionIdRef.current
    if (!sessionId) return

    const chunkNumber = ++chunkCounterRef.current
    setAudioStatus(`Sending segment #${chunkNumber} (${(blob.size / 1024).toFixed(0)} KB)...`)

    let b64: string
    try {
      // Convert to WAV for Groq compatibility
      const wavBlob = await blobToWav(blob)
      console.log(`[AudioRecorder] Segment #${chunkNumber}: ${(blob.size / 1024).toFixed(0)}KB webm → ${(wavBlob.size / 1024).toFixed(0)}KB wav`)
      b64 = await blobToBase64(wavBlob)
    } catch (err: any) {
      console.warn(`[AudioRecorder] WAV conversion failed for segment #${chunkNumber}:`, err.message)
      // Fallback: send original format
      b64 = await blobToBase64(blob)
    }

    try {
      await uploadChunk(sessionId, chunkNumber, b64, 'audio/wav')
      setState(prev => ({ ...prev, chunkCount: chunkCounterRef.current }))
      setAudioStatus(`Segment #${chunkNumber} transcribed`)
    } catch {
      enqueuePending({ sessionId, chunkNumber, b64, mime: 'audio/wav', attempts: 0 })
      setState(prev => ({ ...prev, chunkCount: chunkCounterRef.current }))
      setAudioStatus(`Segment #${chunkNumber} queued for retry`)
    }
  }, [])

  /* ── Segment-based recording: each segment is a complete MediaRecorder session ── */
  const startSegment = useCallback(() => {
    if (!streamRef.current) return

    const mr = new MediaRecorder(streamRef.current)
    mediaRecorderRef.current = mr
    const localChunks: Blob[] = []

    mr.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) localChunks.push(ev.data)
    }

    mr.onstop = () => {
      if (localChunks.length === 0) return
      const blob = new Blob(localChunks, { type: mr.mimeType || 'audio/webm' })
      void sendChunk(blob)
      // Auto-start next segment if still recording
      if (recordingRef.current && streamRef.current) {
        startSegment()
      }
    }

    mr.start() // No timeslice — record until stop() is called
  }, [sendChunk])

  /* ── Start recording ── */
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      streamRef.current = stream
      if (!sessionIdRef.current) {
        sessionIdRef.current = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`
      }
      chunkCounterRef.current = 0
      recordingRef.current = true

      // Acquire Wake Lock to prevent screen sleep on mobile
      await acquireWakeLock()

      // Start first segment
      startSegment()
      setAudioStatus('Recording — first segment in 15s...')

      // Use Web Worker for segment timer (survives tab switches)
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'start', intervalMs: SEGMENT_INTERVAL_MS })
      } else {
        // Fallback: setInterval (may throttle in background tabs)
        segmentTimerRef.current = setInterval(() => {
          try { mediaRecorderRef.current?.stop() } catch { /* already stopped */ }
        }, SEGMENT_INTERVAL_MS)
      }

      // Duration timer (display only — throttling is acceptable here)
      durationTimerRef.current = setInterval(() => {
        setState(prev => ({ ...prev, duration: prev.duration + 1 }))
      }, 1000)

      setState({
        status: 'recording',
        sessionId: sessionIdRef.current,
        duration: 0,
        chunkCount: 0,
        accumulatedText: '',
        error: null,
      })
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        status: 'idle',
        error: `Microphone access denied: ${err.message}`,
      }))
    }
  }, [startSegment, acquireWakeLock])

  /* ── Auto-start (teacher tapped the live mic / resumed a crashed class) ── */
  useEffect(() => {
    if (autoStart && !autoStartedRef.current) {
      autoStartedRef.current = true
      void startRecording()
    }
  }, [autoStart, startRecording])

  /* ── Stop helpers ── */
  const stopSegmentTimer = () => {
    recordingRef.current = false
    // Stop worker timer
    workerRef.current?.postMessage({ type: 'stop' })
    // Stop fallback timer
    if (segmentTimerRef.current) {
      clearInterval(segmentTimerRef.current)
      segmentTimerRef.current = null
    }
    try { mediaRecorderRef.current?.stop() } catch { /* */ }
    mediaRecorderRef.current = null
  }

  const stopStream = () => {
    try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch { /* */ }
    streamRef.current = null
  }

  const stopDurationTimer = () => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current)
      durationTimerRef.current = null
    }
  }

  /* ── Stop recording & process ── */
  const stopRecording = useCallback(async () => {
    if (state.status !== 'recording' && state.status !== 'paused') return

    stopSegmentTimer()
    stopStream()
    stopDurationTimer()
    await releaseWakeLock()
    // Clear offline tick timer
    if (offlineTickRef.current) { clearInterval(offlineTickRef.current); offlineTickRef.current = null }

    setState(prev => ({ ...prev, status: 'processing' }))
    setAudioStatus('Flushing remaining segments...')

    // Wait for pending chunks to flush (up to 15 seconds)
    const stillPending = await flushWithTimeout(sessionIdRef.current, 15000)
    if (stillPending > 0) {
      setAudioStatus(`${stillPending} segment(s) still retrying in background`)
    } else if (lostCountRef.current > 0) {
      setAudioStatus(`Done — ${uploadedCountRef.current} uploaded, ${lostCountRef.current} lost (internet issues)`)
    } else {
      setAudioStatus(`All ${uploadedCountRef.current} segments uploaded successfully`)
    }

    // Trigger the full transcript processing
    if (onRecordingCompleteRef.current) {
      onRecordingCompleteRef.current(sessionIdRef.current)
    }
  }, [state.status, releaseWakeLock])

  /* Parent-commanded stop — fires when `stopSignal` changes to a new non-zero
     value (the scheduled class time ran out). A freshly mounted recorder
     ignores the value it mounts with, so a stale signal from a previous class
     can never stop a new one. Follows the normal “Stop & Process” path. */
  const lastStopSignalRef = useRef(stopSignal)
  useEffect(() => {
    if (stopSignal === lastStopSignalRef.current) return
    lastStopSignalRef.current = stopSignal
    if (stopSignal > 0) void stopRecording()
  }, [stopSignal, stopRecording])

  /* ── Pause / Resume ── */
  const pauseRecording = useCallback(() => {
    if (state.status !== 'recording') return
    stopSegmentTimer()
    stopDurationTimer()
    setAudioStatus('Paused')
    setState(prev => ({ ...prev, status: 'paused' }))
  }, [state.status])

  const resumeRecording = useCallback(() => {
    if (state.status !== 'paused') return
    const resumeWithStream = (stream: MediaStream) => {
      streamRef.current = stream
      recordingRef.current = true
      startSegment()
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'start', intervalMs: SEGMENT_INTERVAL_MS })
      } else {
        segmentTimerRef.current = setInterval(() => {
          try { mediaRecorderRef.current?.stop() } catch { /* */ }
        }, SEGMENT_INTERVAL_MS)
      }
      durationTimerRef.current = setInterval(() => {
        setState(prev => ({ ...prev, duration: prev.duration + 1 }))
      }, 1000)
      setAudioStatus('Resumed — recording...')
      setState(prev => ({ ...prev, status: 'recording' }))
      acquireWakeLock()
    }
    if (!streamRef.current) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(resumeWithStream).catch(() => {
        setState(prev => ({ ...prev, error: 'Could not re-acquire microphone' }))
      })
    } else {
      resumeWithStream(streamRef.current)
    }
  }, [state.status, startSegment, acquireWakeLock])

  /* ── Cleanup on unmount ── */
  useEffect(() => {
    return () => {
      recordingRef.current = false
      stopStream()
      workerRef.current?.postMessage({ type: 'stop' })
      if (segmentTimerRef.current) clearInterval(segmentTimerRef.current)
      if (durationTimerRef.current) clearInterval(durationTimerRef.current)
      releaseWakeLock()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const formatDuration = (sec: number) =>
    `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`

  return (
    <div
      className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100"
      data-recording={state.status === 'recording' || state.status === 'paused' ? 'true' : 'false'}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <Radio className={clsx('w-5 h-5',
            state.status === 'recording' ? 'text-red-500 animate-pulse' : 'text-gray-400'
          )} />
          <span className="font-semibold text-navy text-sm">Lecture Recorder</span>
        </div>
        <div className="flex items-center gap-2">
          {!isOnline && (
            <Badge color="red" size="sm">
              <WifiOff className="w-3 h-3" /> Offline
            </Badge>
          )}
          {pendingCount > 0 && (
            <Badge color="yellow" size="sm">
              {pendingCount} retrying
            </Badge>
          )}
          {state.status === 'recording' && (
            <Badge color="blue" size="sm">
              Segments: {state.chunkCount}
            </Badge>
          )}
        </div>
      </div>

      {/* ── Prominent offline warning banner ── */}
      {!isOnline && (state.status === 'recording' || state.status === 'paused') && (
        <div className="mb-4 rounded-xl border-2 border-red-300 bg-red-50 p-4 animate-pulse">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
              <WifiOff className="w-5 h-5 text-red-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-red-700 font-bold text-sm">No Internet Connection</p>
              <p className="text-red-500 text-xs mt-0.5">
                Recording continues locally. All segments are saved on this device and will upload automatically when you reconnect — even on another network.
              </p>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="text-red-600 text-xs font-semibold">
                  Offline: {Math.floor(offlineSeconds / 60)}:{(offlineSeconds % 60).toString().padStart(2, '0')}
                </span>
                <span className="text-red-400 text-xs">
                  {pendingCount} segment{pendingCount !== 1 ? 's' : ''} queued ({queueSizeKB > 1024 ? `${(queueSizeKB / 1024).toFixed(1)} MB` : `${queueSizeKB} KB`})
                </span>
                {queueSizeKB > LOCAL_STORAGE_WARN_MB * 1024 && (
                  <span className="text-amber-600 text-xs font-bold">
                    Queue large — reconnect when possible
                  </span>
                )}
                {lostChunks > 0 && (
                  <span className="text-red-600 text-xs font-bold">
                    {lostChunks} segment{lostChunks !== 1 ? 's' : ''} lost
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {state.error && (
        <div className="bg-amber-50 text-amber-700 p-3 rounded-xl text-xs mb-4 border border-amber-100">
          {state.error}
        </div>
      )}

      {/* Idle state */}
      {state.status === 'idle' && (
        <p className="text-sm text-gray-500 mb-4">
          Record your lecture and AI will automatically generate notes, quizzes, and study materials.
        </p>
      )}

      {/* Recording state */}
      {state.status === 'recording' && (
        <div className="bg-red-50 rounded-xl p-4 mb-4 border border-red-100">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <span className="text-red-700 text-sm font-semibold">
              Recording... {formatDuration(state.duration)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-red-500/60 text-xs">
              Segments: {state.chunkCount} &middot; {audioStatus}
            </p>
            <div className="flex items-center gap-1.5">
              {tabHiddenRef.current && (
                <Badge color="yellow" size="sm">
                  <MonitorUp className="w-3 h-3" /> BG
                </Badge>
              )}
              {isOnline && <Wifi className="w-3.5 h-3.5 text-green-500" />}
            </div>
          </div>
          {wakeLockRef.current && (
            <p className="text-[10px] text-red-400 mt-1.5 flex items-center gap-1">
              <MonitorUp className="w-3 h-3" /> Screen will stay awake
            </p>
          )}
        </div>
      )}

      {/* Paused state */}
      {state.status === 'paused' && (
        <div className="bg-amber-50 rounded-xl p-4 mb-4 border border-amber-100">
          <div className="flex items-center gap-2">
            <Pause className="w-4 h-4 text-amber-600" />
            <span className="text-amber-700 text-sm font-semibold">
              Paused — {formatDuration(state.duration)}
            </span>
          </div>
        </div>
      )}

      {/* Processing state */}
      {state.status === 'processing' && (
        <div className={clsx('rounded-xl p-4 mb-4 border', lostChunks > 0 ? 'bg-amber-50 border-amber-100' : 'bg-blue-50 border-blue-100')}>
          <div className="flex items-center gap-2 mb-1">
            <div className={clsx('w-4 h-4 border-2 border-t-transparent rounded-full animate-spin', lostChunks > 0 ? 'border-amber-500' : 'border-blue-500')} />
            <span className={clsx('text-sm font-semibold', lostChunks > 0 ? 'text-amber-700' : 'text-blue-700')}>
              {lostChunks > 0 ? 'Processing (with data loss)' : 'Processing transcript & generating notes...'}
            </span>
          </div>
          <p className={clsx('text-xs', lostChunks > 0 ? 'text-amber-500/80' : 'text-blue-500/60')}>{audioStatus}</p>
          {lostChunks > 0 && (
            <div className="mt-2 flex items-center gap-3 text-xs">
              <span className="text-emerald-600 font-semibold">{uploadedCountRef.current} uploaded</span>
              <span className="text-red-500 font-semibold">{lostChunks} lost</span>
              <span className="text-amber-600">Internet issues caused data loss</span>
            </div>
          )}
        </div>
      )}

      {/* Live transcript */}
      {state.accumulatedText && (
        <div className="bg-gray-50 rounded-xl p-4 mb-4 max-h-32 overflow-y-auto border border-gray-100">
          <p className="text-xs text-gray-500 mb-1.5 font-semibold">Live Transcript:</p>
          <p className="text-sm text-gray-700 leading-relaxed">{state.accumulatedText}</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {state.status === 'idle' && (
          <Button onClick={startRecording} variant="danger" size="sm">
            <Mic className="w-4 h-4" />
            Start Recording
          </Button>
        )}
        {state.status === 'recording' && (
          <>
            <Button variant="secondary" onClick={pauseRecording} size="sm">
              <Pause className="w-4 h-4" />
              Pause
            </Button>
            <Button variant="danger" onClick={stopRecording} size="sm">
              <Square className="w-4 h-4" />
              Stop & Process
            </Button>
          </>
        )}
        {state.status === 'paused' && (
          <>
            <Button onClick={resumeRecording} variant="gradient" size="sm">
              <Play className="w-4 h-4" />
              Resume
            </Button>
            <Button variant="danger" onClick={stopRecording} size="sm">
              <Square className="w-4 h-4" />
              Stop & Process
            </Button>
          </>
        )}
        {state.status === 'processing' && (
          <Button disabled loading size="sm">
            Processing transcript...
          </Button>
        )}
      </div>
    </div>
  )
}

/* ── Helpers ── */

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/** Convert audio blob to WAV (16kHz, mono, 16-bit PCM) for Groq */
async function blobToWav(blob: Blob): Promise<Blob> {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 })
  try {
    const buffer = await blob.arrayBuffer()
    const decoded = await ctx.decodeAudioData(buffer)
    const channelData = decoded.getChannelData(0)
    const numSamples = channelData.length

    const wavBuf = new ArrayBuffer(44 + numSamples * 2)
    const v = new DataView(wavBuf)

    // RIFF header
    w(v, 0, 'RIFF'); v.setUint32(4, 36 + numSamples * 2, true); w(v, 8, 'WAVE')
    // fmt
    w(v, 12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
    v.setUint16(22, 1, true); v.setUint32(24, 16000, true)
    v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
    // data
    w(v, 36, 'data'); v.setUint32(40, numSamples * 2, true)

    let off = 44
    for (let i = 0; i < numSamples; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i]))
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
      off += 2
    }
    return new Blob([wavBuf], { type: 'audio/wav' })
  } finally {
    await ctx.close()
  }
}

function w(v: DataView, off: number, s: string) {
  for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
}
