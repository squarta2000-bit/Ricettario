import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/authContext'
import { RequireAuth } from './components/RequireAuth'
import { Toaster } from './components/ui/sonner'
import LoginPage from './pages/LoginPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <div className="min-h-screen bg-background">
                  <div className="max-w-7xl mx-auto px-4 py-8 text-center text-muted-foreground py-16">
                    <p className="text-xl mb-2">No recipes yet</p>
                    <p>Home page comes in Task 5.</p>
                  </div>
                </div>
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </AuthProvider>
  )
}
