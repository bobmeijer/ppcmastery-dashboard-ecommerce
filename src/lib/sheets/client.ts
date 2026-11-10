import 'server-only';
import { createSign } from 'node:crypto';

// Read-only Google Sheets access through the service account in
// GOOGLE_SHEETS_SERVICE_ACCOUNT_B64 (base64 of the service-account JSON).
// No SDK: the JWT is signed with node:crypto and exchanged for an access
// token at the Google OAuth endpoint. The sheet must be shared with the
// service account's client_email as a viewer; it is never "published to web".

// Drive read-only lets the auction sync list the files Google Ads drops in a
// shared folder (the scheduled reports); both scopes stay read-only.
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const TOKEN_TTL_SECONDS = 3600;

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

function loadServiceAccount(): ServiceAccount {
  const encoded = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_B64;
  if (!encoded) throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_B64 is not configured');
  let parsed: Partial<ServiceAccount>;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch {
    throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_B64 is not valid base64 JSON');
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Service account JSON is missing client_email or private_key');
  }
  return parsed as ServiceAccount;
}

const base64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function signJwt(account: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: account.client_email, scope: SCOPE, aud: account.token_uri || TOKEN_URL,
    iat: now, exp: now + TOKEN_TTL_SECONDS,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(account.private_key));
  return `${header}.${claims}.${signature}`;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const account = loadServiceAccount();
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(account),
  });
  const response = await fetch(account.token_uri || TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!response.ok) {
    throw new Error(`Google token exchange failed (${response.status})`);
  }
  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('Google token exchange returned no access token');
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? TOKEN_TTL_SECONDS) * 1000 };
  return cachedToken.value;
}

// The service account's email, for the "share the sheet with ..." instruction.
// The private key never leaves this module.
export function sheetsServiceAccountEmail(): string {
  return loadServiceAccount().client_email;
}

export function isSheetsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_B64);
}

// Returns the 2D values of a range (A1 notation, e.g. "Sheet1" or
// "Sheet1!A1:Z"). Cells come back as the strings the sheet displays
// (FORMATTED_VALUE); trailing empty rows and cells are omitted by the API.
export async function readSheetRange(spreadsheetId: string, range: string): Promise<string[][]> {
  const token = await getAccessToken();
  const url = `${SHEETS_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (response.status === 403 || response.status === 404) {
    throw new Error(`Google Sheets returned ${response.status} for ${spreadsheetId}: share the sheet with the service account (viewer)`);
  }
  if (!response.ok) throw new Error(`Google Sheets request failed (${response.status})`);
  const json = (await response.json()) as { values?: unknown[][] };
  return (json.values || []).map(row => row.map(cell => (cell == null ? '' : String(cell))));
}

export interface DriveSheetFile { id: string; name: string; createdTime: string; modifiedTime: string }

// Google Sheets in a Drive folder, oldest change first. The folder must be
// shared with the service account (viewer); a 404 means the share is missing.
export async function listFolderSpreadsheets(folderId: string, modifiedAfter?: string): Promise<DriveSheetFile[]> {
  const token = await getAccessToken();
  const clauses = [`'${folderId.replace(/'/g, "\\'")}' in parents`, 'trashed = false', "mimeType = 'application/vnd.google-apps.spreadsheet'"];
  if (modifiedAfter) clauses.push(`modifiedTime > '${modifiedAfter}'`);
  const files: DriveSheetFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: clauses.join(' and '), orderBy: 'modifiedTime', pageSize: '100',
      fields: 'nextPageToken, files(id, name, createdTime, modifiedTime)',
      supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetch(`${DRIVE_FILES_URL}?${params}`, { headers: { authorization: `Bearer ${token}` } });
    if (response.status === 403 || response.status === 404) {
      throw new Error(`Google Drive returned ${response.status} for folder ${folderId}: share the folder with the service account (viewer) and enable the Drive API`);
    }
    if (!response.ok) throw new Error(`Google Drive request failed (${response.status})`);
    const json = (await response.json()) as { files?: DriveSheetFile[]; nextPageToken?: string };
    files.push(...(json.files || []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return files;
}
