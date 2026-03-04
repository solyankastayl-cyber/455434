/**
 * AS-2: Whale Transfer Signals
 * 
 * Отслеживает действия крупных игроков
 * MVP: используем количество крупных транзакций как proxy для whale activity
 */

import { TransferModel } from '../transfers/transfers.model.js';

// Whale threshold - для MVP используем amountNormalized threshold
const WHALE_AMOUNT_THRESHOLD = 100000; // 100K tokens (будет зависеть от токена)

// Known exchanges (whitelist)
const EXCHANGES = new Set([
  // Binance
  '0x28c6c06298d514db089934071355e5743bf21d60', // Binance 14
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549', // Binance 15
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d', // Binance 16
  
  // Coinbase
  '0x71660c4005ba85c37ccec55d0c4493e66fe775d3', // Coinbase 1
  '0x503828976d22510aad0201ac7ec88293211d23da', // Coinbase 2
  '0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740', // Coinbase 3
  
  // Kraken
  '0x2910543af39aba0cd09dbb2d50200b3e800a63d2', // Kraken 1
  '0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13', // Kraken 2
  
  // OKX
  '0x98ec059dc3adfbdd63429454aeb0c990fba4a128', // OKX 1
  '0xa7efae728d2936e78bda97dc267687568dd593f3', // OKX 2
  
  // KuCoin
  '0x2b5634c42055806a59e9107ed44d43c426e58258', // KuCoin 1
  '0xd6216fc19db775df9774a6e33526131da7d19a2c', // KuCoin 2
]);

export type WhaleSignalType = 'accumulation' | 'exit' | 'repeated_exit';

export interface WhaleTransfer {
  from: string;
  to: string;
  amount: number;
  timestamp: Date;
  txHash: string;
  fromExchange: boolean;
  toExchange: boolean;
}

export interface WhaleSignal {
  type: WhaleSignalType;
  transfers: WhaleTransfer[];
  totalAmount: number;
  count: number;
}

export interface WhaleAnalysis {
  token: string;
  accumulations: WhaleSignal | null;
  exits: WhaleSignal | null;
  repeatedExits: WhaleSignal | null;
  evidence: {
    whaleTransfers: number;
    fromExchangeCount: number;
    toExchangeCount: number;
  };
}

/**
 * Проверяет, является ли адрес биржей
 */
function isExchange(address: string): boolean {
  return EXCHANGES.has(address.toLowerCase());
}

/**
 * Анализирует whale transfers для токена за последние 24 часа
 */
export async function analyzeWhaleTransfers(
  tokenAddress: string
): Promise<WhaleAnalysis> {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Получаем крупные transfers (в MVP фильтруем по amountNormalized)
  const transfers = await TransferModel.find({
    assetAddress: tokenAddress.toLowerCase(),
    timestamp: { $gte: since24h },
    source: 'erc20_log',
    amountNormalized: { $gte: WHALE_AMOUNT_THRESHOLD },
  }).sort({ timestamp: -1 }).lean();

  const whaleTransfers: WhaleTransfer[] = [];
  const accumulations: WhaleTransfer[] = [];
  const exits: WhaleTransfer[] = [];
  let fromExchangeCount = 0;
  let toExchangeCount = 0;

  for (const transfer of transfers) {
    const fromExchange = isExchange(transfer.from);
    const toExchange = isExchange(transfer.to);

    const whaleTransfer: WhaleTransfer = {
      from: transfer.from,
      to: transfer.to,
      amount: transfer.amountNormalized || 0,
      timestamp: transfer.timestamp,
      txHash: transfer.txHash,
      fromExchange,
      toExchange,
    };

    whaleTransfers.push(whaleTransfer);

    // Accumulation: биржа → кошелек (покупка)
    if (fromExchange && !toExchange) {
      accumulations.push(whaleTransfer);
      fromExchangeCount++;
    }

    // Exit: кошелек → биржа (продажа)
    if (!fromExchange && toExchange) {
      exits.push(whaleTransfer);
      toExchangeCount++;
    }
  }

  // Repeated exits (≥3 exits за 24ч)
  const hasRepeatedExits = exits.length >= 3;

  return {
    token: tokenAddress,
    accumulations: accumulations.length > 0 ? {
      type: 'accumulation',
      transfers: accumulations,
      totalAmount: accumulations.reduce((sum, t) => sum + t.amount, 0),
      count: accumulations.length,
    } : null,
    exits: exits.length > 0 ? {
      type: 'exit',
      transfers: exits,
      totalAmount: exits.reduce((sum, t) => sum + t.amount, 0),
      count: exits.length,
    } : null,
    repeatedExits: hasRepeatedExits ? {
      type: 'repeated_exit',
      transfers: exits,
      totalAmount: exits.reduce((sum, t) => sum + t.amount, 0),
      count: exits.length,
    } : null,
    evidence: {
      whaleTransfers: whaleTransfers.length,
      fromExchangeCount,
      toExchangeCount,
    },
  };
}

/**
 * Вычисляет влияние whale signals на Engine state
 */
export interface WhaleImpact {
  evidencePoints: number;
  directionPoints: number;
  riskPoints: number;
  confidencePoints: number;
  reasons: string[];
}

export function calculateWhaleImpact(analysis: WhaleAnalysis): WhaleImpact {
  const impact: WhaleImpact = {
    evidencePoints: 0,
    directionPoints: 0,
    riskPoints: 0,
    confidencePoints: 0,
    reasons: [],
  };

  // Accumulation (покупки с биржи)
  if (analysis.accumulations) {
    const { count } = analysis.accumulations;
    impact.evidencePoints += 20;
    impact.directionPoints += 15;
    impact.confidencePoints += 10;
    impact.reasons.push(
      `Whale accumulation: ${count} large transfer(s) from exchanges`
    );
  }

  // Exit (продажи на биржу)
  if (analysis.exits && !analysis.repeatedExits) {
    const { count } = analysis.exits;
    impact.directionPoints -= 20;
    impact.riskPoints += 15;
    impact.reasons.push(
      `Whale exit: ${count} large transfer(s) to exchanges`
    );
  }

  // Repeated exits (сильный негативный сигнал)
  if (analysis.repeatedExits) {
    const { count } = analysis.repeatedExits;
    impact.riskPoints += 25;
    impact.confidencePoints -= 20;
    impact.reasons.push(
      `⚠️ Repeated whale exits: ${count} large transfers to exchanges`
    );
  }

  return impact;
}
