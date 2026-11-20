import crypto from "node:crypto";

const VIEW_TOKEN_SECRET = crypto.randomBytes(32);

/**
 * Creates a signed view token for a specific attachment ID, valid for 15 minutes by default.
 */
export function createUploadViewToken(attachmentId: string, ttlMs = 15 * 60 * 1000): string {
  const expiresAt = Date.now() + ttlMs;
  const payload = `${attachmentId}.${expiresAt}`;
  const sig = crypto.createHmac("sha256", VIEW_TOKEN_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/**
 * Verifies that a view token is valid for the specified attachment ID and has not expired.
 */
export function verifyUploadViewToken(token: string, expectedAttachmentId: string): boolean {
  if (!token || !expectedAttachmentId) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [tokenAttachmentId, expStr, sig] = parts;
  if (tokenAttachmentId !== expectedAttachmentId) return false;

  const expiresAt = parseInt(expStr, 10);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const payload = `${tokenAttachmentId}.${expStr}`;
  const expectedSig = crypto.createHmac("sha256", VIEW_TOKEN_SECRET).update(payload).digest("hex");

  const bufSig = Buffer.from(sig, "hex");
  const bufExpected = Buffer.from(expectedSig, "hex");
  if (bufSig.length !== bufExpected.length) return false;
  return crypto.timingSafeEqual(bufSig, bufExpected);
}
