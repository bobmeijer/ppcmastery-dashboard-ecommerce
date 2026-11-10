// Loads .env.local into process.env without overriding what is already set.
import { readFileSync, existsSync } from 'node:fs';

export function loadEnv(path = '.env.local') {
  if (!existsSync(path)) return false;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#')) {
      const key = line.slice(0, i).trim();
      if (!process.env[key]) process.env[key] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return true;
}
