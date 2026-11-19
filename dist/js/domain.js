// Business rules for connections, sessions, messages, safety controls and learning records.
// Every function takes the database and the acting profile id, validates ownership, mutates the
// database, and throws RuleError with a user-facing message when the action is not allowed.
// These checks run in the browser, so they are prototype rules, not a security boundary.
import { toInstant, isValidZone, DAYS } from './time.js';
import { uid, clampText, parseList } from './util.js';
import { t } from './i18n.js';

export class RuleError extends Error {}
const fail = message => { throw new RuleError(message); };

export const FORMATS = ['Skill exchange', 'One-way tutoring', 'Study together', 'Project collaboration', 'Practice & feedback'];
export const COMMUNICATION = ['Video call', 'Text chat', 'External meeting link'];
export const CLARITY = ['Not rated', 'Very clear', 'Mostly clear', 'Needs improvement'];
const EXCHANGE_MODES = ['Skill exchange', 'Equal teaching exchange'];
const LIMITS = { intro: 1200, interest: 160, topic: 160, goal: 200, note: 1000, agenda: 1500, message: 3000, report: 1000, custom: 100, text: 2000, nextStep: 300, feedback: 500, reschedule: 500 };

// ---------- lookups ----------
export const person = (db, id) => db.people.find(p => p.id === id);
export const involves = (x, id) => x.from === id || x.to === id;
export const otherOf = (x, id) => (x.from === id ? x.to : x.from);
export const connectionBetween = (db, a, b) => db.connections.find(c => involves(c, a) && otherOf(c, a) === b);
export const isBlocked = (db, a, b) => Boolean(person(db, a)?.blocked.includes(b) || person(db, b)?.blocked.includes(a));
export const isConnected = (db, a, b) => connectionBetween(db, a, b)?.status === 'Connected' && !isBlocked(db, a, b);
export const isExchange = s => EXCHANGE_MODES.includes(s.mode);
export const findSession = (db, id) => db.sessions.find(s => s.id === id);

function sessionFor(db, actor, id) {
  const s = findSession(db, id);
  if (!s || !involves(s, actor)) fail(t('err.sessionGone'));
  return s;
}

// ---------- time ----------
export function sessionStart(db, s) {
  if (Number.isFinite(s.startsAt)) return s.startsAt;
  try { return toInstant(s.date, s.dateZone || person(db, s.from)?.timezone || 'UTC'); } catch { return null; }
}

export function findConflict(db, at, minutes, ids, ignoreId) {
  return db.sessions.find(s => {
    if (s.id === ignoreId || s.status !== 'Planned' || !ids.some(id => involves(s, id))) return false;
    const start = sessionStart(db, s);
    return start !== null && at < start + s.minutes * 60000 && start < at + minutes * 60000;
  }) || null;
}

/** Validate a proposed local time and return its UTC instant. */
export function validateSlot(db, { date, zone, minutes, ids, ignoreId, now }) {
  let at;
  try { at = toInstant(date, zone); } catch (e) { fail(e.message); }
  if (at <= now) fail(t('err.future'));
  if (findConflict(db, at, minutes, ids, ignoreId)) fail(t('err.conflict'));
  return at;
}

/**
 * Where a session sits from one participant's point of view.
 * incoming | outgoing | expired | upcoming | ready (time has come, learning not yet recorded) | done | closed
 */
export function sessionPhase(db, s, actor, now) {
  const start = sessionStart(db, s);
  if (s.status === 'Pending') {
    if (start !== null && start <= now) return 'expired';
    return s.to === actor ? 'incoming' : 'outgoing';
  }
  if (s.status === 'Planned') return start !== null && start <= now ? 'ready' : 'upcoming';
  if (s.status === 'Completed') return s.results?.[actor] ? 'done' : 'ready';
  return 'closed';
}

// ---------- profile ----------
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function updateProfile(db, actor, input) {
  const name = clampText(input.name, 60);
  if (!name) fail(t('err.name'));
  const teaches = parseList(input.teaches);
  const learns = parseList(input.learns);
  if (!teaches.length || !learns.length) fail(t('err.skills'));
  if (!isValidZone(input.timezone)) fail(t('err.zone'));
  const slots = (input.availability || []).map(a => ({ day: a.day, start: a.start, end: a.end }));
  if (slots.some(a => !DAYS.includes(a.day) || !HHMM.test(a.start) || !HHMM.test(a.end) || a.start >= a.end)) fail(t('err.window'));
  const unique = [...new Map(slots.map(a => [`${a.day}|${a.start}|${a.end}`, a])).values()];
  Object.assign(person(db, actor), { name, teaches, learns, teach: teaches[0], learn: learns[0], availability: unique, timezone: input.timezone });
  return person(db, actor);
}

// ---------- connections ----------
export function requestConnection(db, actor, to, { intro, interest } = {}, now = Date.now()) {
  if (actor === to || !person(db, to)) fail(t('err.connectOther'));
  if (isBlocked(db, actor, to)) fail(t('err.unavailable'));
  if (connectionBetween(db, actor, to)) fail(t('err.exists'));
  const text = clampText(intro, LIMITS.intro);
  if (!text) fail(t('err.intro'));
  const c = { id: uid(), from: actor, to, status: 'Pending', intro: text, interest: clampText(interest, LIMITS.interest), createdAt: now };
  db.connections.push(c);
  return c;
}

function closePendingSessions(db, a, b, reason) {
  for (const s of db.sessions) {
    if (involves(s, a) && otherOf(s, a) === b && s.status === 'Pending') Object.assign(s, { status: 'Withdrawn', closedReason: reason });
  }
}

export function respondConnection(db, actor, otherId, action, now = Date.now()) {
  const c = connectionBetween(db, actor, otherId);
  if (!c) fail(t('err.requestGone'));
  const remove = () => { db.connections = db.connections.filter(x => x !== c); };
  if (action === 'accept' && c.to === actor && c.status === 'Pending') {
    if (isBlocked(db, actor, otherId)) fail(t('err.unavailable'));
    Object.assign(c, { status: 'Connected', acceptedAt: now });
  } else if (action === 'decline' && c.to === actor && c.status === 'Pending') remove();
  else if (action === 'withdraw' && c.from === actor && c.status === 'Pending') remove();
  else if (action === 'remove' && c.status === 'Connected') {
    remove();
    closePendingSessions(db, actor, otherId, 'Connection removed');
  } else fail(t('err.connAction'));
  return c;
}

// ---------- sessions ----------
function validLink(link) {
  if (!link) return '';
  let url;
  try { url = new URL(link); } catch { fail(t('err.linkFormat')); }
  if (url.protocol !== 'https:') fail(t('err.https'));
  return url.href;
}

export function createSession(db, actor, to, input, now = Date.now()) {
  if (!isConnected(db, actor, to)) fail(t('err.connectFirst'));
  const topic = clampText(input.topic, LIMITS.topic);
  const goal = clampText(input.goal, LIMITS.goal);
  if (!topic) fail(t('err.topic'));
  if (!goal) fail(t('err.goal'));
  const minutes = Number(input.minutes);
  if (!Number.isInteger(minutes) || minutes < 2 || minutes > 180) fail(t('err.length'));
  let mode = input.format;
  if (mode === 'Custom') {
    mode = clampText(input.customFormat, LIMITS.custom);
    if (!mode) fail(t('err.custom'));
  } else if (!FORMATS.includes(mode)) fail(t('err.format'));
  const communication = COMMUNICATION.includes(input.communication) ? input.communication : 'Video call';
  const link = validLink(clampText(input.link, 500));
  if (communication === 'External meeting link' && !link) fail(t('err.linkNeeded'));
  const share = Number(input.learningShare ?? 50);
  if (!Number.isFinite(share) || share < 0 || share > 100) fail(t('err.share'));
  const zone = person(db, actor).timezone;
  const startsAt = validateSlot(db, { date: input.date, zone, minutes, ids: [actor, to], now });
  const s = {
    id: uid(), from: actor, to, topic, goal,
    note: clampText(input.note, LIMITS.note), agenda: clampText(input.agenda, LIMITS.agenda),
    date: input.date, dateZone: zone, startsAt, minutes,
    mode, format: mode, communication, link,
    learningShare: EXCHANGE_MODES.includes(mode) ? Math.round(share) : 50,
    learner: mode === 'One-way tutoring' && input.learner === 'to' ? 'to' : 'from',
    exchangeTopic: person(db, actor).teaches[0] || '',
    status: 'Pending', results: {}, createdAt: now,
  };
  db.sessions.push(s);
  return s;
}

export function respondSession(db, actor, id, accept, now = Date.now()) {
  const s = sessionFor(db, actor, id);
  if (s.to !== actor || s.status !== 'Pending') fail(t('err.onlyInvited'));
  if (!accept) { s.status = 'Declined'; return s; }
  if (!isConnected(db, s.from, s.to)) fail(t('err.notConnected'));
  const start = sessionStart(db, s);
  if (start === null || start <= now) fail(t('err.expired'));
  s.startsAt = validateSlot(db, { date: s.date, zone: s.dateZone || person(db, s.from).timezone, minutes: s.minutes, ids: [s.from, s.to], ignoreId: s.id, now });
  s.status = 'Planned';
  s.acceptedAt = now;
  return s;
}

export function cancelSession(db, actor, id) {
  const s = sessionFor(db, actor, id);
  if (s.status === 'Pending' && s.from === actor) s.status = 'Withdrawn';
  else if (s.status === 'Planned') Object.assign(s, { status: 'Cancelled', cancelledBy: actor });
  else fail(t('err.cantCancel'));
  delete s.reschedule;
  return s;
}

export function proposeReschedule(db, actor, id, { date, note } = {}, now = Date.now()) {
  const s = sessionFor(db, actor, id);
  if (s.status !== 'Planned') fail(t('err.onlyAccepted'));
  if (s.reschedule) fail(t('err.pendingReschedule'));
  const zone = person(db, actor).timezone;
  const at = validateSlot(db, { date, zone, minutes: s.minutes, ids: [s.from, s.to], ignoreId: s.id, now });
  s.reschedule = { by: actor, at, date, zone, note: clampText(note, LIMITS.reschedule), createdAt: now };
  return s;
}

export function replyReschedule(db, actor, id, accept, now = Date.now()) {
  const s = sessionFor(db, actor, id);
  const r = s.reschedule;
  if (!r || r.by === actor || s.status !== 'Planned') fail(t('err.onlyOther'));
  if (accept) {
    const at = validateSlot(db, { date: r.date, zone: r.zone, minutes: s.minutes, ids: [s.from, s.to], ignoreId: s.id, now });
    Object.assign(s, { date: r.date, dateZone: r.zone, startsAt: at });
  }
  delete s.reschedule;
  return s;
}

export function withdrawReschedule(db, actor, id) {
  const s = sessionFor(db, actor, id);
  if (s.reschedule?.by !== actor) fail(t('err.onlyProposer'));
  delete s.reschedule;
  return s;
}

// ---------- teaching roles ----------
export function learnerOf(s) {
  if (s.mode === 'One-way tutoring') return s.learner === 'to' ? s.to : s.from;
  return null;
}

/** 'learn' | 'teach' | 'collaborate' for one participant at a point in the practice timer. */
export function roleAt(s, actor, elapsed, total) {
  if (isExchange(s)) {
    const senderLearnsNow = elapsed < total * ((s.learningShare ?? 50) / 100);
    return senderLearnsNow === (s.from === actor) ? 'learn' : 'teach';
  }
  if (s.mode === 'One-way tutoring') return learnerOf(s) === actor ? 'learn' : 'teach';
  return 'collaborate';
}

/** Plain-language description of the teaching split for one participant. */
export function roleSummary(s, actor) {
  if (isExchange(s)) {
    const share = (s.learningShare ?? 50) / 100;
    const senderLearn = Math.round(s.minutes * share);
    const senderTeach = s.minutes - senderLearn;
    const iAmSender = s.from === actor;
    const learnMin = iAmSender ? senderLearn : senderTeach;
    const teachMin = iAmSender ? senderTeach : senderLearn;
    if (!learnMin) return t('role.teachAll', { n: s.minutes });
    if (!teachMin) return t('role.learnAll', { n: s.minutes });
    return iAmSender ? t('role.learnFirst', { a: learnMin, b: teachMin }) : t('role.teachFirst', { a: teachMin, b: learnMin });
  }
  if (s.mode === 'One-way tutoring') return learnerOf(s) === actor ? t('role.learner') : t('role.teacher');
  return t('role.together');
}

// ---------- messages ----------
export function sendMessage(db, actor, to, text, now = Date.now()) {
  if (!isConnected(db, actor, to)) fail(t('err.messageConnected'));
  const body = clampText(text, LIMITS.message);
  if (!body) fail(t('err.message'));
  const m = { id: uid(), from: actor, to, text: body, at: now };
  db.messages.push(m);
  return m;
}

export const conversation = (db, actor, otherId) => db.messages.filter(m => involves(m, actor) && otherOf(m, actor) === otherId);

export function unreadCount(db, actor, from = 'all') {
  return db.messages.filter(m => m.to === actor && !m.read && isConnected(db, actor, m.from) && (from === 'all' || m.from === Number(from))).length;
}

export function markRead(db, actor, from) {
  let changed = false;
  for (const m of db.messages) if (m.to === actor && m.from === from && !m.read) { m.read = true; changed = true; }
  return changed;
}

// ---------- safety ----------
/** Block hides both people from each other, ends the connection and closes open plans between them. */
export function blockPerson(db, actor, target, now = Date.now()) {
  if (actor === target || !person(db, target)) fail(t('err.blockOther'));
  const me = person(db, actor);
  if (!me.blocked.includes(target)) me.blocked.push(target);
  db.connections = db.connections.filter(c => !(involves(c, actor) && otherOf(c, actor) === target));
  for (const s of db.sessions) {
    if (!(involves(s, actor) && otherOf(s, actor) === target)) continue;
    if (s.status === 'Pending') Object.assign(s, { status: 'Withdrawn', closedReason: 'Blocked' });
    if (s.status === 'Planned' && (sessionStart(db, s) ?? 0) > now) Object.assign(s, { status: 'Cancelled', cancelledBy: actor, closedReason: 'Blocked' });
    delete s.reschedule;
  }
}

export function unblockPerson(db, actor, target) {
  const me = person(db, actor);
  me.blocked = me.blocked.filter(id => id !== target);
}

export function reportPerson(db, actor, target, reason, now = Date.now()) {
  if (actor === target || !person(db, target)) fail(t('err.reportOther'));
  const text = clampText(reason, LIMITS.report);
  if (!text) fail(t('err.reportReason'));
  const r = { id: uid(), from: actor, to: target, reason: text, at: now };
  db.reports.push(r);
  return r;
}

// ---------- learning records ----------
export const canRecord = (s, actor) => Boolean(s && involves(s, actor) && ['Planned', 'Completed'].includes(s.status) && !s.results?.[actor]);

const confidence = v => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null; };

/** Save one participant's private learning record. Clarity and feedback are shared with the partner. */
export function saveResult(db, actor, id, input, elapsed, now = Date.now()) {
  const s = sessionFor(db, actor, id);
  if (!canRecord(s, actor)) fail(t('err.alreadySaved'));
  const outcome = clampText(input.outcome, LIMITS.text);
  if (!outcome) fail(t('err.outcome'));
  s.results[actor] = {
    goal: clampText(input.goal, LIMITS.goal) || s.goal,
    before: clampText(input.before, LIMITS.text),
    notes: clampText(input.notes, LIMITS.text),
    outcome,
    achieved: Boolean(input.achieved),
    elapsed: Math.max(0, Number(elapsed) || 0),
    confidenceBefore: confidence(input.confidenceBefore),
    confidenceAfter: confidence(input.confidenceAfter),
    nextStep: clampText(input.nextStep, LIMITS.nextStep),
    nextStepDone: false,
    rating: CLARITY.includes(input.rating) ? input.rating : 'Not rated',
    feedback: clampText(input.feedback, LIMITS.feedback),
    savedAt: now,
  };
  s.status = 'Completed';
  delete s.reschedule;
  return s.results[actor];
}

export function toggleFollowUp(db, actor, id) {
  const r = sessionFor(db, actor, id).results?.[actor];
  if (!r?.nextStep) fail(t('err.noFollowUp'));
  r.nextStepDone = !r.nextStepDone;
  return r;
}

export function journal(db, actor) {
  return db.sessions
    .filter(s => involves(s, actor) && s.results?.[actor])
    .map(s => ({ session: s, record: s.results[actor], partner: otherOf(s, actor) }))
    .sort((a, b) => (b.record.savedAt || 0) - (a.record.savedAt || 0));
}

/** Clarity ratings and comments partners chose to share with this person. */
export function feedbackReceived(db, actor) {
  return db.sessions.filter(s => involves(s, actor)).flatMap(s => {
    const r = s.results?.[otherOf(s, actor)];
    if (!r || ((!r.rating || r.rating === 'Not rated') && !r.feedback)) return [];
    return [{ session: s, from: otherOf(s, actor), rating: r.rating || 'Not rated', comment: r.feedback || '', at: r.savedAt || 0 }];
  }).sort((a, b) => b.at - a.at);
}

export function progressSummary(db, actor) {
  const entries = journal(db, actor);
  const deltas = entries.map(e => e.record).filter(r => r.confidenceBefore && r.confidenceAfter).map(r => r.confidenceAfter - r.confidenceBefore);
  return {
    records: entries.length,
    achieved: entries.filter(e => e.record.achieved).length,
    minutes: Math.round(entries.reduce((sum, e) => sum + (e.record.elapsed || 0), 0) / 60),
    confidenceChange: deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null,
    confidenceSamples: deltas.length,
    openFollowUps: entries.filter(e => e.record.nextStep && !e.record.nextStepDone).length,
  };
}
