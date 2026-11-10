// True when the app runs on the built-in fictional data. next.config.js fixes this value
// at build time (see demo-mode.js), so a normal production build can never turn it on.
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === '1';

export const DEMO_SESSION = {
  user: { id: 'demo-admin', email: 'demo@example.com', name: 'Demo viewer', role: 'admin' as const, sv: 1 },
  expires: '2099-01-01T00:00:00.000Z',
};
