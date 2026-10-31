/**
 * Quiet Hours Policy Enforcer
 * Evaluates whether a dispatch timestamp falls into the restricted night window in East Africa Time (UTC+3).
 *
 * Proclamation 1321/2024 and Ethiopian business ethics:
 * Standard quiet hours: 20:00 (8:00 PM) to 07:00 (7:00 AM) EAT.
 */

export function isWithinQuietHours(
  date: Date = new Date(),
  startStr = '20:00',
  endStr = '07:00',
  timezone = 'Africa/Addis_Ababa',
): boolean {
  // Format date in target timezone to get current hour and minute
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
  const currentMinutes = hour * 60 + minute;

  const [startH, startM] = startStr.split(':').map((v) => parseInt(v, 10));
  const [endH, endM] = endStr.split(':').map((v) => parseInt(v, 10));

  const startMinutes = (isNaN(startH) ? 20 : startH) * 60 + (isNaN(startM) ? 0 : startM);
  const endMinutes = (isNaN(endH) ? 7 : endH) * 60 + (isNaN(endM) ? 0 : endM);

  // If start is after end (e.g. 20:00 to 07:00 spanning midnight)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  } else {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
}
