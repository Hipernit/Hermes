// HTML builders. Each view reads state and returns a string; app.js wires behavior through data-action.
// All visible text goes through t(). Stored values (formats, ratings, days, page names) stay in English
// and are translated only for display, so changing language never changes saved data.
import { esc, firstName, initials } from './util.js';
import { DAYS, friendlyTime, clockTime, shortDay, wallTime, zoneLabel, zoneName, timeZoneOptions, formatMinutes, dayName, hhmm } from './time.js';
import {
  person, otherOf, connectionBetween, isBlocked, isConnected, isExchange, sessionStart, sessionPhase, roleSummary,
  canRecord, conversation, unreadCount, journal, feedbackReceived, progressSummary, FORMATS, CLARITY, COMMUNICATION,
} from './domain.js';
import { matchFor, bookableStart } from './match.js';
import { t, tv, LANGUAGES, getLocale } from './i18n.js';

export const PAGES = ['Discover', 'My sessions', 'Connections', 'Progress', 'My profile'];

const me = ctx => person(ctx.db, ctx.actor);
const T = (key, vars) => esc(t(key, vars));
const btn = (label, action, attrs = {}, cls = '') => `<button type="button"${cls ? ` class="${cls}"` : ''} data-action="${action}"${Object.entries(attrs).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('')}>${label}</button>`;

export function availabilityText(p) {
  if (!p.availability.length) return t('disc.askAvailability');
  const sorted = [...p.availability].sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start.localeCompare(b.start));
  return sorted.map(a => `${dayName(a.day, 'short')} ${hhmm(a.start)}–${hhmm(a.end)}`).join(' · ') + ` (${zoneName(p.timezone)})`;
}

const windowText = ([start, end], zone) => `${shortDay(start, zone)} ${clockTime(start, zone)}–${clockTime(end, zone)}`;

export function unreadBadge(ctx, id) {
  const n = unreadCount(ctx.db, ctx.actor, id);
  return `<span data-unread="${id}" class="unread-badge"${n ? '' : ' hidden'} aria-label="${T('unread', { n })}">${n > 99 ? '99+' : n}</span>`;
}

// ---------- chrome ----------
export function topBar(ctx) {
  return `<div><span class="badge">${T('top.demo')}</span><h3>${T('top.viewing', { name: me(ctx).name })}</h3><small>${T('top.switchHint')}</small></div>`
    + `<div class="top-controls"><div><label for="demo-profile">${T('top.profile')}</label><select id="demo-profile" data-input="profile">${ctx.db.people.map(p => `<option value="${p.id}"${p.id === ctx.actor ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>`
    + `${btn(T('top.settings'), 'settings', {}, 'secondary settings-button')}</div>`;
}

export function navView(ctx) {
  const { db, actor, now } = ctx;
  const incoming = db.sessions.filter(s => sessionPhase(db, s, actor, now) === 'incoming' && !isBlocked(db, actor, s.from)).length;
  const invites = db.connections.filter(c => c.to === actor && c.status === 'Pending' && !isBlocked(db, actor, c.from)).length;
  return PAGES.map(p => {
    const n = p === 'My sessions' ? incoming : p === 'Connections' ? invites : 0;
    const label = p === 'My sessions' ? T('nav.newRequests', { n }) : T('nav.newIntros', { n });
    const count = n ? `<span class="nav-count" aria-label="${label}">${T('nav.new', { n })}</span>` : '';
    return `<button type="button" data-action="go" data-page="${p}"${ctx.ui.page === p ? ' class="active" aria-current="page"' : ''}><span>${T(`page.${p}`)}</span><span class="nav-meta">${count}${p === 'Connections' ? unreadBadge(ctx, 'all') : ''}</span></button>`;
  }).join('');
}

// ---------- discover ----------
export function connectionButton(ctx, id) {
  const { db, actor } = ctx;
  if (isBlocked(db, actor, id)) return '';
  const c = connectionBetween(db, actor, id);
  if (!c) return btn(T('disc.connect'), 'connect', { id });
  if (c.status === 'Connected') return btn(`${T('disc.chatWith', { name: firstName(person(db, id).name) })} ${unreadBadge(ctx, id)}`, 'open-chat', { id });
  return btn(c.to === actor ? T('disc.review') : T('disc.sent'), 'go', { page: 'Connections' }, 'secondary');
}

function visiblePeople(ctx) {
  const { db, actor, now } = ctx;
  return db.people
    .filter(p => p.id !== actor && !isBlocked(db, actor, p.id))
    .map(p => ({ p, m: matchFor(me(ctx), p, now) }))
    .sort((a, b) => b.m.score - a.m.score);
}

/** The pinned card's skills, with the ones you have in common marked by the highlighter. */
function pinned(items, matched) {
  const hits = new Set(matched);
  return items.map(x => (hits.has(x) ? `<mark class="hl">${esc(x)}</mark>` : esc(x))).join(' · ');
}

function tags(items, matched) {
  const hits = new Set(matched);
  return items.map(x => hits.has(x)
    ? `<span class="tag"><mark class="hl">${esc(x)}</mark><span class="sr-only"> ${T('disc.matchesYou')}</span></span>`
    : `<span class="tag">${esc(x)}</span>`).join('');
}

function overlapLine(ctx, p, m) {
  const zone = me(ctx).timezone;
  const open = m.windows.map(w => [bookableStart(w, ctx.now), w[1]]).filter(w => w[0] !== null);
  if (open.length) {
    const more = open.length > 1 ? ` ${T('disc.more', { n: open.length - 1 })}` : '';
    return `<mark class="hl">${T('disc.sharedTime')}</mark> ${T('disc.yourTime', { time: windowText(open[0], zone) })}${more}`;
  }
  return p.timezone !== zone ? T('disc.noWindowZones') : T('disc.noWindowChat');
}

function matchBadge(m) {
  return m.fit && m.swap ? T('badge.mutual') : m.fit ? T('badge.canHelp') : m.swap ? T('badge.wants') : T('badge.new');
}

export function directoryRows(ctx) {
  const q = ctx.ui.filter.trim().toLowerCase();
  const rows = visiblePeople(ctx).filter(({ p, m }) => (!ctx.ui.reciprocal || (m.fit && m.swap))
    && [p.name, ...p.teaches, ...p.learns].join(' ').toLowerCase().includes(q));
  if (!rows.length) {
    const or = t('disc.or');
    if (ctx.ui.reciprocal && !q) return `<div class="empty">${T('disc.noTwoWay', { learn: me(ctx).learns.join(or), teach: me(ctx).teaches.join(or) })}</div>`;
    return `<div class="empty">${T(ctx.ui.reciprocal ? 'disc.noMatchMutual' : 'disc.noMatch')}</div>`;
  }
  return rows.map(({ p, m }) => `<article class="person-row"><div><div class="avatar" aria-hidden="true">${esc(initials(p.name))}</div><h3>${esc(p.name)}</h3><span class="badge">${matchBadge(m)}</span></div>`
    + `<div><div class="label">${T('disc.askMe')}</div>${tags(p.teaches, m.theyTeachYouWant)}</div>`
    + `<div><div class="label">${T('disc.hereToLearn')}</div>${tags(p.learns, m.theyWantYouTeach)}</div>`
    + `<div><small>${esc(availabilityText(p))}</small><small class="overlap">${overlapLine(ctx, p, m)}</small>${connectionButton(ctx, p.id)}</div></article>`).join('');
}

export function mutualSwitch(ctx) {
  const on = ctx.ui.reciprocal;
  return `<button type="button" class="switch" role="switch" data-action="toggle-reciprocal" aria-checked="${on}"><span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>${T('disc.mutual')}<span class="switch-state" aria-hidden="true">${T(on ? 'common.on' : 'common.off')}</span></button>`;
}

export function discoverView(ctx) {
  const top = visiblePeople(ctx)[0];
  const note = top ? `<div class="exchange-note"><div class="eyebrow">${T('disc.cardEyebrow')}</div><h3>${T('disc.meet', { name: firstName(top.p.name) })}</h3><div class="exchange-line"><span>${T('disc.helpWith')}</span><strong>${pinned(top.p.teaches, top.m.theyTeachYouWant)}</strong></div><div class="exchange-line"><span>${T('disc.youShare')}</span><strong>${pinned(me(ctx).teaches, top.m.theyWantYouTeach)}</strong></div><p>${top.m.swap ? T('disc.goodStart') : T('disc.newConvo')}</p><div class="note-foot">${T('disc.cardFoot')}</div></div>` : '';
  return `<section class="hero"><div class="hero-copy"><div class="eyebrow">${T('disc.eyebrow')}</div><h1>${T('disc.h1a')}<br>${T('disc.h1b')}</h1><p>${T('disc.lead')}</p>${btn(T('disc.cta'), 'go', { page: 'My profile' })}</div>${note}</section>`
    + `<section aria-label="${T('disc.sectionLabel')}"><div class="directory-heading"><div><div class="eyebrow">${T('disc.peopleEyebrow')}</div><h2>${T('disc.peopleTitle')}</h2></div><small>${T('disc.sample')}</small></div>`
    + `<div class="toolbar"><input type="search" data-input="search" aria-label="${T('disc.search')}" placeholder="${T('disc.searchPh')}" value="${esc(ctx.ui.filter)}">${mutualSwitch(ctx)}</div>`
    + `<div id="cards" class="directory" aria-live="polite">${directoryRows(ctx)}</div></section>`
    + `<section class="closing-note"><h2>${T('close.title1')}<br>${T('close.title2')} <span>${T('close.title3')}</span></h2><p>${T('close.body')}</p></section>`;
}

// ---------- connections ----------
export function messagesHtml(ctx, otherId) {
  const { db, actor } = ctx;
  const zone = me(ctx).timezone;
  const today = wallTime(ctx.now, zone).slice(0, 10);
  const list = conversation(db, actor, otherId);
  if (!list.length) return `<p>${T('con.noMessages')}</p>`;
  return list.map(m => {
    const when = (wallTime(m.at, zone).slice(0, 10) === today ? '' : shortDay(m.at, zone) + ' ') + clockTime(m.at, zone);
    return `<div class="bubble ${m.from === actor ? 'outgoing' : ''}"><small>${m.from === actor ? T('common.you') : esc(person(db, m.from).name)} · ${esc(when)}</small><div class="multiline">${esc(m.text)}</div></div>`;
  }).join('');
}

function chatPanel(ctx, id) {
  const { db, actor } = ctx;
  const p = person(db, id);
  const c = connectionBetween(db, actor, id);
  const draft = ctx.drafts[`${actor}:${id}`] || '';
  return `<div class="row"><div><h3>${esc(p.name)}</h3><small>${esc(availabilityText(p))}</small></div>${btn(T('con.plan'), 'plan', { id })}</div>`
    + (c.intro ? `<p class="notice multiline">${T('con.introFrom', { name: person(db, c.from).name, text: c.intro })}</p>` : '')
    + `<div id="chat-history" class="chat-history">${messagesHtml(ctx, id)}</div>`
    + `<form data-form="chat" data-id="${id}"><label for="chat-text">${T('con.message', { name: firstName(p.name) })}</label><textarea id="chat-text" name="text" maxlength="3000" rows="2" required placeholder="${T('con.messagePh')}">${esc(draft)}</textarea><button>${T('con.send')}</button>`
    + `<small class="hint"><kbd>${T('key.enter')}</kbd> ${T('con.hintSend')} · <kbd>${T('key.shift')}</kbd> <kbd>${T('key.enter')}</kbd> ${T('con.hintNewLine')} · ${T('con.hintDrafts')}</small><p role="alert" class="form-error"></p></form>`
    + `<p class="notice">${T('con.demoNote')}</p>`
    + `<div class="actions">${btn(T('con.remove'), 'remove-connection', { id }, 'secondary')}${btn(T('con.reportBlock'), 'report', { id }, 'secondary')}</div>`;
}

export function connectionsView(ctx) {
  const { db, actor } = ctx;
  const all = db.connections.filter(c => (c.from === actor || c.to === actor) && !isBlocked(db, actor, otherOf(c, actor)));
  const pending = all.filter(c => c.status === 'Pending');
  const friends = all.filter(c => c.status === 'Connected');
  const chatId = isConnected(db, actor, ctx.ui.chatId) ? ctx.ui.chatId : null;
  const requests = pending.map(c => {
    const id = otherOf(c, actor);
    const p = person(db, id);
    const incoming = c.to === actor;
    return `<div class="card"><h3>${esc(p.name)}</h3><span class="badge">${T(incoming ? 'con.incoming' : 'con.waiting')}</span><p class="multiline">${c.intro ? esc(c.intro) : T('con.defaultIntro')}</p>${c.interest ? `<p>${T('con.interested', { text: c.interest })}</p>` : ''}<p><small>${T('con.teachesLearns', { teaches: p.teaches.join(', '), learns: p.learns.join(', ') })}</small></p><div class="actions">`
      + (incoming
        ? btn(T('con.accept'), 'connection', { id, act: 'accept' }) + btn(T('common.decline'), 'connection', { id, act: 'decline' }, 'secondary') + btn(T('con.reportBlock'), 'report', { id }, 'secondary')
        : btn(T('con.withdraw'), 'connection', { id, act: 'withdraw' }, 'secondary'))
      + '</div></div>';
  }).join('');
  return `<h1>${T('con.title')}</h1><p>${T('con.lead')}</p>`
    + (pending.length ? `<h2>${T('con.requests')}</h2><div class="grid">${requests}</div>` : '')
    + `<div class="chat-layout"><div class="card"><h3>${T('con.list', { n: friends.length })}</h3>${friends.map(c => {
      const p = person(db, otherOf(c, actor));
      return `<button type="button" class="secondary" data-action="open-chat" data-id="${p.id}"${p.id === chatId ? ' aria-current="true"' : ''}><span>${esc(p.name)}</span>${unreadBadge(ctx, p.id)}</button>`;
    }).join('') || `<p>${T('con.acceptToStart')}</p>`}</div>`
    + `<div id="chat-panel" class="card">${chatId !== null ? chatPanel(ctx, chatId) : `<div class="empty">${T('con.select')}</div>`}</div></div>`;
}

// ---------- sessions ----------
export function sessionCard(ctx, s) {
  const { db, actor, now } = ctx;
  const partnerId = otherOf(s, actor);
  const p = person(db, partnerId);
  const zone = me(ctx).timezone;
  const at = sessionStart(db, s);
  const phase = sessionPhase(db, s, actor, now);
  const sentByMe = s.from === actor;
  const badge = phase === 'expired' ? t('status.Expired') : tv('status', s.status) + (s.closedReason ? ` · ${tv('reason', s.closedReason)}` : '');
  const when = at !== null ? friendlyTime(at, zone) : String(s.date || t('ses.timeUnknown')).replace('T', ' ');
  const theirTime = at !== null && p.timezone !== zone ? `<p><small>${T('ses.forThem', { name: firstName(p.name), time: friendlyTime(at, p.timezone) })}</small></p>` : '';
  const actions = [];
  if (phase === 'incoming') actions.push(btn(T('ses.acceptReq'), 'respond-session', { sid: s.id, act: 'accept' }), btn(T('common.decline'), 'respond-session', { sid: s.id, act: 'decline' }, 'secondary'));
  if (phase === 'outgoing') actions.push(`<span>${T('ses.waitingFor', { name: firstName(p.name) })}</span>`, btn(T('con.withdraw'), 'cancel-session', { sid: s.id }, 'secondary'));
  if (phase === 'expired') {
    actions.push(`<span>${T('ses.passed')}</span>`);
    actions.push(sentByMe ? btn(T('con.withdraw'), 'cancel-session', { sid: s.id }, 'secondary') : btn(T('ses.dismiss'), 'respond-session', { sid: s.id, act: 'decline' }, 'secondary'));
  }
  if (['Planned', 'Completed'].includes(s.status)) {
    if (canRecord(s, actor)) actions.push(btn(T(s.status === 'Completed' ? 'ses.record' : phase === 'ready' ? 'ses.startRecord' : 'ses.start'), 'start-practice', { sid: s.id }));
    else if (s.results?.[actor]) actions.push(`<span class="badge">${T('ses.saved')}</span>`);
    if (s.status === 'Planned') {
      if (!s.reschedule) actions.push(btn(T('ses.suggest'), 'reschedule', { sid: s.id }, 'secondary'));
      actions.push(btn(T('ses.cancel'), 'cancel-session', { sid: s.id }, 'secondary'));
    }
  }
  let proposal = '';
  if (s.status === 'Planned' && s.reschedule) {
    const r = s.reschedule;
    proposal = `<div class="notice"><strong>${r.by === actor ? T('ses.proposedByYou') : T('ses.proposedBy', { name: person(db, r.by).name })}</strong><p>${esc(friendlyTime(r.at, zone))}</p>${r.note ? `<p class="multiline">${esc(r.note)}</p>` : ''}<small>${T('ses.staysScheduled')}</small><div class="actions">`
      + (r.by !== actor
        ? btn(T('ses.acceptNew'), 'reply-reschedule', { sid: s.id, act: 'accept' }) + btn(T('ses.keep'), 'reply-reschedule', { sid: s.id, act: 'decline' }, 'secondary')
        : btn(T('ses.withdrawSuggestion'), 'withdraw-reschedule', { sid: s.id }, 'secondary'))
      + '</div></div>';
  }
  const follow = [];
  if (s.status !== 'Pending' && isConnected(db, actor, partnerId)) follow.push(btn(T('ses.another'), 'plan', { id: partnerId }, 'secondary'));
  return `<article class="card session-card"><div class="row"><h3>${esc(p.name)} · ${esc(s.topic)}</h3><span class="badge">${esc(badge)}</span></div>`
    + `<p>${T('ses.meta', { when, minutes: t('common.minutes', { n: s.minutes }), format: tv('fmt', s.mode) })}</p>${theirTime}`
    + `<p>${sentByMe ? T('ses.yourGoal', { goal: s.goal }) : T('ses.theirGoal', { name: firstName(person(db, s.from).name), goal: s.goal })}</p>`
    + `<p><small>${esc(roleSummary(s, actor))} ${T('ses.communication', { how: tv('comm', s.communication || 'External meeting') })}</small></p>`
    + (s.note ? `<div class="notice multiline"><strong>${sentByMe ? T('ses.yourNote') : T('ses.noteFrom', { name: person(db, s.from).name })}</strong><br>${esc(s.note)}</div>` : '')
    + (s.agenda ? `<p class="multiline">${T('ses.agenda', { text: s.agenda })}</p>` : '')
    + (s.link && ['Planned', 'Completed'].includes(s.status) ? `<p><a href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">${T('ses.link')} ↗</a></p>` : '')
    + (actions.length ? `<div class="actions">${actions.join('')}</div>` : '')
    + proposal
    + (follow.length ? `<div class="actions">${follow.join('')}</div>` : '')
    + '</article>';
}

export function sessionsView(ctx) {
  const { db, actor, now } = ctx;
  const mine = db.sessions.filter(s => s.from === actor || s.to === actor).map(s => ({ s, phase: sessionPhase(db, s, actor, now), at: sessionStart(db, s) ?? 0 }));
  const zone = me(ctx).timezone;
  const intro = `<p class="notice">${T('ses.tzNote', { zone: zoneLabel(zone) })}</p><h1>${T('ses.title', { name: firstName(me(ctx).name) })}</h1><p>${T('ses.lead')}</p>`;
  if (!mine.length) return intro + `<div class="card empty">${T('ses.empty')}</div>`;
  const group = (key, phases) => {
    const rows = mine.filter(x => phases.includes(x.phase)).sort((a, b) => a.at - b.at);
    return rows.length ? `<h2>${T(key)}</h2>${rows.map(x => sessionCard(ctx, x.s)).join('')}` : '';
  };
  const history = mine.filter(x => ['done', 'closed', 'expired'].includes(x.phase)).sort((a, b) => b.at - a.at);
  return intro
    + group('ses.forYou', ['incoming'])
    + group('ses.ready', ['ready'])
    + group('ses.upcoming', ['upcoming'])
    + group('ses.sent', ['outgoing'])
    + (history.length ? `<details class="history"><summary>${T('ses.history', { n: history.length })}</summary>${history.map(x => sessionCard(ctx, x.s)).join('')}</details>` : '');
}

// ---------- progress ----------
const confidenceText = r => (r.confidenceBefore && r.confidenceAfter ? t('pro.confValue', { a: r.confidenceBefore, b: r.confidenceAfter }) : '');

export function progressView(ctx) {
  const { db, actor } = ctx;
  const entries = journal(db, actor);
  const sum = progressSummary(db, actor);
  const zone = me(ctx).timezone;
  const feedback = feedbackReceived(db, actor);
  const followUps = entries.filter(e => e.record.nextStep);
  const fmt = n => new Intl.NumberFormat(getLocale() === 'ar' ? 'ar-u-nu-latn' : getLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1, signDisplay: 'exceptZero' }).format(n);
  const change = sum.confidenceChange === null ? '' : `<span><strong><bdi>${fmt(sum.confidenceChange)}</bdi></strong> ${T('pro.confidence')}</span>`;
  let html = `<h1>${T('pro.title')}</h1><p>${T('pro.lead', { name: me(ctx).name })}</p>`;
  if (!entries.length && !feedback.length) return html + `<div class="card empty">${T('pro.empty')}</div>`;
  if (entries.length) {
    const stat = (n, key) => `<span><strong>${n}</strong> ${T(key, { n })}</span>`;
    html += `<p class="summary-line">${stat(sum.records, 'pro.records')}${stat(sum.achieved, 'pro.goals')}${stat(sum.minutes, 'pro.minutes')}${change}</p>`;
  }
  if (followUps.length) {
    html += `<h2>${T('pro.next')}</h2><ul class="follow-ups">${followUps.map(({ session: s, record: r, partner }) => `<li class="${r.nextStepDone ? 'done' : ''}"><div><strong>${esc(r.nextStep)}</strong><small>${T('pro.from', { topic: s.topic, name: person(db, partner).name })}</small></div>${btn(T(r.nextStepDone ? 'pro.notDone' : 'pro.practiced'), 'follow-up', { sid: s.id }, 'secondary')}</li>`).join('')}</ul>`;
  }
  if (feedback.length) {
    html += `<h2>${T('pro.feedback')}</h2>${feedback.map(f => `<div class="feedback-row"><span class="label">${esc(person(db, f.from).name)} · ${esc(f.session.topic)}</span><p>${f.rating !== 'Not rated' ? `<strong>${T('pro.clarity', { rating: tv('rate', f.rating) })}</strong> ` : ''}${f.comment ? `<span class="multiline">${esc(f.comment)}</span>` : ''}</p></div>`).join('')}`;
  }
  if (entries.length) {
    html += `<h2>${T('pro.recordsTitle')}</h2>${entries.map(({ session: s, record: r, partner }) => {
      const shared = [r.rating && r.rating !== 'Not rated' ? t('pro.sharedClarity', { rating: tv('rate', r.rating) }) : '', r.feedback].filter(Boolean).join('. ');
      const rows = [['pro.before', r.before], ['pro.result', r.outcome], ['pro.notes', r.notes], ['pro.conf', confidenceText(r)], ['pro.nextStep', r.nextStep], ['pro.shared', shared]].filter(([, v]) => v);
      return `<article class="journal-entry"><div><span class="eyebrow">${esc(r.savedAt ? friendlyTime(r.savedAt, zone) : t('pro.earlier'))}</span><h3>${esc(r.goal)}</h3><small>${T('pro.with', { name: person(db, partner).name, topic: s.topic, time: formatMinutes(r.elapsed) })}</small>${r.achieved ? `<span class="badge">${T('pro.achieved')}</span>` : ''}</div><dl>${rows.map(([k, v]) => `<dt>${T(k)}</dt><dd class="multiline">${esc(v)}</dd>`).join('')}</dl></article>`;
    }).join('')}`;
  }
  return html;
}

// ---------- profile ----------
export function slotRow(a = { day: 'Monday', start: '16:00', end: '17:00' }) {
  return `<div class="availability-row"><select aria-label="${T('prof.day')}" name="slot-day">${DAYS.map(d => `<option value="${d}"${a.day === d ? ' selected' : ''}>${esc(dayName(d))}</option>`).join('')}</select><input aria-label="${T('prof.from')}" name="slot-start" type="time" required value="${esc(a.start)}"><input aria-label="${T('prof.until')}" name="slot-end" type="time" required value="${esc(a.end)}">${btn(T('common.remove'), 'remove-slot', {}, 'secondary')}</div>`;
}

export function profileView(ctx) {
  const { db } = ctx;
  const m = me(ctx);
  return `<h1>${T('prof.title')}</h1><p>${T('prof.lead')}</p>`
    + `<form data-form="profile" class="card"><label>${T('prof.name')}<input name="name" required maxlength="60" value="${esc(m.name)}"></label><div class="profile-columns"><label>${T('prof.teach')}<textarea name="teaches" required rows="4" placeholder="${T('prof.teachPh')}">${esc(m.teaches.join('\n'))}</textarea></label><label>${T('prof.learn')}<textarea name="learns" required rows="4" placeholder="${T('prof.learnPh')}">${esc(m.learns.join('\n'))}</textarea></label></div>`
    + `<label>${T('prof.tz')}<select name="timezone" required>${timeZoneOptions(m.timezone)}</select></label><h3>${T('prof.avail')}</h3><p>${T('prof.availHelp')}</p>`
    + `<div id="slots">${m.availability.map(slotRow).join('')}</div>${btn(T('prof.add'), 'add-slot', {}, 'secondary')} <button>${T('prof.save')}</button><p id="profile-error" role="alert" class="form-error"></p></form>`
    + `<section class="card"><h2>${T('prof.blocked')}</h2><p>${T('prof.blockedHelp')}</p>${m.blocked.map(id => `<div class="row"><span>${esc(person(db, id)?.name || t('common.demoStudent'))}</span>${btn(T('prof.unblock'), 'unblock', { id }, 'secondary')}</div>`).join('') || `<p>${T('prof.noBlocked')}</p>`}</section>`;
}

// ---------- dialogs ----------
const formError = '<p role="alert" class="form-error"></p>';

export function connectDialog(ctx, id) {
  const p = person(ctx.db, id);
  return `<h2 id="dialog-title">${T('dlg.connectTitle', { name: p.name })}</h2><p>${T('dlg.connectLead')}</p><form data-form="connect" data-id="${id}"><label>${T('dlg.intro')}<textarea name="intro" required maxlength="1200" rows="5" placeholder="${T('dlg.introPh', { name: firstName(p.name) })}"></textarea></label><label>${T('dlg.interest')}<input name="interest" maxlength="160" placeholder="${T('dlg.interestPh')}"></label>${formError}<div class="actions"><button>${T('dlg.sendConnect')}</button>${btn(T('common.cancel'), 'close-dialog', {}, 'secondary')}</div></form>`;
}

export function bookingDialog(ctx, id) {
  const { db, now } = ctx;
  const p = person(db, id);
  const m = me(ctx);
  const zone = m.timezone;
  const windows = matchFor(m, p, now).windows.map(w => [bookableStart(w, now), w[1]]).filter(w => w[0] !== null).slice(0, 4);
  const topics = [...new Set([...p.teaches, ...m.teaches, ...p.learns, ...m.learns])];
  const suggestions = windows.length
    ? `<div class="slot-suggestions"><span class="label">${T('dlg.sharedTimes')}</span><div class="actions">${windows.map(w => btn(esc(windowText(w, zone)), 'fill-slot', { value: wallTime(w[0], zone) }, 'secondary')).join('')}</div></div>`
    : `<p><small>${T('dlg.noOverlap')}</small></p>`;
  return `<h2 id="dialog-title">${T('dlg.planTitle', { name: p.name })}</h2><p>${esc(availabilityText(p))}</p>${suggestions}`
    + `<form data-form="booking" data-id="${id}"><label>${T('dlg.topic')}<input name="topic" required maxlength="160" list="topic-options" placeholder="${T('dlg.topicPh')}"></label><datalist id="topic-options">${topics.map(x => `<option value="${esc(x)}">`).join('')}</datalist>`
    + `<label>${T('dlg.goal')}<input name="goal" required maxlength="200" placeholder="${T('dlg.goalPh')}"></label><label>${T('dlg.note')}<textarea name="note" maxlength="1000"></textarea></label>`
    + `<label>${T('dlg.date', { zone: zoneName(zone) })}<input name="date" type="datetime-local" required min="${esc(wallTime(now, zone))}"></label><label>${T('dlg.minutes')}<input name="minutes" type="number" min="2" max="180" value="30" required></label>`
    + `<label>${T('dlg.format')}<select name="format" data-input="format">${[...FORMATS, 'Custom'].map(f => `<option value="${esc(f)}">${T(`fmt.${f}`)}</option>`).join('')}</select></label>`
    + `<label data-show-for="Custom" hidden>${T('dlg.custom')}<input name="customFormat" maxlength="100" placeholder="${T('dlg.customPh')}"></label>`
    + `<label data-show-for="One-way tutoring" hidden>${T('dlg.whoLearns')}<select name="learner"><option value="from">${T('dlg.iLearn')}</option><option value="to">${T('dlg.theyLearn', { name: firstName(p.name) })}</option></select></label>`
    + `<div data-show-for="Skill exchange"><label>${T('dlg.share')}<input name="learningShare" type="number" min="0" max="100" value="50" required></label><small>${T('dlg.shareHelp')}</small></div>`
    + `<label>${T('dlg.comm')}<select name="communication">${COMMUNICATION.map(c => `<option value="${esc(c)}">${T(`comm.${c}`)}</option>`).join('')}</select></label><label>${T('dlg.link')}<input name="link" type="url" placeholder="https://…"></label>`
    + `<label>${T('dlg.agenda')}<textarea name="agenda" maxlength="1500" placeholder="${T('dlg.agendaPh')}"></textarea></label>${formError}`
    + `<div class="actions"><button>${T('dlg.sendSession')}</button>${btn(T('common.back'), 'close-dialog', {}, 'secondary')}</div></form>`;
}

export function rescheduleDialog(ctx, s) {
  const zone = me(ctx).timezone;
  return `<h2 id="dialog-title">${T('dlg.reschedTitle')}</h2><p>${T('dlg.reschedLead')}</p><form data-form="reschedule" data-sid="${esc(s.id)}"><label>${T('dlg.newTime', { zone: zoneName(zone) })}<input name="date" type="datetime-local" required min="${esc(wallTime(ctx.now, zone))}"></label><label>${T('dlg.note')}<textarea name="note" maxlength="500" placeholder="${T('dlg.reschedPh')}"></textarea></label>${formError}<div class="actions"><button>${T('dlg.sendSuggestion')}</button>${btn(T('common.back'), 'close-dialog', {}, 'secondary')}</div></form>`;
}

export function reportDialog(ctx, id) {
  const p = person(ctx.db, id);
  return `<h2 id="dialog-title">${T('dlg.reportTitle')}</h2><p>${T('dlg.reportLead')}</p><form data-form="report" data-id="${id}"><label>${T('dlg.reportWhat', { name: p.name })}<textarea name="reason" maxlength="1000" rows="4"></textarea></label>${formError}<div class="actions"><button>${T('dlg.saveReport')}</button>${btn(T('dlg.block'), 'block', { id }, 'secondary')}${btn(T('common.close'), 'close-dialog', {}, 'secondary')}</div><p><small>${T('dlg.blockHelp')}</small></p></form>`;
}

const confidenceOptions = name => `<select name="${name}"><option value="">${T('pr.skip')}</option>${[['1', t('pr.conf1')], ['2', '2'], ['3', t('pr.conf3')], ['4', '4'], ['5', t('pr.conf5')]].map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>`;

export function practiceDialog(ctx, s) {
  const { db, actor } = ctx;
  const partner = person(db, otherOf(s, actor));
  const pname = firstName(partner.name);
  const goal = s.from === actor ? s.goal : isExchange(s) ? t('pr.practiceGoal', { topic: s.exchangeTopic || me(ctx).learns[0] || s.topic }) : t('pr.practiceTeach', { topic: s.topic });
  return `<h2 id="dialog-title">${T('pr.title', { name: partner.name })}</h2><p>${esc(s.topic)} · ${esc(tv('fmt', s.mode))} · ${esc(roleSummary(s, actor))}</p>`
    + `<p id="role" class="role-line" aria-live="polite"></p><div class="clock" id="clock" role="timer" aria-label="${T('pr.timeLeft')}"></div>`
    + `<div class="actions">${btn(T('pr.start'), 'timer-toggle')}${btn(T('pr.add'), 'timer-add', {}, 'secondary')}</div>`
    + `<p class="notice">${T('pr.method')}</p>`
    + `<details class="meeting-tools"><summary>${T('pr.videoSummary')} <span class="muted">${T('pr.videoNote')}</span></summary><div class="video-grid"><div><video id="local-video" autoplay muted playsinline></video><small>${T('common.you')}</small></div><div><video id="remote-video" autoplay playsinline></video><small>${esc(partner.name)}</small></div></div>`
    + `<p id="call-status" role="status">${T('pr.callHelp')}</p>`
    + `<div class="actions">${btn(T('pr.join'), 'video-join')}${btn(T('pr.mute'), 'video-toggle', { kind: 'audio' }, 'secondary')}${btn(T('pr.camOff'), 'video-toggle', { kind: 'video' }, 'secondary')}${btn(T('pr.leave'), 'video-leave', {}, 'secondary')}</div>`
    + `<form data-form="meeting-chat" data-id="${partner.id}"><label for="meeting-message">${T('pr.chat')}</label><textarea id="meeting-message" name="text" rows="2" maxlength="3000" placeholder="${T('con.message', { name: pname })}"></textarea><button>${T('pr.sendChat')}</button>${formError}</form><div id="meeting-messages" class="chat-history"></div></details>`
    + `<form data-form="practice" data-sid="${esc(s.id)}"><h3>${T('pr.record')}</h3><p><small>${T('pr.private')}</small></p>`
    + `<label>${T('pr.goal')}<input name="goal" maxlength="200" value="${esc(goal)}"></label>`
    + `<div class="field-pair"><label>${T('pr.confBefore')}${confidenceOptions('confidenceBefore')}</label><label>${T('pr.confAfter')}${confidenceOptions('confidenceAfter')}</label></div>`
    + `<label>${T('pr.before')}<textarea name="before"></textarea></label><label>${T('pr.notes')}<textarea name="notes"></textarea></label>`
    + `<label>${T('pr.outcome')}<textarea name="outcome" required placeholder="${T('pr.outcomePh')}"></textarea></label>`
    + `<label class="check"><input name="achieved" type="checkbox"> ${T('pr.achieved')}</label>`
    + `<label>${T('pr.next')}<input name="nextStep" maxlength="300" placeholder="${T('pr.nextPh')}"></label>`
    + `<fieldset class="shared"><legend>${T('pr.sharedWith', { name: pname })}</legend><label>${T('pr.clarity', { name: pname })}<select name="rating">${CLARITY.map(c => `<option value="${esc(c)}">${T(`rate.${c}`)}</option>`).join('')}</select></label><label>${T('pr.feedback')}<textarea name="feedback" maxlength="500" rows="2"></textarea></label></fieldset>`
    + `${formError}<div class="actions"><button>${T('pr.save')}</button>${btn(T('pr.leaveNoSave'), 'close-dialog', {}, 'secondary')}</div></form>`;
}

export function meetingMessagesHtml(ctx, partnerId) {
  return conversation(ctx.db, ctx.actor, partnerId).slice(-20)
    .map(m => `<p><b>${m.from === ctx.actor ? T('common.you') : esc(person(ctx.db, m.from).name)}:</b> ${esc(m.text)}</p>`).join('');
}

// ---------- settings ----------
export function settingsDialog(prefs) {
  const radio = (name, value, label) => `<label class="choice"><input type="radio" name="${name}" value="${value}"${prefs[name] === value ? ' checked' : ''}> ${label}</label>`;
  const check = (name, key) => `<label class="check"><input type="checkbox" name="${name}"${prefs[name] ? ' checked' : ''}> ${T(key)}</label>`;
  return `<h2 id="dialog-title">${T('set.title')}</h2><p>${T('set.intro')}</p><form data-form="settings">`
    + `<label>${T('set.language')}<select name="lang" data-input="settings">${LANGUAGES.map(l => `<option value="${l.code}" lang="${l.code}"${l.code === getLocale() ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label><p><small>${T('set.languageNote')}</small></p>`
    + `<fieldset class="choices" data-input="settings"><legend>${T('set.theme')}</legend>${radio('theme', 'system', T('set.theme.system'))}${radio('theme', 'light', T('set.theme.light'))}${radio('theme', 'dark', T('set.theme.dark'))}</fieldset>`
    + `<fieldset class="choices" data-input="settings"><legend>${T('set.textSize')}</legend>${radio('size', '100', T('set.size.100'))}${radio('size', '115', T('set.size.115'))}${radio('size', '130', T('set.size.130'))}</fieldset>`
    + `<fieldset class="choices stacked" data-input="settings">${check('readable', 'set.font')}${check('contrast', 'set.contrast')}${check('motion', 'set.motion')}${check('underline', 'set.underline')}${check('spacing', 'set.spacing')}</fieldset>`
    + `<div class="actions">${btn(T('set.done'), 'close-dialog')}${btn(T('set.reset'), 'reset-settings', {}, 'secondary')}</div></form>`;
}
