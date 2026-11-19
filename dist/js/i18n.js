// Translation layer. English is bundled; other catalogs load on demand from ../i18n/<code>.js.
import en from '../i18n/en.js';

/** Languages offered in the settings dialog, named in their own language. */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'it', name: 'Italiano' },
  { code: 'zh-Hans', name: '简体中文' },
  { code: 'zh-Hant', name: '繁體中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'tl', name: 'Tagalog' },
  { code: 'ru', name: 'Русский' },
  { code: 'uk', name: 'Українська' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ar', name: 'العربية', dir: 'rtl' },
];

const cache = { en };
let locale = 'en';
let catalog = en;

export const getLocale = () => locale;
export const getDir = () => LANGUAGES.find(l => l.code === locale)?.dir || 'ltr';
/** Locale for Intl formatting. Arabic keeps Western digits so numbers stay in one system across the page. */
export const intlLocale = () => (locale === 'ar' ? 'ar-u-nu-latn' : locale);

export async function setLocale(code) {
  if (!LANGUAGES.some(l => l.code === code)) code = 'en';
  if (!cache[code]) cache[code] = (await import(`../i18n/${code}.js`)).default;
  locale = code;
  catalog = cache[code];
  return code;
}

/** Translate a key. Plural entries are objects keyed by Intl.PluralRules categories; vars.n picks the form. */
export function t(key, vars = {}) {
  let value = catalog[key] ?? en[key] ?? key;
  if (value && typeof value === 'object') {
    const form = new Intl.PluralRules(intlLocale()).select(Number(vars.n ?? 0));
    value = value[form] ?? value.other ?? en[key]?.other ?? key;
  }
  return String(value).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

/** Translate a stored English value (format, rating, status) if a key exists for it, else show it as entered. */
export function tv(prefix, value) {
  const key = `${prefix}.${value}`;
  return catalog[key] !== undefined || en[key] !== undefined ? t(key) : String(value ?? '');
}

/** Pick the best supported language for the browser's preferred languages. */
export function bestMatch(preferred = []) {
  for (const raw of preferred) {
    const tag = String(raw);
    const exact = LANGUAGES.find(l => l.code.toLowerCase() === tag.toLowerCase());
    if (exact) return exact.code;
    const lower = tag.toLowerCase();
    if (lower.startsWith('zh')) return /-(tw|hk|mo|hant)/.test(lower) ? 'zh-Hant' : 'zh-Hans';
    if (lower.startsWith('pt')) return 'pt-BR';
    if (lower === 'fil' || lower.startsWith('fil-')) return 'tl';
    const base = LANGUAGES.find(l => l.code.split('-')[0] === lower.split('-')[0]);
    if (base) return base.code;
  }
  return 'en';
}

export const catalogs = { en };
