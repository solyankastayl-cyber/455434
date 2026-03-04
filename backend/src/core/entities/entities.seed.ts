/**
 * Entities Seed Service
 * 
 * Загружает seed dataset в MongoDB
 */
import { EntityModel } from './entities.model.js';
import { EntityAddressModel } from './entity_address.model.js';
import seedData from './entities_seed.json' with { type: 'json' };

export async function seedEntities() {
  try {
    // Check if already seeded
    const existingCount = await EntityModel.countDocuments();
    if (existingCount > 0) {
      console.log('[Entities Seed] Already seeded, skipping');
      return { seeded: false, count: existingCount };
    }

    console.log('[Entities Seed] Starting seed...');
    
    let seededCount = 0;
    let addressCount = 0;

    for (const entityData of seedData) {
      // Create entity
      const entity = await EntityModel.create({
        ...entityData,
        addressesCount: entityData.primaryAddresses?.length || 0,
        coverage: 75, // Default coverage for seed entities
        status: 'live',
        firstSeen: new Date(),
        lastSeen: new Date(),
      });

      seededCount++;

      // Create entity addresses
      if (entityData.primaryAddresses && entityData.primaryAddresses.length > 0) {
        for (const address of entityData.primaryAddresses) {
          await EntityAddressModel.create({
            entityId: entity._id.toString(),
            chain: 'ethereum', // Default to Ethereum for seed
            address: address.toLowerCase(),
            role: 'hot', // Default role
            labelConfidence: entityData.attribution?.confidence || 80,
            firstSeen: new Date(),
            lastSeen: new Date(),
          });
          addressCount++;
        }
      }
    }

    console.log(`[Entities Seed] ✅ Seeded ${seededCount} entities with ${addressCount} addresses`);
    return { seeded: true, count: seededCount, addresses: addressCount };
  } catch (error) {
    console.error('[Entities Seed] Error:', error);
    throw error;
  }
}

/**
 * Update entity metrics (to be called periodically)
 */
export async function updateEntityMetrics(entityId: string) {
  // TODO: Calculate real metrics from on-chain data
  // For now, just update timestamps
  await EntityModel.findByIdAndUpdate(entityId, {
    lastSeen: new Date(),
    updatedAt: new Date(),
  });
}
