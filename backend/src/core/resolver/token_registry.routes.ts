/**
 * Token Registry Routes (P2.5 + User Architecture Refactor)
 * 
 * NEW ARCHITECTURE:
 * - GET /api/tokens/suggest?q={query} - Autocomplete search
 * - POST /api/tokens/resolve - Resolve symbol/address to canonical token
 * - Canonical URL: /token/:chainId/:address
 * - Alias URL: /token/:symbol → redirects to canonical
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { TokenRegistryModel } from './token_registry.model.js';
import { 
  resolveToken, 
  resolveTokens, 
  formatToken,
  getTokenRegistryStats,
  seedTokenRegistry,
  KNOWN_TOKENS
} from './token.resolver.js';

// Chain ID mapping
const CHAIN_ID_MAP: Record<string, number> = {
  'ethereum': 1,
  'arbitrum': 42161,
  'polygon': 137,
  'base': 8453,
  'optimism': 10,
  'avalanche': 43114,
  'bsc': 56,
};

const CHAIN_NAME_MAP: Record<number, string> = {
  1: 'ethereum',
  42161: 'arbitrum',
  137: 'polygon',
  8453: 'base',
  10: 'optimism',
  43114: 'avalanche',
  56: 'bsc',
};

export async function tokenRegistryRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/tokens/suggest
   * Autocomplete search for tokens
   * 
   * Query: q (required) - search query (min 1 char)
   * Returns: Array of matching tokens for autocomplete dropdown
   */
  app.get('/tokens/suggest', async (request: FastifyRequest) => {
    const { q, limit = '10' } = request.query as { q?: string; limit?: string };
    
    if (!q || q.length < 1) {
      return {
        ok: true,
        data: [],
        message: 'Query too short',
      };
    }
    
    const searchQuery = q.trim();
    const limitNum = Math.min(parseInt(limit) || 10, 20);
    
    // Search by symbol (exact match first) then by name
    const tokens = await TokenRegistryModel.find({
      $or: [
        { symbol: { $regex: `^${searchQuery}`, $options: 'i' } }, // Starts with (priority)
        { symbol: { $regex: searchQuery, $options: 'i' } },
        { name: { $regex: searchQuery, $options: 'i' } },
      ],
    })
      .sort({ verified: -1, symbol: 1 }) // Verified first, then alphabetical
      .limit(limitNum)
      .lean();
    
    return {
      ok: true,
      data: tokens.map((t: any) => ({
        address: t.address,
        chainId: CHAIN_ID_MAP[t.chain] || 1,
        chain: t.chain,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        verified: t.verified,
        logo: t.logo,
        // Canonical URL for navigation
        canonicalUrl: `/token/${CHAIN_ID_MAP[t.chain] || 1}/${t.address}`,
      })),
      count: tokens.length,
    };
  });
  
  /**
   * POST /api/tokens/resolve
   * Resolve token symbol or address to canonical token(s)
   * 
   * Body:
   *   - input: string (symbol like "UNI" or address like "0x...")
   *   - chainId?: number (optional, to disambiguate multi-chain tokens)
   * 
   * Returns:
   *   - status: 'found' | 'multiple' | 'not_found'
   *   - token?: Single resolved token (if status === 'found')
   *   - tokens?: Array of matching tokens (if status === 'multiple')
   *   - canonicalUrl?: Redirect URL (if status === 'found')
   */
  app.post('/tokens/resolve', async (request: FastifyRequest) => {
    const { input, chainId } = request.body as { input?: string; chainId?: number };
    
    if (!input || input.trim().length === 0) {
      return {
        ok: false,
        error: 'MISSING_INPUT',
        message: 'Input is required (symbol or address)',
      };
    }
    
    const cleanInput = input.trim();
    
    // Case 1: Input is an Ethereum address (0x...)
    if (/^0x[a-f0-9]{40}$/i.test(cleanInput)) {
      const address = cleanInput.toLowerCase();
      
      // If chainId provided, search specific chain
      if (chainId) {
        const chainName = CHAIN_NAME_MAP[chainId];
        if (!chainName) {
          return {
            ok: false,
            error: 'INVALID_CHAIN',
            message: `Unsupported chainId: ${chainId}`,
          };
        }
        
        const token = await TokenRegistryModel.findOne({ 
          address, 
          chain: chainName 
        }).lean();
        
        if (token) {
          const t = token as any;
          return {
            ok: true,
            status: 'found',
            token: {
              address: t.address,
              chainId: CHAIN_ID_MAP[t.chain] || 1,
              chain: t.chain,
              symbol: t.symbol,
              name: t.name,
              decimals: t.decimals,
              verified: t.verified,
            },
            canonicalUrl: `/token/${chainId}/${t.address}`,
          };
        }
      }
      
      // Search all chains for this address
      const tokens = await TokenRegistryModel.find({ address }).lean();
      
      if (tokens.length === 0) {
        return {
          ok: true,
          status: 'not_found',
          message: `Token with address ${address} not found in registry`,
          input: cleanInput,
        };
      }
      
      if (tokens.length === 1) {
        const t = tokens[0] as any;
        return {
          ok: true,
          status: 'found',
          token: {
            address: t.address,
            chainId: CHAIN_ID_MAP[t.chain] || 1,
            chain: t.chain,
            symbol: t.symbol,
            name: t.name,
            decimals: t.decimals,
            verified: t.verified,
          },
          canonicalUrl: `/token/${CHAIN_ID_MAP[t.chain] || 1}/${t.address}`,
        };
      }
      
      // Multiple chains have this address (unlikely but possible)
      return {
        ok: true,
        status: 'multiple',
        message: 'Token exists on multiple chains. Please select a network.',
        tokens: tokens.map((t: any) => ({
          address: t.address,
          chainId: CHAIN_ID_MAP[t.chain] || 1,
          chain: t.chain,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          verified: t.verified,
          canonicalUrl: `/token/${CHAIN_ID_MAP[t.chain] || 1}/${t.address}`,
        })),
      };
    }
    
    // Case 2: Input is a symbol (e.g., "UNI", "USDT")
    const symbol = cleanInput.toUpperCase();
    
    // Build query
    const query: any = { 
      symbol: { $regex: `^${symbol}$`, $options: 'i' } 
    };
    
    if (chainId) {
      const chainName = CHAIN_NAME_MAP[chainId];
      if (chainName) {
        query.chain = chainName;
      }
    }
    
    const tokens = await TokenRegistryModel.find(query)
      .sort({ verified: -1, chain: 1 })
      .lean();
    
    if (tokens.length === 0) {
      return {
        ok: true,
        status: 'not_found',
        message: `Token "${symbol}" not found in registry. Only ERC20 tokens are supported.`,
        input: cleanInput,
        suggestions: [
          'Check the token symbol spelling',
          'This token may not be in our registry yet',
          'BTC, SOL, and other non-EVM tokens are not supported',
        ],
      };
    }
    
    if (tokens.length === 1) {
      const t = tokens[0] as any;
      return {
        ok: true,
        status: 'found',
        token: {
          address: t.address,
          chainId: CHAIN_ID_MAP[t.chain] || 1,
          chain: t.chain,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          verified: t.verified,
        },
        canonicalUrl: `/token/${CHAIN_ID_MAP[t.chain] || 1}/${t.address}`,
      };
    }
    
    // Multiple tokens with same symbol (multi-chain disambiguation)
    return {
      ok: true,
      status: 'multiple',
      message: `"${symbol}" exists on multiple networks. Please select one.`,
      tokens: tokens.map((t: any) => ({
        address: t.address,
        chainId: CHAIN_ID_MAP[t.chain] || 1,
        chain: t.chain,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        verified: t.verified,
        canonicalUrl: `/token/${CHAIN_ID_MAP[t.chain] || 1}/${t.address}`,
      })),
    };
  });
  
  /**
   * GET /api/tokens/by-canonical/:chainId/:address
   * Get token by canonical identifier (chainId + address)
   * This is the primary endpoint for the token detail page
   */
  app.get('/tokens/by-canonical/:chainId/:address', async (request: FastifyRequest) => {
    const { chainId, address } = request.params as { chainId: string; address: string };
    
    const chainIdNum = parseInt(chainId);
    const chainName = CHAIN_NAME_MAP[chainIdNum];
    
    if (!chainName) {
      return {
        ok: false,
        error: 'INVALID_CHAIN',
        message: `Unsupported chainId: ${chainId}`,
      };
    }
    
    const normalizedAddress = address.toLowerCase();
    
    const token = await TokenRegistryModel.findOne({ 
      address: normalizedAddress, 
      chain: chainName 
    }).lean();
    
    if (!token) {
      return {
        ok: true,
        status: 'not_found',
        message: `Token not found: ${chainName}/${normalizedAddress}`,
        chainId: chainIdNum,
        address: normalizedAddress,
      };
    }
    
    const t = token as any;
    return {
      ok: true,
      status: 'found',
      token: {
        address: t.address,
        chainId: chainIdNum,
        chain: t.chain,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        verified: t.verified,
        logo: t.logo,
        coingeckoId: t.coingeckoId,
      },
    };
  });

  /**
   * GET /api/tokens/resolve/:address (LEGACY - kept for backwards compatibility)
   * Resolve single token address to symbol/metadata
   */
  app.get('/tokens/resolve/:address', async (request: FastifyRequest) => {
    const { address } = request.params as { address: string };
    const { chain = 'ethereum' } = request.query as { chain?: string };
    
    const info = await resolveToken(address, chain);
    
    return {
      ok: true,
      data: {
        ...info,
        formatted: formatToken(info),
      },
    };
  });
  
  /**
   * POST /api/tokens/resolve/batch
   * Resolve multiple tokens at once
   */
  app.post('/tokens/resolve/batch', async (request: FastifyRequest) => {
    const { addresses, chain = 'ethereum' } = request.body as { 
      addresses: string[]; 
      chain?: string; 
    };
    
    if (!addresses || !Array.isArray(addresses)) {
      return {
        ok: false,
        error: 'INVALID_BODY',
        message: 'Body must contain "addresses" array',
      };
    }
    
    if (addresses.length > 100) {
      return {
        ok: false,
        error: 'TOO_MANY_ADDRESSES',
        message: 'Maximum 100 addresses per batch',
      };
    }
    
    const resolved = await resolveTokens(addresses, chain);
    
    // Convert Map to object
    const result: Record<string, any> = {};
    for (const [addr, info] of resolved) {
      result[addr] = {
        ...info,
        formatted: formatToken(info),
      };
    }
    
    return {
      ok: true,
      data: result,
      count: Object.keys(result).length,
    };
  });
  
  /**
   * GET /api/tokens/registry/stats
   * Get token registry statistics
   */
  app.get('/tokens/registry/stats', async () => {
    const stats = await getTokenRegistryStats();
    
    return {
      ok: true,
      data: stats,
    };
  });
  
  /**
   * GET /api/tokens/registry/search
   * Search tokens by symbol or name
   */
  app.get('/tokens/registry/search', async (request: FastifyRequest) => {
    const { q, chain, limit = '20' } = request.query as { 
      q?: string; 
      chain?: string;
      limit?: string;
    };
    
    if (!q || q.length < 1) {
      return {
        ok: false,
        error: 'MISSING_QUERY',
        message: 'Query parameter "q" is required',
      };
    }
    
    const filter: any = {
      $or: [
        { symbol: { $regex: q, $options: 'i' } },
        { name: { $regex: q, $options: 'i' } },
      ],
    };
    
    if (chain) {
      filter.chain = chain;
    }
    
    const tokens = await TokenRegistryModel.find(filter)
      .limit(parseInt(limit))
      .lean();
    
    return {
      ok: true,
      data: tokens.map((t: any) => ({
        address: t.address,
        chain: t.chain,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        verified: t.verified,
      })),
      count: tokens.length,
    };
  });
  
  /**
   * POST /api/tokens/registry/seed
   * Seed known tokens (admin endpoint)
   */
  app.post('/tokens/registry/seed', async () => {
    const seeded = await seedTokenRegistry();
    
    return {
      ok: true,
      data: { seeded },
    };
  });
  
  /**
   * POST /api/tokens/registry/add
   * Add new token to registry (admin endpoint)
   */
  app.post('/tokens/registry/add', async (request: FastifyRequest) => {
    const body = request.body as {
      address: string;
      chain?: string;
      symbol: string;
      name: string;
      decimals?: number;
      verified?: boolean;
    };
    
    if (!body.address || !body.symbol || !body.name) {
      return {
        ok: false,
        error: 'MISSING_FIELDS',
        message: 'Required: address, symbol, name',
      };
    }
    
    const token = await TokenRegistryModel.findOneAndUpdate(
      { address: body.address.toLowerCase(), chain: body.chain || 'ethereum' },
      {
        address: body.address.toLowerCase(),
        chain: body.chain || 'ethereum',
        symbol: body.symbol,
        name: body.name,
        decimals: body.decimals || 18,
        verified: body.verified || false,
        source: 'manual',
        lastUpdated: new Date(),
      },
      { upsert: true, new: true }
    );
    
    return {
      ok: true,
      data: {
        address: (token as any).address,
        symbol: (token as any).symbol,
        name: (token as any).name,
      },
    };
  });
  
  app.log.info('Token Registry routes registered (P2.5)');
}
