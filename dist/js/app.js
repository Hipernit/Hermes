// Hermes controller: UI state, rendering, event delegation, dialogs, the practice timer and tab sync.
import * as store from './store.js';
import * as D from './domain.js';
import * as V from './views.js';
import * as video from './video.js';
import { formatClock } from './time.js';
import { firstName } from './util.js';
import { t, setLocale, getDir, getLocale, bestMatch } from './i18n.js';

const $ = s => document.querySelector(s);
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const ACTIVE_KEY = 'skillswap-active-profile';

const loaded = store.load(localStorage, localZone);
let db = loaded.db;
let drafts = loaded.drafts;
let warning = loaded.warning; // a translation key, or ''
let actor = initialActor();
const ui = { page: 'Discover', filter: '', reciprocal: false, chatId: null };
/** Practice timer for the open practice dialog: { sessionId, partner, elapsed, total, running, last } */
let practice = null;
const dialog = $('#modal');

function initialActor() {
  let id = null;
  try { id = sessionStorage.getItem(ACTIVE_KEY); } catch { /* ignore */ }
  const n = id === null ? NaN : Number(id);
  return db.people.some(p => p.id === n) ? n : db.active;
}

const ctx = () => ({ db, actor, now: Date.now(), ui, drafts });
const name = id => D.person(db, id)?.name || t('common.demoStudent');

function persist() {
  db.active = actor;
  if (!store.save(localStorage, db)) warning = 'warn.saveFailed';
  else if (warning === 'warn.saveFailed') warning = '';
  showWarning();
}

function persistDrafts() { store.saveDrafts(localStorage, drafts); }

function showWarning() {
  const el = $('#storage-warning');
  el.textContent = warning ? t(warning) : '';
  el.hidden = !warning;
}

let flashTimer = null;
function flash(message, isError = false) {
  const el = $('#flash');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.hidden = true; }, isError ? 7000 : 4000);
}

/** Run a domain action. On a rule violation show the message (in the form if given) and return false. */
function attempt(fn, form) {
  try {
    const result = fn();
    persist();
    return result ?? true;
  } catch (e) {
    if (!(e instanceof D.RuleError)) { console.error(e); e = new Error(t('msg.generic')); }
    const box = form?.querySelector('.form-error');
    if (box) box.textContent = e.message;
    else flash(e.message, true);
    return false;
  }
}

// ---------- rendering ----------
const PAGE_VIEWS = { Discover: V.discoverView, 'My sessions': V.sessionsView, Connections: V.connectionsView, Progress: V.progressView, 'My profile': V.profileView };

function render({ keepScroll = false } = {}) {
  const y = window.scrollY;
  const c = ctx();
  if (ui.chatId !== null && !D.isConnected(db, actor, ui.chatId)) ui.chatId = null;
  $('.top').innerHTML = V.topBar(c);
  $('#nav').innerHTML = V.navView(c);
  $('#app').innerHTML = PAGE_VIEWS[ui.page](c);
  if (ui.page === 'Connections' && ui.chatId !== null) afterChatShown();
  showWarning();
  if (keepScroll) window.scrollTo(0, y);
}

function go(page) {
  ui.page = page;
  render();
  window.scrollTo(0, 0);
  const h = $('#app h1');
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
}

function updateBadges() {
  document.querySelectorAll('[data-unread]').forEach(b => {
    const n = D.unreadCount(db, actor, b.dataset.unread);
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n);
    b.setAttribute('aria-label', t('unread', { n }));
  });
}

function markReadIfVisible(from) {
  if (document.visibilityState === 'hidden') return;
  if (D.markRead(db, actor, from)) persist();
  updateBadges();
}

function afterChatShown() {
  const box = $('#chat-history');
  if (box) box.scrollTop = box.scrollHeight;
  markReadIfVisible(ui.chatId);
}

function refreshChat() {
  const box = $('#chat-history');
  if (!box || ui.chatId === null || !D.isConnected(db, actor, ui.chatId)) return;
  box.innerHTML = V.messagesHtml(ctx(), ui.chatId);
  afterChatShown();
}

function refreshMeetingChat() {
  const box = $('#meeting-messages');
  if (!practice || !box) return;
  box.innerHTML = V.meetingMessagesHtml(ctx(), practice.partner);
  box.scrollTop = box.scrollHeight;
  markReadIfVisible(practice.partner);
}

// ---------- dialogs ----------
function openDialog(html, { wide = false, focus = 'form input:not([type=hidden]), form textarea, form select' } = {}) {
  teardownDialog();
  dialog.className = wide ? 'meeting-modal' : '';
  dialog.innerHTML = html;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  if (!dialog.open) dialog.showModal();
  dialog.querySelector(focus)?.focus({ preventScroll: true });
  dialog.scrollTop = 0;
}

/** Stop anything owned by the dialog. Runs on every close path (buttons, Escape, profile switch). */
function teardownDialog() {
  practice = null;
  leaveVideo();
}

function closeDialog() {
  teardownDialog();
  dialog.className = '';
  if (dialog.open) dialog.close();
}

function practiceDirty() {
  if (!practice) return false;
  if (practice.elapsed > 0) return true;
  const f = dialog.querySelector('form[data-form="practice"]');
  return Boolean(f && ['before', 'notes', 'outcome', 'nextStep', 'feedback', 'confidenceBefore', 'confidenceAfter'].some(n => f.elements[n]?.value.trim()));
}

// In-page confirmation. Native confirm() is blocked in sandboxed hosts, so the app never relies on it.
const confirmBox = $('#confirm-dialog');
let confirmResolve = null;
function finishConfirm(value) {
  const resolve = confirmResolve;
  confirmResolve = null;
  if (confirmBox.open) confirmBox.close();
  resolve?.(value);
}
function ask(message, yesLabel = t('common.confirm')) {
  if (confirmResolve) finishConfirm(false);
  $('#confirm-text').textContent = message;
  confirmBox.querySelector('[data-confirm="yes"]').textContent = yesLabel;
  confirmBox.querySelector('[data-confirm="no"]').textContent = t('common.cancel');
  confirmBox.showModal();
  confirmBox.querySelector('[data-confirm="no"]').focus();
  return new Promise(resolve => { confirmResolve = resolve; });
}
confirmBox.addEventListener('click', e => {
  const b = e.target.closest('[data-confirm]');
  if (b) finishConfirm(b.dataset.confirm === 'yes');
});
confirmBox.addEventListener('close', () => finishConfirm(false));

/** Close the main dialog, asking first if a practice record would be lost. */
async function leaveDialog() {
  if (!practiceDirty() || await ask(t('ask.leavePractice'), t('ask.leaveNoSave'))) closeDialog();
}

dialog.addEventListener('cancel', e => { if (practiceDirty()) { e.preventDefault(); leaveDialog(); } });
dialog.addEventListener('close', () => {
  if (dialog.open) return;
  teardownDialog();
  dialog.className = '';
});

// ---------- practice timer ----------


function startPractice(sid) {
  const s = D.findSession(db, sid);
  if (!D.canRecord(s, actor)) { flash(t('err.alreadySaved'), true); return; }
  openDialog(V.practiceDialog(ctx(), s), { wide: true, focus: '[data-action="timer-toggle"]' });
  practice = { sessionId: sid, partner: D.otherOf(s, actor), elapsed: 0, total: s.minutes * 60, running: false, last: 0 };
  tickPractice();
  refreshMeetingChat();
}

function tickPractice() {
  if (!practice) return;
  const s = D.findSession(db, practice.sessionId);
  const toggle = dialog.querySelector('[data-action="timer-toggle"]');
  if (practice.running) {
    const now = Date.now();
    practice.elapsed += (now - practice.last) / 1000;
    practice.last = now;
    if (practice.elapsed >= practice.total) {
      practice.elapsed = practice.total;
      practice.running = false;
      if (toggle) toggle.textContent = t('pr.complete');
    }
  }
  const clock = $('#clock');
  if (clock) clock.textContent = formatClock(practice.total - practice.elapsed);
  const role = $('#role');
  if (role && s) {
    const r = D.roleAt(s, actor, practice.elapsed, practice.total);
    const text = r === 'learn' ? t('role.learn') : r === 'teach' ? t('role.teach') : t('role.collab', { format: s.mode });
    if (role.textContent !== text) role.textContent = text;
  }
}
setInterval(tickPractice, 250);

function toggleTimer(button) {
  if (!practice || practice.elapsed >= practice.total) return;
  tickPractice();
  practice.running = !practice.running;
  practice.last = Date.now();
  button.textContent = practice.running ? t('pr.pause') : t('pr.resume');
}

// ---------- video ----------
const setCallStatus = text => { const el = $('#call-status'); if (el) el.textContent = text; };

function leaveVideo() {
  if (!video.hangup()) return;
  setCallStatus(t('vid.ended'));
  for (const id of ['#local-video', '#remote-video']) { const v = $(id); if (v) v.srcObject = null; }
}

// ---------- display, language and accessibility settings (this browser only) ----------
const PREFS_KEY = 'hermes-prefs';
const DEFAULT_PREFS = { lang: '', theme: 'system', size: '100', readable: false, contrast: false, motion: false, underline: false, spacing: false };
let prefs = loadPrefs();
const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');

function loadPrefs() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch { /* ignore */ }
  const p = { ...DEFAULT_PREFS, ...saved };
  if (!p.lang) p.lang = bestMatch(navigator.languages || [navigator.language]);
  return p;
}

function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } }

/** Apply theme, size and accessibility options to <html>, and the language to static page text. */
function applyPrefs() {
  const root = document.documentElement;
  const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && darkQuery?.matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.size = prefs.size;
  for (const k of ['readable', 'contrast', 'motion', 'underline', 'spacing']) root.classList.toggle(`pref-${k}`, Boolean(prefs[k]));
  root.lang = getLocale();
  root.dir = getDir();
  document.title = t('app.title');
  $('.logo').textContent = t('app.name').toLowerCase() + '.';
  $('#nav').setAttribute('aria-label', t('nav.label'));
  $('.skip-link').textContent = t('app.skip');
}
darkQuery?.addEventListener?.('change', () => { if (prefs.theme === 'system') applyPrefs(); });

async function updateSettings(form, changed) {
  const f = form.elements;
  const next = {
    lang: f.lang.value, theme: f.theme.value, size: f.size.value,
    readable: f.readable.checked, contrast: f.contrast.checked, motion: f.motion.checked, underline: f.underline.checked, spacing: f.spacing.checked,
  };
  const langChanged = next.lang !== prefs.lang;
  prefs = next;
  savePrefs();
  if (langChanged) await setLocale(prefs.lang);
  applyPrefs();
  render({ keepScroll: true });
  if (langChanged) {
    // Redraw the dialog in the new language and keep focus on the language menu.
    dialog.innerHTML = V.settingsDialog(prefs);
    dialog.querySelector('select[name="lang"]').focus();
  } else if (changed) {
    dialog.querySelector(`[name="${changed}"]:checked, [name="${changed}"]`)?.focus();
  }
}

async function resetSettings() {
  prefs = { ...DEFAULT_PREFS, lang: bestMatch(navigator.languages || [navigator.language]) };
  savePrefs();
  await setLocale(prefs.lang);
  applyPrefs();
  render({ keepScroll: true });
  dialog.innerHTML = V.settingsDialog(prefs);
}

// ---------- profile switching ----------
async function switchProfile(id) {
  if (practiceDirty() && !await ask(t('ask.switchPractice'), t('ask.leavePracticeBtn'))) { $('#demo-profile').value = String(actor); return; }
  closeDialog();
  actor = id;
  try { sessionStorage.setItem(ACTIVE_KEY, String(id)); } catch { /* ignore */ }
  Object.assign(ui, { filter: '', reciprocal: false, chatId: null });
  persist();
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ---------- click actions ----------
const num = el => Number(el.dataset.id);
const actions = {
  go: el => go(el.dataset.page),
  'toggle-reciprocal': () => { ui.reciprocal = !ui.reciprocal; render({ keepScroll: true }); },
  connect: el => openDialog(V.connectDialog(ctx(), num(el))),
  'open-chat': el => { ui.chatId = num(el); if (ui.page !== 'Connections') go('Connections'); else render({ keepScroll: true }); $('#chat-text')?.focus({ preventScroll: true }); },
  connection: el => {
    const id = num(el);
    const act = el.dataset.act;
    if (!attempt(() => D.respondConnection(db, actor, id, act))) return render();
    if (act === 'accept') { ui.chatId = id; flash(t('msg.connected', { name: name(id) })); }
    if (act === 'decline') flash(t('msg.declined'));
    if (act === 'withdraw') flash(t('msg.withdrawn'));
    ui.page = 'Connections';
    render({ keepScroll: act !== 'accept' });
  },
  'remove-connection': async el => {
    const id = num(el);
    if (!await ask(t('ask.remove', { name: name(id) }), t('con.remove'))) return;
    if (attempt(() => D.respondConnection(db, actor, id, 'remove'))) { ui.chatId = null; flash(t('msg.removed', { name: name(id) })); }
    render();
  },
  report: el => openDialog(V.reportDialog(ctx(), num(el))),
  block: async el => {
    const id = num(el);
    if (!await ask(t('ask.block', { name: name(id) }), t('ask.blockBtn'))) return;
    if (attempt(() => D.blockPerson(db, actor, id))) { closeDialog(); if (ui.chatId === id) ui.chatId = null; flash(t('msg.blocked', { name: name(id) })); }
    render();
  },
  unblock: el => { if (attempt(() => D.unblockPerson(db, actor, num(el)))) flash(t('msg.unblocked', { name: name(num(el)) })); render({ keepScroll: true }); },
  plan: el => {
    const id = num(el);
    if (!D.isConnected(db, actor, id)) { flash(t('err.connectFirst'), true); return; }
    openDialog(V.bookingDialog(ctx(), id));
  },
  'fill-slot': el => { const input = dialog.querySelector('input[name="date"]'); input.value = el.dataset.value; input.focus(); },
  'respond-session': el => {
    const accept = el.dataset.act === 'accept';
    if (attempt(() => D.respondSession(db, actor, el.dataset.sid, accept))) flash(accept ? t('msg.accepted') : t('msg.reqDeclined'));
    render({ keepScroll: true });
  },
  'cancel-session': async el => {
    if (!await ask(t('ask.cancel'), t('ask.cancelBtn'))) return;
    if (attempt(() => D.cancelSession(db, actor, el.dataset.sid))) flash(t('msg.updated'));
    render({ keepScroll: true });
  },
  reschedule: el => { const s = D.findSession(db, el.dataset.sid); if (s) openDialog(V.rescheduleDialog(ctx(), s)); },
  'reply-reschedule': el => {
    const accept = el.dataset.act === 'accept';
    if (attempt(() => D.replyReschedule(db, actor, el.dataset.sid, accept))) flash(accept ? t('msg.moved') : t('msg.kept'));
    render({ keepScroll: true });
  },
  'withdraw-reschedule': el => { if (attempt(() => D.withdrawReschedule(db, actor, el.dataset.sid))) flash(t('msg.sugWithdrawn')); render({ keepScroll: true }); },
  'start-practice': el => startPractice(el.dataset.sid),
  'timer-toggle': el => toggleTimer(el),
  'timer-add': () => {
    if (!practice) return;
    practice.total += 120;
    const tg = dialog.querySelector('[data-action="timer-toggle"]');
    if (tg?.textContent === t('pr.complete')) tg.textContent = t('pr.resume');
    tickPractice();
  },
  'video-join': () => {
    if (!practice) return;
    video.joinVideo({ sessionId: practice.sessionId, uid: actor, partner: practice.partner, localVideo: () => $('#local-video'), remoteVideo: () => $('#remote-video'), setStatus: setCallStatus });
  },
  'video-toggle': el => {
    const on = video.toggleMedia(el.dataset.kind);
    if (on === null) return;
    el.textContent = el.dataset.kind === 'audio' ? t(on ? 'pr.mute' : 'pr.unmute') : t(on ? 'pr.camOff' : 'pr.camOn');
  },
  'video-leave': () => leaveVideo(),
  'follow-up': el => { attempt(() => D.toggleFollowUp(db, actor, el.dataset.sid)); render({ keepScroll: true }); },
  'add-slot': () => $('#slots').insertAdjacentHTML('beforeend', V.slotRow()),
  'remove-slot': el => el.closest('.availability-row').remove(),
  'close-dialog': () => leaveDialog(),
  settings: () => openDialog(V.settingsDialog(prefs), { focus: 'select[name="lang"]' }),
  'reset-settings': () => resetSettings(),
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  e.preventDefault();
  actions[el.dataset.action](el, e);
});

// ---------- forms ----------
const fields = form => Object.fromEntries(new FormData(form));
const forms = {
  connect: form => {
    const id = num(form);
    if (!attempt(() => D.requestConnection(db, actor, id, fields(form)), form)) return;
    closeDialog();
    flash(t('msg.introSent', { name: name(id) }));
    go('Connections');
  },
  booking: form => {
    const id = num(form);
    if (!attempt(() => D.createSession(db, actor, id, fields(form)), form)) return;
    closeDialog();
    flash(t('msg.sessionSent', { name: name(id) }));
    go('My sessions');
  },
  reschedule: form => {
    if (!attempt(() => D.proposeReschedule(db, actor, form.dataset.sid, fields(form)), form)) return;
    closeDialog();
    flash(t('msg.suggested'));
    render({ keepScroll: true });
  },
  report: form => {
    const id = num(form);
    if (!attempt(() => D.reportPerson(db, actor, id, fields(form).reason), form)) return;
    closeDialog();
    flash(t('msg.reportSaved'));
  },
  profile: form => {
    const data = fields(form);
    data.availability = [...form.querySelectorAll('.availability-row')].map(r => ({
      day: r.querySelector('[name="slot-day"]').value, start: r.querySelector('[name="slot-start"]').value, end: r.querySelector('[name="slot-end"]').value,
    }));
    if (!attempt(() => D.updateProfile(db, actor, data), form)) return;
    flash(t('msg.profileSaved'));
    go('Discover');
  },
  chat: form => {
    const id = num(form);
    const field = form.elements.text;
    form.querySelector('.form-error').textContent = '';
    if (!attempt(() => D.sendMessage(db, actor, id, field.value), form)) return;
    field.value = '';
    delete drafts[`${actor}:${id}`];
    persistDrafts();
    refreshChat();
    field.focus();
  },
  'meeting-chat': form => {
    const field = form.elements.text;
    form.querySelector('.form-error').textContent = '';
    if (!attempt(() => D.sendMessage(db, actor, num(form), field.value), form)) return;
    field.value = '';
    refreshMeetingChat();
  },
  practice: form => {
    if (!practice) return;
    tickPractice();
    const data = fields(form);
    data.achieved = form.elements.achieved.checked;
    if (!attempt(() => D.saveResult(db, actor, form.dataset.sid, data, practice.elapsed), form)) return;
    closeDialog();
    flash(t('msg.recordSaved'));
    go('Progress');
  },
};

document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-form]');
  if (!form || !forms[form.dataset.form]) return;
  e.preventDefault();
  forms[form.dataset.form](form);
});

document.addEventListener('input', e => {
  const target = e.target;
  if (target.dataset.input === 'search') {
    ui.filter = target.value;
    $('#cards').innerHTML = V.directoryRows(ctx());
  } else if (target.id === 'chat-text' && ui.chatId !== null) {
    // Drafts live under their own storage key so typing never re-renders other tabs.
    drafts[`${actor}:${ui.chatId}`] = target.value;
    persistDrafts();
  }
});

document.addEventListener('change', e => {
  const target = e.target;
  if (target.dataset.input === 'profile') switchProfile(Number(target.value));
  if (target.dataset.input === 'format') {
    target.form.querySelectorAll('[data-show-for]').forEach(el => { el.hidden = el.dataset.showFor !== target.value; });
  }
  if (target.closest('form[data-form="settings"]')) updateSettings(target.closest('form'), target.name);
});

document.addEventListener('keydown', e => {
  if (!e.target.matches('#chat-text, #meeting-message')) return;
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    e.target.form.requestSubmit();
  }
});

// ---------- other tabs of this browser ----------
window.addEventListener('storage', e => {
  if (e.key === store.DRAFT_KEY) {
    try { drafts = JSON.parse(e.newValue || '{}') || {}; } catch { /* ignore */ }
    return;
  }
  if (e.key !== store.KEY || !e.newValue) return;
  try { db = store.normalize(JSON.parse(e.newValue), localZone).db; } catch { return; }
  if (!db.people.some(p => p.id === actor)) actor = db.people[0].id;
  syncFromOtherTab();
});

function syncFromOtherTab() {
  const c = ctx();
  $('#nav').innerHTML = V.navView(c);
  updateBadges();
  if (dialog.open) { refreshMeetingChat(); return; }
  // Never rebuild the page under someone who is typing; refresh only the live conversation.
  const a = document.activeElement;
  if (a && $('#app').contains(a) && a.matches('input, textarea, select')) {
    if (ui.page === 'Connections') refreshChat();
    return;
  }
  render({ keepScroll: true });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (practice) refreshMeetingChat();
  else if (ui.page === 'Connections') refreshChat();
});

window.addEventListener('beforeunload', () => video.hangup());

async function boot() {
  try { await setLocale(prefs.lang); } catch { await setLocale('en'); }
  applyPrefs();
  persist();
  render();
}
boot();

// Exposed for automated browser tests and debugging only. Not used by the app itself.
window.__skillswap = { get db() { return db; }, get actor() { return actor; }, get practice() { return practice; }, get prefs() { return prefs; }, ui, firstName };
