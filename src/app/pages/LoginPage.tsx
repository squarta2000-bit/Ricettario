import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useTranslation } from '../lib/i18n/LanguageContext'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { LanguageSelector } from '../components/LanguageSelector'

type AuthMode = 'login' | 'signup'

export default function LoginPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
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
      const isNoAccount = error?.context?.status === 404
      setErrorMessage(isNoAccount ? t('login.noAccountError') : t('login.genericError'))
      setStatus('error')
      return
    }

    const { error: sessionError } = await supabase.auth.setSession({
      access_token: data.accessToken,
      refresh_token: data.refreshToken,
    })
    if (sessionError) {
      setErrorMessage(t('login.genericError'))
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
      setErrorMessage(t('login.genericError'))
      setStatus('error')
      return
    }
    setStatus('sent')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-4 px-4">
        <div className="flex justify-end">
          <LanguageSelector />
        </div>
        <h1 className="font-serif text-3xl text-center">Ricettario</h1>
        <Tabs value={mode} onValueChange={handleModeChange}>
          <TabsList className="w-full">
            <TabsTrigger value="login" className="flex-1">{t('login.tabLogin')}</TabsTrigger>
            <TabsTrigger value="signup" className="flex-1">{t('login.tabSignup')}</TabsTrigger>
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
                {status === 'submitting' ? t('login.loggingIn') : t('login.logIn')}
              </Button>
              {mode === 'login' && status === 'error' && (
                <p className="text-center text-destructive text-sm">{errorMessage}</p>
              )}
            </form>
          </TabsContent>
          <TabsContent value="signup">
            {mode === 'signup' && status === 'sent' ? (
              <p className="text-center text-muted-foreground">{t('login.checkEmail')}</p>
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
                  {status === 'submitting' ? t('login.sending') : t('login.signUp')}
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
