/**
 * EVOLUTION CRON JOB
 */

import cron from "node-cron";
import type { OutcomeService } from "./outcome.service.js";

export function startEvolutionCron(outcomeService: OutcomeService): void {
  // Every hour
  cron.schedule("0 * * * *", async () => {
    try {
      const res = await outcomeService.closeDueForecasts();
      console.log(`[Evolution Cron] Closed: ${res.closed}, Errors: ${res.errors}`);
    } catch (e) {
      console.error("[Evolution Cron] Error:", e);
    }
  });

  console.log("[Evolution] Cron started (hourly outcome evaluation)");
}

console.log('[Evolution] Cron job loaded');
