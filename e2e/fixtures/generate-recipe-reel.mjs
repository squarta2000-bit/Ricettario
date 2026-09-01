// e2e/fixtures/generate-recipe-reel.mjs
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const html = `
<!doctype html>
<canvas id="c" width="320" height="240"></canvas>
<script>
  function uint8ToBase64(bytes) {
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return btoa(binary)
  }

  window.record = async () => {
    const canvas = document.getElementById('c')
    const ctx = canvas.getContext('2d')
    const stream = canvas.captureStream(10)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' })
    const chunks = []
    recorder.ondataavailable = (e) => chunks.push(e.data)
    const stopped = new Promise((resolve) => { recorder.onstop = resolve })
    recorder.start()
    const colors = ['#e07a5f', '#3d405b', '#81b29a', '#f2cc8f']
    for (let i = 0; i < colors.length; i++) {
      ctx.fillStyle = colors[i]
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#ffffff'
      ctx.font = '32px sans-serif'
      ctx.fillText('Step ' + (i + 1), 40, 120)
      await new Promise((r) => setTimeout(r, 750))
    }
    recorder.stop()
    await stopped
    const blob = new Blob(chunks, { type: 'video/webm' })
    const buffer = await blob.arrayBuffer()
    return uint8ToBase64(new Uint8Array(buffer))
  }
</script>
`

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(html)
const base64 = await page.evaluate(() => window.record())
const outPath = path.join(__dirname, 'recipe-reel.webm')
writeFileSync(outPath, Buffer.from(base64, 'base64'))
await browser.close()
console.log(`Wrote ${outPath}`)
