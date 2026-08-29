export interface CompressedImage {
  mediaType: string
  data: string
}

export function computeResizedDimensions(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) return { width, height }
  const scale = maxDimension / Math.max(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

export async function compressImageFile(
  file: File,
  maxDimension = 1500,
  quality = 0.8,
): Promise<CompressedImage> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Failed to load photo'))
      img.src = objectUrl
    })

    const { width, height } = computeResizedDimensions(image.naturalWidth, image.naturalHeight, maxDimension)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not supported in this browser')
    ctx.drawImage(image, 0, 0, width, height)

    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    const base64 = dataUrl.split(',')[1]
    return { mediaType: 'image/jpeg', data: base64 }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
