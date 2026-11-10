'use client';

// Users (admin only): list, add, new password, remove. Passwords
// are generated on the server and shown once here, with a copy button; only a
// bcrypt hash is stored. You cannot remove yourself or the last admin.
import { LOCALE, TIME_ZONE } from '@/lib/config';
import { useCallback, useEffect, useState } from 'react';
import { AdminTabs } from '@/components/AdminTabs';
import { Card, Notice, Skeleton } from '@/components/Card';
import type { UserRole } from '@/lib/userInput';

interface UserRow { id: string; email: string; name: string | null; role: UserRole; created_at: string; last_login: string | null }
interface Issued { name: string; email: string; password: string; kind: 'new' | 'reset' }

const ROLE_LABEL: Record<UserRole, string> = { admin: 'Admin', client: 'Client' };

const fmtDateTime = (iso: string | null) => (iso
  ? new Date(iso).toLocaleString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE })
  : 'Never');

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

function IssuedPassword({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(issued.password); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <Card title={issued.kind === 'new' ? 'User added' : 'New password'}
      subtitle={`${issued.name} (${issued.email}). Copy the password now: it is not shown again.`}
      actions={<button type="button" className="btn-chip" onClick={onClose}>Close</button>}>
      <div className="flex flex-wrap items-center gap-3">
        <code className="num rounded-[8px] border border-line bg-paper-alt px-3 py-2 text-base tracking-wide">{issued.password}</code>
        <button type="button" className="btn-chip" data-active={!copied} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <p className="mt-3 text-xs text-muted">Log in with this email address and password.</p>
    </Card>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; email: string; role: UserRole }>({ name: '', email: '', role: 'client' });

  const load = useCallback(() => {
    call<{ users: UserRow[]; me: string | null }>('/api/admin/users')
      .then(body => { setUsers(body.users); setMe(body.me); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy('add'); setError(null);
    try {
      const body = await call<{ user: UserRow; password: string }>('/api/admin/users', { method: 'POST', body: JSON.stringify(form) });
      setIssued({ name: body.user.name || body.user.email, email: body.user.email, password: body.password, kind: 'new' });
      setForm({ name: '', email: '', role: 'client' });
      load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const reset = async (user: UserRow) => {
    if (!window.confirm(`New password for ${user.name || user.email}? The old password stops working.`)) return;
    setBusy(user.id); setError(null);
    try {
      const body = await call<{ password: string }>(`/api/admin/users/${user.id}`, { method: 'POST', body: JSON.stringify({ action: 'reset' }) });
      setIssued({ name: user.name || user.email, email: user.email, password: body.password, kind: 'reset' });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const remove = async (user: UserRow) => {
    if (!window.confirm(`Remove ${user.name || user.email}? This person will no longer be able to log in.`)) return;
    setBusy(user.id); setError(null);
    try {
      await call(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      if (issued?.email === user.email) setIssued(null);
      load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-[var(--page-gap)]">
      <AdminTabs />
      {error && <Notice tone="bad">{error}</Notice>}
      {issued && <IssuedPassword issued={issued} onClose={() => setIssued(null)} />}

      <Card title="Add user" subtitle="Clients see the dashboard. Admins also see Status, Users and the internal notes.">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Name</span>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required maxLength={120} autoComplete="off" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Email address</span>
            <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required autoComplete="off" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Role</span>
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as UserRole })}>
              <option value="client">Client</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit" className="btn-chip justify-center" data-active="true" disabled={busy === 'add'}>
            {busy === 'add' ? 'Working...' : 'Add'}
          </button>
        </form>
        <p className="mt-2 text-xs text-muted">The password is generated automatically and shown once after adding.</p>
      </Card>

      <Card title="Users">
        {!users && !error && <Skeleton rows={3} />}
        {/* Phones: one block per user instead of a six-column table whose buttons sat off-screen
           . */}
        {users && (
          <ul className="divide-y divide-line sm:hidden">
            {users.map(user => (
              <li key={user.id} className="py-3 first:pt-0 last:pb-0">
                <div className="text-sm font-medium">{user.name || '-'}{user.id === me && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}</div>
                <div className="mt-0.5 break-all text-sm text-ink-soft">{user.email}</div>
                <div className="mt-1 text-xs text-muted">{ROLE_LABEL[user.role]} &middot; last login {fmtDateTime(user.last_login).toLowerCase()}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button type="button" className="btn-chip" disabled={busy === user.id} onClick={() => reset(user)}>New password</button>
                  {user.id !== me && <button type="button" className="btn-chip" disabled={busy === user.id} onClick={() => remove(user)}>Remove</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {users && (
          <div className="overflow-x-auto max-sm:hidden">
            <table className="data">
              <thead><tr><th>Name</th><th>Email address</th><th>Role</th><th>Last login</th><th>Added</th><th /></tr></thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id}>
                    <td>{user.name || '-'}{user.id === me && <span className="ml-1.5 text-xs text-muted">(you)</span>}</td>
                    <td>{user.email}</td>
                    <td>{ROLE_LABEL[user.role]}</td>
                    <td>{fmtDateTime(user.last_login)}</td>
                    <td>{fmtDateTime(user.created_at)}</td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <button type="button" className="btn-chip" disabled={busy === user.id} onClick={() => reset(user)}>New password</button>
                        {user.id !== me && <button type="button" className="btn-chip" disabled={busy === user.id} onClick={() => remove(user)}>Remove</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
