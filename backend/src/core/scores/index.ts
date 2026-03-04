/**
 * Scores Module Index
 */
export { 
  ScoreModel, 
  type IScore, 
  type ScoreSubjectType, 
  type ScoreWindow, 
  type ScoreBreakdown,
  getTierFromScore,
  calculateCompositeScore 
} from './scores.model.js';

export { 
  scoreSubjectTypeSchema, 
  scoreWindowSchema, 
  scoreTierSchema, 
  scoreSortSchema,
  type ScoreTier,
  type ScoreSort
} from './scores.schema.js';

export { scoresRepository, type ScoreUpsertData, type ScoreFilter } from './scores.repository.js';
export { scoresService, formatScore } from './scores.service.js';
export { scoresRoutes } from './scores.routes.js';
