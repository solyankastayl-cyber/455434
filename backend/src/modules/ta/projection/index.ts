/**
 * Phase AC: Projection Module Index
 */

export * from './projection_types.js';
export * from './projection_engine.js';

// Projectors
export { triangleProjector } from './projectors/triangle.projector.js';
export { flagProjector } from './projectors/flag.projector.js';
export { hsShouldersProjector } from './projectors/hs.projector.js';
export { harmonicProjector } from './projectors/harmonic.projector.js';
export { elliottProjector } from './projectors/elliott.projector.js';
export { channelProjector } from './projectors/channel.projector.js';
