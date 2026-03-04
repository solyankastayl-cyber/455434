// Session Crypto Utils - Encrypt/Decrypt cookies
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// Get encryption key from env or generate
function getEncryptionKey(): Buffer {
  const key = process.env.SESSION_ENCRYPTION_KEY || process.env.COOKIE_ENC_KEY;
  if (key && key.length >= 64) {
    // Key is HEX encoded (64 hex chars = 32 bytes)
    return Buffer.from(key, 'hex');
  }
  if (key && key.length >= 32) {
    // Fallback: treat as raw string (legacy)
    console.warn('[SessionCrypto] Using legacy key format - please use 64 hex char key');
    return Buffer.from(key.slice(0, 32));
  }
  // Default key (should be changed in production)
  console.warn('[SessionCrypto] Using default key - NOT SECURE FOR PRODUCTION');
  return crypto.scryptSync('twitter-parser-v2-default-key', 'salt', 32);
}

export function encryptCookies(cookies: any[]): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const json = JSON.stringify(cookies);
  let encrypted = cipher.update(json, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encryptedData (all base64)
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted,
  ].join(':');
}

export function decryptCookies(encryptedData: string): any[] {
  try {
    if (!encryptedData) {
      console.error('[SessionCrypto] No encrypted data provided');
      return [];
    }
    
    const key = getEncryptionKey();
    const parts = encryptedData.split(':');
    
    if (parts.length !== 3) {
      console.error(`[SessionCrypto] Invalid format: expected 3 parts, got ${parts.length}`);
      return [];
    }
    
    const [ivB64, authTagB64, encrypted] = parts;
    console.log(`[SessionCrypto] Decrypting: iv=${ivB64.length}chars, tag=${authTagB64.length}chars, enc=${encrypted.length}chars`);

    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    
    console.log(`[SessionCrypto] IV length: ${iv.length}, AuthTag length: ${authTag.length}`);
    console.log(`[SessionCrypto] Key length: ${key.length}`);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    console.log('[SessionCrypto] Decipher created, starting decryption...');

    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    console.log(`[SessionCrypto] After update: ${decrypted.length} chars`);
    
    decrypted += decipher.final('utf8');
    console.log(`[SessionCrypto] After final: ${decrypted.length} chars total`);

    const cookies = JSON.parse(decrypted);
    console.log(`[SessionCrypto] Parsed type: ${typeof cookies}, isArray: ${Array.isArray(cookies)}`);
    console.log(`[SessionCrypto] Decrypted ${cookies?.length || 0} cookies successfully`);
    
    // Handle both array and object formats
    if (Array.isArray(cookies)) {
      return cookies;
    }
    // If it's an object with cookies property
    if (cookies && typeof cookies === 'object' && Array.isArray(cookies.cookies)) {
      return cookies.cookies;
    }
    // Single cookie object? Wrap in array
    if (cookies && typeof cookies === 'object' && !Array.isArray(cookies)) {
      console.log('[SessionCrypto] Wrapping single object in array');
      return [cookies];
    }
    
    return cookies || [];
  } catch (error: any) {
    console.error('[SessionCrypto] Decryption FAILED:', error.message);
    console.error('[SessionCrypto] Error stack:', error.stack?.slice(0, 300));
    return [];
  }
}

export function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex');
}
