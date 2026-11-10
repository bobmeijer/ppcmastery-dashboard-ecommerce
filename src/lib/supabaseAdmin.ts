import 'server-only';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let adminClient: SupabaseClient | null | undefined;

// Service-role client. The database has RLS on and no policies, so this is the
// only way the app reads or writes. It never reaches the browser.
export const getSupabaseAdmin = (): SupabaseClient => {
  // Spelled out so a normal build drops this branch and the demo code with it.
  if (process.env.NEXT_PUBLIC_DEMO_MODE === '1') {
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Demo mode refuses to run with database settings present.');
    // Required here, not imported at the top, so a normal build never includes the demo.
    return (require('./demo/fakeClient') as typeof import('./demo/fakeClient')).getDemoClient();
  }
  if (adminClient) return adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service-role configuration is missing');
  // no-store: Next's fetch data cache must never serve a stale table read
  // (otherwise accounts can keep returning pre-migration columns).
  adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
  return adminClient;
};

export const assertOk = (error: { message: string } | null, context: string) => {
  if (error) throw new Error(`${context}: ${error.message}`);
};
