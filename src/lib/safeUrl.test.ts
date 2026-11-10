import { describe, expect, it } from 'vitest';
import { safeCallback, safeHref } from './safeUrl';

const ORIGIN = 'https://dashboard.example.com';

describe('safeCallback', () => {
  it('keeps same-origin paths', () => {
    expect(safeCallback('/products?scope=shopb', ORIGIN)).toBe('/products?scope=shopb');
    expect(safeCallback('/', ORIGIN)).toBe('/');
  });
  it('refuses anything that leaves the site', () => {
    expect(safeCallback('//evil.example/login', ORIGIN)).toBe('/');
    expect(safeCallback('/\\evil.example', ORIGIN)).toBe('/');
    expect(safeCallback('https://evil.example', ORIGIN)).toBe('/');
    expect(safeCallback(null, ORIGIN)).toBe('/');
  });
});

describe('safeHref', () => {
  it('allows http(s) only', () => {
    expect(safeHref('https://shopa.example/product?x=1')).toBe('https://shopa.example/product?x=1');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref('not a url')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});
