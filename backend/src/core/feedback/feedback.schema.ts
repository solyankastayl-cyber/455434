/**
 * Feedback Zod Schemas
 */
import { z } from 'zod';

export const FeedbackRatingEnum = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const FeedbackOutcomeEnum = z.enum(['followed', 'ignored', 'partial', 'pending']);

export const SubmitDecisionFeedbackParams = z.object({
  decisionId: z.string().min(1),
});

export const SubmitActionFeedbackParams = z.object({
  actionId: z.string().min(1),
});

export const SubmitSimulationFeedbackParams = z.object({
  simulationId: z.string().min(1),
});

export const SubmitFeedbackBody = z.object({
  rating: FeedbackRatingEnum.optional(),
  outcome: FeedbackOutcomeEnum.optional(),
  helpful: z.boolean().optional(),
  accurate: z.boolean().optional(),
  timely: z.boolean().optional(),
  comments: z.string().max(1000).optional(),
  tags: z.array(z.string()).max(10).optional(),
});

export const GetFeedbackParams = z.object({
  sourceId: z.string().min(1),
});

export const GetHistoryQuery = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
});

export const TargetIdParams = z.object({
  targetId: z.string().min(1),
});
