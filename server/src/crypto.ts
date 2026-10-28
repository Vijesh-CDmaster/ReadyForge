import crypto from 'node:crypto';

/**
 * Generates a cryptographically secure, URL-safe token (256 bits).
 * The raw value is returned to the caller exactly once and is never stored.
 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * One-way hash used to persist token lookups. Because tokens are 256-bit
 * random values (not user-supplied), a plain SHA-256 is sufficient: there is
 * no low-entropy input to brute force, and we need deterministic lookup.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}