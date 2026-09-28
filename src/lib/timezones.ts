/**
 * Time zone list and display helpers for the Settings picker.
 *
 * `Intl.supportedValuesOf` is used when available so the list stays current
 * with the browser's own IANA database and no zone table has to be shipped.
 * The offset label is deliberately recomputed at render time rather than
 * hardcoded, because it changes with daylight saving.
 *
 * This module is self-contained on purpose: the client bundle should not
 * depend on the server's domain tree.
 */

const FALLBACK_TIME_ZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Australia/Sydney',
];

export function listTimeZones(): string[] {
  const candidate = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  if (typeof candidate === 'function') {
    try {
      const zones = candidate('timeZone');
      if (Array.isArray(zones) && zones.length > 0) return zones;
    } catch {
      // fall through to the static list
    }
  }
  return FALLBACK_TIME_ZONES;
}

/** e.g. "GMT-5" or "GMT+5:30" for the given zone at the given instant. */
export function offsetLabel(timeZone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(at);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/** "America/New_York" -> "New York" */
export function cityName(zone: string): string {
  if (!zone.includes('/')) return zone;
  return zone.slice(zone.lastIndexOf('/') + 1).replace(/_/g, ' ');
}

export type TimeZoneGroup = { region: string; zones: string[] };

/** Group zones by their region prefix so the select is navigable. */
export function groupTimeZones(zones: string[]): TimeZoneGroup[] {
  const groups = new Map<string, string[]>();
  for (const zone of zones) {
    const region = zone.includes('/') ? zone.split('/')[0].replace(/_/g, ' ') : 'UTC';
    const bucket = groups.get(region);
    if (bucket) bucket.push(zone);
    else groups.set(region, [zone]);
  }
  return [...groups.entries()]
    .map(([region, zs]) => ({ region, zones: zs }))
    .sort((a, b) => a.region.localeCompare(b.region));
}

/** Label shown in the picker, e.g. "New York (GMT-4)". */
export function timeZoneOptionLabel(zone: string, at: Date = new Date()): string {
  const offset = offsetLabel(zone, at);
  return offset ? `${cityName(zone)} (${offset})` : cityName(zone);
}
