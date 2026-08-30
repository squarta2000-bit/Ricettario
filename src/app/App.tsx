import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/authContext'
import { LanguageProvider } from './lib/i18n/LanguageContext'
import { RequireAuth } from './components/RequireAuth'
import { Toaster } from './components/ui/sonner'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import RecipeDetailPage from './pages/RecipeDetailPage'
import CookingModePage from './pages/CookingModePage'
import ImportPage from './pages/ImportPage'

export default function App() {
  return (
    <AuthProvider>
      <LanguageProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <HomePage />
                </RequireAuth>
              }
            />
            <Route
              path="/recipe/:id"
              element={
                <RequireAuth>
                  <RecipeDetailPage />
                </RequireAuth>
              }
            />
            <Route
              path="/recipe/:id/cook"
              element={
                <RequireAuth>
                  <CookingModePage />
                </RequireAuth>
              }
            />
            <Route
              path="/import"
              element={
                <RequireAuth>
                  <ImportPage />
                </RequireAuth>
              }
            />
          </Routes>
        </BrowserRouter>
        <Toaster />
      </LanguageProvider>
    </AuthProvider>
  )
}
