import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'

type AuthMode = 'login' | 'signup'

export default function LoginPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  function handleModeChange(value: string) {
    setMode(value as AuthMode)
    setStatus('idle')
    setErrorMessage('')
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault()
    setStatus('submitting')
    const { data, error } = await supabase.functions.invoke('server/login', { body: { email } })
    if (error || !data?.accessToken || !data?.refreshToken) {
      let message = 'No account found for that email. Sign up first.'
      if (error) {
        try {
          const errorBody = await error.context.json()
          if (errorBody?.error) message = errorBody.error
        } catch {
          // fall back to the generic message above
        }
      }
      setErrorMessage(message)
      setStatus('error')
      return
    }

    const { error: sessionError } = await supabase.auth.setSession({
      access_token: data.accessToken,
      refresh_token: data.refreshToken,
    })
    if (sessionError) {
      setErrorMessage(sessionError.message)
      setStatus('error')
      return
    }
    navigate('/')
  }

  async function handleSignup(event: FormEvent) {
    event.preventDefault()
    setStatus('submitting')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) {
      setErrorMessage(error.message)
      setStatus('error')
      return
    }
    setStatus('sent')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-4 px-4">
        <h1 className="font-serif text-3xl text-center">Ricettario</h1>
        <Tabs value={mode} onValueChange={handleModeChange}>
          <TabsList className="w-full">
            <TabsTrigger value="login" className="flex-1">Log In</TabsTrigger>
            <TabsTrigger value="signup" className="flex-1">Sign Up</TabsTrigger>
          </TabsList>
          <TabsContent value="login">
            <form onSubmit={handleLogin} className="space-y-4">
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
              <Button type="submit" className="w-full" disabled={status === 'submitting'}>
                {status === 'submitting' ? 'Logging in…' : 'Log in'}
              </Button>
              {mode === 'login' && status === 'error' && (
                <p className="text-center text-destructive text-sm">{errorMessage}</p>
              )}
            </form>
          </TabsContent>
          <TabsContent value="signup">
            {mode === 'signup' && status === 'sent' ? (
              <p className="text-center text-muted-foreground">
                Check your email to confirm your address.
              </p>
            ) : (
              <form onSubmit={handleSignup} className="space-y-4">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
                <Button type="submit" className="w-full" disabled={status === 'submitting'}>
                  {status === 'submitting' ? 'Sending…' : 'Sign up'}
                </Button>
                {mode === 'signup' && status === 'error' && (
                  <p className="text-center text-destructive text-sm">{errorMessage}</p>
                )}
              </form>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
