// Browser-local persistence. This is a single-browser demo store, not a shared database.
import { isValidZone } from './time.js';

export const KEY = 'skillswap3';
export const LEGACY_KEY = 'skillswap1';
export const DRAFT_KEY = 'skillswap3-drafts';
export const SCHEMA_VERSION = 5;

const DEFAULT_AVAILABILITY = () => [
  { day: 'Monday', start: '16:00', end: '18:00' },
  { day: 'Wednesday', start: '16:00', end: '18:00' },
];

/** The five sample profiles shipped with the demo. They are fictional demo students. */
export function seedPeople(zone) {
  return [
    { id: 0, name: 'Eric', teaches: ['Java loops'], learns: ['Guitar chords'] },
    { id: 1, name: 'Maya Chen', teaches: ['Guitar chords'], learns: ['Java loops'] },
    { id: 2, name: 'Alex Rivera', teaches: ['Guitar chords'], learns: ['Spanish conversation'] },
    { id: 3, name: 'Jordan Lee', teaches: ['Spanish conversation'], learns: ['Java loops', 'Guitar chords'] },
    { id: 4, name: 'Sam Patel', teaches: ['Java loops'], learns: ['Guitar chords'] },
  ].map(p => ({ ...p, blocked: [], availability: DEFAULT_AVAILABILITY(), timezone: zone }));
}

export function emptyDb(zone) {
  return { version: SCHEMA_VERSION, active: 0, people: seedPeople(zone), sessions: [], connections: [], messages: [], reports: [] };
}

/** Build a database from the original skillswap1 format. Mirrors the migration in the first prototype. */
export function migrateLegacy(old, zone) {
  const db = emptyDb(zone);
  if (!old) return db;
  const eric = db.people[0];
  if (old.profile) {
    if (old.profile.name) eric.name = old.profile.name;
    if (old.profile.teach) eric.teaches = [old.profile.teach];
    if (old.profile.learn) eric.learns = [old.profile.learn];
  }
  eric.blocked = Array.isArray(old.blocked) ? old.blocked : [];
  db.sessions = (old.sessions || []).map(s => ({
    ...s,
    from: 0,
    to: s.partnerId ?? db.people.find(p => p.name === s.partner)?.id ?? 1,
    results: s.status === 'Completed'
      ? { 0: { goal: s.goal, before: s.before, outcome: s.outcome, notes: s.notes, elapsed: s.elapsed, achieved: s.achieved } }
      : {},
  }));
  db.connections = (old.connections || []).map(c => ({ from: 0, to: c.id, status: c.status }));
  db.reports = old.reports || [];
  return db;
}

const arr = x => (Array.isArray(x) ? x : []);

/**
 * Fill in fields added by later versions so old browser data keeps working.
 * Returns { db, drafts } where drafts are any chat drafts that older versions stored inside the database.
 */
export function normalize(raw, zone) {
  const db = raw && typeof raw === 'object' ? raw : emptyDb(zone);
  if (!arr(db.people).length) db.people = seedPeople(zone);
  for (const p of db.people) {
    p.teaches = arr(p.teaches).length ? p.teaches : [p.teach].filter(Boolean);
    p.learns = arr(p.learns).length ? p.learns : [p.learn].filter(Boolean);
    p.availability = Array.isArray(p.availability) ? p.availability : DEFAULT_AVAILABILITY();
    p.timezone = isValidZone(p.timezone) ? p.timezone : zone;
    p.blocked = [...new Set(arr(p.blocked))];
  }
  db.sessions = arr(db.sessions).map(s => ({ ...s, results: s.results && typeof s.results === 'object' ? s.results : {} }));
  db.connections = arr(db.connections);
  db.messages = arr(db.messages);
  db.reports = arr(db.reports);
  if (!db.people.some(p => p.id === db.active)) db.active = db.people[0].id;
  const drafts = db.drafts && typeof db.drafts === 'object' ? db.drafts : {};
  delete db.drafts;
  // Nov 2026 sample-data fix: give Alex and Jordan a two-way match. Applied once, only to an unedited Jordan.
  const jordan = db.people.find(p => p.id === 3 && p.name === 'Jordan Lee');
  if (!db.seedMutualFix && jordan && jordan.learns.length === 1 && jordan.learns[0] === 'Java loops') jordan.learns.push('Guitar chords');
  db.seedMutualFix = true;
  db.version = SCHEMA_VERSION;
  return { db, drafts };
}

function readJson(storage, key) {
  const raw = storage.getItem(key);
  if (raw == null) return { value: null, raw };
  try { return { value: JSON.parse(raw), raw }; } catch { return { value: undefined, raw }; }
}

/** Load (and if needed migrate) the demo database. */
export function load(storage, zone) {
  let warning = '';
  let current;
  try { current = readJson(storage, KEY); } catch { return { db: emptyDb(zone), drafts: {}, warning: 'warn.storageBlocked' }; }
  let source = current.value;
  if (current.value === undefined) {
    try { storage.setItem(`${KEY}-unreadable-${Date.now()}`, current.raw); } catch { /* ignore */ }
    warning = 'warn.unreadable'; // translation key
    source = null;
  }
  if (!source) {
    const legacy = readJson(storage, LEGACY_KEY).value;
    source = migrateLegacy(legacy || null, zone);
  }
  const { db, drafts } = normalize(source, zone);
  let storedDrafts = {};
  try { storedDrafts = readJson(storage, DRAFT_KEY).value || {}; } catch { /* ignore */ }
  return { db, drafts: { ...drafts, ...storedDrafts }, warning };
}

/** Persist the database. Returns false when the browser refuses (quota, privacy mode). */
export function save(storage, db) {
  try { storage.setItem(KEY, JSON.stringify(db)); return true; } catch { return false; }
}

export function saveDrafts(storage, drafts) {
  try { storage.setItem(DRAFT_KEY, JSON.stringify(drafts)); return true; } catch { return false; }
}
