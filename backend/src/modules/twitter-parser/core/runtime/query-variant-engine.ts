/**
 * Twitter Parser Module — Query Variant Engine
 * 
 * Diversifies queries to reduce rate-limit risk.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY variant templates or selection logic
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
  weight: number;
  safetyLevel: 'aggressive' | 'normal' | 'safe';
}

export interface TargetContext {
  type: 'KEYWORD' | 'ACCOUNT';
  value: string;
  runCount: number;
  qualityStatus: 'HEALTHY' | 'DEGRADED' | 'UNSTABLE';
  lastVariantId?: string;
}

// Variant templates - FROZEN
const KEYWORD_VARIANTS: Omit<QueryVariant, 'id' | 'query'>[] = [
  { sort: 'latest', lang: 'en', sinceWindow: 'none', includeReplies: false, weight: 10, safetyLevel: 'normal' },
  { sort: 'top', lang: 'en', sinceWindow: 'none', includeReplies: false, weight: 8, safetyLevel: 'normal' },
  { sort: 'latest', lang: 'all', sinceWindow: 'none', includeReplies: false, weight: 7, safetyLevel: 'normal' },
  { sort: 'latest', lang: 'en', sinceWindow: '6h', includeReplies: false, weight: 6, safetyLevel: 'safe' },
  { sort: 'latest', lang: 'en', sinceWindow: '24h', includeReplies: false, weight: 5, safetyLevel: 'safe' },
  { sort: 'latest', lang: 'en', sinceWindow: 'none', includeReplies: true, weight: 4, safetyLevel: 'aggressive' },
];

const ACCOUNT_VARIANTS: Omit<QueryVariant, 'id' | 'query'>[] = [
  { sort: 'latest', lang: 'all', sinceWindow: 'none', includeReplies: false, weight: 10, safetyLevel: 'normal' },
  { sort: 'latest', lang: 'all', sinceWindow: 'none', includeReplies: false, weight: 8, safetyLevel: 'safe' },
  { sort: 'latest', lang: 'all', sinceWindow: '6h', includeReplies: false, weight: 6, safetyLevel: 'safe' },
  { sort: 'latest', lang: 'all', sinceWindow: '24h', includeReplies: false, weight: 5, safetyLevel: 'safe' },
];

// Synonym map - FROZEN
const SYNONYM_MAP: Record<string, string[]> = {
  'bitcoin': ['btc', '$btc'],
  'ethereum': ['eth', '$eth'],
  'crypto': ['cryptocurrency', 'blockchain'],
  'ai': ['artificial intelligence', 'machine learning'],
  'trump': ['donald trump', '@realdonaldtrump'],
  'biden': ['joe biden', 'potus'],
  'stocks': ['stock market', 'trading'],
};

export class QueryVariantEngine {
  
  static generateVariants(context: TargetContext): QueryVariant[] {
    const { type, value, qualityStatus } = context;
    
    if (type === 'KEYWORD') {
      return this.generateKeywordVariants(value, qualityStatus);
    } else {
      return this.generateAccountVariants(value);
    }
  }
  
  static selectVariant(context: TargetContext): QueryVariant {
    const variants = this.generateVariants(context);
    const allowedVariants = this.filterByQualityStatus(variants, context.qualityStatus);
    
    if (allowedVariants.length === 0) {
      return variants.find(v => v.safetyLevel === 'safe') || variants[0];
    }
    
    const index = context.runCount % allowedVariants.length;
    const selected = allowedVariants[index];
    
    if (selected.id === context.lastVariantId && allowedVariants.length > 1) {
      return allowedVariants[(index + 1) % allowedVariants.length];
    }
    
    return selected;
  }
  
  private static generateKeywordVariants(keyword: string, qualityStatus: string): QueryVariant[] {
    const baseKeyword = keyword.trim();
    const queryFormats = this.getKeywordQueryFormats(baseKeyword);
    const variants: QueryVariant[] = [];
    
    for (let i = 0; i < queryFormats.length; i++) {
      const queryFormat = queryFormats[i];
      
      for (let j = 0; j < KEYWORD_VARIANTS.length; j++) {
        const template = KEYWORD_VARIANTS[j];
        let query = queryFormat;
        
        if (template.lang === 'en') {
          query += ' lang:en';
        }
        
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
          weight: template.weight - (i * 2),
          safetyLevel: template.safetyLevel,
        });
      }
    }
    
    return variants;
  }
  
  private static getKeywordQueryFormats(keyword: string): string[] {
    const formats: string[] = [keyword];
    
    if (!keyword.startsWith('#')) {
      formats.push(`#${keyword}`);
    }
    
    const synonyms = SYNONYM_MAP[keyword.toLowerCase()];
    if (synonyms && synonyms.length > 0) {
      formats.push(`${keyword} OR ${synonyms[0]}`);
    }
    
    formats.push(`${keyword} -giveaway -airdrop`);
    
    return formats;
  }
  
  private static generateAccountVariants(username: string): QueryVariant[] {
    const cleanUsername = username.replace('@', '');
    const variants: QueryVariant[] = [];
    
    for (let i = 0; i < ACCOUNT_VARIANTS.length; i++) {
      const template = ACCOUNT_VARIANTS[i];
      let query = `from:${cleanUsername}`;
      
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
  
  private static filterByQualityStatus(variants: QueryVariant[], status: string): QueryVariant[] {
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
  
  static buildQueryParams(variant: QueryVariant): { q: string; result_type?: string } {
    return {
      q: variant.query,
      result_type: variant.sort === 'top' ? 'popular' : 'recent',
    };
  }
  
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
