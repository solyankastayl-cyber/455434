/**
 * Engine V2: Subject Resolver Wrapper
 * 
 * Converts actorSlug/tokenAddress → normalized primary.id
 */
import { ActorModel } from '../actors/actor.model.js';
import { EntityModel } from '../entities/entities.model.js';

export interface ResolvedSubject {
  type: 'actor' | 'entity';
  normalizedId: string;
  ref: string;
  confidence: number;
  name?: string;
}

/**
 * Resolve actor slug to actorId
 */
export async function resolveActorSlug(slug: string): Promise<ResolvedSubject | null> {
  if (!slug) return null;
  
  const normalizedSlug = slug.toLowerCase().trim();
  
  // Try exact id match first
  let actor = await ActorModel.findOne({ id: normalizedSlug }).lean();
  
  // Try name match if not found
  if (!actor) {
    actor = await ActorModel.findOne({ 
      name: { $regex: new RegExp(`^${normalizedSlug}$`, 'i') }
    }).lean();
  }
  
  if (!actor) return null;
  
  return {
    type: 'actor',
    normalizedId: actor.id,
    ref: slug,
    confidence: 1.0,
    name: actor.name,
  };
}

/**
 * Resolve token address to entityId
 */
export async function resolveTokenAddress(address: string): Promise<ResolvedSubject | null> {
  if (!address) return null;
  
  const normalizedAddr = address.toLowerCase().trim();
  
  // Try finding entity by primary addresses
  const entity = await EntityModel.findOne({
    primaryAddresses: normalizedAddr,
  }).lean();
  
  if (!entity) {
    // Return as raw address (no entity mapping)
    return {
      type: 'entity',
      normalizedId: normalizedAddr,
      ref: address,
      confidence: 0.5,
    };
  }
  
  return {
    type: 'entity',
    normalizedId: entity.slug,
    ref: address,
    confidence: 1.0,
    name: entity.name,
  };
}

/**
 * Universal subject resolver
 */
export async function resolveSubject(input: string, inputType?: 'actor' | 'asset'): Promise<ResolvedSubject | null> {
  if (!input) return null;
  
  const cleaned = input.trim();
  
  // If explicit type given
  if (inputType === 'actor') {
    return resolveActorSlug(cleaned);
  }
  if (inputType === 'asset') {
    return resolveTokenAddress(cleaned);
  }
  
  // Auto-detect: if starts with 0x and is 42 chars, it's an address
  if (/^0x[a-f0-9]{40}$/i.test(cleaned)) {
    return resolveTokenAddress(cleaned);
  }
  
  // Otherwise try as actor slug
  return resolveActorSlug(cleaned);
}
