// TwitterAccount Service - MULTI Architecture
import { TwitterAccountModel, ITwitterAccount, AccountStatus } from './account.model.js';

export interface CreateAccountDTO {
  username: string;
  displayName?: string;
  twitterId?: string;
  rateLimit?: number;
  notes?: string;
}

export interface UpdateAccountDTO {
  displayName?: string;
  status?: AccountStatus;
  rateLimit?: number;
  notes?: string;
}

export class AccountService {
  async create(data: CreateAccountDTO): Promise<ITwitterAccount> {
    const account = await TwitterAccountModel.create({
      username: data.username.toLowerCase().replace('@', ''),
      displayName: data.displayName,
      twitterId: data.twitterId,
      rateLimit: data.rateLimit || 200,
      notes: data.notes,
      status: 'ACTIVE',
    });
    console.log(`[AccountService] Created account: ${account.username}`);
    return account;
  }

  async findAll(): Promise<ITwitterAccount[]> {
    return TwitterAccountModel.find().sort({ createdAt: -1 }).lean();
  }

  async findActive(): Promise<ITwitterAccount[]> {
    return TwitterAccountModel.find({ status: 'ACTIVE' }).lean();
  }

  async findByUsername(username: string): Promise<ITwitterAccount | null> {
    return TwitterAccountModel.findOne({ 
      username: username.toLowerCase().replace('@', '') 
    }).lean();
  }

  async findById(id: string): Promise<ITwitterAccount | null> {
    return TwitterAccountModel.findById(id).lean();
  }

  async update(id: string, data: UpdateAccountDTO): Promise<ITwitterAccount | null> {
    return TwitterAccountModel.findByIdAndUpdate(
      id,
      { $set: data },
      { new: true }
    ).lean();
  }

  async setStatus(id: string, status: AccountStatus): Promise<void> {
    await TwitterAccountModel.findByIdAndUpdate(id, { status });
    console.log(`[AccountService] Account ${id} status -> ${status}`);
  }

  async delete(id: string): Promise<boolean> {
    const result = await TwitterAccountModel.findByIdAndDelete(id);
    return !!result;
  }

  async count(): Promise<{ total: number; active: number; disabled: number }> {
    const [total, active, disabled] = await Promise.all([
      TwitterAccountModel.countDocuments(),
      TwitterAccountModel.countDocuments({ status: 'ACTIVE' }),
      TwitterAccountModel.countDocuments({ status: 'DISABLED' }),
    ]);
    return { total, active, disabled };
  }
}

export const accountService = new AccountService();
