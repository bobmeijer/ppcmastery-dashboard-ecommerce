'use client';

import { accountConfig, accountName } from '@/lib/config';

/* eslint-disable @next/next/no-img-element */
// Fixed-height logo box, so switching accounts never moves what sits underneath.
// Shows the logo from dashboard.config.ts, or the account name when there is none.
export function BrandLogo({ scope, height = 28, maxWidth = 180 }: { scope: string; height?: number; maxWidth?: number }) {
  const logo = accountConfig(scope)?.logo;
  const name = accountName(scope);
  return (
    <div className="brand-logo flex items-center" style={{ height }}>
      {logo
        ? <img src={logo} alt={name} style={{ maxHeight: height, maxWidth, width: 'auto' }} />
        : <span className="font-semibold text-ink" style={{ fontSize: Math.round(height * 0.7), maxWidth }}>{name}</span>}
    </div>
  );
}
