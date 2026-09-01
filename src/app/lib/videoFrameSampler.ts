import { computeResizedDimensions, type CompressedImage } from './imageResize'

export function computeSampleTimestamps(durationSeconds: number, frameCount: number): number[] {
  if (durationSeconds <= 0 || frameCount <= 0) return []
  const count = Math.max(1, Math.floor(frameCount))
  const step = durationSeconds / (count + 1)
  return Array.from({ length: count }, (_, i) => step * (i + 1))
}

// Ceiling on the whole sampling operation. Both the loadedmetadata and
// seeked waits below only ever settle via an event or the video's own
// `error` event - a stalled decode or a non-seekable file would otherwise
// leave the returned promise pending forever, with no user-visible error.
const SAMPLE_TIMEOUT_MS = 15000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

// Samples up to `frameCount` evenly-spaced frames from a video file entirely
// client-side (no ffmpeg or server-side video processing available in the
// Supabase edge function this app uses). Reuses the same resize/compression
// bounds as photo uploads so a video contributes the same per-frame cost to
// the vision LLM call as an equivalent photo would.
export async function sampleVideoFrames(
  file: File,
  frameCount: number,
  maxDimension = 1500,
  quality = 0.8,
): Promise<CompressedImage[]> {
  return withTimeout(
    sampleVideoFramesUnbounded(file, frameCount, maxDimension, quality),
    SAMPLE_TIMEOUT_MS,
    'Timed out while sampling video frames',
  )
}

async function sampleVideoFramesUnbounded(
  file: File,
  frameCount: number,
  maxDimension: number,
  quality: number,
): Promise<CompressedImage[]> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.src = objectUrl
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('Failed to load video'))
    })
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error('Video has no readable duration')
    }

    const { width, height } = computeResizedDimensions(video.videoWidth, video.videoHeight, maxDimension)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not supported in this browser')

    const frames: CompressedImage[] = []
    const seenFrameData = new Set<string>()
    for (const timestamp of computeSampleTimestamps(video.duration, frameCount)) {
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve()
        video.onerror = () => reject(new Error('Failed to seek video'))
        video.currentTime = timestamp
      })
      ctx.drawImage(video, 0, 0, width, height)
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      const data = dataUrl.split(',')[1]
      // Skip byte-identical frames (e.g. a source with less visual variety
      // than the requested sample density) so callers don't get duplicate
      // React keys and don't waste shared frame budget on the same image.
      if (seenFrameData.has(data)) continue
      seenFrameData.add(data)
      frames.push({ mediaType: 'image/jpeg', data })
    }
    return frames
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
