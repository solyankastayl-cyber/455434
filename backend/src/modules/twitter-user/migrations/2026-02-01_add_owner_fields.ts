// Migration: Add owner fields to existing data
import { UserTwitterAccountModel } from '../models/twitter-account.model.js';
import { UserTwitterSessionModel } from '../models/twitter-session.model.js';
import { TwitterTaskModel } from '../../twitter/execution/queue/task.model.js'; // Use existing model
import { UserTwitterParsedTweetModel } from '../models/twitter-parsed-tweet.model.js';

export async function migrateAddOwnerFields() {
  console.log('[Migration] Adding owner fields to existing documents...');

  // Mark old records as SYSTEM if missing ownerType
  const accountsResult = await UserTwitterAccountModel.updateMany(
    { ownerType: { $exists: false } },
    { $set: { ownerType: 'SYSTEM', enabled: true } }
  );
  console.log(`[Migration] Updated ${accountsResult.modifiedCount} accounts`);

  const sessionsResult = await UserTwitterSessionModel.updateMany(
    { ownerType: { $exists: false } },
    {
      $set: {
        ownerType: 'SYSTEM',
        status: 'STALE',
        staleReason: 'migrated-no-owner',
      },
    }
  );
  console.log(`[Migration] Updated ${sessionsResult.modifiedCount} sessions`);

  const tasksResult = await TwitterTaskModel.updateMany(
    { ownerType: { $exists: false } },
    { $set: { ownerType: 'SYSTEM', status: 'PENDING' } }
  );
  console.log(`[Migration] Updated ${tasksResult.modifiedCount} tasks`);

  const tweetsResult = await UserTwitterParsedTweetModel.updateMany(
    { ownerType: { $exists: false } },
    { $set: { ownerType: 'SYSTEM' } }
  );
  console.log(`[Migration] Updated ${tweetsResult.modifiedCount} parsed tweets`);

  console.log('[Migration] Complete!');
}
