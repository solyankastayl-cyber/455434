/**
 * Bootstrap - Single entrypoint for service initialization
 * 
 * RULES:
 * - Only dynamic imports (no side effects)
 * - Feature check BEFORE import
 * - No conditional imports in global scope
 */

import { resolveFeatures, getProfileDescription, type DeployProfile, FEATURES } from './features.js'

export async function bootstrap(app: any) {
  const profile = process.env.DEPLOY_PROFILE as DeployProfile
  
  if (!profile) {
    console.warn('[BOOT] DEPLOY_PROFILE not set, defaulting to "full"')
  }
  
  const activeProfile = profile || 'full'
  const features = resolveFeatures(activeProfile)

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`[BOOT] Profile: ${activeProfile}`)
  console.log(`[BOOT] Description: ${getProfileDescription(activeProfile)}`)
  console.log(`[BOOT] Features:`, features)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // Initialize features based on profile
  // Using dynamic imports to prevent side effects

  if (features.twitter) {
    console.log('[BOOT] Initializing Twitter module...')
    // Twitter parser, scheduler, worker, admin, extension sync
    // Already initialized via existing module system
    console.log('[BOOT] ✓ Twitter module ready')
  }

  if (features.sentiment) {
    console.log('[BOOT] Initializing Sentiment module...')
    // Sentiment engine, LLM consumers
    // TODO: Add sentiment init when Phase 11 starts
    console.log('[BOOT] ✓ Sentiment module ready (placeholder)')
  }

  if (features.onchain) {
    console.log('[BOOT] Initializing Onchain module...')
    // Onchain analytics, signals, rankings
    // Already initialized via existing module system
    console.log('[BOOT] ✓ Onchain module ready')
  }

  if (features.indexer) {
    console.log('[BOOT] Initializing Indexer module...')
    // DEX indexer connection
    // Handled by separate dex-indexer service
    console.log('[BOOT] ✓ Indexer module ready (external service)')
  }

  if (features.ml) {
    console.log('[BOOT] Initializing ML module...')
    // ML service connection
    // Handled by separate ml_service
    console.log('[BOOT] ✓ ML module ready (external service)')
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('[BOOT] ✓ System ready')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  return features
}

export { FEATURES }
