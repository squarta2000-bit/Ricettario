import { defineConfig } from '@playwright/test'

// This machine runs several unrelated dev servers on the common Vite
// default ports (5173-5183 were all observed occupied by other projects'
// dev servers during setup), so a dedicated, less-common port is used here
// and `--strictPort` ensures Vite fails loudly instead of silently binding
// to a different port than the one Playwright is told to wait on.
const PORT = 5199
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  use: { baseURL },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: baseURL,
    // Always start a fresh server for the suite rather than reusing
    // whatever else might already be listening on this host - see the note
    // above about other dev servers sharing this machine.
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
