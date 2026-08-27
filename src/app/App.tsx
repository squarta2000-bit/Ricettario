import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from './components/ui/button'
import { Toaster } from './components/ui/sonner'
import { useIsMobile } from './hooks/useIsMobile'
import { projectId, publicAnonKey } from '../../utils/supabase/info'

const API_BASE = `https://${projectId}.supabase.co/functions/v1/server`

export default function App() {
  const [loading, setLoading] = useState(false)
  const isMobile = useIsMobile()

  useEffect(() => {
    // Placeholder health check to confirm the Supabase edge function is reachable.
    fetch(`${API_BASE}/health`, {
      headers: { Authorization: `Bearer ${publicAnonKey}` },
    }).catch(() => {
      // Ignored until real Supabase project credentials are configured.
    })
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-normal">Ricettario</h1>
          <Button variant="outline" size="icon" disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="text-center py-16 text-muted-foreground">
          <p className="text-xl mb-2">No recipes yet</p>
          <p>Start building Ricettario on top of this scaffold.</p>
        </div>
      </div>
      <Toaster />
    </div>
  )
}
