/**
 * Abort Handler Service - Phase 1.4 + Phase 5.2.2
 * 
 * Обработка abort от парсера:
 * - session → STALE
 * - lastAbortAt update
 * - Telegram notification via Router
 */

import { UserTwitterSessionModel } from '../models/twitter-session.model.js';
import { UserTwitterAccountModel } from '../models/twitter-account.model.js';
import { telegramRouter } from '../../telegram/index.js';
import type { ParserRuntimeConfig } from './session-selector.service.js';
import type { ParserEngineSummary } from '../dto/parse-request.dto.js';

export interface AbortHandlerInput {
  ownerUserId: string;
  runtime: ParserRuntimeConfig;
  engineSummary: ParserEngineSummary;
  taskId?: string;
}

export class AbortHandlerService {
  
  /**
   * Handle abort from parser
   * 
   * Steps:
   * 1. Mark session as STALE or EXPIRED (unless PARSER_DOWN)
   * 2. Update lastAbortAt
   * 3. Store engineSummary (optional)
   * 4. Send Telegram notification
   */
  async handleAbort(input: AbortHandlerInput): Promise<void> {
    const { ownerUserId, runtime, engineSummary, taskId } = input;

    console.log(`[AbortHandler] Processing abort | session: ${runtime.sessionId} | reason: ${engineSummary.abortReason}`);

    // Check if this is an infrastructure error (parser down)
    // In this case, DO NOT touch the session - it's not the user's fault
    const isParserDown = engineSummary.abortReason === 'PARSER_DOWN' || 
                          (engineSummary as any).isParserDown === true;
    
    if (isParserDown) {
      console.log(`[AbortHandler] PARSER_DOWN detected - session will NOT be marked as STALE/EXPIRED`);
      // Only log the abort, don't change session status
      return;
    }

    // Determine session status based on abort reason
    // SESSION_EXPIRED = cookies are dead, need resync
    // Other reasons = temporary issues, STALE is enough
    const isSessionExpired = engineSummary.abortReason === 'SESSION_EXPIRED' || 
                              (engineSummary as any).isSessionExpired === true;
    
    const newStatus = isSessionExpired ? 'EXPIRED' : 'STALE';
    const staleReason = isSessionExpired ? 'EXPIRED' : (engineSummary.abortReason || 'PARSER_ABORT');

    // 1. Update session status
    const sessionUpdate = await UserTwitterSessionModel.updateOne(
      { _id: runtime.sessionId, isActive: true },
      {
        $set: {
          status: newStatus,
          staleReason,
          staleAt: isSessionExpired ? new Date() : undefined,
          lastAbortAt: new Date(),
          // Update risk score if high (ensure valid number)
          riskScore: Number.isFinite(engineSummary.riskMax) 
            ? Math.max(engineSummary.riskMax, 50) 
            : 50,
        },
      }
    );

    console.log(`[AbortHandler] Session updated: ${sessionUpdate.modifiedCount > 0 ? 'yes' : 'no'} | status: ${newStatus}`);

    if (isSessionExpired) {
      console.log(`[AbortHandler] ⚠️ SESSION EXPIRED - user needs to resync cookies`);
    }

    // 2. Get account info for notification
    let accountUsername = 'unknown';
    try {
      const account = await UserTwitterAccountModel.findById(runtime.accountId).lean();
      if (account?.username) {
        accountUsername = account.username;
      }
    } catch (err) {
      console.warn('[AbortHandler] Could not get account username');
    }

    // 3. Send Telegram notification via Router (Phase 5.2.2)
    try {
      if (isSessionExpired) {
        await telegramRouter.notifySessionExpired(ownerUserId, {
          account: accountUsername,
          reason: engineSummary.abortReason || 'Session expired',
        });
      } else {
        // Regular abort - use PARSE_ABORTED event
        await telegramRouter.sendEvent({
          event: 'PARSE_ABORTED',
          userId: ownerUserId,
          scope: 'USER',
          payload: {
            account: accountUsername,
            reason: engineSummary.abortReason || 'Unknown',
            fetched: engineSummary.fetched,
          },
        });
      }
      console.log(`[AbortHandler] Telegram notification sent to user ${ownerUserId}`);
    } catch (err) {
      console.warn('[AbortHandler] Failed to send Telegram notification:', err);
    }
  }

  /**
   * Handle high risk (not abort, but warning)
   */
  async handleHighRisk(input: Omit<AbortHandlerInput, 'engineSummary'> & {
    riskScore: number;
  }): Promise<void> {
    const { ownerUserId, runtime, riskScore } = input;
    
    // Ensure valid risk score
    const validRiskScore = Number.isFinite(riskScore) ? Math.max(riskScore, 0) : 0;

    // Update session risk score without changing status
    await UserTwitterSessionModel.updateOne(
      { _id: runtime.sessionId, isActive: true },
      {
        $set: {
          riskScore: validRiskScore,
        },
      }
    );

    // Optionally notify if risk is very high via Router (Phase 5.2.2)
    if (validRiskScore >= 75) {
      try {
        await telegramRouter.sendEvent({
          event: 'HIGH_RISK',
          userId: ownerUserId,
          scope: 'USER',
          payload: {
            riskScore: validRiskScore,
          },
        });
      } catch (err) {
        // Ignore
      }
    }
  }
}
