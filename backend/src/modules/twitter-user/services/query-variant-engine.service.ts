/**
 * Phase 7.3.2 — Query Variant Engine
 * 
 * Diversifies queries to reduce rate-limit and shadow-ban risk.
 * Rotates between different query formats for the same target.
 * 
 * НЕ ЛОМАЕТ CORE — только генерация вариантов запроса.
 */

export type QuerySort = 'latest' | 'top';
export type QueryLang = 'en' | 'all';
export type SinceWindow = '1h' | '6h' | '24h' | 'none';

export interface QueryVariant {
  id: string;
  query: string;
  sort: QuerySort;
  lang: QueryLang;
  sinceWindow: SinceWindow;
  includeReplies: boolean;
  weight: number;  // Higher = more likely to be selected
  safetyLevel: 'aggressive' | 'normal' | 'safe';
}

export interface TargetContext {
  type: 'KEYWORD' | 'ACCOUNT';
  value: string;           // keyword or username
  runCount: number;        // how many times this target has been run
  qualityStatus: 'HEALTHY' | 'DEGRADED' | 'UNSTABLE';
  lastVariantId?: string;  // last used variant
}

// Variant templates for keywords
const KEYWORD_VARIANTS: Omit<QueryVariant, 'id' | 'query'>[] = [
  // Base variants
  { sort: 'latest', lang: 'en', sinceWindow: 'none', includeReplies: false, weight: 10, safetyLevel: 'normal' },
  { sort: 'top', lang: 'en', sinceWindow: 'none', includeReplies: false, weight: 8, safetyLevel: 'normal' },
  { sort: 'latest', lang: 'all', sinceWindow: 'none', includeReplies: false, weight: 7, safetyLevel: 'normal' },
  
  // Time-windowed variants
  { sort: 'latest', lang: 'en', sinceWindow: '6h', includeReplies: false, weight: 6, safetyLevel: 'safe' },
  { sort: 'latest', lang: 'en', sinceWindow: '24h', includeReplies: false, weight: 5, safetyLevel: 'safe' },
  
  // With replies (aggressive)
  { sort: 'latest', lang: 'en', sinceWindow: 'none', includeReplies: true, weight: 4, safetyLevel: 'aggressive' },
];

// Variant templates for accounts
const ACCOUNT_VARIANTS: Omit<QueryVariant, 'id' | 'query'>[] = [
  // Base
  { sort: 'latest', lang: 'all', sinceWindow: 'none', includeReplies: false, weight: 10, safetyLevel: 'normal' },
  
  // Without replies (cleaner)
  { sort: 'latest', lang: 'all', sinceWindow: 'none', includeReplies: false, weight: 8, safetyLevel: 'safe' },
  
  // Time-windowed
  { sort: 'latest', lang: 'all', sinceWindow: '6h', includeReplies: false, weight: 6, safetyLevel: 'safe' },
  { sort: 'latest', lang: 'all', sinceWindow: '24h', includeReplies: false, weight: 5, safetyLevel: 'safe' },
];

export class QueryVariantEngine {
  
  /**
   * Generate all variants for a target
   */
  static generateVariants(context: TargetContext): QueryVariant[] {
    const { type, value, qualityStatus } = context;
    
    if (type === 'KEYWORD') {
      return this.generateKeywordVariants(value, qualityStatus);
    } else {
      return this.generateAccountVariants(value, qualityStatus);
    }
  }
  
  /**
   * Select the best variant for this run
   * Uses rotation + quality-aware selection
   */
  static selectVariant(context: TargetContext): QueryVariant {
    const variants = this.generateVariants(context);
    
    // Filter by quality status
    const allowedVariants = this.filterByQualityStatus(variants, context.qualityStatus);
    
    if (allowedVariants.length === 0) {
      // Fallback to safest variant
      return variants.find(v => v.safetyLevel === 'safe') || variants[0];
    }
    
    // Rotation: use runCount to cycle through variants
    const index = context.runCount % allowedVariants.length;
    
    // Avoid same variant twice in a row
    const selected = allowedVariants[index];
    if (selected.id === context.lastVariantId && allowedVariants.length > 1) {
      return allowedVariants[(index + 1) % allowedVariants.length];
    }
    
    return selected;
  }
  
  /**
   * Generate keyword query variants
   */
  private static generateKeywordVariants(
    keyword: string,
    qualityStatus: string
  ): QueryVariant[] {
    const baseKeyword = keyword.trim();
    const queryFormats = this.getKeywordQueryFormats(baseKeyword);
    
    const variants: QueryVariant[] = [];
    
    for (let i = 0; i < queryFormats.length; i++) {
      const queryFormat = queryFormats[i];
      
      for (let j = 0; j < KEYWORD_VARIANTS.length; j++) {
        const template = KEYWORD_VARIANTS[j];
        
        // Build final query
        let query = queryFormat;
        
        // Add lang filter if not 'all'
        if (template.lang === 'en') {
          query += ' lang:en';
        }
        
        // Add exclude replies if needed
        if (!template.includeReplies) {
          query += ' -filter:replies';
        }
        
        variants.push({
          id: `kw_${i}_${j}`,
          query,
          sort: template.sort,
          lang: template.lang,
          sinceWindow: template.sinceWindow,
          includeReplies: template.includeReplies,
          weight: template.weight - (i * 2), // Lower weight for alternative formats
          safetyLevel: template.safetyLevel,
        });
      }
    }
    
    return variants;
  }
  
  /**
   * Get different query formats for a keyword
   */
  private static getKeywordQueryFormats(keyword: string): string[] {
    const formats: string[] = [
      keyword, // Base
    ];
    
    // Add hashtag variant if not already a hashtag
    if (!keyword.startsWith('#')) {
      formats.push(`#${keyword}`);
    }
    
    // Add OR variant for common synonyms
    const synonyms = this.getCommonSynonyms(keyword);
    if (synonyms.length > 0) {
      formats.push(`${keyword} OR ${synonyms[0]}`);
    }
    
    // Add exclusion of common spam patterns
    formats.push(`${keyword} -giveaway -airdrop`);
    
    return formats;
  }
  
  /**
   * Get common synonyms for popular keywords
   */
  private static getCommonSynonyms(keyword: string): string[] {
    const synonymMap: Record<string, string[]> = {
      'bitcoin': ['btc', '$btc'],
      'ethereum': ['eth', '$eth'],
      'crypto': ['cryptocurrency', 'blockchain'],
      'ai': ['artificial intelligence', 'machine learning'],
      'trump': ['donald trump', '@realdonaldtrump'],
      'biden': ['joe biden', 'potus'],
      'stocks': ['stock market', 'trading'],
    };
    
    return synonymMap[keyword.toLowerCase()] || [];
  }
  
  /**
   * Generate account query variants
   */
  private static generateAccountVariants(
    username: string,
    qualityStatus: string
  ): QueryVariant[] {
    const cleanUsername = username.replace('@', '');
    
    const variants: QueryVariant[] = [];
    
    for (let i = 0; i < ACCOUNT_VARIANTS.length; i++) {
      const template = ACCOUNT_VARIANTS[i];
      
      // Base query: from:username
      let query = `from:${cleanUsername}`;
      
      // Alternative: (from:username)
      const altQuery = `(from:${cleanUsername})`;
      
      // Exclude replies if needed
      if (!template.includeReplies) {
        query += ' -is:reply';
      }
      
      variants.push({
        id: `acc_${i}`,
        query,
        sort: template.sort,
        lang: template.lang,
        sinceWindow: template.sinceWindow,
        includeReplies: template.includeReplies,
        weight: template.weight,
        safetyLevel: template.safetyLevel,
      });
    }
    
    return variants;
  }
  
  /**
   * Filter variants by quality status
   * UNSTABLE → only safe variants
   * DEGRADED → safe + normal variants
   * HEALTHY → all variants
   */
  private static filterByQualityStatus(
    variants: QueryVariant[],
    status: string
  ): QueryVariant[] {
    switch (status) {
      case 'UNSTABLE':
        return variants.filter(v => v.safetyLevel === 'safe');
        
      case 'DEGRADED':
        return variants.filter(v => v.safetyLevel !== 'aggressive');
        
      case 'HEALTHY':
      default:
        return variants;
    }
  }
  
  /**
   * Build Twitter API compatible query params
   */
  static buildQueryParams(variant: QueryVariant): {
    q: string;
    result_type?: string;
    count?: number;
  } {
    return {
      q: variant.query,
      result_type: variant.sort === 'top' ? 'popular' : 'recent',
    };
  }
  
  /**
   * Get human-readable description of variant
   */
  static describeVariant(variant: QueryVariant): string {
    const parts: string[] = [
      `Query: "${variant.query}"`,
      `Sort: ${variant.sort}`,
    ];
    
    if (variant.sinceWindow !== 'none') {
      parts.push(`Since: ${variant.sinceWindow}`);
    }
    
    if (!variant.includeReplies) {
      parts.push('No replies');
    }
    
    parts.push(`Safety: ${variant.safetyLevel}`);
    
    return parts.join(' | ');
  }
}

export const queryVariantEngine = new QueryVariantEngine();
