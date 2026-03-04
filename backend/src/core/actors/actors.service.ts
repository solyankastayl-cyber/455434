/**
 * Actors Service - PLACEHOLDER
 */

import { actorsRepository } from './actors.repository.js';
import type { CreateActorInput, UpdateActorInput } from './actors.schema.js';

export const actorsService = {
  async getAll() {
    return actorsRepository.findAll();
  },

  async getById(id: string) {
    return actorsRepository.findById(id);
  },

  async create(input: CreateActorInput) {
    return actorsRepository.create(input);
  },

  async update(id: string, input: UpdateActorInput) {
    return actorsRepository.update(id, input);
  },

  async delete(id: string) {
    return actorsRepository.delete(id);
  },
};
