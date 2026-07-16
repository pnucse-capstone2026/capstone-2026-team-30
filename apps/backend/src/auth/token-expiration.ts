export const DEFAULT_ACCESS_TOKEN_EXPIRES_IN = "15m";
export const DEFAULT_REFRESH_TOKEN_EXPIRES_IN = "7d";

const EXPIRATION_PATTERN = /^(\d+)([smhd])$/;
const EXPIRATION_MULTIPLIERS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
} as const;

export function parseExpiresInMs(expiresIn: string): number {
  const normalizedExpiresIn = expiresIn.trim();
  const match = EXPIRATION_PATTERN.exec(normalizedExpiresIn);

  if (!match) {
    throwInvalidExpiration(expiresIn);
  }

  const value = Number(match[1]);
  const unit = match[2] as keyof typeof EXPIRATION_MULTIPLIERS;
  const durationMs = value * EXPIRATION_MULTIPLIERS[unit];

  if (!Number.isSafeInteger(durationMs)) {
    throwInvalidExpiration(expiresIn);
  }

  return durationMs;
}

export function getExpiresAt(
  expiresIn: string,
  nowMs: number = Date.now(),
): Date {
  return new Date(nowMs + parseExpiresInMs(expiresIn));
}

function throwInvalidExpiration(expiresIn: string): never {
  throw new Error(
    `Invalid expiration duration "${expiresIn}". Expected an integer followed by s, m, h, or d.`,
  );
}
