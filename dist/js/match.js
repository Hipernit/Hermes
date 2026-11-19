// Partner matching: exact normalized skill overlap plus shared weekly availability across time zones.
import { norm } from './util.js';
import { toInstant, wallTime, addDays, weekdayOf } from './time.js';

const DAY_MS = 86400000;

/** Concrete [start, end] instants for a person's weekly windows over the next `days` days. */
export function upcomingWindows(p, now, days = 8) {
  const out = [];
  const today = wallTime(now, p.timezone).slice(0, 10);
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const day = weekdayOf(date);
    for (const w of p.availability || []) {
      if (w.day !== day || !w.start || !w.end || w.start >= w.end) continue;
      try {
        const start = toInstant(`${date}T${w.start}`, p.timezone);
        const end = toInstant(`${date}T${w.end}`, p.timezone);
        if (end > now) out.push([Math.max(start, now), end]);
      } catch { /* window touches a clock change; skip that one occurrence */ }
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Shared time windows in the coming week (UTC instants), earliest first. Works across time zones. */
export function sharedWindows(a, b, now, minMinutes = 15) {
  const mine = upcomingWindows(a, now);
  const theirs = upcomingWindows(b, now);
  const out = [];
  for (const [s1, e1] of mine) {
    for (const [s2, e2] of theirs) {
      const start = Math.max(s1, s2);
      const end = Math.min(e1, e2);
      if (end - start >= minMinutes * 60000 && start < now + 7 * DAY_MS) out.push([start, end]);
    }
  }
  return out.sort((x, y) => x[0] - y[0]);
}

const QUARTER = 15 * 60000;

/** Earliest start inside a shared window that is still worth booking: at least 10 minutes out, on a quarter hour. */
export function bookableStart([start, end], now, minMinutes = 15) {
  const t = Math.ceil(Math.max(start, now + 10 * 60000) / QUARTER) * QUARTER;
  return t + minMinutes * 60000 <= end ? t : null;
}

export function matchFor(me, p, now = Date.now()) {
  const myLearns = new Set(me.learns.map(norm));
  const myTeaches = new Set(me.teaches.map(norm));
  const theyTeachYouWant = p.teaches.filter(t => myLearns.has(norm(t)));
  const theyWantYouTeach = p.learns.filter(l => myTeaches.has(norm(l)));
  const windows = sharedWindows(me, p, now);
  const fit = theyTeachYouWant.length > 0;
  const swap = theyWantYouTeach.length > 0;
  const overlap = windows.length > 0;
  return { fit, swap, overlap, windows, theyTeachYouWant, theyWantYouTeach, score: (fit ? 50 : 0) + (swap ? 30 : 0) + (overlap ? 20 : 0) };
}
