/**
 * Time utilities
 */

export function addDays(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

export function addDaysISO(days: number): string {
  return addDays(days).toISOString();
}

export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

export function yearsAgo(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d;
}

export const DAY_MS = 86400000;
