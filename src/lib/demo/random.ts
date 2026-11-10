// Small deterministic helpers: the same seed and key always give the same number.

export function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

// A number from 0 up to 1 for this seed and key.
export function noise(seed: number, key: string): number {
  let t = (hash(key) + seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
}

export const between = (seed: number, key: string, low: number, high: number) => low + noise(seed, key) * (high - low);
export const round2 = (value: number) => Math.round(value * 100) / 100;
