// Every translation catalog must match the English keys, keep placeholders, and cover its plural categories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import en from '../dist/i18n/en.js';
import { LANGUAGES, setLocale, t, bestMatch, tv } from '../dist/js/i18n.js';

const placeholders = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
const forms = v => (typeof v === 'object' ? Object.values(v) : [v]);

for (const { code } of LANGUAGES.filter(l => l.code !== 'en')) {
  test(`catalog ${code} is complete and consistent`, async () => {
    const cat = (await import(`../dist/i18n/${code}.js`)).default;
    const missing = Object.keys(en).filter(k => !(k in cat));
    const extra = Object.keys(cat).filter(k => !(k in en));
    assert.deepEqual(missing, [], `${code} missing keys`);
    assert.deepEqual(extra, [], `${code} unknown keys`);
    const needed = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
    for (const [k, v] of Object.entries(en)) {
      const want = placeholders(forms(v).find(f => /\{/.test(f)) ?? '');
      for (const f of forms(cat[k])) {
        assert.equal(typeof f, 'string', `${code} ${k} must be text`);
        if (k !== 'close.title2') assert.ok(f.trim(), `${code} ${k} is empty`); // some languages fold this connector word into the next phrase
        if (typeof v !== 'object') assert.equal(placeholders(f), want, `${code} ${k} placeholders`);
        else for (const p of placeholders(f).split(',').filter(Boolean)) assert.ok(want.includes(p), `${code} ${k} unknown placeholder ${p}`);
        assert.ok(!/—/.test(f), `${code} ${k} uses an em dash`);
      }
      if (typeof v === 'object') {
        assert.equal(typeof cat[k], 'object', `${code} ${k} must have plural forms`);
        for (const c of needed) if (c !== 'many' || code !== 'fr') assert.ok(cat[k][c] || cat[k].other, `${code} ${k} lacks ${c}`);
        assert.ok(cat[k].other, `${code} ${k} lacks other`);
      }
    }
  });
}

test('t() fills placeholders, picks plurals and falls back to English', async () => {
  await setLocale('en');
  assert.equal(t('unread', { n: 1 }), '1 unread message');
  assert.equal(t('unread', { n: 3 }), '3 unread messages');
  assert.equal(t('top.viewing', { name: 'Maya' }), 'Viewing as Maya');
  assert.equal(t('no.such.key'), 'no.such.key');
  assert.equal(tv('fmt', 'Interview practice'), 'Interview practice');
  await setLocale('ru');
  assert.match(t('unread', { n: 5 }), /^5 /);
  await setLocale('xx-unknown');
  assert.equal(t('page.Discover'), 'Discover');
});

test('browser language matching', () => {
  assert.equal(bestMatch(['es-MX']), 'es');
  assert.equal(bestMatch(['zh-TW']), 'zh-Hant');
  assert.equal(bestMatch(['zh-CN']), 'zh-Hans');
  assert.equal(bestMatch(['pt-PT']), 'pt-BR');
  assert.equal(bestMatch(['fil-PH']), 'tl');
  assert.equal(bestMatch(['sw', 'fr-CA']), 'fr');
  assert.equal(bestMatch(['sw']), 'en');
});
