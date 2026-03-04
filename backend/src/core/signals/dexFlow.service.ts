/**
 * AS-1: DEX Flow Signals
 * 
 * Анализирует потоки ликвидности через DEX
 * Источник: MongoDB indexed transfers
 */

import { TransferModel } from '../transfers/transfers.model.js';

// Known DEX router addresses (Uniswap V2/V3, Sushiswap, etc.)
const DEX_ROUTERS = new Set([
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', // Uniswap V2 Router
  '0xe592427a0aece92de3edee1f18e0157c05861564', // Uniswap V3 Router
  '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f', // Sushiswap Router
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', // Uniswap V3 Router 2
]);

export interface DEXFlowSignal {
  netFlowUSD: number;         // Net inflow/outflow через DEX
  liquidityChangePct: number; // % изменения ликвидности в пулах
  txCount: number;            // Количество транзакций
  timestamp: Date;
}

export interface DEXFlowAnalysis {
  token: string;
  window24h: DEXFlowSignal;
  evidence: {
    inflows: number;
    outflows: number;
    dexTxCount: number;
    lpEvents: number;
  };
}

/**
 * Анализирует DEX flow для токена за последние 24 часа
 */
export async function analyzeDEXFlow(
  tokenAddress: string
): Promise<DEXFlowAnalysis> {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Получаем все transfer events для токена за 24ч
  const transfers = await TransferModel.find({
    assetAddress: tokenAddress.toLowerCase(),
    timestamp: { $gte: since24h },
    source: 'erc20_log',
  }).lean();

  let inflowCount = 0;
  let outflowCount = 0;
  let dexTxCount = 0;

  for (const transfer of transfers) {
    const fromIsDEX = DEX_ROUTERS.has(transfer.from.toLowerCase());
    const toIsDEX = DEX_ROUTERS.has(transfer.to.toLowerCase());

    // Покупка через DEX (токены выходят из DEX к пользователю)
    if (fromIsDEX) {
      inflowCount++;
      dexTxCount++;
    }

    // Продажа через DEX (токены идут от пользователя в DEX)
    if (toIsDEX) {
      outflowCount++;
      dexTxCount++;
    }
  }

  // Для MVP используем количество транзакций как прокси для USD flow
  // netFlow положительный = больше покупок, отрицательный = больше продаж
  const netFlowUSD = (inflowCount - outflowCount) * 50000; // Простая эвристика

  // Liquidity change пока 0 (нужен более сложный анализ LP events)
  const liquidityChangePct = 0;

  return {
    token: tokenAddress,
    window24h: {
      netFlowUSD,
      liquidityChangePct,
      txCount: dexTxCount,
      timestamp: now,
    },
    evidence: {
      inflows: inflowCount,
      outflows: outflowCount,
      dexTxCount,
      lpEvents: 0,
    },
  };
}

/**
 * Вычисляет влияние DEX flow на Engine state
 */
export interface DEXFlowImpact {
  evidencePoints: number;
  directionPoints: number;
  riskPoints: number;
  reasons: string[];
}

export function calculateDEXFlowImpact(signal: DEXFlowSignal): DEXFlowImpact {
  const impact: DEXFlowImpact = {
    evidencePoints: 0,
    directionPoints: 0,
    riskPoints: 0,
    reasons: [],
  };

  const { netFlowUSD, liquidityChangePct, txCount } = signal;

  // Сильный приток (покупки через DEX)
  if (netFlowUSD > 250_000) {
    impact.evidencePoints += 15;
    impact.directionPoints += 10;
    impact.reasons.push(`Strong DEX inflow: $${(netFlowUSD / 1000).toFixed(0)}K`);
  } else if (netFlowUSD > 100_000) {
    impact.evidencePoints += 8;
    impact.directionPoints += 5;
    impact.reasons.push(`Moderate DEX inflow: $${(netFlowUSD / 1000).toFixed(0)}K`);
  }

  // Сильный отток (продажи через DEX)
  if (netFlowUSD < -150_000) {
    impact.directionPoints -= 10;
    impact.riskPoints += 5;
    impact.reasons.push(`DEX outflow: -$${Math.abs(netFlowUSD / 1000).toFixed(0)}K`);
  }

  // Liquidity drain (опасно!)
  if (liquidityChangePct < -15) {
    impact.riskPoints += 20;
    impact.evidencePoints -= 15;
    impact.reasons.push(`Liquidity drain: ${liquidityChangePct.toFixed(1)}%`);
  }

  // Низкая активность = недостаточно данных
  if (txCount < 10) {
    impact.riskPoints += 5;
    impact.reasons.push('Low DEX activity (< 10 tx)');
  }

  return impact;
}
