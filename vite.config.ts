import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/app'),
    },
  },
  test: {
    // Vitest's default `include` pattern (**/*.{test,spec}.ts) would also
    // pick up the Playwright specs under e2e/, which fail immediately
    // under Vitest's runner (they call Playwright's own `test()`, a
    // different test framework entirely - see e2e/*.spec.ts, run via
    // `npm run test:e2e` / `playwright test` instead). Excluding e2e/ here
    // keeps `npm run test` scoped to the Vitest unit suite, on top of
    // Vitest's own defaults.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      'e2e/**',
    ],
  },
})
