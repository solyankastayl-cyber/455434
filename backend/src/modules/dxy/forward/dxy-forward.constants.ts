/**
 * DXY FORWARD CONSTANTS
 * 
 * ISOLATION: DXY forward layer. DO NOT import from BTC/SPX modules.
 */

export const DXY_ASSET = "DXY" as const;

// Горизонты для DXY
export const DXY_HORIZON_DAYS: number[] = [7, 14, 30, 90, 180, 365];

// Версия модели/контракта для аудита
export const DXY_MODEL_VERSION = "dxy-fractal-v1.0";

// Safety: ограничение на создание сигналов за 1 запрос
export const MAX_HORIZONS_PER_SNAPSHOT = 12;
