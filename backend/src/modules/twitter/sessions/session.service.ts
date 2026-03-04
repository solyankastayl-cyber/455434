// TwitterSession Service - MULTI Architecture
import { TwitterSessionModel, ITwitterSession, SessionStatus } from './session.model.js';
import { encryptCookies, decryptCookies, generateApiKey } from './session.crypto.js';
import { accountService } from '../accounts/account.service.js';

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
}

export interface IngestSessionDTO {
  sessionId: string;
  cookies: Cookie[];
  userAgent?: string;
  accountUsername?: string;
  accountId?: string;
}

export class SessionService {
  private webhookApiKey: string;

  constructor() {
    this.webhookApiKey = process.env.WEBHOOK_API_KEY || generateApiKey();
    console.log(`[SessionService] Webhook API key: ${this.webhookApiKey.slice(0, 8)}...`);
  }

  getWebhookApiKey(): string {
    return this.webhookApiKey;
  }

  regenerateApiKey(): string {
    this.webhookApiKey = generateApiKey();
    console.log(`[SessionService] API key regenerated: ${this.webhookApiKey.slice(0, 8)}...`);
    return this.webhookApiKey;
  }

  validateApiKey(key: string): boolean {
    return key === this.webhookApiKey;
  }

  async ingestSession(data: IngestSessionDTO): Promise<ITwitterSession> {
    const { sessionId, cookies, userAgent, accountUsername, accountId: providedAccountId } = data;

    const domains = [...new Set(cookies.map((c) => c.domain))];
    const hasAuthToken = cookies.some((c) => c.name === 'auth_token');
    const hasCt0 = cookies.some((c) => c.name === 'ct0');
    const encryptedCookies = encryptCookies(cookies);

    // Resolve accountId from username or use provided
    let accountId = providedAccountId;
    if (!accountId && accountUsername) {
      const account = await accountService.findByUsername(accountUsername);
      if (account) {
        accountId = (account as any)._id?.toString();
      }
    }

    // Determine status based on required cookies
    const status = (hasAuthToken && hasCt0) ? 'OK' : 'STALE';

    const session = await TwitterSessionModel.findOneAndUpdate(
      { sessionId },
      {
        $set: {
          encryptedCookies,
          userAgent: userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          cookiesMeta: { count: cookies.length, domains, hasAuthToken, hasCt0 },
          status,
          lastSyncedAt: new Date(),
          lastError: undefined,
          ...(accountId && { accountId }),
        },
      },
      { upsert: true, new: true }
    );

    console.log(`[SessionService] Ingested session: ${sessionId} (${cookies.length} cookies, status: ${status})`);
    return session;
  }

  async getCookies(sessionId: string): Promise<Cookie[]> {
    const session = await TwitterSessionModel.findOne({ sessionId }).lean();
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    await TwitterSessionModel.updateOne({ sessionId }, { lastUsedAt: new Date() });
    
    // DEBUG STEP 1: Log raw encrypted cookies format
    const encryptedCookies = session.encryptedCookies;
    console.log('[DEBUG getCookies] sessionId:', sessionId);
    console.log('[DEBUG getCookies] encryptedCookies raw type:', typeof encryptedCookies);
    console.log('[DEBUG getCookies] encryptedCookies raw preview:', 
      typeof encryptedCookies === 'string' 
        ? encryptedCookies?.slice(0, 80) + '...'
        : JSON.stringify(encryptedCookies)?.slice(0, 120)
    );
    
    // STEP 2: Normalize - handle both string "iv:tag:enc" and object {iv, tag, enc}
    const normalized = this.normalizeEncryptedCookies(encryptedCookies);
    console.log('[DEBUG getCookies] normalized preview:', normalized?.slice(0, 80) + '...');
    
    const cookies = decryptCookies(normalized);
    console.log('[DEBUG getCookies] decrypted cookies count:', cookies.length);
    
    return cookies;
  }
  
  // Normalize encrypted cookies to string format "iv:tag:enc"
  private normalizeEncryptedCookies(input: any): string {
    if (!input) {
      console.error('[FATAL normalizeEncryptedCookies] No input provided');
      return '';
    }

    if (typeof input === 'string') {
      return input;
    }

    if (typeof input === 'object' && input.iv && input.tag && input.enc) {
      console.log('[normalizeEncryptedCookies] Converting object to string format');
      return `${input.iv}:${input.tag}:${input.enc}`;
    }

    console.error('[FATAL normalizeEncryptedCookies] Invalid cookie format:', typeof input, input);
    return '';
  }

  async findAll(): Promise<ITwitterSession[]> {
    return TwitterSessionModel.find()
      .populate('accountId', 'username displayName status')
      .sort({ lastSyncedAt: -1 })
      .lean();
  }

  async findBySessionId(sessionId: string): Promise<ITwitterSession | null> {
    return TwitterSessionModel.findOne({ sessionId })
      .populate('accountId', 'username displayName status')
      .lean();
  }

  async findActive(): Promise<ITwitterSession[]> {
    return TwitterSessionModel.find({ status: 'OK' })
      .populate('accountId', 'username displayName')
      .lean();
  }

  async findByAccount(accountId: string): Promise<ITwitterSession[]> {
    return TwitterSessionModel.find({ accountId }).lean();
  }

  async setStatus(sessionId: string, status: SessionStatus, error?: string): Promise<void> {
    const update: any = { status };
    if (error) {
      update.lastError = { code: status, message: error, at: new Date() };
    }
    await TwitterSessionModel.updateOne({ sessionId }, update);
    console.log(`[SessionService] Session ${sessionId} status -> ${status}`);
  }

  async delete(sessionId: string): Promise<boolean> {
    const result = await TwitterSessionModel.deleteOne({ sessionId });
    return result.deletedCount > 0;
  }

  async bindToAccount(sessionId: string, accountId: string): Promise<void> {
    await TwitterSessionModel.updateOne({ sessionId }, { accountId });
  }

  async count(): Promise<{ total: number; ok: number; stale: number; invalid: number }> {
    const [total, ok, stale, invalid] = await Promise.all([
      TwitterSessionModel.countDocuments(),
      TwitterSessionModel.countDocuments({ status: 'OK' }),
      TwitterSessionModel.countDocuments({ status: 'STALE' }),
      TwitterSessionModel.countDocuments({ status: { $in: ['INVALID', 'EXPIRED'] } }),
    ]);
    return { total, ok, stale, invalid };
  }
}

export const sessionService = new SessionService();
