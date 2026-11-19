// Time zone and calendar helpers. Bookings are stored as UTC instants (ms) and shown in each viewer's zone.
import { esc } from './util.js';
import { t, intlLocale } from './i18n.js';

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const wallFormatters = new Map();
function wallFormatter(zone) {
  if (!wallFormatters.has(zone)) {
    wallFormatters.set(zone, new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }));
  }
  return wallFormatters.get(zone);
}

/** "YYYY-MM-DDTHH:MM" wall-clock time of an instant in a zone. */
export function wallTime(ms, zone) {
  const p = Object.fromEntries(wallFormatter(zone).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * Convert a local wall-clock time in a zone to a UTC instant.
 * Throws when the time is skipped (spring forward) or repeated (fall back) by a clock change.
 */
export function toInstant(value, zone) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value))) throw new Error(t('err.dateIncomplete'));
  const nominal = Date.parse(value + 'Z');
  if (!Number.isFinite(nominal)) throw new Error(t('err.dateIncomplete'));
  const found = new Set();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = nominal + hours * 3600000;
    const offset = Date.parse(wallTime(probe, zone) + 'Z') - probe;
    const candidate = nominal - offset;
    if (wallTime(candidate, zone) === value) found.add(candidate);
  }
  if (!found.size) throw new Error(t('err.dstGap'));
  if (found.size > 1) throw new Error(t('err.dstRepeat'));
  return [...found][0];
}

export function isValidZone(zone) {
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return Boolean(zone); } catch { return false; }
}

export function friendlyTime(at, zone) {
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(at));
}

export function clockTime(at, zone) {
  return new Intl.DateTimeFormat(intlLocale(), { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(at));
}

export function shortDay(at, zone) {
  return new Intl.DateTimeFormat(intlLocale(), { timeZone: zone, weekday: 'short' }).format(new Date(at));
}

/** Add whole days to a "YYYY-MM-DD" date string. */
export function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Weekday name ("Monday") of a "YYYY-MM-DD" date string. */
export function weekdayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return DAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
}

/** "12:05" style countdown. */
export function formatClock(seconds) {
  const n = Math.max(0, Math.ceil(seconds));
  return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
}

export function formatMinutes(seconds) {
  const m = Math.round((seconds || 0) / 60);
  return m < 1 ? t('common.underMinute') : t('common.minutes', { n: m });
}

/** Localized weekday name for a stored English day ("Monday"). 2024-01-01 was a Monday. */
export function dayName(day, style = 'long') {
  const i = DAYS.indexOf(day);
  if (i < 0) return day;
  return new Intl.DateTimeFormat(intlLocale(), { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i)));
}

/** Localized clock time for a stored "HH:MM". */
export function hhmm(value) {
  const [h, m] = String(value).split(':').map(Number);
  return new Intl.DateTimeFormat(intlLocale(), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1, h, m)));
}

export const COMMON_ZONES = ['America/Los_Angeles', 'America/Denver', 'America/Phoenix', 'America/Chicago', 'America/New_York',
  'America/Anchorage', 'Pacific/Honolulu', 'Europe/London', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];

function zonePart(zone, style, at = Date.now()) {
  try {
    return new Intl.DateTimeFormat(intlLocale(), { timeZone: zone, timeZoneName: style })
      .formatToParts(new Date(at)).find(p => p.type === 'timeZoneName')?.value || '';
  } catch { return ''; }
}
const city = zone => (zone === 'UTC' ? '' : String(zone).split('/').pop().replaceAll('_', ' '));

/** Readable zone name in the current language, e.g. "Pacific Time · Los Angeles". */
export function zoneName(zone) {
  const generic = zonePart(zone, 'longGeneric');
  const c = city(zone);
  if (!generic || /^GMT|^UTC[+-]/.test(generic)) return c || zone;
  return c && !generic.includes(c) ? `${generic} · ${c}` : generic;
}

/** zoneName plus the current offset, e.g. "Pacific Time · Los Angeles (GMT-8)". */
export function zoneLabel(zone, at = Date.now()) {
  const offset = zonePart(zone, 'shortOffset', at);
  const name = zoneName(zone);
  return offset && !name.includes(offset) ? `${name} (${offset})` : name;
}

export function timeZoneOptions(current) {
  let zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  zones = [...new Set([...zones, current].filter(z => z && !COMMON_ZONES.includes(z)))].sort();
  const option = z => `<option value="${esc(z)}" ${z === current ? 'selected' : ''}>${esc(zoneLabel(z))}</option>`;
  return `<optgroup label="${esc(t('tz.common'))}">${COMMON_ZONES.map(option).join('')}</optgroup>`
    + `<optgroup label="${esc(t('tz.all'))}">${zones.map(option).join('')}</optgroup>`;
}
