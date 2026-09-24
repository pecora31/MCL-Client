(function () {
  'use strict';

  // Paste the Discord invite here once the server exists; empty keeps the button in its "coming soon" state.
  var DISCORD_URL = '';

  var REPO = 'pecora31/MCL-Client';
  var DOCS_ROOT = 'https://pecora31.github.io/MCL-Client/';
  var RELEASE_API = 'https://api.github.com/repos/' + REPO + '/releases/latest';
  var CACHE_KEY = 'mcl-release-v1';
  var CACHE_TTL_MS = 60 * 60 * 1000;

  var strings = window.MCL_I18N || {};
  var root = document.documentElement;
  var lang = pickLanguage();
  var release = null;

  function store(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
  }

  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function pickLanguage() {
    var saved = load('mcl-lang');
    if (saved === 'vi' || saved === 'en') return saved;
    var nav = (navigator.language || 'en').toLowerCase();
    return nav.indexOf('vi') === 0 ? 'vi' : 'en';
  }

  function t(key) {
    var table = strings[lang] || {};
    return table[key] != null ? table[key] : (strings.en || {})[key] || '';
  }

  function format(template, values) {
    return template.replace(/\{(\w+)\}/g, function (_, k) { return values[k] != null ? values[k] : ''; });
  }

  function applyLanguage() {
    root.lang = lang;
    document.title = t('pageTitle');
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', t('metaDescription'));

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var value = t(el.getAttribute('data-i18n'));
      if (value) el.textContent = value;
    });

    // Docs are built per language: English at the root, Vietnamese under /vi/.
    document.querySelectorAll('[data-doc]').forEach(function (el) {
      el.href = DOCS_ROOT + (lang === 'vi' ? 'vi/' : '') + el.getAttribute('data-doc');
    });

    var toggle = document.getElementById('lang-toggle');
    toggle.textContent = lang === 'vi' ? 'EN' : 'VI';
    toggle.setAttribute('aria-label', lang === 'vi' ? 'Switch to English' : 'Chuyển sang tiếng Việt');

    renderDiscord();
    renderRelease();
  }

  function renderDiscord() {
    var link = document.getElementById('discord-link');
    var label = document.getElementById('discord-label');
    if (DISCORD_URL) {
      link.href = DISCORD_URL;
      link.removeAttribute('aria-disabled');
      label.textContent = t('discJoin');
    } else {
      link.setAttribute('aria-disabled', 'true');
      link.setAttribute('tabindex', '-1');
      label.textContent = t('discSoon');
    }
  }

  function isWindows() {
    var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    return /win/i.test(platform) || /Windows/i.test(navigator.userAgent);
  }

  function renderRelease() {
    if (!release) return;
    var date = new Date(release.date);
    var dateText = isNaN(date) ? '' : date.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    document.getElementById('dl-meta').textContent = format(t('dlMeta'), {
      version: release.version,
      size: release.exeSizeMb,
      date: dateText,
    });
  }

  function applyRelease(data) {
    release = data;
    if (data.exeUrl) document.getElementById('dl-main').href = data.exeUrl;
    if (data.msiUrl) document.getElementById('dl-msi').href = data.msiUrl;
    if (data.notesUrl) document.getElementById('dl-notes').href = data.notesUrl;
    if (data.exeName) document.getElementById('dl-filename').textContent = data.exeName;
    renderRelease();
  }

  function parseRelease(json) {
    var assets = json.assets || [];
    var exe = assets.find(function (a) { return /_x64-setup\.exe$/i.test(a.name); });
    var msi = assets.find(function (a) { return /\.msi$/i.test(a.name); });
    if (!exe) return null;
    return {
      version: String(json.tag_name || '').replace(/^v/, ''),
      date: json.published_at,
      notesUrl: json.html_url,
      exeUrl: exe.browser_download_url,
      exeName: exe.name,
      exeSizeMb: (exe.size / 1048576).toFixed(1),
      msiUrl: msi ? msi.browser_download_url : null,
    };
  }

  function fetchRelease() {
    var cached = null;
    try { cached = JSON.parse(load(CACHE_KEY) || 'null'); } catch (e) { cached = null; }
    if (cached && cached.data) applyRelease(cached.data);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return;

    // On failure the links keep pointing at the GitHub releases page, so downloads still work.
    fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function (json) {
        var data = parseRelease(json);
        if (!data) return;
        store(CACHE_KEY, JSON.stringify({ at: Date.now(), data: data }));
        applyRelease(data);
      })
      .catch(function () { /* fall back to the static links */ });
  }

  document.getElementById('lang-toggle').addEventListener('click', function () {
    lang = lang === 'vi' ? 'en' : 'vi';
    store('mcl-lang', lang);
    applyLanguage();
  });

  document.getElementById('theme-toggle').addEventListener('click', function () {
    var current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    store('mcl-theme', next);
  });

  if (!isWindows()) document.getElementById('dl-os-note').hidden = false;

  // Without a screenshot the hero collapses to a single text column rather than showing an empty frame.
  var shot = document.getElementById('hero-shot');
  function dropShot() {
    shot.closest('figure').remove();
    document.querySelector('.hero-grid').classList.add('no-shot');
  }
  if (shot.complete && shot.naturalWidth === 0) dropShot();
  else shot.addEventListener('error', dropShot);

  applyLanguage();
  fetchRelease();
})();
