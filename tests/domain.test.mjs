// Regression tests for Hermes rules. Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../dist/js/domain.js';
import { emptyDb, normalize, migrateLegacy, load, save, saveDrafts, KEY, DRAFT_KEY, LEGACY_KEY } from '../dist/js/store.js';
import { toInstant, wallTime } from '../dist/js/time.js';
import { matchFor, sharedWindows } from '../dist/js/match.js';
import { parseList, esc } from '../dist/js/util.js';

const LA = 'America/Los_Angeles';
const NOW = Date.parse('2027-03-01T18:00:00Z'); // Monday 10:00 in Los Angeles
const ERIC = 0, MAYA = 1, ALEX = 2;

function fresh() {
  const db = emptyDb(LA);
  return db;
}
function connected(db = fresh(), a = ERIC, b = MAYA) {
  D.requestConnection(db, a, b, { intro: 'Hi there' }, NOW);
  D.respondConnection(db, b, a, 'accept', NOW);
  return db;
}
const booking = (date, extra = {}) => ({ topic: 'Guitar chords', goal: 'Play G', date, minutes: 30, format: 'Skill exchange', communication: 'Video call', learningShare: 50, ...extra });
const rejects = (fn, pattern) => assert.throws(fn, err => err instanceof D.RuleError && pattern.test(err.message));

// ---------- connection requests ----------
test('connection request needs an introduction and is directional', () => {
  const db = fresh();
  rejects(() => D.requestConnection(db, ERIC, MAYA, { intro: '   ' }, NOW), /introduction/);
  D.requestConnection(db, ERIC, MAYA, { intro: 'Hello' }, NOW);
  rejects(() => D.requestConnection(db, MAYA, ERIC, { intro: 'Hello back' }, NOW), /already/);
  rejects(() => D.respondConnection(db, ERIC, MAYA, 'accept', NOW), /not available/); // sender cannot accept
  rejects(() => D.respondConnection(db, MAYA, ERIC, 'withdraw', NOW), /not available/); // recipient cannot withdraw
  D.respondConnection(db, MAYA, ERIC, 'accept', NOW);
  assert.equal(D.isConnected(db, ERIC, MAYA), true);
  assert.equal(D.isConnected(db, MAYA, ERIC), true);
});

test('decline and withdraw remove the request so a new one can be sent', () => {
  const db = fresh();
  D.requestConnection(db, ERIC, MAYA, { intro: 'Hello' }, NOW);
  D.respondConnection(db, MAYA, ERIC, 'decline', NOW);
  assert.equal(D.connectionBetween(db, ERIC, MAYA), undefined);
  D.requestConnection(db, ERIC, MAYA, { intro: 'Second try' }, NOW);
  D.respondConnection(db, ERIC, MAYA, 'withdraw', NOW);
  assert.equal(db.connections.length, 0);
});

test('removing a connection withdraws pending session requests but keeps accepted meetings', () => {
  const db = connected();
  const pending = D.createSession(db, ERIC, MAYA, booking('2027-03-03T16:00'), NOW);
  const planned = D.createSession(db, ERIC, MAYA, booking('2027-03-04T16:00'), NOW);
  D.respondSession(db, MAYA, planned.id, true, NOW);
  D.respondConnection(db, MAYA, ERIC, 'remove', NOW);
  assert.equal(pending.status, 'Withdrawn');
  assert.equal(planned.status, 'Planned');
});

// ---------- sessions ----------
test('sessions require an accepted connection (connection-first flow)', () => {
  const db = fresh();
  rejects(() => D.createSession(db, ERIC, MAYA, booking('2027-03-03T16:00'), NOW), /Connect/);
  D.requestConnection(db, ERIC, MAYA, { intro: 'Hello' }, NOW);
  rejects(() => D.createSession(db, ERIC, MAYA, booking('2027-03-03T16:00'), NOW), /Connect/);
});

test('booking validation: past times, links, custom format and external links', () => {
  const db = connected();
  rejects(() => D.createSession(db, ERIC, MAYA, booking('2027-02-27T16:00'), NOW), /future/);
  rejects(() => D.createSession(db, ERIC, MAYA, booking('2027-03-03T16:00', { link: 'http://example.com' }), NOW), /HTTPS/);
  rejects(() => D.createSession(db, ERIC, MAYA, booking('2027-03-03T16:00', { link: 'javascript:alert(1)' }), NOW), /HTTPS/);
  rejects(() => D.createSession(db, ERIC, MAYA, booking('2027-03-03T16:00', { format: 'Custom', customFormat: ' ' }), NOW), /custom format/);
  rejects(() => D.createSession(db, ERIC, MAYA, booking('2027-03-03T16:00', { communication: 'External meeting link' }), NOW), /meeting link/);
  rejects(() => D.createSession(db, ERIC, MAYA, booking('2027-03-03T16:00', { minutes: 500 }), NOW), /between 2 and 180/);
  const s = D.createSession(db, ERIC, MAYA, booking('2027-03-03T16:00', { format: 'Custom', customFormat: 'Interview practice', link: 'https://meet.example.com/x' }), NOW);
  assert.equal(s.mode, 'Interview practice');
  assert.equal(s.startsAt, Date.parse('2027-03-04T00:00:00Z'));
});

test('only the recipient can accept; accepting re-checks conflicts', () => {
  const db = connected();
  connected(db, ERIC, ALEX);
  const a = D.createSession(db, ERIC, MAYA, booking('2027-03-03T16:00'), NOW);
  const b = D.createSession(db, ALEX, ERIC, booking('2027-03-03T16:15'), NOW);
  rejects(() => D.respondSession(db, ERIC, a.id, true, NOW), /invited person/);
  D.respondSession(db, MAYA, a.id, true, NOW);
  rejects(() => D.respondSession(db, ERIC, b.id, true, NOW), /already has an accepted meeting/);
  rejects(() => D.createSession(db, MAYA, ERIC, booking('2027-03-03T16:29'), NOW), /already has an accepted meeting/);
  // back to back is fine
  D.createSession(db, MAYA, ERIC, booking('2027-03-03T16:30'), NOW);
});

test('expired pending requests cannot be accepted but can be dismissed', () => {
  const db = connected();
  const s = D.createSession(db, ERIC, MAYA, booking('2027-03-01T11:00'), NOW);
  const later = NOW + 2 * 3600000;
  assert.equal(D.sessionPhase(db, s, MAYA, later), 'expired');
  rejects(() => D.respondSession(db, MAYA, s.id, true, later), /expired/);
  D.respondSession(db, MAYA, s.id, false, later);
  assert.equal(s.status, 'Declined');
});

test('withdraw is sender-only; cancel works for either participant of an accepted meeting', () => {
  const db = connected();
  const s = D.createSession(db, ERIC, MAYA, booking('2027-03-03T16:00'), NOW);
  rejects(() => D.cancelSession(db, MAYA, s.id), /no longer/);
  rejects(() => D.cancelSession(db, ALEX, s.id), /no longer available/);
  D.respondSession(db, MAYA, s.id, true, NOW);
  D.cancelSession(db, MAYA, s.id);
  assert.equal(s.status, 'Cancelled');
  assert.equal(s.cancelledBy, MAYA);
});

// ---------- rescheduling ----------
test('rescheduling: proposer cannot accept own suggestion, original time stays until accepted', () => {
  const db = connected();
  const s = D.createSession(db, ERIC, MAYA, booking('2027-03-03T16:00'), NOW);
  D.respondSession(db, MAYA, s.id, true, NOW);
  const original = s.startsAt;
  D.proposeReschedule(db, MAYA, s.id, { date: '2027-03-05T17:00', note: 'Practice ran late' }, NOW);
  assert.equal(s.startsAt, original);
  rejects(() => D.proposeReschedule(db, ERIC, s.id, { date: '2027-03-06T17:00' }, NOW), /already waiting/);
  rejects(() => D.replyReschedule(db, MAYA, s.id, true, NOW), /other participant/);
  rejects(() => D.withdrawReschedule(db, ERIC, s.id), /Only the person/);
  rejects(() => D.replyReschedule(db, ALEX, s.id, true, NOW), /no longer available/);
  D.replyReschedule(db, ERIC, s.id, true, NOW);
  assert.equal(s.startsAt, Date.parse('2027-03-06T01:00:00Z'));
  assert.equal(s.reschedule, undefined);
});

test('rescheduling can be declined or withdrawn, and accepting re-validates the slot', () => {
  const db = connected();
  connected(db, ERIC, ALEX);
  const s = D.createSession(db, ERIC, MAYA, booking('2027-03-03T16:00'), NOW);
  D.respondSession(db, MAYA, s.id, true, NOW);
  D.proposeReschedule(db, ERIC, s.id, { date: '2027-03-05T17:00' }, NOW);
  D.withdrawReschedule(db, ERIC, s.id);
  D.proposeReschedule(db, ERIC, s.id, { date: '2027-03-05T17:00' }, NOW);
  // Alex books Eric at that time before Maya answers
  const clash = D.createSession(db, ALEX, ERIC, booking('2027-03-05T17:00'), NOW);
  D.respondSession(db, ERIC, clash.id, true, NOW);
  rejects(() => D.replyReschedule(db, MAYA, s.id, true, NOW), /already has an accepted meeting/);
  D.replyReschedule(db, MAYA, s.id, false, NOW);
  assert.equal(s.startsAt, Date.parse('2027-03-04T00:00:00Z'));
});

// ---------- time zones ----------
test('daylight-saving gaps and repeats are rejected rather than guessed', () => {
  assert.throws(() => toInstant('2027-03-14T02:30', LA), /does not exist/);
  assert.throws(() => toInstant('2027-11-07T01:30', LA), /occurs twice/);
  assert.equal(toInstant('2027-03-14T03:30', LA), Date.parse('2027-03-14T10:30:00Z'));
  assert.equal(wallTime(Date.parse('2027-07-01T19:00:00Z'), 'Asia/Kolkata'), '2027-07-02T00:30');
});

test('matching finds shared windows across time zones', () => {
  const db = fresh();
  const eric = D.person(db, ERIC);
  const maya = D.person(db, MAYA);
  eric.availability = [{ day: 'Monday', start: '16:00', end: '18:00' }]; // LA, 00:00 to 02:00 UTC Tuesday
  maya.timezone = 'America/New_York';
  maya.availability = [{ day: 'Monday', start: '19:00', end: '20:00' }]; // 00:00 to 01:00 UTC Tuesday
  const m = matchFor(eric, maya, NOW);
  assert.equal(m.fit && m.swap && m.overlap, true);
  assert.equal(m.score, 100);
  assert.equal(m.windows[0][0], Date.parse('2027-03-02T00:00:00Z'));
  assert.equal(m.windows[0][1], Date.parse('2027-03-02T01:00:00Z'));
  // Same clock times in different zones do not overlap (the original matched on clock text alone).
  maya.availability = [{ day: 'Monday', start: '16:00', end: '18:00' }];
  assert.equal(sharedWindows(eric, maya, NOW).length, 0);
});

test('skill matching is case and whitespace insensitive', () => {
  const db = fresh();
  D.person(db, MAYA).teaches = ['  guitar   CHORDS '];
  assert.deepEqual(matchFor(D.person(db, ERIC), D.person(db, MAYA), NOW).theyTeachYouWant, ['  guitar   CHORDS ']);
  assert.deepEqual(parseList('Java, java ,\nGuitar  chords,,'), ['Java', 'Guitar chords']);
});

// ---------- teaching roles (original interval bug) ----------
test('skill exchange roles switch at the learning share for both participants', () => {
  const s = { from: ERIC, to: MAYA, mode: 'Skill exchange', learningShare: 25, minutes: 40 };
  assert.equal(D.roleAt(s, ERIC, 0, 2400), 'learn');
  assert.equal(D.roleAt(s, MAYA, 0, 2400), 'teach');
  assert.equal(D.roleAt(s, ERIC, 601, 2400), 'teach');
  assert.equal(D.roleAt(s, MAYA, 601, 2400), 'learn');
  assert.equal(D.roleSummary(s, ERIC), 'You learn first for 10 min, then teach for 30 min.');
  assert.equal(D.roleSummary(s, MAYA), 'You teach first for 10 min, then learn for 30 min.');
  assert.equal(D.roleAt({ ...s, mode: 'Equal teaching exchange', learningShare: undefined }, ERIC, 1300, 2400), 'teach');
});

test('one-way tutoring records who is learning; other formats collaborate', () => {
  const s = { from: ERIC, to: MAYA, mode: 'One-way tutoring', learner: 'to' };
  assert.equal(D.roleAt(s, MAYA, 0, 60), 'learn');
  assert.equal(D.roleAt(s, ERIC, 0, 60), 'teach');
  assert.equal(D.roleAt({ ...s, mode: 'Study together' }, ERIC, 0, 60), 'collaborate');
});

// ---------- messages and unread ----------
test('messages need a connection and unread counts are per profile and per sender', () => {
  const db = connected();
  connected(db, ALEX, ERIC);
  rejects(() => D.sendMessage(db, MAYA, ALEX, 'hi', NOW), /connected/);
  rejects(() => D.sendMessage(db, ERIC, MAYA, '   ', NOW), /Write a message/);
  D.sendMessage(db, MAYA, ERIC, 'one', NOW);
  D.sendMessage(db, MAYA, ERIC, 'two', NOW);
  D.sendMessage(db, ALEX, ERIC, 'three', NOW);
  assert.equal(D.unreadCount(db, ERIC), 3);
  assert.equal(D.unreadCount(db, ERIC, MAYA), 2);
  assert.equal(D.unreadCount(db, ERIC, String(ALEX)), 1);
  assert.equal(D.unreadCount(db, MAYA), 0); // the sender has nothing unread
  assert.equal(D.markRead(db, ERIC, MAYA), true);
  assert.equal(D.markRead(db, ERIC, MAYA), false);
  assert.equal(D.unreadCount(db, ERIC), 1);
  assert.deepEqual(D.conversation(db, MAYA, ERIC).map(m => m.text), ['one', 'two']);
  assert.equal(D.conversation(db, MAYA, ALEX).length, 0);
});

// ---------- safety ----------
test('blocking hides both sides, ends the connection and closes open plans; unblock restores discovery only', () => {
  const db = connected();
  const pending = D.createSession(db, ERIC, MAYA, booking('2027-03-03T16:00'), NOW);
  const planned = D.createSession(db, MAYA, ERIC, booking('2027-03-04T16:00'), NOW);
  D.respondSession(db, ERIC, planned.id, true, NOW);
  D.sendMessage(db, MAYA, ERIC, 'hello', NOW);
  D.blockPerson(db, ERIC, MAYA, NOW);
  D.blockPerson(db, ERIC, MAYA, NOW); // idempotent
  assert.deepEqual(D.person(db, ERIC).blocked, [MAYA]);
  assert.equal(D.isBlocked(db, MAYA, ERIC), true);
  assert.equal(D.connectionBetween(db, ERIC, MAYA), undefined);
  assert.equal(pending.status, 'Withdrawn');
  assert.equal(planned.status, 'Cancelled');
  assert.equal(D.unreadCount(db, ERIC), 0);
  rejects(() => D.requestConnection(db, MAYA, ERIC, { intro: 'please' }, NOW), /not available/);
  D.unblockPerson(db, ERIC, MAYA);
  assert.equal(D.isBlocked(db, ERIC, MAYA), false);
  assert.equal(D.isConnected(db, ERIC, MAYA), false);
});

test('a blocked sender cannot have their introduction accepted', () => {
  const db = fresh();
  D.requestConnection(db, ALEX, ERIC, { intro: 'hi' }, NOW);
  D.person(db, ALEX).blocked.push(ERIC);
  rejects(() => D.respondConnection(db, ERIC, ALEX, 'accept', NOW), /not available/);
});

test('reports need a reason', () => {
  const db = fresh();
  rejects(() => D.reportPerson(db, ERIC, MAYA, '  ', NOW), /Describe/);
  D.reportPerson(db, ERIC, MAYA, 'Spam', NOW);
  assert.equal(db.reports[0].to, MAYA);
});

// ---------- learning records ----------
test('learning records are owned per participant; only clarity and comment are shared', () => {
  const db = connected();
  const s = D.createSession(db, ERIC, MAYA, booking('2027-03-03T16:00'), NOW);
  rejects(() => D.saveResult(db, ERIC, s.id, { outcome: 'x' }, 60, NOW), /already saved/); // still pending
  D.respondSession(db, MAYA, s.id, true, NOW);
  rejects(() => D.saveResult(db, ERIC, s.id, { outcome: ' ' }, 60, NOW), /task result/);
  rejects(() => D.saveResult(db, ALEX, s.id, { outcome: 'x' }, 60, NOW), /no longer available/);
  D.saveResult(db, ERIC, s.id, { outcome: 'Played G cleanly', notes: 'private note', confidenceBefore: '2', confidenceAfter: '4', achieved: true, nextStep: 'Switch G to C', rating: 'Very clear', feedback: 'Slow demo helped' }, 900, NOW);
  assert.equal(s.status, 'Completed');
  rejects(() => D.saveResult(db, ERIC, s.id, { outcome: 'again' }, 1, NOW), /already saved/);
  assert.equal(D.journal(db, MAYA).length, 0); // Maya has not recorded anything
  const fb = D.feedbackReceived(db, MAYA);
  assert.equal(fb.length, 1);
  assert.deepEqual(Object.keys(fb[0]).sort(), ['at', 'comment', 'from', 'rating', 'session']);
  assert.equal(fb[0].comment, 'Slow demo helped');
  const sum = D.progressSummary(db, ERIC);
  assert.deepEqual([sum.records, sum.achieved, sum.minutes, sum.confidenceChange, sum.openFollowUps], [1, 1, 15, 2, 1]);
  D.toggleFollowUp(db, ERIC, s.id);
  assert.equal(D.progressSummary(db, ERIC).openFollowUps, 0);
  rejects(() => D.toggleFollowUp(db, MAYA, s.id), /no follow-up/);
  // Maya can still record her own learning afterwards
  D.saveResult(db, MAYA, s.id, { outcome: 'Explained a for loop' }, 300, NOW);
  assert.equal(D.journal(db, MAYA).length, 1);
});

// ---------- profile ----------
test('profile edits validate input and only change the acting profile', () => {
  const db = fresh();
  const before = JSON.stringify(D.person(db, MAYA));
  rejects(() => D.updateProfile(db, ERIC, { name: 'E', teaches: '', learns: 'x', timezone: LA }), /at least one/);
  rejects(() => D.updateProfile(db, ERIC, { name: 'E', teaches: 'a', learns: 'b', timezone: 'Mars/Base' }), /time zone/);
  rejects(() => D.updateProfile(db, ERIC, { name: 'E', teaches: 'a', learns: 'b', timezone: LA, availability: [{ day: 'Monday', start: '18:00', end: '17:00' }] }), /end after/);
  D.updateProfile(db, ERIC, { name: ' Eric M ', teaches: 'Java loops, Chess', learns: 'Guitar chords', timezone: 'Europe/London', availability: [{ day: 'Friday', start: '15:00', end: '16:00' }, { day: 'Friday', start: '15:00', end: '16:00' }] });
  const eric = D.person(db, ERIC);
  assert.equal(eric.name, 'Eric M');
  assert.deepEqual(eric.teaches, ['Java loops', 'Chess']);
  assert.equal(eric.availability.length, 1);
  assert.equal(JSON.stringify(D.person(db, MAYA)), before);
});

// ---------- storage ----------
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; } };
}

test('store migrates skillswap1 data, moves drafts out of the database and keeps unreadable data', () => {
  const legacy = { profile: { name: 'Eric K', teach: 'Chess', learn: 'Guitar chords' }, blocked: [3], sessions: [{ partner: 'Maya Chen', status: 'Completed', goal: 'g', outcome: 'o' }], connections: [{ id: 1, status: 'Connected' }] };
  const s1 = memoryStorage({ [LEGACY_KEY]: JSON.stringify(legacy) });
  const { db } = load(s1, LA);
  assert.equal(db.people[0].name, 'Eric K');
  assert.deepEqual(db.people[0].teaches, ['Chess']);
  assert.equal(db.sessions[0].to, MAYA);
  assert.equal(db.sessions[0].results[0].outcome, 'o');
  assert.deepEqual(db.connections[0], { from: 0, to: 1, status: 'Connected' });

  const old = emptyDb(LA);
  old.drafts = { '0:1': 'half typed' };
  const s2 = memoryStorage({ [KEY]: JSON.stringify(old), [DRAFT_KEY]: JSON.stringify({ '1:0': 'other' }) });
  const loaded = load(s2, LA);
  assert.deepEqual(loaded.drafts, { '0:1': 'half typed', '1:0': 'other' });
  assert.equal('drafts' in loaded.db, false);

  const s3 = memoryStorage({ [KEY]: '{not json' });
  const broken = load(s3, LA);
  assert.equal(broken.warning, 'warn.unreadable');
  assert.equal(broken.db.people.length, 5);
  assert.ok(Object.keys(s3.data).some(k => k.startsWith(`${KEY}-unreadable-`)));
});

test('save reports failure instead of throwing', () => {
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.equal(save(full, emptyDb(LA)), false);
  assert.equal(saveDrafts(full, {}), false);
});

test('normalize fills fields added by later versions', () => {
  const { db } = normalize({ active: 9, people: [{ id: 0, name: 'Eric', teach: 'Java loops', learn: 'Guitar chords', blocked: [1, 1] }] }, LA);
  assert.deepEqual(db.people[0].teaches, ['Java loops']);
  assert.deepEqual(db.people[0].blocked, [1]);
  assert.equal(db.active, 0);
  assert.deepEqual([db.sessions, db.messages, db.connections, db.reports], [[], [], [], []]);
  assert.equal(migrateLegacy(null, LA).people.length, 5);
});

test('escaping covers HTML-significant characters', () => {
  assert.equal(esc(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
});

test('suggested booking times start in the future on a quarter hour', async () => {
  const { bookableStart } = await import('../dist/js/match.js');
  const now = Date.parse('2027-03-01T18:07:30Z');
  assert.equal(bookableStart([now - 3600000, now + 3600000], now), Date.parse('2027-03-01T18:30:00Z'));
  assert.equal(bookableStart([now - 3600000, now + 20 * 60000], now), null); // too little time left
  assert.equal(bookableStart([Date.parse('2027-03-02T00:00:00Z'), Date.parse('2027-03-02T02:00:00Z')], now), Date.parse('2027-03-02T00:00:00Z'));
});
