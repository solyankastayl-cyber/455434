// AES-256-GCM Encryption Service for cookies
import crypto from 'crypto';

export class CryptoService {
  private readonly key: Buffer;

  constructor(keyHex: string) {
    if (!keyHex) {
      throw new Error('COOKIE_ENC_KEY is required');
    }
    
    const keyBuffer = Buffer.from(keyHex, 'hex');
    
    if (keyBuffer.length !== 32) {
      throw new Error('COOKIE_ENC_KEY must be 32 bytes (64 hex chars)');
    }
    
    this.key = keyBuffer;
  }

  encryptJson(obj: any): { enc: string; iv: string; tag: string } {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);

    const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
    const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      enc: enc.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
    };
  }

  decryptJson(encB64: string, ivB64: string, tagB64: string): any {
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const enc = Buffer.from(encB64, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);

    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  }
}
