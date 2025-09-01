import type { ResetTimeInfo, UserConfiguration } from '../types/usage.js';

export class ResetTimeService {
  private static instance: ResetTimeService;

  // Default configuration based on Claude's standard reset time
  private defaultConfig: UserConfiguration = {
    resetHour: 9, // 9 AM Pacific (Claude's standard reset time)
    timezone: 'America/Los_Angeles', // Pacific Time
    updateInterval: 30000, // 30 seconds
    warningThresholds: {
      low: 70,
      high: 90,
    },
    plan: 'auto',
    customTokenLimit: undefined,
  };

  private currentConfig: UserConfiguration;

  constructor(config?: Partial<UserConfiguration>) {
    this.currentConfig = { ...this.defaultConfig, ...config };
  }

  static getInstance(config?: Partial<UserConfiguration>): ResetTimeService {
    if (!ResetTimeService.instance) {
      ResetTimeService.instance = new ResetTimeService(config);
    } else if (config) {
      // Update configuration if provided
      ResetTimeService.instance.updateConfiguration(config);
    }
    return ResetTimeService.instance;
  }

  updateConfiguration(config: Partial<UserConfiguration>): void {
    this.currentConfig = { ...this.currentConfig, ...config };
  }

  getConfiguration(): UserConfiguration {
    return { ...this.currentConfig };
  }

  /**
   * Convert UTC date to user's timezone
   */
  private toZonedTime(date: Date, timezone: string): Date {
    // Get the offset for the timezone at this specific date
    const utcTime = date.getTime();
    const localTime = new Date(date.toLocaleString('en-US', { timeZone: timezone })).getTime();
    const timezoneOffset = utcTime - localTime;

    return new Date(utcTime + timezoneOffset);
  }

  /**
   * Convert timezone-aware date back to UTC
   */
  private fromZonedTime(date: Date, timezone: string): Date {
    // Create a date in the target timezone
    const localDateString = date.toISOString().slice(0, 19); // Remove Z suffix
    const tempDate = new Date(localDateString);

    // Get what this time would be in the target timezone
    const targetTime = new Date(tempDate.toLocaleString('en-US', { timeZone: timezone })).getTime();
    const localTime = tempDate.getTime();
    const offset = localTime - targetTime;

    return new Date(tempDate.getTime() + offset);
  }

  /**
   * Get start of day for a date
   */
  private startOfDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  /**
   * Add months to a date
   */
  private addMonths(date: Date, months: number): Date {
    const result = new Date(date);
    const currentMonth = result.getMonth();
    result.setMonth(currentMonth + months);

    // Handle month overflow (e.g., Jan 31 + 1 month should be Feb 28/29, not Mar 2/3)
    if (result.getMonth() !== (((currentMonth + months) % 12) + 12) % 12) {
      result.setDate(0); // Set to last day of previous month
    }

    return result;
  }

  /**
   * Calculate difference in days between two dates
   */
  private differenceInDays(laterDate: Date, earlierDate: Date): number {
    const msPerDay = 24 * 60 * 60 * 1000;
    const laterStart = this.startOfDay(laterDate);
    const earlierStart = this.startOfDay(earlierDate);
    return Math.floor((laterStart.getTime() - earlierStart.getTime()) / msPerDay);
  }

  /**
   * Calculate difference in milliseconds between two dates
   */
  private differenceInMilliseconds(laterDate: Date, earlierDate: Date): number {
    return laterDate.getTime() - earlierDate.getTime();
  }

  /**
   * Check if first date is after second date
   */
  private isAfter(date1: Date, date2: Date): boolean {
    return date1.getTime() > date2.getTime();
  }

  /**
   * Check if first date is before second date
   */
  private isBefore(date1: Date, date2: Date): boolean {
    return date1.getTime() < date2.getTime();
  }

  /**
   * Calculate next reset time information
   * Based on Claude's monthly billing cycle with configurable reset hour
   */
  calculateResetInfo(currentDate: Date = new Date()): ResetTimeInfo {
    const { resetHour, timezone } = this.currentConfig;

    // Convert current time to user's timezone
    const zonedNow = this.toZonedTime(currentDate, timezone);

    // Calculate next reset time
    const nextReset = this.calculateNextResetTime(zonedNow, resetHour, timezone);

    // Calculate time until reset
    const timeUntilReset = this.differenceInMilliseconds(nextReset, currentDate);

    // Calculate billing cycle information
    const cycleInfo = this.calculateBillingCycleInfo(zonedNow, resetHour, timezone);

    return {
      nextResetTime: nextReset.toISOString(),
      timeUntilReset: Math.max(0, timeUntilReset),
      resetHour,
      timezone,
      percentUntilReset: cycleInfo.percentCompleted,
      daysInCycle: cycleInfo.totalDays,
      daysSinceReset: cycleInfo.daysElapsed,
    };
  }

  /**
   * Calculate the next reset time based on Claude's monthly billing cycle
   */
  private calculateNextResetTime(zonedNow: Date, resetHour: number, timezone: string): Date {
    // Create reset time for today
    let resetToday = this.startOfDay(zonedNow);
    resetToday.setHours(resetHour, 0, 0, 0);

    // If today's reset time has passed, calculate next month's reset
    if (this.isAfter(zonedNow, resetToday)) {
      // Move to next month
      const nextMonth = this.addMonths(resetToday, 1);
      resetToday = this.startOfDay(nextMonth);
      resetToday.setHours(resetHour, 0, 0, 0);
    }

    // Convert back to UTC for consistent storage
    return this.fromZonedTime(resetToday, timezone);
  }

  /**
   * Calculate billing cycle information
   */
  private calculateBillingCycleInfo(
    zonedNow: Date,
    resetHour: number,
    timezone: string
  ): {
    totalDays: number;
    daysElapsed: number;
    percentCompleted: number;
  } {
    // Find the start of current billing cycle (last reset)
    let currentCycleStart = this.startOfDay(zonedNow);
    currentCycleStart.setHours(resetHour, 0, 0, 0);

    // If we haven't reached today's reset time, the cycle started last month
    if (this.isBefore(zonedNow, currentCycleStart)) {
      currentCycleStart = this.addMonths(currentCycleStart, -1);
    }

    // Calculate next reset (end of current cycle)
    const nextReset = this.addMonths(currentCycleStart, 1);

    // Calculate cycle information
    const totalDays = this.differenceInDays(nextReset, currentCycleStart);
    const daysElapsed = this.differenceInDays(zonedNow, currentCycleStart);
    const percentCompleted = Math.min(100, Math.max(0, (daysElapsed / totalDays) * 100));

    return {
      totalDays,
      daysElapsed,
      percentCompleted,
    };
  }

  /**
   * Format time until reset in human-readable format
   */
  formatTimeUntilReset(timeUntilReset: number): string {
    const msInSecond = 1000;
    const msInMinute = msInSecond * 60;
    const msInHour = msInMinute * 60;
    const msInDay = msInHour * 24;

    const days = Math.floor(timeUntilReset / msInDay);
    const hours = Math.floor((timeUntilReset % msInDay) / msInHour);
    const minutes = Math.floor((timeUntilReset % msInHour) / msInMinute);

    if (days > 0) {
      return `${days}d ${hours}h`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m`;
    }
    return 'Soon';
  }

  /**
   * Get formatted reset time in user's timezone
   */
  getFormattedResetTime(resetTime: string, timezone: string): string {
    const utcDate = new Date(resetTime);

    // Use Intl.DateTimeFormat for timezone-aware formatting
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    });

    const parts = formatter.formatToParts(utcDate);
    const month = parts.find((p) => p.type === 'month')?.value || '';
    const day = parts.find((p) => p.type === 'day')?.value || '';
    const year = parts.find((p) => p.type === 'year')?.value || '';
    const hour = parts.find((p) => p.type === 'hour')?.value || '';
    const minute = parts.find((p) => p.type === 'minute')?.value || '';
    const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value || '';
    const timeZoneName = parts.find((p) => p.type === 'timeZoneName')?.value || '';

    return `${month} ${day}, ${year} at ${hour}:${minute} ${dayPeriod} ${timeZoneName}`;
  }

  /**
   * Check if we're in the critical period before reset (last 3 days)
   */
  isInCriticalPeriod(resetInfo: ResetTimeInfo): boolean {
    const daysUntilReset = resetInfo.daysInCycle - resetInfo.daysSinceReset;
    return daysUntilReset <= 3;
  }

  /**
   * Get recommended daily token limit to last until reset
   */
  calculateRecommendedDailyLimit(tokensRemaining: number, resetInfo: ResetTimeInfo): number {
    const daysUntilReset = resetInfo.daysInCycle - resetInfo.daysSinceReset;
    if (daysUntilReset <= 0) return tokensRemaining;

    return Math.floor(tokensRemaining / daysUntilReset);
  }

  /**
   * Determine if current usage is on track to last until reset
   */
  isOnTrackForReset(tokensUsed: number, tokenLimit: number, resetInfo: ResetTimeInfo): boolean {
    const expectedUsageAtThisPoint = (resetInfo.percentUntilReset / 100) * tokenLimit;
    return tokensUsed <= expectedUsageAtThisPoint * 1.1; // Allow 10% buffer
  }

  /**
   * Get available timezones for configuration
   */
  static getCommonTimezones(): Array<{ label: string; value: string }> {
    return [
      { label: 'Pacific Time (Los Angeles)', value: 'America/Los_Angeles' },
      { label: 'Mountain Time (Denver)', value: 'America/Denver' },
      { label: 'Central Time (Chicago)', value: 'America/Chicago' },
      { label: 'Eastern Time (New York)', value: 'America/New_York' },
      { label: 'GMT (London)', value: 'Europe/London' },
      { label: 'Central European Time (Paris)', value: 'Europe/Paris' },
      { label: 'Japan Standard Time (Tokyo)', value: 'Asia/Tokyo' },
      { label: 'Australian Eastern Time (Sydney)', value: 'Australia/Sydney' },
      { label: 'UTC', value: 'UTC' },
    ];
  }
}
