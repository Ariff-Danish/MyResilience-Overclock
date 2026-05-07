import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import ProtectedRoute from './lib/ProtectedRoute'
import AuthPage from './pages/AuthPage'
import ProfilePage from './pages/ProfilePage'
import DependentsPage from './pages/DependentsPage'
import App from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<AuthPage />} />

          {/* Protected routes — require authentication */}
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dependents"
            element={
              <ProtectedRoute>
                <DependentsPage />
              </ProtectedRoute>
            }
          />

          {/* Main dashboard — works with or without auth (graceful degradation) */}
          <Route path="/*" element={<App />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
