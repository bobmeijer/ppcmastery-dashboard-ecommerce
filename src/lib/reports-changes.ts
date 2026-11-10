import 'server-only';
import { assertOk, getSupabaseAdmin } from './supabaseAdmin';

export interface ChangeEventRecord {
  account_id: string;
  change_time: string;
  change_date: string;
  resource_name: string;
  resource_type: string;
  operation: string;
  campaign_id: string | null;
  campaign_name: string | null;
  changed_fields: string[];
  summary: string;
  user_email: string;
  client_type: string;
}

export interface ChangeEventSummary {
  time: string;
  summary: string;
  campaign_name: string | null;
  resource_type: string;
  operation: string;
  user_email: string;
}

export interface ChangeDay {
  date: string;
  count: number;
  events: ChangeEventSummary[];
}

// Account change history (Admin-only). Events whose Amsterdam calendar day falls
// inside the range, oldest first.
export async function readChangeEvents(accountIds: string[], start: string, end: string): Promise<ChangeEventRecord[]> {
  if (accountIds.length === 0) return [];
  const { data, error } = await getSupabaseAdmin().rpc('read_change_events_json', {
    p_account_ids: accountIds, p_start_date: start, p_end_date: end,
  });
  assertOk(error, 'Unable to read change events');
  return (data || []) as ChangeEventRecord[];
}

export function groupChangeEventsByDay(rows: ChangeEventRecord[]): ChangeDay[] {
  const days = new Map<string, ChangeDay>();
  for (const row of rows) {
    const day = days.get(row.change_date) || { date: row.change_date, count: 0, events: [] };
    day.events.push({
      time: row.change_time, summary: row.summary, campaign_name: row.campaign_name,
      resource_type: row.resource_type, operation: row.operation, user_email: row.user_email,
    });
    day.count += 1;
    days.set(row.change_date, day);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
