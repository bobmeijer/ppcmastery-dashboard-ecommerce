import 'server-only';
import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { getSupabaseAdmin } from './supabaseAdmin';
import { DEMO_MODE, DEMO_SESSION } from './demoMode';

export type Role = 'admin' | 'client';

declare module 'next-auth' {
  interface User { id: string; role?: Role; sv?: number }
  interface Session { user: { id?: string; name?: string | null; email?: string | null; role?: Role; sv?: number } }
}
declare module 'next-auth/jwt' {
  interface JWT { id?: string; role?: Role; sv?: number }
}

// Login throttling: failures in the window per email and per IP.
const WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_EMAIL = 10;
const MAX_FAILURES_PER_IP = 30;
// bcrypt hash of a random throwaway string: unknown emails still pay one compare, so the
// response time does not tell which addresses have an account.
const DUMMY_HASH = '$2a$12$OOBOt8DFtN/EuC2ArxbhP.dwiPR1YEgfwDqMSRleHxpPQDmLP.GYy';

const clientIp = (req: { headers?: Record<string, string | string[] | undefined> } | undefined) => {
  const raw = req?.headers?.['x-forwarded-for'];
  return (Array.isArray(raw) ? raw[0] : raw || '').split(',')[0].trim();
};

async function recentFailures(column: 'email' | 'ip', value: string): Promise<number> {
  if (!value) return 0;
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const { count } = await getSupabaseAdmin().from('login_attempts').select('id', { count: 'exact', head: true })
    .eq(column, value).eq('success', false).gte('created_at', since);
  return count ?? 0;
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Email and password',
      credentials: { email: { label: 'Email', type: 'email' }, password: { label: 'Password', type: 'password' } },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials.password) return null;
        const email = credentials.email.trim().toLowerCase().slice(0, 254);
        const ip = clientIp(req);
        const supabase = getSupabaseAdmin();
        const [byEmail, byIp] = await Promise.all([recentFailures('email', email), recentFailures('ip', ip)]);
        // Locked: no password check at all, the client shows "try again in 15 minutes".
        if (byEmail >= MAX_FAILURES_PER_EMAIL || byIp >= MAX_FAILURES_PER_IP) throw new Error('locked');
        const { data: user } = await supabase.from('users').select('id,email,password_hash,role,name,session_version')
          .eq('email', email).maybeSingle();
        const ok = await bcrypt.compare(credentials.password, user?.password_hash || DUMMY_HASH);
        await supabase.from('login_attempts').insert({ email, ip, success: !!user && ok });
        if (!user || !ok) return null;
        await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);
        // Housekeeping: attempts older than 30 days go.
        await supabase.from('login_attempts').delete().lt('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString());
        return { id: user.id, email: user.email, name: user.name || user.email, role: user.role as Role, sv: user.session_version ?? 1 };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) { token.id = user.id; token.role = user.role; token.sv = user.sv; }
      return token;
    },
    async session({ session, token }) {
      if (session.user) { session.user.id = token.id; session.user.role = token.role; session.user.sv = token.sv; }
      return session;
    },
  },
  pages: { signIn: '/login' },
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET,
};

export const getSession = () => getServerSession(authOptions);

// The session is a 30-day JWT, so the role in it can be stale: the user row decides.
// A deleted user loses access on the next request, a changed role applies at once
// (user admin page).
export async function requireSession(minimumRole: Role = 'client') {
  if (DEMO_MODE) return { ...DEMO_SESSION, user: { ...DEMO_SESSION.user, role: 'admin' as Role } };
  const session = await getSession();
  const id = session?.user?.id;
  if (!session || !id) return null;
  const { data: user } = await getSupabaseAdmin().from('users').select('role,session_version').eq('id', id).maybeSingle();
  const role = user?.role as Role | undefined;
  if (!role) return null;
  // A password reset bumps session_version: older tokens stop working. Tokens from before
  // the version existed count as version 1.
  if ((session.user.sv ?? 1) !== (user?.session_version ?? 1)) return null;
  if (minimumRole === 'admin' && role !== 'admin') return null;
  session.user.role = role;
  return session;
}
