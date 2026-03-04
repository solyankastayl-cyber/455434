/**
 * ApiKeyService - управление API ключами пользователей
 */

import { UserApiKeyModel, generateApiKey, hashApiKey, decryptApiKey, type ApiKeyScope, type IUserApiKey } from '../models/user-api-key.model.js';
import { userScope } from '../acl/ownership.js';

export interface CreateApiKeyDTO {
  name: string;
  scopes: ApiKeyScope[];
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  fullKey?: string;  // Available if encrypted key is stored
  scopes: ApiKeyScope[];
  lastUsedAt?: Date;
  createdAt: Date;
  revoked: boolean;
}

export class ApiKeyService {
  /**
   * Создать новый API ключ
   */
  async create(ownerUserId: string, dto: CreateApiKeyDTO): Promise<{
    apiKey: string;
    info: ApiKeyInfo;
  }> {
    // Generate key with encryption
    const { plainKey, keyHash, keyPrefix, encrypted } = generateApiKey();
    
    // Save to DB with encrypted key
    const doc = new UserApiKeyModel({
      ownerUserId,
      keyHash,
      keyPrefix,
      keyEnc: encrypted.enc,
      keyIv: encrypted.iv,
      keyTag: encrypted.tag,
      name: dto.name || 'API Key',
      scopes: dto.scopes,
    });
    
    await doc.save();
    
    return {
      apiKey: plainKey,
      info: this.toInfo(doc, plainKey),
    };
  }

  /**
   * Список ключей пользователя (с возможностью получить полный ключ)
   */
  async list(ownerUserId: string): Promise<ApiKeyInfo[]> {
    const keys = await UserApiKeyModel.find({
      ...userScope(ownerUserId),
      revokedAt: null,
    }).sort({ createdAt: -1 }).lean();
    
    return keys.map(k => this.toInfo(k));
  }

  /**
   * Отозвать ключ
   */
  async revoke(ownerUserId: string, keyId: string): Promise<boolean> {
    const result = await UserApiKeyModel.updateOne(
      {
        _id: keyId,
        ...userScope(ownerUserId),
        revokedAt: null,
      },
      { $set: { revokedAt: new Date() } }
    );
    
    return result.modifiedCount > 0;
  }

  /**
   * Валидация ключа + получение ownerUserId
   * Используется в middleware
   */
  async validate(plainKey: string, requiredScope: ApiKeyScope): Promise<{
    valid: boolean;
    ownerUserId?: string;
    error?: string;
  }> {
    if (!plainKey || !plainKey.startsWith('usr_')) {
      return { valid: false, error: 'Invalid key format' };
    }
    
    const keyHash = hashApiKey(plainKey);
    
    const keyDoc = await UserApiKeyModel.findOne({
      keyHash,
      revokedAt: null,
    });
    
    if (!keyDoc) {
      return { valid: false, error: 'Key not found or revoked' };
    }
    
    // Check scope
    if (!keyDoc.scopes.includes(requiredScope)) {
      return { valid: false, error: `Missing scope: ${requiredScope}` };
    }
    
    // Update lastUsedAt (async, don't wait)
    UserApiKeyModel.updateOne(
      { _id: keyDoc._id },
      { $set: { lastUsedAt: new Date() } }
    ).exec();
    
    return {
      valid: true,
      ownerUserId: keyDoc.ownerUserId,
    };
  }

  /**
   * Convert to API-safe info
   * Decrypts fullKey if encryption data is available
   */
  private toInfo(doc: IUserApiKey | any, knownPlainKey?: string): ApiKeyInfo {
    let fullKey: string | undefined = knownPlainKey;
    
    // Try to decrypt if we have encryption data
    if (!fullKey && doc.keyEnc && doc.keyIv && doc.keyTag) {
      try {
        fullKey = decryptApiKey(doc.keyEnc, doc.keyIv, doc.keyTag);
      } catch (e) {
        // Decryption failed, fullKey stays undefined
        console.error('Failed to decrypt API key:', e);
      }
    }
    
    return {
      id: doc._id.toString(),
      name: doc.name,
      keyPrefix: doc.keyPrefix,
      fullKey,
      scopes: doc.scopes,
      lastUsedAt: doc.lastUsedAt,
      createdAt: doc.createdAt,
      revoked: !!doc.revokedAt,
    };
  }
}
