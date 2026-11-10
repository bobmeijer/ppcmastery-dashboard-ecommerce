import 'server-only';
import bcrypt from 'bcryptjs';
import { assertOk, getSupabaseAdmin } from './supabaseAdmin';
import { generatePassword, NewUserInput, UserRole } from './userInput';

// Dashboard users (table users, bcrypt hashes). Passwords are generated here and
// returned once to the admin; only the hash is stored.

export interface UserRow { id: string; email: string; name: string | null; role: UserRole; created_at: string; last_login: string | null }

const COLUMNS = 'id,email,name,role,created_at,last_login';

export async function listUsers(): Promise<UserRow[]> {
  const { data, error } = await getSupabaseAdmin().from('users').select(COLUMNS).order('role').order('name');
  assertOk(error, 'Unable to read users');
  return (data || []) as UserRow[];
}

export async function createUser(input: NewUserInput): Promise<{ user: UserRow; password: string } | { error: string }> {
  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase.from('users').select('id').eq('email', input.email).maybeSingle();
  if (existing) return { error: 'A user with this email address already exists.' };
  const password = generatePassword();
  const { data, error } = await supabase.from('users')
    .insert({ email: input.email, name: input.name, role: input.role, password_hash: await bcrypt.hash(password, 12) })
    .select(COLUMNS).single();
  assertOk(error, 'Unable to create user');
  return { user: data as UserRow, password };
}

export async function resetPassword(id: string): Promise<string | null> {
  const password = generatePassword();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('users')
    .update({ password_hash: await bcrypt.hash(password, 12) }).eq('id', id).select('id').maybeSingle();
  assertOk(error, 'Unable to reset password');
  if (!data) return null;
  // Ends every existing session of this user.
  const { error: bumpError } = await supabase.rpc('bump_session_version', { p_user_id: id });
  assertOk(bumpError, 'Unable to end existing sessions');
  return password;
}

// Refuses to remove the last admin, so nobody can lock the dashboard out of its own user page.
export async function deleteUser(id: string): Promise<{ ok: true } | { error: string }> {
  const supabase = getSupabaseAdmin();
  const { data: user } = await supabase.from('users').select('id,role').eq('id', id).maybeSingle();
  if (!user) return { error: 'User not found.' };
  if (user.role === 'admin') {
    const { count } = await supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin');
    if ((count ?? 0) <= 1) return { error: 'The last admin cannot be removed.' };
  }
  const { error } = await supabase.from('users').delete().eq('id', id);
  assertOk(error, 'Unable to delete user');
  return { ok: true };
}
