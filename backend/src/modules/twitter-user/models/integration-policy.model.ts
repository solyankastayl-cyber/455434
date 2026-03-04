/**
 * Integration Policy Model
 * 
 * Stores versioned policies for integrations (Twitter, Reddit, etc.)
 * Used for consent management and compliance.
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface IIntegrationPolicy extends Document {
  slug: string; // e.g., 'twitter-data-usage'
  title: string;
  version: string; // semver: 1.0.0, 1.1.0, etc.
  contentMarkdown: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const IntegrationPolicySchema = new Schema<IIntegrationPolicy>(
  {
    slug: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    version: {
      type: String,
      required: true,
    },
    contentMarkdown: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: false,
    },
  },
  { 
    timestamps: true,
    collection: 'integration_policies',
  }
);

// Compound index for slug + version uniqueness
IntegrationPolicySchema.index({ slug: 1, version: 1 }, { unique: true });
// Index for finding active policy
IntegrationPolicySchema.index({ slug: 1, isActive: 1 });

export const IntegrationPolicyModel = mongoose.model<IIntegrationPolicy>(
  'IntegrationPolicy',
  IntegrationPolicySchema,
  'integration_policies'
);

// Default Twitter policy content
export const DEFAULT_TWITTER_POLICY = {
  slug: 'twitter-data-usage',
  title: 'Twitter Data Usage & Parsing Consent Policy',
  version: '1.0.0',
  contentMarkdown: `# Twitter Data Usage & Parsing Consent Policy

**Version:** 1.0.0  
**Last updated:** ${new Date().toISOString().split('T')[0]}  
**Applies to:** Twitter Integration (Parsing & Analysis)

---

## 1. Purpose of This Policy

This policy explains how FOMO Platform ("we", "our", "the Platform") accesses, processes, and stores Twitter data when you connect your Twitter account using session-based authentication.

By accepting this policy, you explicitly consent to the data usage practices described below.

---

## 2. What Data Is Used

When you connect Twitter, the Platform may access the following data only through your active session:

- Tweets visible in your feed
- Tweets from accounts you follow
- Public engagement metadata (likes, reposts, replies)
- Tweet timestamps and authorship
- Session-related technical metadata required for parsing

⚠️ **We do not access** private messages, email addresses, phone numbers, or account credentials.

---

## 3. How Data Is Used

Your data is processed exclusively for the following purposes:

- Parsing tweets in near-real time
- Detecting crypto-related signals, narratives, and trends
- Performing sentiment and behavioral analysis
- Generating aggregated analytics for your personal use
- Improving system accuracy and performance

**Data is not used for advertising, resale, or profiling outside the Platform.**

---

## 4. Session Cookies & Authentication

To enable parsing, the Platform uses your browser session cookies.

- Cookies are used only to authenticate requests on your behalf
- Cookies are never shared with third parties
- Cookies are never reused outside the Twitter integration context

All session data is **encrypted at rest using AES-256-GCM**.

---

## 5. Data Storage & Retention

- Raw session data is stored in encrypted form
- Parsed tweet data may be stored in anonymized or aggregated format
- You may disconnect Twitter at any time, which immediately:
  - Invalidates your session
  - Stops all parsing
  - Prevents further data access

Retention periods may vary depending on system requirements, audit needs, and legal obligations.

---

## 6. User Control & Opt-Out

**You are always in control.**

You may:

- Disconnect Twitter integration at any time
- Revoke consent by disabling the integration
- Request deletion of stored session data (where applicable)

If you do not accept this policy, Twitter integration will not be enabled.

---

## 7. Security Measures

We apply industry-standard security practices, including:

- Encrypted storage (AES-256-GCM)
- Strict access control
- Internal audit logging
- Continuous monitoring for abuse or anomalies

However, no system can be guaranteed 100% secure. You acknowledge and accept this risk.

---

## 8. Policy Updates & Versioning

This policy may be updated over time.

When a new version is published:

- All users are required to re-accept the updated policy
- Twitter parsing is paused until acceptance
- The active version number is always displayed

**Your consent is always tied to a specific policy version.**

---

## 9. Compliance & Legal Basis

This policy is designed to align with:

- GDPR principles (lawful basis: consent)
- General data protection best practices
- Platform security and compliance requirements

You confirm that you have the legal right to connect the Twitter account you provide.

---

## 10. Contact

If you have questions regarding this policy or data usage, please contact the Platform administrators via official support channels.

---

**By checking "I understand and agree", you confirm that you have read, understood, and accepted this policy in full.**`,
  isActive: true,
};
