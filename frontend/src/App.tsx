import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { FullScreenLoader } from './components/Loader';
import { LoginPage } from './pages/LoginPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';

// Route-level code-splitting: the dashboard (table + virtualizer) loads on demand.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  const { user, loading } = useAuth();
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Routes>
        <Route
          path="/login"
          element={
            loading ? <FullScreenLoader label="Checking your session…" /> : user ? <Navigate to="/dashboard" replace /> : <LoginPage />
          }
        />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route
          path="/dashboard"
          element={
            <Protected>
              <DashboardPage />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}