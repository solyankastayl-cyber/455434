/**
 * BLOCK 34: SimClock - Time wrapper for simulation
 * Allows "freezing" time for look-ahead free backtesting
 */

export class SimClock {
  private _asOf: Date;

  constructor(start: Date | string) {
    this._asOf = new Date(start);
  }

  now(): Date {
    return new Date(this._asOf);
  }

  set(date: Date | string): void {
    this._asOf = new Date(date);
  }

  addDays(days: number): void {
    const d = new Date(this._asOf);
    d.setDate(d.getDate() + days);
    this._asOf = d;
  }

  isBefore(date: Date | string): boolean {
    return this._asOf.getTime() < new Date(date).getTime();
  }

  isAfter(date: Date | string): boolean {
    return this._asOf.getTime() > new Date(date).getTime();
  }

  toISO(): string {
    return this._asOf.toISOString().slice(0, 10);
  }
}
