/**
 * Pure scheduling math: how many Stories to post today, and how many are
 * allowed *so far* given how much of the posting window has elapsed.
 */

// Posting window in UTC. The publish cron fires several times inside it; the
// pacing below decides which of those firings actually post.
export const POST_WINDOW_START_UTC_HOUR = 5; // ~07–08 Helsinki
export const POST_WINDOW_END_UTC_HOUR = 21; // ~23–00 Helsinki

/**
 * Dynamic daily target. Grows with the library and is capped so we never post
 * more than the cooldown can sustain (sustainable = pool / cooldownDays).
 * Clamped to [dailyMin, dailyMax]. With the defaults (min 3, max 10, cooldown
 * 14d): ~42 videos → 3/day, 84 → 6/day, 140+ → 10/day.
 */
export function dailyTarget(
  librarySize: number,
  cooldownDays: number,
  dailyMin: number,
  dailyMax: number,
): number {
  const sustainable = cooldownDays > 0 ? Math.floor(librarySize / cooldownDays) : dailyMax;
  return Math.max(dailyMin, Math.min(dailyMax, sustainable));
}

/** Fraction (0..1) of the posting window that has elapsed at `now`. */
export function windowFractionElapsed(
  now: Date,
  startHour = POST_WINDOW_START_UTC_HOUR,
  endHour = POST_WINDOW_END_UTC_HOUR,
): number {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const start = startHour * 60;
  const end = endHour * 60;
  if (minutes <= start) return 0;
  if (minutes >= end) return 1;
  return (minutes - start) / (end - start);
}

/**
 * How many posts are allowed by `now`, pacing the daily target evenly across
 * the window so posts don't all fire in the morning.
 */
export function pacedAllowance(
  target: number,
  now: Date,
  startHour = POST_WINDOW_START_UTC_HOUR,
  endHour = POST_WINDOW_END_UTC_HOUR,
): number {
  const fraction = windowFractionElapsed(now, startHour, endHour);
  return Math.min(target, Math.ceil(target * fraction));
}
