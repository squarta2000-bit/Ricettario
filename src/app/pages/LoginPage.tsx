import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setStatus('sending')
    const { error } = await supabase.auth.signInWithOtp({ email })
    setStatus(error ? 'error' : 'sent')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 px-4">
        <h1 className="text-2xl font-normal text-center">Ricettario</h1>
        {status === 'sent' ? (
          <p className="text-center text-muted-foreground">
            Check your email for a sign-in link.
          </p>
        ) : (
          <>
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <Button type="submit" className="w-full" disabled={status === 'sending'}>
              Sign in
            </Button>
            {status === 'error' && (
              <p className="text-center text-destructive text-sm">
                Something went wrong. Please try again.
              </p>
            )}
          </>
        )}
      </form>
    </div>
  )
}
