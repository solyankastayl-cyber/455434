/**
 * Exchange Pressure API - P1.3
 * 
 * Market signals: BUY/SELL pressure based on exchange flows.
 * 
 * Formula (from user specification):
 * - Exchange Pressure = (CEX_IN - CEX_OUT) / (CEX_IN + CEX_OUT)
 * - Positive = SELL pressure (deposits to exchange)
 * - Negative = BUY pressure (withdrawals from exchange)
 */

import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import { SUPPORTED_NETWORKS, normalizeNetwork } from '../../common/network.types.js';
import { TransferModel } from '../transfers/transfers.model.js';

// ============================================
// CEX ADDRESSES (Known Exchange Hot/Cold Wallets)
// ============================================

const CEX_ADDRESSES: Record<string, { name: string; addresses: Record<string, string[]> }> = {
  binance: {
    name: 'Binance',
    addresses: {
      ethereum: [
        '0x28c6c06298d514db089934071355e5743bf21d60', // Hot Wallet 1
        '0x21a31ee1afc51d94c2efccaa2092ad1028285549', // Hot Wallet 2
        '0xdfd5293d8e347dfe59e90efd55b2956a1343963d', // Hot Wallet 3
        '0x56eddb7aa87536c09ccc2793473599fd21a8b17f', // Hot Wallet 4
        '0xf977814e90da44bfa03b6295a0616a897441acec', // Hot Wallet 5
      ],
    },
  },
  coinbase: {
    name: 'Coinbase',
    addresses: {
      ethereum: [
        '0x71660c4005ba85c37ccec55d0c4493e66fe775d3', // Coinbase 1
        '0x503828976d22510aad0201ac7ec88293211d23da', // Coinbase 2
        '0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740', // Coinbase 3
        '0x3cd751e6b0078be393132286c442345e5dc49699', // Coinbase 4
        '0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511', // Coinbase 5
      ],
    },
  },
  kraken: {
    name: 'Kraken',
    addresses: {
      ethereum: [
        '0x2910543af39aba0cd09dbb2d50200b3e800a63d2', // Kraken 1
        '0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13', // Kraken 2
        '0xe853c56864a2ebe4576a807d26fdc4a0ada51919', // Kraken 3
        '0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0', // Kraken 4
      ],
    },
  },
  okx: {
    name: 'OKX',
    addresses: {
      ethereum: [
        '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b', // OKX 1
        '0x236f9f97e0e62388479bf9e5ba4889e46b0273c3', // OKX 2
        '0xa7efae728d2936e78bda97dc267687568dd593f3', // OKX 3
      ],
    },
  },
  bybit: {
    name: 'Bybit',
    addresses: {
      ethereum: [
        '0xf89d7b9c864f589bbf53a82105107622b35eaa40', // Bybit 1
        '0x1db92e2eebc8e0c075a02bea49a2935bcd2dfcf4', // Bybit 2
      ],
    },
  },
  kucoin: {
    name: 'KuCoin',
    addresses: {
      ethereum: [
        '0x2b5634c42055806a59e9107ed44d43c426e58258', // KuCoin 1
        '0x689c56aef474df92d44a1b70850f808488f9769c', // KuCoin 2
        '0xa1d8d972560c2f8144af871db508f0b0b10a3fbf', // KuCoin 3
      ],
    },
  },
  gate: {
    name: 'Gate.io',
    addresses: {
      ethereum: [
        '0x0d0707963952f2fba59dd06f2b425ace40b492fe', // Gate 1
        '0x1c4b70a3968436b9a0a9cf5205c787eb81bb558c', // Gate 2
      ],
    },
  },
};

// Build flat list of CEX addresses per network
function getCexAddresses(network: string): Set<string> {
  const addresses = new Set<string>();
  for (const cex of Object.values(CEX_ADDRESSES)) {
    const networkAddrs = cex.addresses[network] || [];
    networkAddrs.forEach(addr => addresses.add(addr.toLowerCase()));
  }
  return addresses;
}

// ============================================
// HELPERS
// ============================================

function getWindowDate(window: string): Date {
  const now = new Date();
  const hours: Record<string, number> = {
    '1h': 1,
    '4h': 4,
    '24h': 24,
    '7d': 24 * 7,
    '30d': 24 * 30,
  };
  return new Date(now.getTime() - (hours[window] || 24) * 60 * 60 * 1000);
}

function calculatePressure(inflow: number, outflow: number): {
  pressure: number;
  signal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
} {
  const total = inflow + outflow;
  if (total === 0) {
    return { pressure: 0, signal: 'NEUTRAL' };
  }
  
  // Pressure = (IN - OUT) / (IN + OUT)
  // Positive = deposits > withdrawals = SELL pressure
  // Negative = withdrawals > deposits = BUY pressure
  const pressure = (inflow - outflow) / total;
  
  let signal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  if (pressure <= -0.5) signal = 'STRONG_BUY';
  else if (pressure <= -0.2) signal = 'BUY';
  else if (pressure >= 0.5) signal = 'STRONG_SELL';
  else if (pressure >= 0.2) signal = 'SELL';
  else signal = 'NEUTRAL';
  
  return { pressure, signal };
}

// ============================================
// EXCHANGE PRESSURE MODEL
// ============================================

interface IExchangePressure {
  network: string;
  exchange: string;
  window: string;
  timestamp: Date;
  inflow: number;      // Deposits to CEX
  outflow: number;     // Withdrawals from CEX
  inflowTxCount: number;
  outflowTxCount: number;
  pressure: number;
  signal: string;
}

const ExchangePressureSchema = new mongoose.Schema<IExchangePressure>({
  network: { type: String, required: true, index: true },
  exchange: { type: String, required: true, index: true },
  window: { type: String, required: true },
  timestamp: { type: Date, required: true, index: true },
  inflow: { type: Number, default: 0 },
  outflow: { type: Number, default: 0 },
  inflowTxCount: { type: Number, default: 0 },
  outflowTxCount: { type: Number, default: 0 },
  pressure: { type: Number, default: 0 },
  signal: { type: String, enum: ['STRONG_BUY', 'BUY', 'NEUTRAL', 'SELL', 'STRONG_SELL'], default: 'NEUTRAL' },
}, {
  timestamps: true,
  collection: 'exchange_pressure',
});

ExchangePressureSchema.index({ network: 1, exchange: 1, window: 1, timestamp: -1 });

const ExchangePressureModel = mongoose.models.ExchangePressure || 
  mongoose.model<IExchangePressure>('ExchangePressure', ExchangePressureSchema);

// ============================================
// ROUTES
// ============================================

export async function exchangePressureRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/market/exchange-pressure - Get exchange pressure signal (network REQUIRED)
   */
  app.get('/exchange-pressure', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: `Network parameter is required. Supported: ${SUPPORTED_NETWORKS.join(', ')}`,
      });
    }
    
    let network: string;
    try {
      network = normalizeNetwork(query.network);
    } catch (e) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_INVALID',
        message: `Invalid network.`,
      });
    }
    
    const window = query.window || '24h';
    const since = getWindowDate(window);
    const cexAddresses = getCexAddresses(network);
    
    if (cexAddresses.size === 0) {
      return {
        ok: true,
        data: {
          network,
          window,
          message: 'No CEX addresses configured for this network',
          exchanges: [],
          aggregate: { pressure: 0, signal: 'NEUTRAL' },
        },
      };
    }
    
    // Aggregate flows per exchange
    const exchangeResults: Array<{
      exchange: string;
      inflow: number;
      outflow: number;
      inflowTxCount: number;
      outflowTxCount: number;
      pressure: number;
      signal: string;
    }> = [];
    
    let totalInflow = 0;
    let totalOutflow = 0;
    
    for (const [exchangeKey, cexConfig] of Object.entries(CEX_ADDRESSES)) {
      const addresses = cexConfig.addresses[network] || [];
      if (addresses.length === 0) continue;
      
      const lowerAddresses = addresses.map(a => a.toLowerCase());
      
      // Count inflows (transfers TO CEX)
      const inflowPipeline = [
        {
          $match: {
            chain: network,
            timestamp: { $gte: since },
            to: { $in: lowerAddresses },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
          },
        },
      ];
      
      // Count outflows (transfers FROM CEX)
      const outflowPipeline = [
        {
          $match: {
            chain: network,
            timestamp: { $gte: since },
            from: { $in: lowerAddresses },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
          },
        },
      ];
      
      const [inflowResult, outflowResult] = await Promise.all([
        TransferModel.aggregate(inflowPipeline),
        TransferModel.aggregate(outflowPipeline),
      ]);
      
      const inflow = inflowResult[0]?.count || 0;
      const outflow = outflowResult[0]?.count || 0;
      
      totalInflow += inflow;
      totalOutflow += outflow;
      
      const { pressure, signal } = calculatePressure(inflow, outflow);
      
      exchangeResults.push({
        exchange: cexConfig.name,
        inflow,
        outflow,
        inflowTxCount: inflow,
        outflowTxCount: outflow,
        pressure: Math.round(pressure * 100) / 100,
        signal,
      });
    }
    
    // Calculate aggregate pressure
    const { pressure: aggPressure, signal: aggSignal } = calculatePressure(totalInflow, totalOutflow);
    
    // Sort by volume
    exchangeResults.sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow));
    
    return {
      ok: true,
      data: {
        network,
        window,
        since: since.toISOString(),
        exchanges: exchangeResults,
        aggregate: {
          totalInflow,
          totalOutflow,
          netFlow: totalInflow - totalOutflow,
          pressure: Math.round(aggPressure * 100) / 100,
          signal: aggSignal,
        },
      },
    };
  });
  
  /**
   * GET /api/market/exchange-pressure/history - Historical pressure data
   */
  app.get('/exchange-pressure/history', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: `Network parameter is required.`,
      });
    }
    
    let network: string;
    try {
      network = normalizeNetwork(query.network);
    } catch (e) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_INVALID',
        message: `Invalid network.`,
      });
    }
    
    const window = query.window || '24h';
    const limit = Math.min(parseInt(query.limit || '24', 10), 168); // Max 7 days hourly
    
    const history = await ExchangePressureModel
      .find({ network, window })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    
    return {
      ok: true,
      data: {
        network,
        window,
        history: history.map(h => ({
          exchange: h.exchange,
          timestamp: h.timestamp,
          inflow: h.inflow,
          outflow: h.outflow,
          pressure: h.pressure,
          signal: h.signal,
        })),
      },
    };
  });
  
  /**
   * GET /api/market/cex-addresses - List known CEX addresses
   */
  app.get('/cex-addresses', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const network = query.network ? normalizeNetwork(query.network) : null;
    
    const result: Array<{ exchange: string; name: string; addresses: string[] }> = [];
    
    for (const [key, cex] of Object.entries(CEX_ADDRESSES)) {
      const addresses = network 
        ? (cex.addresses[network] || [])
        : Object.values(cex.addresses).flat();
      
      if (addresses.length > 0) {
        result.push({
          exchange: key,
          name: cex.name,
          addresses,
        });
      }
    }
    
    return {
      ok: true,
      data: {
        network: network || 'all',
        exchanges: result,
        totalAddresses: result.reduce((sum, ex) => sum + ex.addresses.length, 0),
      },
    };
  });
  
  app.log.info('[P1.3] Exchange Pressure routes registered');
}

export default exchangePressureRoutes;
export { ExchangePressureModel, CEX_ADDRESSES, getCexAddresses };
