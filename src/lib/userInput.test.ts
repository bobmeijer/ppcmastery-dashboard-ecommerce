import { describe, expect, it } from 'vitest';
import { generatePassword, parseNewUser } from './userInput';

describe('parseNewUser', () => {
  it('normalises email and name', () => {
    expect(parseNewUser({ email: '  Jane@example.COM ', name: ' Jane   Morgan Reed ', role: 'client' }))
      .toEqual({ ok: true, value: { email: 'jane@example.com', name: 'Jane Morgan Reed', role: 'client' } });
  });
  it('rejects bad input with a message', () => {
    expect(parseNewUser({ email: 'jane', name: 'Jane', role: 'client' })).toMatchObject({ ok: false });
    expect(parseNewUser({ email: 'jane@example.com', name: '', role: 'client' })).toMatchObject({ ok: false });
    expect(parseNewUser({ email: 'jane@example.com', name: 'Jane', role: 'owner' })).toMatchObject({ ok: false, error: 'Choose a role.' });
    expect(parseNewUser(null)).toMatchObject({ ok: false });
  });
});

describe('generatePassword', () => {
  it('makes four groups of four without look-alike characters', () => {
    const pw = generatePassword();
    expect(pw).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
    expect(pw).not.toMatch(/[01OlI]/);
    expect(generatePassword()).not.toBe(pw);
  });
});
