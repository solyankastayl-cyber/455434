/**
 * Telegram Module - Phase 5.2.2
 * 
 * Exports:
 * - telegramRouter - Main notification router
 * - TelegramMessageBuilder - Message formatting
 * - systemTelegram - System-only notifier (legacy, use router instead)
 */

export { telegramRouter, type SendEventParams, type SendEventResult } from './telegram-notification-router.service.js';
export { TelegramMessageBuilder, type TelegramEvent, type EventPayload, type TelegramMessage } from './telegram-message-builder.js';
export { systemTelegram, SystemTelegramEvents } from './system-telegram.notifier.js';
