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
  // Tests share one dev server and one real hosted Supabase project (no
  // per-worker isolation for either), so running specs concurrently is a
  // source of real flakiness under load, not just slower — observed one
  // test intermittently miss its 5s expectation under the default 2
  // workers, passing reliably at workers: 1. Serial execution trades some
  // wall-clock time for a suite that fails only on a real regression.
  workers: 1,
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
