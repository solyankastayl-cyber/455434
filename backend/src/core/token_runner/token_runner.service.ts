/**
 * Token Runner Service (Stage C)
 * 
 * Batch processing of tokens through DecisionEngine
 * 
 * Architecture:
 *   TokenUniverse → Token Runner → DecisionEngine → TokenAnalysis → Ranking v2
 * 
 * Modes:
 *   - FAST: ~1 sec/token, basic signals + coverage
 *   - DEEP: ~5-10 sec/token, full analysis (future)
 * 
 * Guarantees:
 *   - Rules ≠ overridden
 *   - Engine ≠ decision-maker
 *   - Ranking ≠ ML-only
 */
import { TokenUniverseModel } from '../token_universe/token_universe.model.js';
import { TokenAnalysisModel } from './token_analysis.model.js';
import { runEngine } from '../engine/engine.service.js';
import { TimeWindow } from '../common/window.service.js';

// ============================================================
// CONFIGURATION
// ============================================================

interface RunnerConfig {
  batchSize: number;
  timeoutPerToken: number;  // ms
  analysisMode: 'fast' | 'deep';
  window: TimeWindow;
}

const DEFAULT_CONFIG: RunnerConfig = {
  batchSize: 25,
  timeoutPerToken: 2000,
  analysisMode: 'fast',
  window: '7d',
};

// ============================================================
// MAIN RUNNER FUNCTION
// ============================================================

export interface RunnerResult {
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  tokens: TokenAnalysisResult[];
}

export interface TokenAnalysisResult {
  symbol: string;
  contractAddress: string;
  engineScore: number;
  confidence: number;
  risk: number;
  label: string;
  status: 'completed' | 'failed' | 'skipped';
  error?: string;
  processingTime: number;
}

/**
 * Run Token Runner on all active tokens
 */
export async function runTokenRunner(
  config: Partial<RunnerConfig> = {}
): Promise<RunnerResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  console.log('[Token Runner] Starting batch analysis...');
  console.log(`[Token Runner] Config: batchSize=${cfg.batchSize}, mode=${cfg.analysisMode}`);
  
  const startTime = Date.now();
  
  try {
    // 1. Get active tokens from TokenUniverse
    const tokens = await TokenUniverseModel.find({ active: true })
      .sort({ marketCap: -1 })
      .limit(cfg.batchSize)
      .select('symbol name contractAddress chainId marketCap')
      .lean();
    
    console.log(`[Token Runner] Found ${tokens.length} tokens to analyze`);
    
    if (tokens.length === 0) {
      return {
        processed: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        duration_ms: Date.now() - startTime,
        tokens: [],
      };
    }
    
    // 2. Process tokens
    const results: TokenAnalysisResult[] = [];
    let successful = 0;
    let failed = 0;
    let skipped = 0;
    
    for (const token of tokens) {
      const tokenStart = Date.now();
      
      try {
        // Run Engine analysis
        const analysis = await analyzeToken(token, cfg);
        
        if (analysis.status === 'completed') {
          successful++;
        } else if (analysis.status === 'failed') {
          failed++;
        } else {
          skipped++;
        }
        
        results.push(analysis);
        
        console.log(`[Token Runner] ${token.symbol}: ${analysis.status} (score=${analysis.engineScore}, conf=${analysis.confidence})`);
        
      } catch (err: any) {
        failed++;
        results.push({
          symbol: token.symbol,
          contractAddress: token.contractAddress,
          engineScore: 0,
          confidence: 0,
          risk: 100,
          label: 'NEUTRAL',
          status: 'failed',
          error: err.message,
          processingTime: Date.now() - tokenStart,
        });
        
        console.error(`[Token Runner] ${token.symbol}: FAILED - ${err.message}`);
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`[Token Runner] Completed in ${duration}ms: ${successful} success, ${failed} failed, ${skipped} skipped`);
    
    return {
      processed: tokens.length,
      successful,
      failed,
      skipped,
      duration_ms: duration,
      tokens: results,
    };
    
  } catch (err: any) {
    console.error('[Token Runner] Batch failed:', err);
    throw err;
  }
}

/**
 * Analyze single token through Engine
 */
async function analyzeToken(
  token: any,
  config: RunnerConfig
): Promise<TokenAnalysisResult> {
  const startTime = Date.now();
  
  try {
    // Run Engine
    const engineResponse = await runEngine(token.contractAddress, config.window);
    
    // Calculate scores from Engine response
    const scores = calculateScores(engineResponse);
    
    // Save to TokenAnalysis collection
    await saveTokenAnalysis(token, engineResponse, scores, config);
    
    return {
      symbol: token.symbol,
      contractAddress: token.contractAddress,
      engineScore: scores.engineScore,
      confidence: scores.confidence,
      risk: scores.risk,
      label: engineResponse.decision.label,
      status: 'completed',
      processingTime: Date.now() - startTime,
    };
    
  } catch (err: any) {
    // Save failed analysis
    await saveFailedAnalysis(token, err.message, config);
    
    return {
      symbol: token.symbol,
      contractAddress: token.contractAddress,
      engineScore: 0,
      confidence: 0,
      risk: 100,
      label: 'NEUTRAL',
      status: 'failed',
      error: err.message,
      processingTime: Date.now() - startTime,
    };
  }
}

// ============================================================
// SCORING FUNCTIONS
// ============================================================

interface EngineScores {
  engineScore: number;
  confidence: number;
  risk: number;
}

/**
 * Calculate scores from Engine response
 * 
 * Engine Score: Based on decision label + strength
 * Confidence: Based on coverage + inputs
 * Risk: Based on risk factors count
 */
function calculateScores(engineResponse: any): EngineScores {
  const decision = engineResponse.decision;
  const coverage = engineResponse.coverage?.pct || 0;
  const inputs = engineResponse.inputsUsed || {};
  
  // 1. Engine Score (based on label + strength)
  let baseScore = 50; // NEUTRAL base
  
  if (decision.label === 'BUY') {
    baseScore = decision.strength === 'high' ? 85 :
                decision.strength === 'medium' ? 75 : 65;
  } else if (decision.label === 'SELL') {
    baseScore = decision.strength === 'high' ? 15 :
                decision.strength === 'medium' ? 25 : 35;
  }
  
  // 2. Confidence (based on coverage + data availability)
  const coverageScore = coverage; // 0-100
  const dataScore = Math.min(100, 
    (inputs.actorSignals || 0) * 5 +
    (inputs.contexts || 0) * 10 +
    (inputs.corridors || 0) * 5
  );
  
  const confidence = Math.round((coverageScore * 0.6 + dataScore * 0.4));
  
  // 3. Risk (based on risk factors)
  const riskFactors = decision.risks?.length || 0;
  const risk = Math.min(100, riskFactors * 20 + (100 - coverage) * 0.3);
  
  return {
    engineScore: Math.round(baseScore),
    confidence: Math.max(0, Math.min(100, confidence)),
    risk: Math.max(0, Math.min(100, Math.round(risk))),
  };
}

// ============================================================
// PERSISTENCE FUNCTIONS
// ============================================================

/**
 * Save successful analysis to DB
 */
async function saveTokenAnalysis(
  token: any,
  engineResponse: any,
  scores: EngineScores,
  config: RunnerConfig
): Promise<void> {
  await TokenAnalysisModel.updateOne(
    {
      contractAddress: token.contractAddress.toLowerCase(),
      chainId: token.chainId || 1,
    },
    {
      $set: {
        symbol: token.symbol,
        contractAddress: token.contractAddress.toLowerCase(),
        chainId: token.chainId || 1,
        engineLabel: engineResponse.decision.label,
        engineStrength: engineResponse.decision.strength,
        engineScore: scores.engineScore,
        confidence: scores.confidence,
        risk: scores.risk,
        coverage: {
          percent: engineResponse.coverage?.pct || 0,
          checked: engineResponse.coverage?.checked || [],
        },
        inputsUsed: engineResponse.inputsUsed || {},
        whyFactors: engineResponse.decision.why || [],
        riskFactors: engineResponse.decision.risks || [],
        analysisMode: config.analysisMode,
        analyzedAt: new Date(),
        status: 'completed',
        error: null,
      },
    },
    { upsert: true }
  );
}

/**
 * Save failed analysis to DB
 */
async function saveFailedAnalysis(
  token: any,
  errorMsg: string,
  config: RunnerConfig
): Promise<void> {
  await TokenAnalysisModel.updateOne(
    {
      contractAddress: token.contractAddress.toLowerCase(),
      chainId: token.chainId || 1,
    },
    {
      $set: {
        symbol: token.symbol,
        contractAddress: token.contractAddress.toLowerCase(),
        chainId: token.chainId || 1,
        engineLabel: 'NEUTRAL',
        engineStrength: 'low',
        engineScore: 50,
        confidence: 0,
        risk: 100,
        analysisMode: config.analysisMode,
        analyzedAt: new Date(),
        status: 'failed',
        error: errorMsg,
      },
    },
    { upsert: true }
  );
}

// ============================================================
// QUERY FUNCTIONS
// ============================================================

/**
 * Get latest analysis for token
 */
export async function getTokenAnalysis(symbol: string) {
  return TokenAnalysisModel.findOne({ symbol: symbol.toUpperCase() })
    .sort({ analyzedAt: -1 })
    .select('-_id')
    .lean();
}

/**
 * Get analysis stats
 */
export async function getAnalysisStats() {
  const [total, completed, failed, byLabel] = await Promise.all([
    TokenAnalysisModel.countDocuments(),
    TokenAnalysisModel.countDocuments({ status: 'completed' }),
    TokenAnalysisModel.countDocuments({ status: 'failed' }),
    TokenAnalysisModel.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: '$engineLabel', count: { $sum: 1 } } },
    ]),
  ]);
  
  const lastRun = await TokenAnalysisModel.findOne()
    .sort({ analyzedAt: -1 })
    .select('analyzedAt')
    .lean();
  
  return {
    totalAnalyses: total,
    completed,
    failed,
    byLabel: byLabel.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {} as Record<string, number>),
    lastRun: lastRun?.analyzedAt,
  };
}

/**
 * Get top tokens by engine score
 */
export async function getTopByEngineScore(limit = 20) {
  return TokenAnalysisModel.find({ status: 'completed' })
    .sort({ engineScore: -1 })
    .limit(limit)
    .select('-_id symbol contractAddress engineScore confidence risk engineLabel')
    .lean();
}
