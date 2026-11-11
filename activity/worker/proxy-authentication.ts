import { createPublicKey, verify } from 'node:crypto';

import { isRecord } from '../src/validation.ts';

const ALLOWED_CLOCK_SKEW_SECONDS = 30;

function decodeBase64(value: unknown): Buffer | undefined {
  if (typeof value !== 'string' || !/^[a-z0-9+/_-]+={0,2}$/iu.test(value)) return undefined;
  return Buffer.from(value, 'base64');
}

/** Builds the signature verifier for requests delivered through Discord's Activity proxy. */
export function createProxyAuthenticator(
  publicKeyHex: string
): (headers: Readonly<Record<string, unknown>>) => boolean {
  if (!/^[a-f0-9]{64}$/iu.test(publicKeyHex))
    throw new Error('DISCORD_ACTIVITY_PUBLIC_KEY must be a 64-character hexadecimal key.');

  const publicKey = createPublicKey({
    format: 'jwk',
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKeyHex, 'hex').toString('base64url') }
  });

  return (headers): boolean => {
    const encodedSignature = headers['x-signature-ed25519'];
    // Discord's JavaScript and Python examples use base64 and hexadecimal, respectively.
    const signature =
      typeof encodedSignature === 'string' && /^[a-f0-9]{128}$/iu.test(encodedSignature) ?
        Buffer.from(encodedSignature, 'hex')
      : decodeBase64(encodedSignature);
    const payload = decodeBase64(headers['x-discord-proxy-payload']);
    if (signature?.length !== 64 || payload === undefined) return false;

    let data: unknown;
    try {
      // Verify the original bytes before interpreting the signed claims as JSON.
      if (!verify(null, payload, publicKey, signature)) return false;
      data = JSON.parse(payload.toString('utf8'));
    } catch {
      return false;
    }
    if (!isRecord(data)) return false;
    const createdAt = data['created_at'];
    const expiresAt = data['expires_at'];
    const now = Math.floor(Date.now() / 1000);
    return (
      typeof createdAt === 'number'
      && Number.isSafeInteger(createdAt)
      && String(createdAt) === headers['x-signature-timestamp']
      && createdAt <= now + ALLOWED_CLOCK_SKEW_SECONDS
      && typeof expiresAt === 'number'
      && Number.isSafeInteger(expiresAt)
      && expiresAt > Math.max(now, createdAt)
    );
  };
}
