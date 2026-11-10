import 'server-only';
import { assertOk, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { parseCsv, unzipFirst } from './csv';

// Microsoft Advertising API v13 (SOAP). Reports run asynchronously: submit,
// poll until ready, download a zipped CSV.
//
// Auth: an Entra app (MSADS_CLIENT_ID / _SECRET) plus a refresh token. Microsoft
// hands out a new refresh token on every use and expires one that sits unused
// for 90 days, so the latest token lives in oauth_tokens; MSADS_REFRESH_TOKEN
// only seeds it on the first run.

const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const SCOPE = 'https://ads.microsoft.com/msads.manage offline_access';
const REPORTING_URL = 'https://reporting.api.bingads.microsoft.com/Api/Advertiser/Reporting/v13/ReportingService.svc';
const PROVIDER = 'microsoft_ads';
// Accounts run on the configured time zone; Google reports in the account zone too.
const REPORT_TIME_ZONE = 'AmsterdamBerlinBernRomeStockholmVienna';
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 240_000;

export interface MsAccount { accountId: string; customerId: string }
export type Aggregation = 'Daily' | 'Monthly' | 'Summary';

let cached: { token: string; expiresAt: number } | null = null;

async function storedRefreshToken(): Promise<string> {
  const { data, error } = await getSupabaseAdmin().from('oauth_tokens').select('refresh_token').eq('provider', PROVIDER).maybeSingle();
  assertOk(error, 'Unable to read the Microsoft Ads refresh token');
  const token = data?.refresh_token || process.env.MSADS_REFRESH_TOKEN;
  if (!token) throw new Error('No Microsoft Ads refresh token: run `npm run msads:auth` and set MSADS_REFRESH_TOKEN');
  return token;
}

export async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const clientId = process.env.MSADS_CLIENT_ID;
  const clientSecret = process.env.MSADS_CLIENT_SECRET;
  if (!clientId || !clientSecret || !process.env.MSADS_DEVELOPER_TOKEN) throw new Error('Microsoft Ads API credentials are missing');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token',
      refresh_token: await storedRefreshToken(), scope: SCOPE,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`Microsoft Ads token refresh failed (${response.status}): ${body.error ?? ''} ${String(body.error_description ?? '').split('\r')[0]}`);
  }
  if (body.refresh_token) {
    const { error } = await getSupabaseAdmin().from('oauth_tokens')
      .upsert({ provider: PROVIDER, refresh_token: body.refresh_token, updated_at: new Date().toISOString() });
    assertOk(error, 'Unable to store the Microsoft Ads refresh token');
  }
  cached = { token: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000 };
  return cached.token;
}

const xmlEscape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function reportingCall(account: MsAccount, action: string, body: string): Promise<string> {
  const envelope = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
<s:Header xmlns="https://bingads.microsoft.com/Reporting/v13">
<Action s:mustUnderstand="1">${action}</Action>
<AuthenticationToken>${xmlEscape(await getAccessToken())}</AuthenticationToken>
<CustomerAccountId>${account.accountId}</CustomerAccountId>
<CustomerId>${account.customerId}</CustomerId>
<DeveloperToken>${xmlEscape(process.env.MSADS_DEVELOPER_TOKEN || '')}</DeveloperToken>
</s:Header><s:Body>${body}</s:Body></s:Envelope>`;
  const response = await fetch(REPORTING_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: action }, body: envelope,
  });
  const text = await response.text();
  if (!response.ok) {
    // Operation errors carry Code + Message; keep both, drop the markup.
    const detail = [...text.matchAll(/<(?:\w+:)?Message>([^<]*)</g)].map(m => m[1]).join('; ') || text.slice(0, 500);
    throw new Error(`Microsoft Ads ${action} failed (${response.status}): ${detail}`);
  }
  return text;
}

const dateXml = (value: string) => {
  const [y, m, d] = value.split('-');
  return `<Day>${Number(d)}</Day><Month>${Number(m)}</Month><Year>${y}</Year>`;
};
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Runs one report for one account and returns its rows keyed on the column names.
// Element order follows the WSDL (base ReportRequest fields first, then the type's own, alphabetical).
export async function runReport(account: MsAccount, reportType: string, columns: string[], start: string, end: string,
  aggregation: Aggregation = 'Daily', label = reportType): Promise<Record<string, string>[]> {
  const column = `${reportType}Column`;
  const submit = await reportingCall(account, 'SubmitGenerateReport', `<SubmitGenerateReportRequest xmlns="https://bingads.microsoft.com/Reporting/v13">
<ReportRequest i:type="${reportType}Request">
<ExcludeColumnHeaders>false</ExcludeColumnHeaders><ExcludeReportFooter>true</ExcludeReportFooter><ExcludeReportHeader>true</ExcludeReportHeader>
<Format>Csv</Format><FormatVersion>2.0</FormatVersion><ReportName>${xmlEscape(label)}</ReportName><ReturnOnlyCompleteData>false</ReturnOnlyCompleteData>
<Aggregation>${aggregation}</Aggregation>
<Columns>${columns.map(c => `<${column}>${c}</${column}>`).join('')}</Columns>
<Scope><AccountIds xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays"><a:long>${account.accountId}</a:long></AccountIds></Scope>
<Time><CustomDateRangeEnd>${dateXml(end)}</CustomDateRangeEnd><CustomDateRangeStart>${dateXml(start)}</CustomDateRangeStart><ReportTimeZone>${REPORT_TIME_ZONE}</ReportTimeZone></Time>
</ReportRequest></SubmitGenerateReportRequest>`);
  const requestId = submit.match(/<ReportRequestId>([^<]+)</)?.[1];
  if (!requestId) throw new Error(`Microsoft Ads ${label}: no report request id returned`);

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const poll = await reportingCall(account, 'PollGenerateReport',
      `<PollGenerateReportRequest xmlns="https://bingads.microsoft.com/Reporting/v13"><ReportRequestId>${requestId}</ReportRequestId></PollGenerateReportRequest>`);
    const status = poll.match(/<Status>([^<]+)</)?.[1];
    if (status === 'Error') throw new Error(`Microsoft Ads ${label} ${start}..${end}: report generation failed`);
    if (status === 'Success') {
      const url = poll.match(/<ReportDownloadUrl>([^<]*)</)?.[1]?.replace(/&amp;/g, '&');
      if (!url) return []; // Success without a file = no rows in the range
      const download = await fetch(url);
      if (!download.ok) throw new Error(`Microsoft Ads ${label}: report download failed (${download.status})`);
      return parseCsv(unzipFirst(Buffer.from(await download.arrayBuffer())).toString('utf8'));
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Microsoft Ads ${label} ${start}..${end}: report not ready after ${POLL_TIMEOUT_MS / 1000}s`);
}
