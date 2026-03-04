/**
 * Deployment Profiles - Feature Flags
 * Single source of truth for feature activation
 * 
 * Profiles:
 * - twitter-only: Twitter parser + Extension + Telegram
 * - sentiment-only: ML + Sentiment pipeline
 * - twitter-sentiment: Twitter + Sentiment
 * - onchain-only: Indexer + Onchain analytics
 * - full: All services
 */

export type DeployProfile =
  | 'twitter-only'
  | 'sentiment-only'
  | 'twitter-sentiment'
  | 'onchain-only'
  | 'full'

export interface FeatureFlags {
  twitter: boolean
  sentiment: boolean
  onchain: boolean
  indexer: boolean
  ml: boolean
}

export const FEATURES: FeatureFlags = {
  twitter: false,
  sentiment: false,
  onchain: false,
  indexer: false,
  ml: false,
}

export function resolveFeatures(profile: DeployProfile): FeatureFlags {
  // Reset all features
  FEATURES.twitter = false
  FEATURES.sentiment = false
  FEATURES.onchain = false
  FEATURES.indexer = false
  FEATURES.ml = false

  switch (profile) {
    case 'twitter-only':
      FEATURES.twitter = true
      break

    case 'sentiment-only':
      FEATURES.sentiment = true
      break

    case 'twitter-sentiment':
      FEATURES.twitter = true
      FEATURES.sentiment = true
      break

    case 'onchain-only':
      FEATURES.onchain = true
      FEATURES.indexer = true
      FEATURES.ml = true
      break

    case 'full':
      FEATURES.twitter = true
      FEATURES.sentiment = true
      FEATURES.onchain = true
      FEATURES.indexer = true
      FEATURES.ml = true
      break

    default:
      throw new Error(`Unknown DEPLOY_PROFILE: ${profile}`)
  }

  return FEATURES
}

export function getProfileDescription(profile: DeployProfile): string {
  const descriptions: Record<DeployProfile, string> = {
    'twitter-only': 'Twitter parser + Extension + Telegram + Admin',
    'sentiment-only': 'ML + Sentiment pipeline (no Twitter)',
    'twitter-sentiment': 'Twitter + Sentiment (full Twitter Intelligence)',
    'onchain-only': 'Indexer + Onchain analytics + ML',
    'full': 'All services enabled',
  }
  return descriptions[profile]
}
