// Account Service - resolve active account for user
import { UserTwitterAccountModel } from '../models/twitter-account.model.js';
import { UserTwitterSessionModel } from '../models/twitter-session.model.js';
import { userScope } from '../acl/ownership.js';

export class AccountService {
  async resolveActiveAccount(userId: string) {
    const scope = userScope(userId);
    
    // Find most recent account
    const acc = await UserTwitterAccountModel.findOne(scope)
      .sort({ updatedAt: -1 })
      .lean();
    
    if (!acc) {
      throw new Error('NO_ACCOUNT');
    }

    // Find corresponding session
    const sess = await UserTwitterSessionModel.findOne({
      ...scope,
      accountId: String(acc._id),
    }).lean();
    
    if (!sess) {
      throw new Error('NO_SESSION');
    }

    return { acc, sess };
  }
}
