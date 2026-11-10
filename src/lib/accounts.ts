import 'server-only';
import { assertOk, getSupabaseAdmin } from './supabaseAdmin';

export interface Account {
  id: string;
  label: string;
  display_name: string;
  login_customer_id: string;
  merchant_id: string | null;
  currency: string;
  lag_days: number;
  enabled: boolean;
  msads_account_id: string | null;    // Microsoft Ads AccountId (not the F1... number); null = no Microsoft account
  msads_customer_id: string | null;
}

export async function listAccounts(onlyEnabled = true): Promise<Account[]> {
  const { data, error } = await getSupabaseAdmin().from('accounts').select('*').order('display_name');
  assertOk(error, 'Unable to read accounts');
  const rows = (data || []) as Account[];
  return onlyEnabled ? rows.filter(a => a.enabled) : rows;
}

// Scope = 'all' | account label | account id.
export function resolveScope(accounts: Account[], scope: string | null | undefined): Account[] {
  if (!scope || scope === 'all') return accounts;
  return accounts.filter(a => a.label === scope || a.id === scope.replace(/-/g, ''));
}
