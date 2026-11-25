import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19Z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 12 4.5 4.5L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const POINTS = [
  { title: 'Schedule at scale', body: 'Delayed sends backed by a durable queue — nothing dropped, no duplicates.' },
  { title: 'Send responsibly', body: 'Per-sender hourly limits and spacing keep providers happy.' },
  { title: 'See every send', body: 'Track scheduled, sent, and failed emails in real time.' },
];

function BrandMark({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center rounded-xl bg-brand text-white ${className}`}>
      <span className="text-[15px] font-bold leading-none">R</span>
    </div>
  );
}

export function LoginPage() {
  const { loginWithGoogle, loginAsDemo } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { notify } = useToast();
  const [loading, setLoading] = useState(false);

  const error = params.get('error');

  const handleDemo = async () => {
    setLoading(true);
    try {
      await loginAsDemo();
      navigate('/dashboard');
    } catch {
      notify('Demo login failed - is the backend running?', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      {/* Brand / story panel */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-slate-900 p-10 text-white lg:flex xl:p-14">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-9 w-9" />
          <span className="text-lg font-semibold tracking-tight">ReachInbox</span>
        </div>

        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">
            Cold outreach on autopilot - with real control.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            Schedule emails across your senders, import leads from a CSV, and let per-sender
            pacing handle the rest. Reliably.
          </p>

          <ul className="mt-8 space-y-4">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-300">
                  <CheckIcon />
                </span>
                <div>
                  <p className="text-sm font-medium text-white">{p.title}</p>
                  <p className="text-sm text-slate-400">{p.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-slate-500">ReachInbox · Outbox Labs</p>
      </aside>

      {/* Sign-in */}
      <main className="flex flex-col bg-slate-50 px-4 py-10 sm:px-8">
        <div className="mb-10 flex items-center gap-2.5 lg:hidden">
          <BrandMark className="h-9 w-9" />
          <span className="text-lg font-semibold tracking-tight text-slate-900">ReachInbox</span>
        </div>

        <div className="m-auto w-full max-w-sm">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">
            Continue with your Google account to open your dashboard.
          </p>

          {error && (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-3">
            <Button
              variant="secondary"
              onClick={loginWithGoogle}
              className="h-11 w-full gap-3 font-medium"
            >
              <GoogleIcon />
              Continue with Google
            </Button>

            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              or
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <Button variant="ghost" onClick={handleDemo} loading={loading} className="w-full">
              Use demo account
            </Button>
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            Demo sign-in is available outside production.
          </p>
        </div>
      </main>
    </div>
  );
}