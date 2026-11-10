'use client';

// Login: one card with the sign-in form and a help line. It names no accounts, because
// anyone can open this page.
import { BRAND } from '@/lib/config';
import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeCallback } from '@/lib/safeUrl';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signIn('credentials', { email, password, redirect: false });
    setBusy(false);
    if (result?.error) {
      setError(result.error === 'locked' ? 'Too many failed attempts. Try again in 15 minutes.' : 'Email address or password is incorrect.');
      return;
    }
    // Same-origin paths only: "//evil.com" also starts with "/".
    router.replace(safeCallback(params.get('callbackUrl'), window.location.origin));
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper-alt p-4">
      <div className="w-full max-w-[400px] overflow-hidden rounded-[10px] border border-line bg-paper"
        style={{ boxShadow: '0 1px 2px rgba(10,10,10,0.06), 0 8px 24px rgba(10,10,10,0.06)' }}>
        <form onSubmit={submit} className="space-y-6 p-6 sm:p-8">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{BRAND.name}</h1>
            <p className="mt-1 text-sm text-muted">Log in with your email address and password.</p>
          </div>
          <div className="space-y-4">
            <label className="block text-sm">
              <span className="text-muted">Email address</span>
              <input type="email" required autoComplete="email" className="mt-1.5 w-full" value={email} onChange={e => setEmail(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Password</span>
              <input type="password" required autoComplete="current-password" className="mt-1.5 w-full" value={password} onChange={e => setPassword(e.target.value)} />
            </label>
            {error && <p className="text-sm" style={{ color: 'var(--bad)' }}>{error}</p>}
            <button type="submit" disabled={busy} className="w-full rounded-[8px] bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-60">
              {busy ? 'Logging in...' : 'Log in'}
            </button>
          </div>
          <p className="text-xs text-muted">
            No access or forgotten your password? Ask your administrator.
          </p>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}
