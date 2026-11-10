// Mail to the admin when a reader asks for help on a chat question. Sent through
// Resend. Needs RESEND_API_KEY, ESCALATION_MAIL_FROM
// (an address on a domain verified in Resend) and ESCALATION_MAIL_TO. With
// MAIL_PREVIEW_DIR set nothing is sent: the mail is written there as an .html file.
import 'server-only';
import { Resend } from 'resend';
import type { Escalation } from './chatLog';

type Payload = Parameters<Resend['emails']['send']>[0];

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const para = (s: string) => esc(s).replace(/\n/g, '<br>');

async function send(payload: Payload) {
  const dir = process.env.MAIL_PREVIEW_DIR;
  if (dir) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${dir}/escalation-${Date.now()}.html`, String(payload.html ?? ''));
    return;
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');
  const { error } = await new Resend(key).emails.send(payload);
  if (error) throw new Error(error.message);
}

// The view as the reader had it: period, comparison and filters, plus a link that opens it.
function viewLines(e: Escalation) {
  const v = e.view as { range?: { start: string; end: string }; compareRange?: { start: string; end: string } | null; filters?: { networks?: string[]; campaigns?: string[]; categories?: string[]; excludeBrand?: boolean }; platform?: string };
  const params = new URLSearchParams({ scope: e.accountLabel });
  if (v.range) { params.set('preset', 'custom'); params.set('start', v.range.start); params.set('end', v.range.end); }
  if (v.filters?.networks?.length) params.set('networks', v.filters.networks.join(','));
  if (v.filters?.campaigns?.length) params.set('campaigns', v.filters.campaigns.join(','));
  if (v.filters?.excludeBrand) params.set('brand', '0');
  if (v.filters?.categories?.length) params.set('categories', v.filters.categories.join(','));
  if (v.platform === 'microsoft') params.set('platform', 'microsoft');
  const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
  return {
    period: v.range ? `${v.range.start} to ${v.range.end}${v.compareRange ? `, compared with ${v.compareRange.start} to ${v.compareRange.end}` : ''}` : 'unknown',
    filters: [...(v.platform === 'microsoft' ? ['Microsoft Ads'] : []), ...(v.filters?.networks ?? []), ...(v.filters?.categories ?? []), ...(v.filters?.excludeBrand ? ['excluding brand'] : []), ...(v.filters?.campaigns?.length ? [`${v.filters.campaigns.length} campaign(s)`] : [])].join(', ') || 'none',
    link: base ? `${base}/?${params.toString()}` : null,
  };
}

export async function mailEscalation(e: Escalation, askedBy: string) {
  const from = process.env.ESCALATION_MAIL_FROM;
  const to = process.env.ESCALATION_MAIL_TO;
  if (!process.env.MAIL_PREVIEW_DIR && (!from || !to)) throw new Error('ESCALATION_MAIL_FROM / ESCALATION_MAIL_TO are not set');
  const v = viewLines(e);
  const subject = `Question from ${askedBy} (${e.accountLabel})`;
  const rows: [string, string][] = [['From', `${askedBy} (${e.userEmail})`], ['Account', e.accountLabel], ['Period', v.period], ['Filters', v.filters]];
  const text = [
    `${askedBy} forwarded a question from the AI assistant to you.`, '',
    `Question: ${e.question}`, '', `AI assistant's answer: ${e.answer ?? '(none)'}`, '',
    ...rows.map(([k, val]) => `${k}: ${val}`), ...(v.link ? ['', `Open the view: ${v.link}`] : []),
  ].join('\n');
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#0a0a0a;max-width:620px">
<p>${esc(askedBy)} forwarded a question from the AI assistant to you.</p>
<p style="margin:16px 0 4px;font-weight:600">Question</p><p style="margin:0">${para(e.question)}</p>
<p style="margin:16px 0 4px;font-weight:600">AI assistant's answer</p><p style="margin:0;color:#2b2b2b">${para(e.answer ?? '(none)')}</p>
<table style="margin-top:16px;border-collapse:collapse;font-size:13px;color:#555">${rows.map(([k, val]) => `<tr><td style="padding:2px 12px 2px 0">${esc(k)}</td><td>${esc(val)}</td></tr>`).join('')}</table>
${v.link ? `<p style="margin-top:16px"><a href="${esc(v.link)}" style="color:#0a0a0a">Open the view in the dashboard</a></p>` : ''}
</div>`;
  await send({ from: from ?? 'preview@example.invalid', to: (to ?? 'preview@example.invalid').split(',').map(s => s.trim()), replyTo: e.userEmail, subject, text, html });
}
