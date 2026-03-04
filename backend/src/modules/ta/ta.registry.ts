/**
 * TA Registry - Module registration for FOMA architecture
 * 
 * Registers TA as an independent prediction module.
 */

import { TaModuleConfig } from './ta.contracts.js';

export class TaRegistry {
  private static instance: TaRegistry;
  private modules: Map<string, TaModuleConfig> = new Map();

  private constructor() {}

  static getInstance(): TaRegistry {
    if (!TaRegistry.instance) {
      TaRegistry.instance = new TaRegistry();
    }
    return TaRegistry.instance;
  }

  register(config: TaModuleConfig): void {
    this.modules.set(config.name, config);
    console.log(`[TaRegistry] Registered module: ${config.name} v${config.version}`);
  }

  get(name: string): TaModuleConfig | undefined {
    return this.modules.get(name);
  }

  isEnabled(name: string): boolean {
    const module = this.modules.get(name);
    return module?.enabled ?? false;
  }

  list(): TaModuleConfig[] {
    return Array.from(this.modules.values());
  }
}

export function getTaRegistry(): TaRegistry {
  return TaRegistry.getInstance();
}
