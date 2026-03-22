/**
 * Formats an ISO 8601 timestamp to YYYY-MM-DD for user-facing display.
 * Returns 'n/a' for null/undefined/empty values.
 */
export function toDateString(value: string | null | undefined): string {
  if (!value) return 'n/a';
  return value.slice(0, 10);
}

/**
 * Formats a duration in seconds to a human-readable string.
 *   < 60s  → "45 seconds"
 *   1–59m  → "12 minutes"
 *   1h+    → "1 hour and 4 minutes" (omits minutes when exactly on the hour)
 */
export function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));

  if (totalSeconds < 60) {
    return totalSeconds === 1 ? '1 second' : `${totalSeconds} seconds`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return totalMinutes === 1 ? '1 minute' : `${totalMinutes} minutes`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourLabel = hours === 1 ? '1 hour' : `${hours} hours`;
  if (minutes === 0) return hourLabel;
  const minuteLabel = minutes === 1 ? '1 minute' : `${minutes} minutes`;
  return `${hourLabel} and ${minuteLabel}`;
}
