import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setToken } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/Button';

export function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();

  useEffect(() => {
    const token = params.get('token');
    if (token) {
      setToken(token);
      void refresh().then(() => navigate('/dashboard', { replace: true }));
    } else {
      navigate('/login', { replace: true });
    }
  }, [params, navigate, refresh]);

  return (
    <div className="flex min-h-full items-center justify-center text-slate-500">
      <span className="inline-flex items-center gap-2">
        <Spinner /> Signing you in…
      </span>
    </div>
  );
}
