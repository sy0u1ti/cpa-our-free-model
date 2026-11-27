import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const source = read('web/i18n.js');
const html = read('web/index.html');
const cjk = /[\u4e00-\u9fff]/;

// Builds the globals a page sees: its own URL, an optional same-origin parent
// document (the CPA Management Center) and the browser language list.
function load({ search = '', parentLang, parent, languages, language, topLevel = false } = {}) {
  const window = {};
  if (topLevel) window.parent = window;
  else if (parent) window.parent = parent;
  else if (parentLang !== undefined) window.parent = { document: { documentElement: { lang: parentLang } } };
  const context = { window, location: new URL('https://cpa.example/v0/resource/plugins/our-free-model/console' + search) };
  if (languages || language) context.navigator = { languages, language };
  if (topLevel) context.document = { documentElement: { lang: 'zh-CN' } };
  vm.createContext(context);
  vm.runInContext(source, context);
  return window.ofmI18n;
}

test('language follows the lang parameter, then the CPA host page, then the browser', () => {
  assert.equal(load().locale, 'zh-CN', 'no signal keeps the original Chinese page');
  assert.equal(load({ languages: ['en-US', 'zh-CN'] }).locale, 'en');
  assert.equal(load({ parentLang: 'zh-CN', languages: ['en-US'] }).locale, 'zh-CN');
  assert.equal(load({ parentLang: 'en', languages: ['zh-CN'] }).locale, 'en');
  assert.equal(load({ search: '?lang=en', parentLang: 'zh-CN', languages: ['zh-CN'] }).locale, 'en');
  assert.equal(load({ search: '?layout=embedded&lang=zh-HK', parentLang: 'en' }).locale, 'zh-CN');
  assert.equal(load({ search: '?lang=', parentLang: '', languages: ['en-GB'] }).locale, 'en', 'empty values fall through');
  assert.equal(load({ language: 'en-AU' }).locale, 'en', 'navigator.language is used without navigator.languages');
});

test('Chinese variants share the Simplified catalog and every other language gets English', () => {
  for (const tag of ['zh', 'zh-CN', 'zh-cn', 'zh-SG', 'zh-Hans', 'zh-Hans-CN', 'zh-TW', 'zh-HK', 'zh-Hant', 'zh-Hant-TW', 'zh_TW']) {
    assert.equal(load({ languages: [tag] }).locale, 'zh-CN', tag);
  }
  for (const tag of ['en', 'en-US', 'en-GB', 'ru', 'ru-RU', 'fr-FR', 'ja', 'de']) {
    assert.equal(load({ languages: [tag] }).locale, 'en', tag);
  }
  assert.equal(load({ parentLang: 'ru', languages: ['zh-CN'] }).locale, 'en', 'a host language other than Chinese reads as English');
});

test('an unreadable or self parent never decides the language', () => {
  const crossOrigin = { get document() { throw new Error('SecurityError'); } };
  assert.equal(load({ parent: crossOrigin, languages: ['en-US'] }).locale, 'en');
  assert.equal(load({ parent: crossOrigin, languages: ['zh-TW'] }).locale, 'zh-CN');
  // A top-level page must not read its own static <html lang="zh-CN">.
  assert.equal(load({ topLevel: true, languages: ['en-US'] }).locale, 'en');
});

test('messages interpolate values, pick English singulars and fall back to Chinese', () => {
  const en = load({ languages: ['en'] });
  assert.equal(en.t('selection.loaded', { count: 3 }), 'Loaded 3 upstream models. Uncheck a model to exclude it.');
  assert.equal(en.t('selection.loaded', { count: 1 }), 'Loaded 1 upstream model. Uncheck a model to exclude it.');
  assert.equal(en.t('manager.httpError', { status: 401 }).startsWith('CPA returned HTTP 401.'), true);
  assert.equal(en.t('status.line', { name: 'A', value: '{value}' }), 'A: {value}', 'values are not re-expanded');
  assert.equal(en.t('missing.key'), 'missing.key');
  delete en.catalogs.en['copy.done'];
  assert.equal(en.t('copy.done'), '已复制。', 'a key missing from English falls back to Chinese');
  const zh = load();
  assert.equal(zh.t('selection.loaded', { count: 1 }), '已读取 1 个上游模型，取消勾选即可排除。');
  assert.equal(zh.fromServer('server.release.current', '服务器原文'), '服务器原文', 'Chinese keeps the server text');
  assert.equal(load({ languages: ['en'] }).fromServer('server.release.current', '服务器原文'), 'The running version matches the latest official Release.');
  assert.equal(load({ languages: ['en'] }).fromServer('server.release.new-state', '服务器原文'), '服务器原文', 'an unknown state keeps the server text');
});

test('catalogs stay in sync, keep placeholders and use no em or en dashes in English', () => {
  const { catalogs } = load();
  const zh = catalogs['zh-CN'], en = catalogs.en;
  const enOnly = key => key.startsWith('server.') || key.endsWith('_one');
  assert.deepEqual(Object.keys(en).filter(key => !enOnly(key)).sort(), Object.keys(zh).sort());
  assert.equal(Object.keys(zh).some(enOnly), false, 'server texts and singular forms are English-only');
  const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const key of Object.keys(zh)) assert.deepEqual(placeholders(en[key]), placeholders(zh[key]), key);
  for (const [key, text] of Object.entries(en)) {
    assert.doesNotMatch(text, /[\u2013\u2014]/, key);
    if (key.endsWith('_one')) assert.ok(Object.hasOwn(en, key.slice(0, -4)), key);
    // Only the CPA sidebar label is quoted in Chinese, because the host menu
    // itself is not translated.
    if (key !== 'bridge.openFromSidebar') assert.doesNotMatch(text, cjk, key);
  }
  for (const [key, text] of Object.entries(zh)) assert.equal(typeof text, 'string', key);
});

test('server release and source states all have English text', () => {
  const { catalogs } = load();
  for (const [file, prefix] of [['releases.go', 'server.release.'], ['updates.go', 'server.source.']]) {
    const go = read(file);
    const states = new Set([...go.matchAll(/State(?:, result\.Message)?\s*[:=]+\s*"([a-z-]+)"/g)].map(match => match[1]));
    assert.ok(states.size >= 5, file);
    for (const state of states) assert.ok(Object.hasOwn(catalogs.en, prefix + state), prefix + state);
  }
});

const decode = text => text.replace(/&nbsp;/g, '\u00a0').replace(/&rarr;/g, '\u2192').replace(/&nearr;/g, '\u2197')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

test('static page text matches the Chinese catalog and nothing visible is left untagged', () => {
  const zh = load().catalogs['zh-CN'];
  const tagged = [...html.matchAll(/<(\w+)([^>]*)\sdata-i18n="([^"]+)"([^>]*)>([^<]*)<\/\1>/g)];
  // Every data-i18n element holds plain text only, so the whole node can be replaced.
  assert.equal(tagged.length, html.match(/\sdata-i18n="/g).length);
  for (const [, , , key, , text] of tagged) assert.equal(decode(text), zh[key], key);
  for (const [tag] of html.matchAll(/<\w+[^>]*>/g)) {
    for (const [, name, value] of tag.matchAll(/\s([\w-]+)="([^"]*)"/g)) {
      if (name.startsWith('data-i18n-')) {
        const attribute = name.slice('data-i18n-'.length);
        const original = new RegExp(`\\s${attribute}="([^"]*)"`).exec(tag)?.[1];
        assert.equal(original, zh[value], `${attribute} of ${value}`);
      } else if (cjk.test(value)) {
        assert.match(tag, new RegExp(`data-i18n-${name}="`), `untranslated ${name} in ${tag}`);
      }
    }
  }
  const body = html.slice(html.indexOf('<body>'))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(\w+)[^>]*\sdata-i18n="[^"]+"[^>]*>[^<]*<\/\1>/g, '')
    .replace(/<[^>]+>/g, '');
  assert.doesNotMatch(body, cjk, 'visible Chinese text without a data-i18n key');
  assert.match(html, /<title data-i18n="page\.title">/);
  assert.ok(html.indexOf('src="./i18n.js"') < html.indexOf('src="./updater.js"'), 'the catalog loads before its users');
});

test('every message key used by the web scripts exists, and no Chinese copy remains in them', () => {
  const zh = load().catalogs['zh-CN'];
  for (const name of ['manager.js', 'updater.js', 'eac-feedback.js', 'console-bridge.js', 'engine-bridge.js']) {
    const script = read('web/' + name);
    assert.doesNotMatch(script, cjk, name);
    // Literal keys only; dynamic prefixes such as 'status.eac.' + state are checked below.
    for (const [, key] of script.matchAll(/\bt\('([^']+)'\s*[,)]/g)) assert.ok(Object.hasOwn(zh, key), `${name}: ${key}`);
  }
  const updater = read('web/updater.js');
  for (const [, code] of updater.matchAll(/'(plugin_[a-z_]+)'/g)) assert.ok(Object.hasOwn(zh, 'updater.error.' + code), code);
  const feedback = read('web/eac-feedback.js');
  const codes = /new Set\(\[([\s\S]*?)\]\)/.exec(feedback)[1].match(/'[^']+'/g).map(value => value.slice(1, -1));
  assert.equal(codes.length, 12);
  for (const code of codes) assert.ok(Object.hasOwn(zh, 'eac.' + code), code);
  for (const state of ['ready', 'disabled', 'failed', 'unavailable']) assert.ok(Object.hasOwn(zh, 'status.eac.' + state), state);
});

test('apply translates text, attributes and the document language', () => {
  const i18n = load({ languages: ['en-US'] });
  const element = attributes => ({ attributes, textContent: '', getAttribute(name) { return this.attributes[name]; },
    setAttribute(name, value) { this.attributes[name] = value; } });
  const heading = element({ 'data-i18n': 'update.heading' });
  const input = element({ 'data-i18n-placeholder': 'selection.searchPlaceholder', 'data-i18n-aria-label': 'selection.searchLabel' });
  const frame = element({ 'data-i18n-title': 'workspace.frameTitle' });
  const root = { querySelectorAll: selector => [heading, input, frame].filter(node => Object.hasOwn(node.attributes, selector.slice(1, -1))) };
  const document = { documentElement: {} };
  const context = { window: {}, document, navigator: { languages: ['en-US'] } };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.window.ofmI18n.apply(root);
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(heading.textContent, 'Update plugin');
  assert.equal(input.attributes.placeholder, 'Search model name or ID…');
  assert.equal(input.attributes['aria-label'], 'Search models');
  assert.equal(frame.attributes.title, 'Free model account console');
  assert.equal(i18n.locale, 'en');
});
