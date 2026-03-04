/**
 * Snapshots Zod Schemas
 */
import { z } from 'zod';

export const GetSnapshotParams = z.object({
  address: z.string().min(1),
});

export const GetSnapshotQuery = z.object({
  rebuild: z.coerce.boolean().optional(),
});

export const GetBulkSnapshotsBody = z.object({
  addresses: z.array(z.string().min(1)).min(1).max(100),
});
