// User management input (admin page). Pure, tested in userInput.test.ts.
import { randomInt } from 'node:crypto';

export type UserRole = 'admin' | 'client';

export interface NewUserInput { email: string; name: string; role: UserRole }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Normalises and validates the add-user form; returns the clean input or an error message.
export function parseNewUser(body: unknown): { ok: true; value: NewUserInput } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const email = String(b.email ?? '').trim().toLowerCase();
  const name = String(b.name ?? '').trim().replace(/\s+/g, ' ');
  const role = String(b.role ?? '');
  if (!EMAIL.test(email) || email.length > 254) return { ok: false, error: 'Enter a valid email address.' };
  if (!name || name.length > 120) return { ok: false, error: 'Enter a name (120 characters at most).' };
  if (role !== 'admin' && role !== 'client') return { ok: false, error: 'Choose a role.' };
  return { ok: true, value: { email, name, role } };
}

// Readable generated password: no look-alike characters (0/O, 1/l/I), grouped in
// fours so it can be read out or typed over. 4 groups of 4 from 55 symbols = ~92 bits.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePassword(groups = 4, size = 4): string {
  const parts: string[] = [];
  for (let g = 0; g < groups; g += 1) {
    let part = '';
    for (let i = 0; i < size; i += 1) part += ALPHABET[randomInt(ALPHABET.length)];
    parts.push(part);
  }
  return parts.join('-');
}
