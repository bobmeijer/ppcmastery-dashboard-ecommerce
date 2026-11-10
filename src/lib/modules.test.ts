import { describe, expect, it } from 'vitest';
import { moduleForCron, moduleGate, type ModuleSwitches } from './modules';

const none: ModuleSwitches = { microsoftAds: false, feedStatus: false, auctionInsights: false, changeHistory: false, qualityScore: false, communications: false, ai: false };
const q = (text = '') => new URLSearchParams(text);

describe('moduleGate', () => {
  it('leaves core pages and routes open', () => {
    for (const path of ['/', '/products', '/api/report/products', '/api/report/product', '/api/report/campaigns', '/status']) {
      expect(moduleGate(path, q(), none)).toBe('open');
    }
  });

  it('hides the pages and API routes of a disabled module', () => {
    for (const path of ['/feed', '/auction', '/quality-score', '/meetings', '/api/report/feed', '/api/report/auction', '/api/report/quality', '/api/report/changes', '/api/report/meetings/status', '/api/insights', '/api/chat', '/api/chat/rate']) {
      expect(moduleGate(path, q(), none)).toBe('not-found');
    }
  });

  it('opens a module that is switched on, and only that module', () => {
    const on = { ...none, feedStatus: true };
    expect(moduleGate('/feed', q(), on)).toBe('open');
    expect(moduleGate('/api/cron/feed', q(), on)).toBe('open');
    expect(moduleGate('/auction', q(), on)).toBe('not-found');
  });

  it('does not match a path that merely starts the same', () => {
    expect(moduleGate('/feedback', q(), none)).toBe('open');
    expect(moduleGate('/api/chatter', q(), none)).toBe('open');
  });

  it('lets the crons of a disabled module do nothing', () => {
    for (const path of ['/api/cron/microsoft-ads', '/api/cron/feed', '/api/cron/auction', '/api/cron/auction/import', '/api/cron/insights']) {
      expect(moduleGate(path, q(), none)).toBe('skip');
    }
  });

  it('decides Google Ads datasets one by one', () => {
    expect(moduleGate('/api/cron/google-ads', q('dataset=campaign'), none)).toBe('open');
    expect(moduleGate('/api/cron/google-ads', q('dataset=quality'), none)).toBe('skip');
    expect(moduleGate('/api/cron/google-ads', q('dataset=changes'), none)).toBe('skip');
    expect(moduleForCron('/api/cron/google-ads', q('dataset=quality'))).toBe('qualityScore');
    expect(moduleGate('/api/cron/google-ads', q('dataset=quality'), { ...none, qualityScore: true })).toBe('open');
  });
});
