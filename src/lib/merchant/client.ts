import 'server-only';
import type { MerchantProduct, MerchantStatus, ProductIssue } from '@/lib/feedBuild';

// Merchant API (products/v1), read-only. Same OAuth client as Google Ads; the
// refresh token needs the content scope. MERCHANT_REFRESH_TOKEN wins when set,
// otherwise the Google Ads token is used (it carries both scopes).
async function accessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.MERCHANT_REFRESH_TOKEN || process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Merchant API credentials are missing');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(`Merchant token request failed: ${body.error_description || body.error || response.status}`);
  return body.access_token as string;
}

const text = (value: unknown): string | null => {
  const s = String(value ?? '').trim();
  return s ? s : null;
};

// "in stock" / "IN_STOCK" -> IN_STOCK
const availability = (value: unknown) => text(value)?.toUpperCase().replace(/[\s-]+/g, '_') ?? null;

function destinationStatus(d: any): MerchantStatus | null {
  if (d.disapprovedCountries?.length) return 'DISAPPROVED';
  if (d.pendingCountries?.length) return 'PENDING';
  if (d.approvedCountries?.length) return 'APPROVED';
  return null;
}

export function mapMerchantProduct(p: any): MerchantProduct {
  const a = p.productAttributes || {};
  const destinations: Record<string, MerchantStatus | null> = {};
  for (const d of p.productStatus?.destinationStatuses || []) destinations[d.reportingContext] = destinationStatus(d);
  const issues: ProductIssue[] = (p.productStatus?.itemLevelIssues || [])
    .filter((issue: any) => issue.reportingContext === 'SHOPPING_ADS')
    .map((issue: any) => ({
      code: String(issue.code || 'unknown'),
      source: 'merchant' as const,
      severity: issue.severity === 'DISAPPROVED' ? 'blocking' as const : 'warning' as const,
      description: String(issue.description || ''),
    }));
  return {
    feed_label: String(p.feedLabel || ''),
    item_id: String(p.offerId || ''),
    title: String(a.title || ''),
    link: text(a.link),
    image_link: text(a.imageLink),
    price: a.price?.amountMicros ? Number(a.price.amountMicros) / 1_000_000 : null,
    currency: text(a.price?.currencyCode),
    availability: availability(a.availability),
    brand: text(a.brand),
    product_type: text(a.productTypes?.[0]),
    custom_label_0: text(a.customLabel0),
    custom_label_1: text(a.customLabel1),
    custom_label_2: text(a.customLabel2),
    custom_label_3: text(a.customLabel3),
    custom_label_4: text(a.customLabel4),
    destinations,
    issues,
  };
}

export async function fetchMerchantProducts(merchantId: string): Promise<MerchantProduct[]> {
  const token = await accessToken();
  const products: MerchantProduct[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`https://merchantapi.googleapis.com/products/v1/accounts/${merchantId}/products`);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const body = await response.json();
    if (!response.ok) throw new Error(`Merchant products ${merchantId} failed: ${body.error?.message || response.status}`);
    for (const p of body.products || []) {
      const mapped = mapMerchantProduct(p);
      if (mapped.item_id) products.push(mapped);
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return products;
}
