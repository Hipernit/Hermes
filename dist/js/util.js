// Small DOM-free helpers shared by every module.

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape any value for safe insertion into HTML text or attribute values. */
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ENTITIES[c]);

/** Case- and whitespace-insensitive key used for skill matching. */
export const norm = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Split a comma or newline separated list into unique, trimmed entries (case-insensitive). */
export function parseList(text, maxLength = 80) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text ?? '').split(/[,\n]/)) {
    const item = raw.trim().replace(/\s+/g, ' ').slice(0, maxLength);
    if (item && !seen.has(norm(item))) {
      seen.add(norm(item));
      out.push(item);
    }
  }
  return out;
}

export const initials = name => String(name ?? '').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 3).toUpperCase();
export const firstName = name => String(name ?? '').trim().split(/\s+/)[0] || String(name ?? '');

/** Random id. crypto.randomUUID needs a secure context, so fall back when it is missing. */
export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export const clampText = (value, max) => String(value ?? '').trim().slice(0, max);
