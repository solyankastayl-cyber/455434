/**
 * Universal Resolver Service (Phase 15.5.2 + P2.2 ENS Integration)
 * 
 * ANY input → Resolved entity with context
 * Features:
 * - Confidence scoring with reasoning
 * - Actionable suggestions
 * - Lazy bootstrap for unknown addresses (P2.1 Integration)
 * - Real ENS resolution (P2.2 Integration)
 * - Attribution Claims integration (Phase 15.5.4)
 */
import { 
  ResolutionModel, 
  ResolvedType, 
  ResolutionStatus,
  SuggestionType,
  RESOLUTION_CACHE_TTL,
  RESOLUTION_PENDING_TTL 
} from './resolution.model.js';
import { BootstrapJobModel, BootstrapType } from './bootstrap.model.js';
import { SignalModel } from '../signals/signals.model.js';
import { StrategyProfileModel } from '../strategies/strategy_profiles.model.js';
import { SignalReputationModel } from '../reputation/signal_reputation.model.js';
import { ActorReputationModel } from '../reputation/actor_reputation.model.js';
import { MarketRegimeModel } from '../market_regimes/market_regime.model.js';
import { TransferModel } from '../transfers/transfers.model.js';
import { RelationModel } from '../relations/relations.model.js';
import { attributionClaimsService, AttributionStatus } from '../attribution/attribution_claims.service.js';
import { bootstrapService } from '../bootstrap/index.js';
import { ensService } from '../ens/index.js';

// Known token symbols mapping
const KNOWN_SYMBOLS: Record<string, { address: string; name: string; decimals: number }> = {
  'usdc': { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', name: 'USD Coin', decimals: 6 },
  'usdt': { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', name: 'Tether USD', decimals: 6 },
  'dai': { address: '0x6b175474e89094c44da98b954eedeac495271d0f', name: 'Dai Stablecoin', decimals: 18 },
  'weth': { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', name: 'Wrapped Ether', decimals: 18 },
  'wbtc': { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', name: 'Wrapped BTC', decimals: 8 },
  'eth': { address: '0x0000000000000000000000000000000000000000', name: 'Ethereum', decimals: 18 },
  'link': { address: '0x514910771af9ca656af840dff83e8264ecf986ca', name: 'Chainlink', decimals: 18 },
  'uni': { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', name: 'Uniswap', decimals: 18 },
  'aave': { address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', name: 'Aave', decimals: 18 },
};

export interface ResolutionResult {
  input: string;
  type: ResolvedType;
  subtype?: string;
  normalizedId: string;
  resolvedAddress?: string; // P2.2: Actual address (for ENS inputs)
  chain: string;
  confidence: number;
  reason: string;
  suggestions: SuggestionType[];
  status: ResolutionStatus;
  available: {
    profile: boolean;
    market: boolean;
    signals: boolean;
    trust: boolean;
    reputation: boolean;
    transfers: boolean;
    relations: boolean;
  };
  label?: string;
  symbol?: string; // Token symbol for known tokens
  verified?: boolean;
  cached?: boolean;
  bootstrapQueued?: boolean;
  // Bootstrap progress info (P2.1 Step 3)
  bootstrap?: {
    dedupKey: string;
    progress: number;
    step?: string;
    etaSeconds: number | null;
    status: string;
  };
  // ENS metadata (P2.2)
  ens?: {
    name: string;
    confidence: number;
    source?: 'forward' | 'reverse';
  };
  // Attribution data (Phase 15.5.4)
  attribution?: {
    status: 'linked_confirmed' | 'linked_suspected' | 'unlinked';
    linked: boolean;
    subjects: Array<{
      type: string;
      id: string;
      score: number;
      claimStatus: string;
    }>;
    claimsPreview: any[];
  };
  linkedSubject?: {
    type: string;
    id: string;
    name?: string;
  };
}

/**
 * Resolve any input to entity type + ID with full context
 */
export async function resolve(input: string): Promise<ResolutionResult> {
  if (!input || input.trim().length === 0) {
    return {
      input: input || '',
      type: 'unknown',
      normalizedId: '',
      chain: 'ethereum',
      confidence: 0,
      reason: 'Empty input provided',
      suggestions: [],
      status: 'insufficient_data',
      available: {
        profile: false,
        market: false,
        signals: false,
        trust: false,
        reputation: false,
        transfers: false,
        relations: false,
      },
    };
  }
  
  const cleanInput = input.trim().toLowerCase();
  
  // Check cache first
  const cached = await ResolutionModel.findOne({
    input: cleanInput,
    expiresAt: { $gt: new Date() },
  }).lean();
  
  if (cached) {
    return {
      input: cached.input,
      type: cached.type,
      subtype: cached.subtype,
      normalizedId: cached.normalizedId,
      resolvedAddress: cached.resolvedAddress,
      chain: cached.chain,
      confidence: cached.confidence,
      reason: cached.reason,
      suggestions: cached.suggestions || [],
      status: cached.status,
      available: cached.available,
      label: cached.label,
      verified: cached.verified,
      cached: true,
      bootstrapQueued: cached.bootstrapQueued,
      ens: cached.ens,
    };
  }
  
  // Input type detection (P2.2 - strict order)
  // 1. ENS name (*.eth)
  if (cleanInput.endsWith('.eth')) {
    return await resolveENSName(cleanInput);
  }
  
  // 2. Check if it's an Ethereum address (0x...)
  if (/^0x[a-f0-9]{40}$/i.test(cleanInput)) {
    return await resolveAddress(cleanInput);
  }
  
  // 3. Check if it's a transaction hash (0x... 64 chars)
  if (/^0x[a-f0-9]{64}$/i.test(cleanInput)) {
    return await resolveTransaction(cleanInput);
  }
  
  // 3. Check if it's ENS (.eth)
  if (cleanInput.endsWith('.eth')) {
    return await resolveENS(cleanInput);
  }
  
  // 4. Check if it's a token symbol (USDC, ETH, etc)
  if (/^[A-Z]{2,10}$/i.test(cleanInput)) {
    return await resolveSymbol(cleanInput);
  }
  
  // 5. Unknown format
  const resolution: ResolutionResult = {
    input: cleanInput,
    type: 'unknown',
    normalizedId: cleanInput,
    chain: 'ethereum',
    confidence: 0,
    reason: 'Input format not recognized. Expected: Ethereum address (0x...), ENS name (.eth), token symbol, or transaction hash.',
    suggestions: [],
    status: 'insufficient_data',
    available: {
      profile: false,
      market: false,
      signals: false,
      trust: false,
      reputation: false,
      transfers: false,
      relations: false,
    },
  };
  
  await cacheResolution(resolution);
  return resolution;
}

/**
 * Resolve ENS name to address with full data check (P2.2)
 * 
 * Flow:
 * 1. Resolve ENS → address via ensService
 * 2. If no address → return pending status
 * 3. If address → continue to standard address resolution
 * 4. Attach ENS metadata to response
 */
async function resolveENSName(ensName: string): Promise<ResolutionResult> {
  const name = ensName.toLowerCase().trim();
  
  console.log(`[Resolver] Resolving ENS: ${name}`);
  
  // Step 1: Resolve ENS to address
  const ensResult = await ensService.resolveENS(name);
  
  if (!ensResult.address) {
    // ENS not resolved - return pending status
    const resolution: ResolutionResult = {
      input: name,
      type: 'unknown',
      normalizedId: name,
      chain: 'ethereum',
      confidence: ensResult.confidence,
      reason: ensResult.reason,
      suggestions: ['check_ens_spelling', 'connect_ens_provider'],
      status: 'pending',
      available: {
        profile: false,
        market: false,
        signals: false,
        trust: false,
        reputation: false,
        transfers: false,
        relations: false,
      },
      ens: {
        name: name,
        confidence: ensResult.confidence,
        source: 'forward' as const,
      },
    };
    
    await cacheResolution(resolution);
    return resolution;
  }
  
  // Step 2: ENS resolved → get address data
  const address = ensResult.address.toLowerCase();
  console.log(`[Resolver] ENS ${name} → ${address}`);
  
  // Step 3: Resolve address with standard flow
  const addressResolution = await resolveAddress(address);
  
  // Step 4: Enrich with ENS metadata (forward resolution overrides reverse)
  const resolution: ResolutionResult = {
    ...addressResolution,
    input: name, // Keep original ENS input
    resolvedAddress: address,
    ens: {
      name: name,
      confidence: ensResult.confidence,
      source: 'forward' as const,
    },
    // Boost reason with ENS info
    reason: `ENS "${name}" resolved to ${address.slice(0, 10)}... ${addressResolution.reason}`,
  };
  
  // Cache with ENS input as key
  await cacheResolution(resolution);
  
  return resolution;
}

/**
 * Resolve Ethereum address with comprehensive data check
 */
async function resolveAddress(address: string): Promise<ResolutionResult> {
  const addr = address.toLowerCase();
  
  // P0: Check if this is a known token seed (ground truth)
  const knownToken = Object.entries(KNOWN_SYMBOLS).find(
    ([, token]) => token.address.toLowerCase() === addr
  );
  
  if (knownToken) {
    const [symbol, tokenData] = knownToken;
    // Known token = high confidence immediately, no need to check DB first
    const resolution: ResolutionResult = {
      input: addr,
      type: 'token',
      subtype: 'known_seed',
      normalizedId: addr,
      resolvedAddress: addr,
      chain: 'ethereum',
      confidence: 0.95, // High confidence for known tokens
      reason: `Confirmed EVM token: ${tokenData.name} (${symbol.toUpperCase()})`,
      suggestions: [],
      status: 'resolved',
      available: {
        profile: true,
        market: true,
        signals: false, // Will be indexed
        trust: false,
        reputation: false,
        transfers: false, // Will be indexed
        relations: false,
      },
      label: tokenData.name,
      symbol: symbol.toUpperCase(),
      verified: true,
      bootstrapQueued: false,
    };
    
    // Still try to enrich with actual data if available
    const [signalsToCount, tokenRegime] = await Promise.all([
      SignalModel.countDocuments({ assetAddress: addr }).catch(() => 0),
      MarketRegimeModel.findOne({ assetAddress: addr }).lean().catch(() => null),
    ]);
    
    resolution.available.signals = signalsToCount > 0;
    resolution.available.market = !!tokenRegime || true; // Always true for known tokens
    
    if (signalsToCount > 0) {
      resolution.reason += ` Has ${signalsToCount} associated signals.`;
    }
    
    await cacheResolution(resolution);
    return resolution;
  }
  
  // Parallel check for all data sources including Attribution
  const [
    actor,
    tokenRegime,
    signalsFromCount,
    signalsToCount,
    transfersCount,
    relationsCount,
    actorReputation,
    attributionStatus,
  ] = await Promise.all([
    StrategyProfileModel.findOne({ address: addr }).lean(),
    MarketRegimeModel.findOne({ assetAddress: addr }).lean(),
    SignalModel.countDocuments({ fromAddress: addr }),
    SignalModel.countDocuments({ assetAddress: addr }),
    TransferModel.countDocuments({ $or: [{ from: addr }, { to: addr }] }).catch(() => 0),
    RelationModel.countDocuments({ $or: [{ fromAddress: addr }, { toAddress: addr }] }).catch(() => 0),
    ActorReputationModel.findOne({ address: addr }).lean(),
    attributionClaimsService.getAttributionStatus('ethereum', addr).catch(() => null),
  ]);
  
  // Determine type and confidence based on available data
  let type: ResolvedType = 'unknown';
  let subtype: string | undefined;
  let confidence = 0;
  let reason = '';
  let suggestions: SuggestionType[] = [];
  let status: ResolutionStatus = 'completed'; // Default: analysis completed successfully
  let linkedSubject: { type: string; id: string; name?: string } | undefined;
  let bootstrapInfo: { queued: boolean; bootstrap?: { dedupKey: string; progress: number; step?: string; etaSeconds: number | null; status: string } } | undefined;
  
  const hasTransfers = transfersCount > 0;
  const hasRelations = relationsCount > 0;
  const hasSignalsFrom = signalsFromCount > 0;
  const hasSignalsTo = signalsToCount > 0;
  
  // Check Attribution Claims first - highest priority if confirmed
  if (attributionStatus?.linked && attributionStatus.subjects.length > 0) {
    const bestClaim = attributionStatus.subjects[0];
    
    if (attributionStatus.status === 'linked_confirmed') {
      // Confirmed attribution - use this as primary identity
      type = bestClaim.type as ResolvedType;
      subtype = 'attributed';
      confidence = Math.max(0.85, bestClaim.score);
      reason = `Confirmed ${bestClaim.type} attribution to ${bestClaim.id}. `;
      linkedSubject = { type: bestClaim.type, id: bestClaim.id };
      
      if (actor) reason += `Has tracked activity with ${signalsFromCount} signals.`;
    } else if (attributionStatus.status === 'linked_suspected') {
      // Suspected attribution - boost confidence but not as high
      type = bestClaim.type as ResolvedType;
      subtype = 'attributed_suspected';
      confidence = Math.max(0.60, bestClaim.score * 0.8);
      reason = `Suspected ${bestClaim.type} attribution to ${bestClaim.id}. `;
      linkedSubject = { type: bestClaim.type, id: bestClaim.id };
      suggestions = ['confirm_attribution', 'view_evidence'];
    }
  } else if (actor) {
    // Known actor in our system
    type = 'actor';
    subtype = (actor as any).strategyType || 'trader';
    confidence = 0.95;
    reason = `Identified as tracked actor with ${signalsFromCount} signals generated.`;
    if (hasRelations) reason += ` Has ${relationsCount} known relationships.`;
  } else if (tokenRegime) {
    // Known token
    type = 'token';
    confidence = 0.90;
    reason = `Identified as token with market regime data.`;
    if (hasSignalsTo) reason += ` Has ${signalsToCount} signals associated.`;
  } else if (hasTransfers || hasRelations) {
    // Has on-chain activity but not fully indexed
    type = 'actor';
    subtype = 'eoa';
    confidence = 0.42;
    reason = `Address detected with ${transfersCount} transfers and ${relationsCount} relations, but not yet fully indexed.`;
    suggestions = ['scan_address', 'view_as_raw_wallet'];
    
    // P0 FIX: Check bootstrap status first
    bootstrapInfo = await enqueueBootstrap(addr, 'address');
    
    // Set status based on bootstrap state
    if (bootstrapInfo.bootstrap?.status === 'done') {
      status = 'completed'; // Analysis finished, even if sparse data
      reason += ' Analysis completed.';
    } else if (bootstrapInfo.bootstrap?.status === 'failed') {
      status = 'failed';
      reason += ' Analysis failed after multiple attempts.';
    } else if (bootstrapInfo.bootstrap?.status === 'running') {
      status = 'analyzing';
      if (bootstrapInfo.bootstrap.etaSeconds) {
        reason += ` Analysis in progress. ETA: ~${bootstrapInfo.bootstrap.etaSeconds}s.`;
      }
    } else {
      status = 'analyzing'; // queued or starting
      if (bootstrapInfo.bootstrap?.etaSeconds) {
        reason += ` Queued for analysis. Estimated time: ~${bootstrapInfo.bootstrap.etaSeconds}s.`;
      }
    }
  } else {
    // Valid address but no data
    type = 'unknown';
    confidence = 0.20;
    reason = 'Valid Ethereum address with no recorded activity in our database. May be new or inactive.';
    suggestions = ['scan_address', 'view_on_etherscan', 'wait_for_indexing'];
    
    // P0 FIX: Check bootstrap status first
    bootstrapInfo = await enqueueBootstrap(addr, 'address');
    
    // Set status based on bootstrap state
    if (bootstrapInfo.bootstrap?.status === 'done') {
      status = 'completed'; // Analysis finished, confirmed no data
      reason += ' Analysis completed - no on-chain activity found.';
    } else if (bootstrapInfo.bootstrap?.status === 'failed') {
      status = 'failed';
      reason += ' Analysis failed after multiple attempts.';
    } else if (bootstrapInfo.bootstrap?.status === 'running') {
      status = 'analyzing';
      if (bootstrapInfo.bootstrap.etaSeconds) {
        reason += ` Analysis in progress. ETA: ~${bootstrapInfo.bootstrap.etaSeconds}s.`;
      }
    } else {
      status = 'pending';
      if (bootstrapInfo.bootstrap?.etaSeconds) {
        reason += ` Queued for analysis. Estimated time: ~${bootstrapInfo.bootstrap.etaSeconds}s.`;
      }
    }
  }
  
  // P2.2 Step 3: Reverse ENS Enrichment
  // Try to get ENS name for address (only if no attribution label)
  let ensMetadata: { name: string; confidence: number; source: 'reverse' } | undefined;
  
  // Priority: Attribution label > ENS reverse > Resolver label > Fallback
  if (!linkedSubject?.id) {
    const reverseENS = await ensService.reverseENS(addr);
    if (reverseENS.name && reverseENS.confidence >= 0.7) {
      ensMetadata = {
        name: reverseENS.name,
        confidence: reverseENS.confidence,
        source: 'reverse',
      };
      console.log(`[Resolver] Reverse ENS found: ${addr} → ${reverseENS.name}`);
    }
  }
  
  // Determine final label with priority
  const finalLabel = linkedSubject?.id 
    || ensMetadata?.name 
    || (actor ? `${addr.slice(0, 8)}...${addr.slice(-4)}` : undefined);
  
  const resolution: ResolutionResult = {
    input: addr,
    type,
    subtype,
    normalizedId: addr,
    resolvedAddress: addr, // P2.2: Actual address
    chain: 'ethereum',
    confidence,
    reason,
    suggestions,
    status,
    available: {
      profile: !!actor,
      market: !!tokenRegime,
      signals: hasSignalsFrom || hasSignalsTo,
      trust: false,
      reputation: !!actorReputation,
      transfers: hasTransfers,
      relations: hasRelations,
    },
    label: finalLabel,
    verified: attributionStatus?.status === 'linked_confirmed',
    bootstrapQueued: status === 'pending' || status === 'indexing',
    // Bootstrap progress info for UI polling (P2.1 Step 3)
    bootstrap: bootstrapInfo?.bootstrap,
    // ENS metadata (P2.2 Step 3)
    ens: ensMetadata,
    // Attribution data
    attribution: attributionStatus ? {
      status: attributionStatus.status,
      linked: attributionStatus.linked,
      subjects: attributionStatus.subjects,
      claimsPreview: attributionStatus.claimsPreview.slice(0, 3),
    } : undefined,
    linkedSubject,
  };
  
  await cacheResolution(resolution);
  return resolution;
}

/**
 * Resolve transaction hash
 */
async function resolveTransaction(txHash: string): Promise<ResolutionResult> {
  const hash = txHash.toLowerCase();
  
  // Check if we have signals with this tx
  const signal = await SignalModel.findOne({ txHash: hash }).lean();
  
  let confidence: number;
  let reason: string;
  let suggestions: SuggestionType[] = [];
  let status: ResolutionStatus = 'completed'; // Default: analysis completed successfully
  
  if (signal) {
    confidence = 0.95;
    reason = `Transaction found in signals database. Type: ${(signal as any).type || 'unknown'}`;
  } else {
    confidence = 0.50;
    reason = 'Valid transaction hash format, but not found in our indexed signals. May be a regular transfer or not yet indexed.';
    suggestions = ['view_on_etherscan', 'wait_for_indexing'];
    status = 'pending';
  }
  
  const resolution: ResolutionResult = {
    input: hash,
    type: 'tx',
    normalizedId: hash,
    chain: 'ethereum',
    confidence,
    reason,
    suggestions,
    status,
    available: {
      profile: false,
      market: false,
      signals: !!signal,
      trust: !!signal,
      reputation: false,
      transfers: false,
      relations: false,
    },
  };
  
  await cacheResolution(resolution);
  return resolution;
}

/**
 * Resolve ENS name - honest handling without mocking
 */
async function resolveENS(ensName: string): Promise<ResolutionResult> {
  // Честная обработка ENS без притворства
  const resolution: ResolutionResult = {
    input: ensName,
    type: 'ens',
    normalizedId: ensName,
    chain: 'ethereum',
    confidence: 0.30,
    reason: 'ENS name detected. On-chain resolution requires connected Ethereum provider. Displaying as unresolved ENS.',
    suggestions: ['connect_ens_provider', 'view_on_etherscan'],
    status: 'pending',
    available: {
      profile: false,
      market: false,
      signals: false,
      trust: false,
      reputation: false,
      transfers: false,
      relations: false,
    },
    label: ensName,
    verified: false,
  };
  
  await cacheResolution(resolution);
  return resolution;
}

/**
 * Resolve token symbol
 */
async function resolveSymbol(symbol: string): Promise<ResolutionResult> {
  const sym = symbol.toLowerCase();
  const knownToken = KNOWN_SYMBOLS[sym];
  
  if (knownToken) {
    // Known symbol - resolve to address and check our data
    const addr = knownToken.address;
    
    const [tokenRegime, signalsCount] = await Promise.all([
      MarketRegimeModel.findOne({ assetAddress: addr }).lean(),
      SignalModel.countDocuments({ assetAddress: addr }),
    ]);
    
    const resolution: ResolutionResult = {
      input: sym,
      type: 'token',
      normalizedId: addr,
      chain: 'ethereum',
      confidence: 0.95,
      reason: `Resolved ${symbol.toUpperCase()} to known token address. ${signalsCount > 0 ? `Has ${signalsCount} signals.` : 'No signals recorded yet.'}`,
      suggestions: [],
      status: 'resolved',
      available: {
        profile: true,
        market: !!tokenRegime,
        signals: signalsCount > 0,
        trust: false,
        reputation: false,
        transfers: false,
        relations: false,
      },
      label: knownToken.name,
      verified: true,
    };
    
    await cacheResolution(resolution);
    return resolution;
  }
  
  // Unknown symbol
  const resolution: ResolutionResult = {
    input: sym,
    type: 'token',
    normalizedId: symbol.toUpperCase(),
    chain: 'ethereum',
    confidence: 0.30,
    reason: 'Token symbol not found in our database. May be a newer or less common token.',
    suggestions: ['check_token_contract', 'view_on_etherscan'],
    status: 'insufficient_data',
    available: {
      profile: false,
      market: false,
      signals: false,
      trust: false,
      reputation: false,
      transfers: false,
      relations: false,
    },
    label: symbol.toUpperCase(),
  };
  
  await cacheResolution(resolution);
  return resolution;
}

/**
 * Enqueue bootstrap job for unknown address/token (P2.1 Integration)
 * 
 * Uses new BootstrapTask system with:
 * - Idempotency via dedupKey
 * - Retry with exponential backoff
 * - Progress tracking
 * 
 * Returns bootstrap info for UI polling
 */
async function enqueueBootstrap(input: string, type: BootstrapType): Promise<{
  queued: boolean;
  bootstrap?: {
    dedupKey: string;
    progress: number;
    step?: string;
    etaSeconds: number | null;
    status: string;
  };
}> {
  try {
    // Map old type to new subjectType
    const subjectType = type === 'token' ? 'token' : 'wallet';
    const priority = type === 'token' ? 2 : 3; // Tokens slightly higher priority
    const chain = 'ethereum';
    const address = input.toLowerCase();
    
    const result = await bootstrapService.enqueue({
      subjectType,
      chain,
      address,
      priority,
    });
    
    if (result.queued) {
      console.log(`[Resolver] Queued bootstrap task: ${subjectType} - ${input}`);
    } else {
      console.log(`[Resolver] Bootstrap task already exists: ${subjectType} - ${input} (status: ${result.status})`);
    }
    
    // Get current task status for UI
    const taskStatus = await bootstrapService.getStatus(subjectType, chain, address);
    const etaSeconds = taskStatus.exists 
      ? (taskStatus.etaSeconds ?? bootstrapService.estimateETA(subjectType))
      : bootstrapService.estimateETA(subjectType);
    
    // Generate dedupKey for frontend polling
    const dedupKey = `${subjectType}:${chain}:${address}`;
    
    return {
      queued: result.queued,
      bootstrap: {
        dedupKey,
        progress: taskStatus.progress || 0,
        step: taskStatus.step,
        etaSeconds,
        status: taskStatus.status || 'queued',
      },
    };
  } catch (error) {
    console.error('[Resolver] Failed to queue bootstrap:', error);
    return { queued: false };
  }
}

/**
 * Cache resolution with appropriate TTL
 */
async function cacheResolution(resolution: ResolutionResult): Promise<void> {
  try {
    const ttl = resolution.status === 'completed' ? RESOLUTION_CACHE_TTL : RESOLUTION_PENDING_TTL;
    
    await ResolutionModel.findOneAndUpdate(
      { input: resolution.input },
      {
        $set: {
          ...resolution,
          resolvedAt: new Date(),
          expiresAt: new Date(Date.now() + ttl),
        },
      },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error('[Resolver] Failed to cache resolution:', error);
  }
}

/**
 * Update resolution status after bootstrap completes (P0 FIX)
 * 
 * This is called by bootstrap worker when task finishes.
 * Updates resolution from 'analyzing'/'pending' → 'completed'
 */
export async function updateResolutionAfterBootstrap(
  address: string,
  status: 'done' | 'failed'
): Promise<void> {
  try {
    const normalizedAddr = address.toLowerCase();
    
    // Find resolution by address (might be cached under different inputs)
    const resolution = await ResolutionModel.findOne({
      $or: [
        { input: normalizedAddr },
        { normalizedId: normalizedAddr },
        { resolvedAddress: normalizedAddr },
      ],
    });
    
    if (!resolution) {
      console.log(`[Resolver] No cached resolution found for ${normalizedAddr}, skipping update`);
      return;
    }
    
    const newStatus: ResolutionStatus = status === 'done' ? 'completed' : 'failed';
    
    console.log(`[Resolver] Updating resolution ${normalizedAddr}: ${resolution.status} → ${newStatus}`);
    
    // Update status to terminal state
    await ResolutionModel.updateOne(
      { _id: resolution._id },
      {
        $set: {
          status: newStatus,
          updatedAt: new Date(),
          // If failed, reduce confidence
          ...(status === 'failed' && {
            confidence: Math.max(0.2, resolution.confidence * 0.5),
            reason: `${resolution.reason} Analysis failed after multiple attempts.`,
          }),
        },
      }
    );
    
    console.log(`[Resolver] Resolution updated successfully for ${normalizedAddr}`);
  } catch (error) {
    console.error('[Resolver] Failed to update resolution after bootstrap:', error);
  }
}

/**
 * Clear expired cache
 */
export async function clearExpiredResolutions(): Promise<number> {
  const result = await ResolutionModel.deleteMany({
    expiresAt: { $lt: new Date() },
  });
  
  return result.deletedCount || 0;
}

/**
 * Get bootstrap queue stats (P2.1 - uses new BootstrapTask system)
 */
export async function getBootstrapStats(): Promise<{
  queued: number;
  running: number;
  done: number;
  failed: number;
  total: number;
}> {
  return bootstrapService.getQueueStats();
}

/**
 * Get indexer status for UI banner
 */
export async function getIndexerStatus(): Promise<{
  status: 'active' | 'indexing' | 'idle';
  pendingJobs: number;
  lastActivity?: Date;
}> {
  const [pendingCount, lastJob] = await Promise.all([
    BootstrapJobModel.countDocuments({ status: { $in: ['queued', 'processing'] } }),
    BootstrapJobModel.findOne().sort({ updatedAt: -1 }).lean(),
  ]);
  
  let status: 'active' | 'indexing' | 'idle' = 'idle';
  
  if (pendingCount > 0) {
    status = 'indexing';
  } else if (lastJob && (Date.now() - new Date(lastJob.updatedAt).getTime()) < 5 * 60 * 1000) {
    status = 'active';
  }
  
  return {
    status,
    pendingJobs: pendingCount,
    lastActivity: lastJob?.updatedAt,
  };
}
