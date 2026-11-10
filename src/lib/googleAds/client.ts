import 'server-only';
import { GoogleAdsApi, Customer } from 'google-ads-api';

let api: GoogleAdsApi | null = null;

const getApi = (): GoogleAdsApi => {
  if (api) return api;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google Ads API credentials are missing');
  }
  api = new GoogleAdsApi({ client_id: clientId, client_secret: clientSecret });
  return api;
};

export const getCustomer = (customerId: string, loginCustomerId: string): Customer => {
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!refreshToken) throw new Error('GOOGLE_ADS_REFRESH_TOKEN is missing');
  return getApi().Customer({
    customer_id: customerId.replace(/-/g, ''),
    login_customer_id: (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || loginCustomerId).replace(/-/g, ''),
    refresh_token: refreshToken,
  });
};

const errorText = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  try { return JSON.stringify(error); } catch { return String(error); }
};

const isPermanent = (error: unknown) => {
  const message = errorText(error);
  return ['USER_PERMISSION_DENIED', 'AUTHENTICATION_ERROR', 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION', 'INVALID_ARGUMENT', 'QUERY_ERROR', 'is deprecated']
    .some(token => message.includes(token));
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Google transiently rejects requests under quota pressure. Retrying the whole
// query keeps a run from silently losing a week of data.
export async function queryWithRetry<T = any[]>(operation: () => Promise<T>, label: string, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || isPermanent(error)) break;
      const delay = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      console.warn(`${label} failed (attempt ${attempt}/${attempts}); retrying in ${delay}ms: ${errorText(error)}`);
      await sleep(delay);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${errorText(lastError)}`);
}

export const micros = (value: unknown): number => Number(value || 0) / 1_000_000;
export const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
export const resourceId = (resource: unknown): string => String(resource || '').split('/').pop() || '';
