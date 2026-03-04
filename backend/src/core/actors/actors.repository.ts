/**
 * Actors Repository - PLACEHOLDER
 */

import { ActorModel, IActor } from './actors.model.js';

export const actorsRepository = {
  async findAll(): Promise<IActor[]> {
    return ActorModel.find().lean();
  },

  async findById(id: string): Promise<IActor | null> {
    return ActorModel.findById(id).lean();
  },

  async create(data: Partial<IActor>): Promise<IActor> {
    const actor = new ActorModel(data);
    return actor.save();
  },

  async update(id: string, data: Partial<IActor>): Promise<IActor | null> {
    return ActorModel.findByIdAndUpdate(id, data, { new: true }).lean();
  },

  async delete(id: string): Promise<boolean> {
    const result = await ActorModel.findByIdAndDelete(id);
    return !!result;
  },
};
