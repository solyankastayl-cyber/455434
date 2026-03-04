/**
 * Integration Policy Service
 * 
 * Manages policies and user consent with version tracking.
 * 
 * Key features:
 * - Version-controlled policies
 * - Automatic consent invalidation on policy update
 * - Audit logging for compliance
 */
import { IntegrationPolicyModel, DEFAULT_TWITTER_POLICY, IIntegrationPolicy } from '../models/integration-policy.model.js';
import { IntegrationConsentLogModel } from '../models/integration-consent-log.model.js';
import { TwitterConsentModel } from '../models/twitter-consent.model.js';

export interface PolicyWithConsent {
  policy: {
    slug: string;
    version: string;
    title: string;
    contentMarkdown: string;
    updatedAt: Date;
  };
  userConsent: {
    accepted: boolean;
    acceptedVersion: string | null;
    acceptedAt: Date | null;
    isOutdated: boolean; // true if policy version > accepted version
  };
}

export interface AcceptConsentMeta {
  ip?: string;
  userAgent?: string;
}

export class IntegrationPolicyService {
  
  /**
   * Initialize default policy if not exists
   */
  async ensureDefaultPolicy(slug: string = 'twitter-data-usage'): Promise<IIntegrationPolicy> {
    let policy = await IntegrationPolicyModel.findOne({ slug, isActive: true });
    
    if (!policy) {
      // Create default policy
      policy = await IntegrationPolicyModel.create(DEFAULT_TWITTER_POLICY);
      console.log(`[PolicyService] Created default policy: ${slug} v${policy.version}`);
    }
    
    return policy;
  }
  
  /**
   * Get active policy for a slug
   */
  async getActivePolicy(slug: string): Promise<IIntegrationPolicy | null> {
    return IntegrationPolicyModel.findOne({ slug, isActive: true }).lean();
  }
  
  /**
   * Get policy with user's consent status
   */
  async getPolicyWithConsent(userId: string, slug: string = 'twitter-data-usage'): Promise<PolicyWithConsent> {
    // Ensure policy exists
    const policy = await this.ensureDefaultPolicy(slug);
    
    // Get user's latest consent for this policy
    const latestConsent = await IntegrationConsentLogModel.findOne({
      userId,
      policySlug: slug,
      revokedAt: null,
    }).sort({ acceptedAt: -1 }).lean();
    
    const isOutdated = latestConsent 
      ? this.compareVersions(policy.version, latestConsent.policyVersion) > 0
      : false;
    
    return {
      policy: {
        slug: policy.slug,
        version: policy.version,
        title: policy.title,
        contentMarkdown: policy.contentMarkdown,
        updatedAt: policy.updatedAt,
      },
      userConsent: {
        accepted: !!latestConsent && !isOutdated,
        acceptedVersion: latestConsent?.policyVersion || null,
        acceptedAt: latestConsent?.acceptedAt || null,
        isOutdated,
      },
    };
  }
  
  /**
   * Check if user has accepted the latest policy version
   */
  async hasAcceptedLatestPolicy(userId: string, slug: string = 'twitter-data-usage'): Promise<boolean> {
    const policy = await this.getActivePolicy(slug);
    if (!policy) return false;
    
    const consent = await IntegrationConsentLogModel.findOne({
      userId,
      policySlug: slug,
      policyVersion: policy.version,
      revokedAt: null,
    }).lean();
    
    return !!consent;
  }
  
  /**
   * Accept policy consent
   */
  async acceptConsent(
    userId: string, 
    slug: string = 'twitter-data-usage',
    meta: AcceptConsentMeta = {}
  ): Promise<{ success: boolean; version: string }> {
    const policy = await this.ensureDefaultPolicy(slug);
    
    // Create consent log entry
    await IntegrationConsentLogModel.create({
      userId,
      policySlug: slug,
      policyVersion: policy.version,
      acceptedAt: new Date(),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    
    // Also update legacy TwitterConsentModel for backward compatibility
    await TwitterConsentModel.updateOne(
      { ownerUserId: userId },
      {
        $set: {
          ownerUserId: userId,
          accepted: true,
          acceptedAt: new Date(),
          ip: meta.ip,
          userAgent: meta.userAgent,
          version: policy.version,
        },
      },
      { upsert: true }
    );
    
    console.log(`[PolicyService] User ${userId} accepted policy ${slug} v${policy.version}`);
    
    return { success: true, version: policy.version };
  }
  
  /**
   * Revoke user consent
   */
  async revokeConsent(userId: string, slug: string, reason?: string): Promise<void> {
    await IntegrationConsentLogModel.updateMany(
      { userId, policySlug: slug, revokedAt: null },
      { $set: { revokedAt: new Date(), revokeReason: reason || 'User requested' } }
    );
    
    // Update legacy model
    await TwitterConsentModel.updateOne(
      { ownerUserId: userId },
      { $set: { accepted: false } }
    );
    
    console.log(`[PolicyService] Revoked consent for user ${userId} on policy ${slug}`);
  }
  
  /**
   * Compare semver versions
   * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }
  
  // ============================================================
  // ADMIN METHODS
  // ============================================================
  
  /**
   * Get all policies for admin
   */
  async getAllPolicies(slug?: string): Promise<IIntegrationPolicy[]> {
    const filter = slug ? { slug } : {};
    return IntegrationPolicyModel.find(filter).sort({ slug: 1, updatedAt: -1 }).lean();
  }
  
  /**
   * Update policy (creates new version if content changed)
   */
  async updatePolicy(
    slug: string,
    updates: { title?: string; contentMarkdown?: string; version?: string }
  ): Promise<IIntegrationPolicy> {
    const current = await this.getActivePolicy(slug);
    
    if (!current) {
      throw new Error(`Policy ${slug} not found`);
    }
    
    // Update in place (draft mode)
    const updated = await IntegrationPolicyModel.findByIdAndUpdate(
      current._id,
      { $set: updates },
      { new: true }
    );
    
    return updated!;
  }
  
  /**
   * Publish new policy version
   * This will:
   * 1. Deactivate old version
   * 2. Create new active version
   * 3. Invalidate all user consents (they must re-accept)
   */
  async publishNewVersion(
    slug: string,
    newVersion: string,
    title: string,
    contentMarkdown: string
  ): Promise<IIntegrationPolicy> {
    // Deactivate old version
    await IntegrationPolicyModel.updateMany(
      { slug, isActive: true },
      { $set: { isActive: false } }
    );
    
    // Create new version
    const newPolicy = await IntegrationPolicyModel.create({
      slug,
      version: newVersion,
      title,
      contentMarkdown,
      isActive: true,
    });
    
    // Note: We don't delete old consent logs - they're audit records
    // Users will be required to re-accept because hasAcceptedLatestPolicy
    // checks against the new version
    
    // Update legacy model to force re-consent
    await TwitterConsentModel.updateMany(
      {},
      { $set: { accepted: false } }
    );
    
    console.log(`[PolicyService] Published new policy version: ${slug} v${newVersion}`);
    
    return newPolicy;
  }
  
  /**
   * Get consent logs for admin audit
   */
  async getConsentLogs(filters: {
    userId?: string;
    policySlug?: string;
    limit?: number;
  } = {}): Promise<any[]> {
    const query: any = {};
    if (filters.userId) query.userId = filters.userId;
    if (filters.policySlug) query.policySlug = filters.policySlug;
    
    return IntegrationConsentLogModel.find(query)
      .sort({ acceptedAt: -1 })
      .limit(filters.limit || 100)
      .lean();
  }
}

// Singleton instance
export const integrationPolicyService = new IntegrationPolicyService();
