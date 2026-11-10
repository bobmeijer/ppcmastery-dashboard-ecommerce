import 'server-only';
import type { Customer } from 'google-ads-api';
import type { AdsProduct, AdsStatus, ProductIssue } from '@/lib/feedBuild';
import { micros, queryWithRetry } from './client';

// Every product the account can advertise, with Google Ads' serving verdict.
// One row per product per feed label (no campaign segment), including products
// that never got an impression, so zombies with zero impressions show up too.
// Numeric enums: the library does not export ShoppingProductStatus.
const STATUS: Record<number, AdsStatus> = { 2: 'NOT_ELIGIBLE', 3: 'ELIGIBLE_LIMITED', 4: 'ELIGIBLE' };
const AVAILABILITY: Record<number, string> = { 2: 'IN_STOCK', 3: 'OUT_OF_STOCK', 4: 'PREORDER' };
const SEVERITY_ERROR = 3;

const text = (value: unknown): string | null => {
  const s = String(value ?? '').trim();
  return s ? s : null;
};

export async function fetchAdsFeedProducts(customer: Customer, label: string): Promise<AdsProduct[]> {
  const rows = await queryWithRetry(() => customer.query(`
    SELECT shopping_product.item_id, shopping_product.feed_label, shopping_product.title, shopping_product.status,
      shopping_product.issues, shopping_product.product_image_uri, shopping_product.price_micros,
      shopping_product.currency_code, shopping_product.availability, shopping_product.brand,
      shopping_product.product_type_level1, shopping_product.product_type_level2, shopping_product.product_type_level3,
      shopping_product.custom_attribute0, shopping_product.custom_attribute1, shopping_product.custom_attribute2,
      shopping_product.custom_attribute3, shopping_product.custom_attribute4
    FROM shopping_product
  `), `${label} shopping_product`);
  return rows.map((row: any) => {
    const p = row.shopping_product;
    const issues: ProductIssue[] = (p.issues || []).map((issue: any) => ({
      code: String(issue.error_code || 'unknown'),
      source: 'ads' as const,
      severity: issue.ads_severity === SEVERITY_ERROR ? 'blocking' as const : 'warning' as const,
      description: String(issue.description || ''),
    }));
    return {
      feed_label: String(p.feed_label || ''),
      item_id: String(p.item_id || ''),
      title: String(p.title || ''),
      image_link: text(p.product_image_uri),
      price: p.price_micros ? micros(p.price_micros) : null,
      currency: text(p.currency_code),
      availability: AVAILABILITY[Number(p.availability)] ?? null,
      brand: text(p.brand),
      product_type: [p.product_type_level1, p.product_type_level2, p.product_type_level3].map(text).filter(Boolean).join(' > ') || null,
      custom_label_0: text(p.custom_attribute0),
      custom_label_1: text(p.custom_attribute1),
      custom_label_2: text(p.custom_attribute2),
      custom_label_3: text(p.custom_attribute3),
      custom_label_4: text(p.custom_attribute4),
      status: STATUS[Number(p.status)] ?? null,
      issues,
    };
  }).filter((p: AdsProduct) => p.item_id);
}
