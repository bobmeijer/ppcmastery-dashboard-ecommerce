// Decides whether the app runs on the built-in demo data. Used by next.config.js, which
// fixes the answer into the build as NEXT_PUBLIC_DEMO_MODE.
//
// - `npm run dev` with no database settings: demo.
// - Any production build: only with DASHBOARD_DEMO=1 set on purpose. A production deploy
//   that forgot its database settings fails on the missing settings instead of opening up.
// - DASHBOARD_DEMO=1 together with database settings: refuses to start.

function databaseConfigured(env) {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_SERVICE_ROLE_KEY);
}

function resolveDemoMode(env) {
  const requested = env.DASHBOARD_DEMO === '1';
  if (requested && databaseConfigured(env)) {
    throw new Error('Demo mode refuses to start while database settings are present. Remove DASHBOARD_DEMO, or remove NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (requested) return true;
  return env.NODE_ENV !== 'production' && !databaseConfigured(env);
}

module.exports = { resolveDemoMode, databaseConfigured };
