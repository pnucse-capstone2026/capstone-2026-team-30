import {
  getExpiresAt,
  parseExpiresInMs,
} from './token-expiration';

describe('token expiration utilities', () => {
  it('parses supported expiration units as milliseconds', () => {
    expect(parseExpiresInMs('10s')).toBe(10 * 1000);
    expect(parseExpiresInMs('15m')).toBe(15 * 60 * 1000);
    expect(parseExpiresInMs('2h')).toBe(2 * 60 * 60 * 1000);
    expect(parseExpiresInMs('7d')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('trims expiration values before parsing', () => {
    expect(parseExpiresInMs(' 15m ')).toBe(15 * 60 * 1000);
  });

  it('rejects unsupported or malformed expiration values', () => {
    for (const expiresIn of ['', '7w', '7 days', '-1d', '1.5h']) {
      expect(() => parseExpiresInMs(expiresIn)).toThrow(
        'Invalid expiration duration',
      );
    }
  });

  it('calculates an expiration date from an explicit reference time', () => {
    const nowMs = Date.parse('2026-01-01T00:00:00.000Z');

    expect(getExpiresAt('15m', nowMs)).toEqual(
      new Date('2026-01-01T00:15:00.000Z'),
    );
  });
});
