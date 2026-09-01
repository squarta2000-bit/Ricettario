import { computeResizedDimensions, type CompressedImage } from './imageResize'

export function computeSampleTimestamps(durationSeconds: number, frameCount: number): number[] {
  if (durationSeconds <= 0 || frameCount <= 0) return []
  const count = Math.max(1, Math.floor(frameCount))
  const step = durationSeconds / (count + 1)
  return Array.from({ length: count }, (_, i) => step * (i + 1))
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
    for (const timestamp of computeSampleTimestamps(video.duration, frameCount)) {
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve()
        video.onerror = () => reject(new Error('Failed to seek video'))
        video.currentTime = timestamp
      })
      ctx.drawImage(video, 0, 0, width, height)
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      frames.push({ mediaType: 'image/jpeg', data: dataUrl.split(',')[1] })
    }
    return frames
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
