import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Optional: drop your own way of analysing accounts in context/methodology.md and the AI
// analysis and chat will follow it. The file is gitignored and never required.

let cached: string | null | undefined;

export function readMethodology(): string | null {
  if (cached !== undefined) return cached;
  try {
    cached = readFileSync(join(process.cwd(), 'context', 'methodology.md'), 'utf8').trim() || null;
  } catch {
    cached = null;
  }
  return cached;
}

export function withMethodology(system: string, methodology: string | null = readMethodology()): string {
  if (!methodology) return system;
  return `${system}\n\nThe account manager's own methodology. Follow it where it applies; the rules above still win:\n\n${methodology}`;
}
