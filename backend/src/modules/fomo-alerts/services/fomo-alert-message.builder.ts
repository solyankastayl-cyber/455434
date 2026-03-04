/**
 * FOMO Alert Message Builder
 * ==========================
 * 
 * Formats FOMO AI alerts for Telegram
 * Human-readable, no trading advice, explainability-first
 */

import {
  FomoAlertEvent,
  FomoAlertPayload,
  DecisionChangedPayload,
  HighConfidencePayload,
  RiskIncreasedPayload,
  MlPromotedPayload,
  MlRollbackPayload,
  MlShadowCriticalPayload,
  ProviderDownPayload,
  WsDisconnectPayload,
  DataCompletenessPayload,
  TrustWarningPayload,
  MacroRegimeChangePayload,
  MacroExtremePayload,
} from '../contracts/fomo-alert.types.js';

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface MessageConfig {
  emoji: string;
  title: string;
  format: (payload: any) => string;
}

const MESSAGE_CONFIGS: Record<FomoAlertEvent, MessageConfig> = {
  
  // ═══════════════════════════════════════════════════════════════
  // USER EVENTS (информационные, не торговые советы)
  // ═══════════════════════════════════════════════════════════════
  
  'DECISION_CHANGED': {
    emoji: '🔄',
    title: 'Decision Updated',
    format: (p: DecisionChangedPayload) => {
      const confPrev = (p.previousConfidence * 100).toFixed(0);
      const confNew = (p.newConfidence * 100).toFixed(0);
      const confChange = p.newConfidence > p.previousConfidence ? '↑' : '↓';
      
      let text = `<b>${p.symbol}</b>\n`;
      text += `<b>Previous:</b> ${p.previousAction} → <b>Now:</b> ${p.newAction}\n`;
      text += `<b>Confidence:</b> ${confPrev}% → ${confNew}% ${confChange}\n\n`;
      
      if (p.reasons && p.reasons.length > 0) {
        text += '<b>Reasons:</b>\n';
        for (const reason of p.reasons.slice(0, 4)) {
          text += `• ${escapeHtml(reason)}\n`;
        }
      }
      
      return text;
    },
  },
  
  'HIGH_CONFIDENCE': {
    emoji: '📊',
    title: 'High Confidence Signal',
    format: (p: HighConfidencePayload) => {
      const confPct = (p.confidence * 100).toFixed(0);
      const actionEmoji = p.action === 'BUY' ? '🟢' : '🔴';
      
      let text = `<b>${p.symbol}</b> ${actionEmoji}\n`;
      text += `<b>Signal:</b> ${p.action}\n`;
      text += `<b>Confidence:</b> ${confPct}%\n`;
      text += `<b>Risk:</b> ${p.riskLevel}\n`;
      text += `<b>Data:</b> ${p.dataMode}\n\n`;
      
      if (p.drivers && p.drivers.length > 0) {
        text += '<b>System notes:</b>\n';
        for (const driver of p.drivers.slice(0, 4)) {
          text += `• ${escapeHtml(driver)}\n`;
        }
      }
      
      if (p.snapshotId) {
        text += `\n🔗 <a href="https://backtest-replay-lab.preview.emergentagent.com/snapshot/${p.snapshotId}">View snapshot</a>`;
      }
      
      return text;
    },
  },
  
  'RISK_INCREASED': {
    emoji: '⚠️',
    title: 'Risk Increased',
    format: (p: RiskIncreasedPayload) => {
      const confPct = (p.confidence * 100).toFixed(0);
      
      let text = `<b>${p.symbol}</b>\n`;
      text += `<b>Risk:</b> ${p.previousRisk} → ${p.newRisk}\n`;
      text += `<b>Current decision:</b> ${p.action}\n`;
      text += `<b>Confidence:</b> ${confPct}%\n\n`;
      
      if (p.riskFactors && p.riskFactors.length > 0) {
        text += '<b>Risk factors:</b>\n';
        for (const factor of p.riskFactors.slice(0, 4)) {
          text += `• ${escapeHtml(factor)}\n`;
        }
      }
      
      return text;
    },
  },
  
  // ═══════════════════════════════════════════════════════════════
  // ADMIN EVENTS (system-level, operational)
  // ═══════════════════════════════════════════════════════════════
  
  'ML_PROMOTED': {
    emoji: '🧠',
    title: 'ML Model PROMOTED',
    format: (p: MlPromotedPayload) => {
      let text = `<b>Model:</b> <code>${p.modelId.slice(0, 12)}...</code>\n`;
      text += `<b>Accuracy:</b> ${(p.accuracy * 100).toFixed(1)}%\n`;
      text += `<b>ECE:</b> ${(p.ece * 100).toFixed(2)}%\n`;
      
      if (p.previousModelId) {
        text += `\n<b>Previous:</b> <code>${p.previousModelId.slice(0, 12)}...</code>`;
      }
      
      return text;
    },
  },
  
  'ML_ROLLBACK': {
    emoji: '🔴',
    title: 'AUTO ROLLBACK',
    format: (p: MlRollbackPayload) => {
      let text = `<b>Rolled back:</b> <code>${p.rolledBackModelId.slice(0, 12)}...</code>\n`;
      text += `<b>Restored:</b> <code>${p.restoredModelId.slice(0, 12)}...</code>\n`;
      text += `<b>Reason:</b> ${escapeHtml(p.reason)}\n`;
      text += `<b>Critical streak:</b> ${p.critStreak}×`;
      
      return text;
    },
  },
  
  'ML_SHADOW_CRITICAL': {
    emoji: '⚠️',
    title: 'Shadow Model CRITICAL',
    format: (p: MlShadowCriticalPayload) => {
      let text = `<b>Model:</b> <code>${p.modelId.slice(0, 12)}...</code>\n`;
      text += `<b>Stage:</b> ${p.stage}\n`;
      text += `<b>Health:</b> CRITICAL\n`;
      text += `<b>Streak:</b> ${p.critStreak}×\n`;
      text += `<b>Last ECE:</b> ${(p.lastECE * 100).toFixed(2)}%`;
      
      return text;
    },
  },
  
  'PROVIDER_DOWN': {
    emoji: '🚨',
    title: 'PROVIDER DOWN',
    format: (p: ProviderDownPayload) => {
      let text = `<b>Provider:</b> ${escapeHtml(p.provider)}\n`;
      text += `<b>Status:</b> ${escapeHtml(p.lastStatus || 'disconnected')}\n`;
      
      if (p.downSince) {
        const downMins = Math.round((Date.now() - p.downSince) / 60000);
        text += `<b>Down since:</b> ${downMins} min ago\n`;
      }
      
      if (p.affectedSymbols && p.affectedSymbols.length > 0) {
        text += `\n<b>Affected:</b> ${p.affectedSymbols.join(', ')}`;
      }
      
      return text;
    },
  },
  
  'WS_DISCONNECT': {
    emoji: '🔌',
    title: 'WebSocket Disconnected',
    format: (p: WsDisconnectPayload) => {
      let text = `<b>Service:</b> ${escapeHtml(p.service)}\n`;
      
      if (p.error) {
        text += `<b>Error:</b> ${escapeHtml(p.error)}\n`;
      }
      
      if (p.reconnectAttempts !== undefined) {
        text += `<b>Reconnect attempts:</b> ${p.reconnectAttempts}`;
      }
      
      return text;
    },
  },
  
  'DATA_COMPLETENESS': {
    emoji: '📉',
    title: 'Data Completeness Warning',
    format: (p: DataCompletenessPayload) => {
      let text = `<b>Completeness:</b> ${(p.completeness * 100).toFixed(1)}%\n`;
      text += `<b>Threshold:</b> ${(p.threshold * 100).toFixed(1)}%\n`;
      
      if (p.missingProviders && p.missingProviders.length > 0) {
        text += `\n<b>Missing:</b> ${p.missingProviders.join(', ')}`;
      }
      
      return text;
    },
  },
  
  'TRUST_WARNING': {
    emoji: '🔍',
    title: 'Trust Layer Warning',
    format: (p: TrustWarningPayload) => {
      let text = `<b>Symbol:</b> ${p.symbol}\n`;
      text += `<b>Type:</b> ${p.type.replace(/_/g, ' ')}\n`;
      text += `<b>Value:</b> ${typeof p.value === 'number' ? (p.value * 100).toFixed(1) + '%' : p.value}\n`;
      
      if (p.threshold !== undefined) {
        text += `<b>Threshold:</b> ${(p.threshold * 100).toFixed(1)}%\n`;
      }
      
      if (p.details) {
        text += `\n${escapeHtml(p.details)}`;
      }
      
      return text;
    },
  },
  
  // ═══════════════════════════════════════════════════════════════
  // MACRO EVENTS (Market State Anchor alerts)
  // ═══════════════════════════════════════════════════════════════
  
  'MACRO_REGIME_CHANGE': {
    emoji: '🌍',
    title: 'Macro Regime Changed',
    format: (p: MacroRegimeChangePayload) => {
      const dirEmoji = p.direction === 'WORSENING' ? '📉' : p.direction === 'IMPROVING' ? '📈' : '➡️';
      const prevLabel = p.previousLabel.replace(/_/g, ' ');
      const newLabel = p.newLabel.replace(/_/g, ' ');
      
      let text = `<b>Fear & Greed:</b> ${p.previousValue} → ${p.newValue}\n`;
      text += `<b>Sentiment:</b> ${prevLabel} → ${newLabel} ${dirEmoji}\n`;
      text += `<b>Direction:</b> ${p.direction}\n\n`;
      
      if (p.flags && p.flags.length > 0) {
        text += '<b>Active flags:</b>\n';
        for (const flag of p.flags.slice(0, 5)) {
          const flagText = flag.replace(/_/g, ' ');
          text += `• ${flagText}\n`;
        }
      }
      
      text += `\n<b>Confidence multiplier:</b> ${(p.confidenceMultiplier * 100).toFixed(0)}%`;
      
      if (p.confidenceMultiplier <= 0.7) {
        text += '\n\n⚠️ <i>Elevated caution advised</i>';
      }
      
      return text;
    },
  },
  
  'MACRO_EXTREME': {
    emoji: '🚨',
    title: 'EXTREME Macro Conditions',
    format: (p: MacroExtremePayload) => {
      const label = p.fearGreedLabel.replace(/_/g, ' ');
      const isPanic = p.flags.includes('MACRO_PANIC');
      const conditionEmoji = isPanic ? '😱' : '🤑';
      
      let text = `${conditionEmoji} <b>${label.toUpperCase()}</b>\n\n`;
      text += `<b>Fear & Greed:</b> ${p.fearGreedValue}\n`;
      text += `<b>BTC Dominance:</b> ${p.btcDominance.toFixed(1)}%\n`;
      text += `<b>Stablecoin Dom:</b> ${p.stableDominance.toFixed(1)}%\n\n`;
      
      text += `<b>Impact:</b>\n`;
      text += `• Confidence: ${(p.impact.confidenceMultiplier * 100).toFixed(0)}%\n`;
      
      if (p.impact.blockedStrong) {
        text += `• ⛔ STRONG actions BLOCKED\n`;
      }
      
      text += `\n<i>${escapeHtml(p.impact.reason)}</i>`;
      
      return text;
    },
  },
};

/**
 * Build formatted message for FOMO AI alert
 */
export function buildFomoAlertMessage(
  event: FomoAlertEvent,
  payload: FomoAlertPayload
): { text: string; title: string } {
  const config = MESSAGE_CONFIGS[event];
  
  if (!config) {
    console.warn(`[FomoMessageBuilder] Unknown event: ${event}`);
    return {
      text: `📢 <b>${event}</b>\n\n${JSON.stringify(payload, null, 2)}`,
      title: event,
    };
  }
  
  const body = config.format(payload);
  const text = `${config.emoji} <b>${config.title}</b>\n\n${body}`;
  
  return { text, title: config.title };
}
