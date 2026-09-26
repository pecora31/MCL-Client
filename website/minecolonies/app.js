(function () {
  'use strict';
  var MC = window.MC;
  var byId = {};
  MC.buildings.forEach(function (b) { byId[b.id] = b; });
  var issueById = {};
  MC.issues.forEach(function (i) { issueById[i.id] = i; });
  var stageName = {};
  MC.stages.forEach(function (s) { stageName[s.id] = s.name; });

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function svg(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function imgSrc(name) { return 'img/' + name + '.png'; }
  // Flat item textures are upscaled pixel art; hut renders are already smooth.
  function isFlat(name) { return MC.items.some(function (i) { return i.img === name; }); }
  function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }
  function load(key, fallback) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }

  // ------------------------------------------------------------ detail panel
  function buildingDetail(b) {
    var wrap = el('div', { class: 'detail-inner' });
    var head = el('div', { class: 'detail-head' }, [
      el('img', { src: imgSrc(b.img), alt: '', width: 72, height: 72 }),
      el('div', {}, [el('h3', { text: b.name, id: 'dialog-title' }), el('span', { class: 'stage-tag', text: 'Giai đoạn ' + b.stage + ' · ' + stageName[b.stage] })])
    ]);
    var tips = el('ul');
    b.tips.forEach(function (t) { tips.appendChild(el('li', { text: t })); });
    var dl = el('dl', {}, [
      el('div', {}, [el('dt', { text: 'Làm gì' }), el('dd', { text: b.role })]),
      el('div', {}, [el('dt', { text: 'Cần gì' }), el('dd', { text: b.needs })]),
      el('div', {}, [el('dt', { text: 'Mẹo' }), el('dd', {}, [tips])])
    ]);
    wrap.appendChild(head);
    wrap.appendChild(dl);
    if (b.issues.length) {
      var links = el('div', { class: 'issue-links' });
      b.issues.forEach(function (id) {
        var btn = el('button', { class: 'chip', type: 'button', text: issueById[id].q });
        btn.addEventListener('click', function () { closeDialog(); showIssue(id, true); });
        links.appendChild(btn);
      });
      dl.appendChild(el('div', {}, [el('dt', { text: 'Lỗi hay gặp' }), el('dd', {}, [links])]));
    }
    return wrap;
  }

  function playerDetail() {
    var steps = el('ol');
    ['Mang Clipboard theo người: nó liệt kê mọi yêu cầu đang chờ bạn.',
     'Thấy yêu cầu nào thì bỏ đúng món đó vào Warehouse. Courier sẽ tự chở tới nơi cần.',
     'Món làng tự làm được thì dạy công thức cho thợ, để lần sau khỏi phải đưa tay.'].forEach(function (s) { steps.appendChild(el('li', { text: s })); });
    return el('div', { class: 'detail-inner' }, [
      el('div', { class: 'detail-head' }, [
        el('img', { src: imgSrc('clipboard'), alt: '', width: 72, height: 72, class: 'pixel' }),
        el('div', {}, [el('h3', { text: 'Bạn, chủ làng' }), el('span', { class: 'stage-tag', text: 'Việc của bạn' })])
      ]),
      el('p', { text: 'Dân tự làm hầu hết mọi thứ. Việc của bạn là lấp chỗ thiếu:' }),
      steps
    ]);
  }

  function showDetail(id) {
    var box = $('detail');
    box.innerHTML = '';
    box.appendChild(id === 'player' ? playerDetail() : buildingDetail(byId[id]));
    document.querySelectorAll('.mapnode').forEach(function (n) { n.classList.toggle('active', n.dataset.id === id); });
  }

  // ------------------------------------------------------------ flow map
  function mapNode(map, id, x, y, w, h, sub) {
    var b = byId[id];
    var g = svg('g', { class: 'mapnode', tabindex: '0', role: 'button', 'aria-label': b.name });
    g.dataset.id = id;
    g.appendChild(svg('rect', { x: x, y: y, width: w, height: h, rx: 12 }));
    var img = svg('image', { href: imgSrc(b.img), x: x + w / 2 - 28, y: y + 6, width: 56, height: 56 });
    g.appendChild(img);
    var t = svg('text', { x: x + w / 2, y: y + (sub ? 76 : 82), 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    t.textContent = b.name;
    g.appendChild(t);
    if (sub) {
      var s = svg('text', { x: x + w / 2, y: y + 94, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'sub' });
      s.textContent = sub;
      g.appendChild(s);
    }
    bindSelect(g, id);
    map.appendChild(g);
  }
  function bindSelect(g, id) {
    g.addEventListener('click', function () { showDetail(id); });
    g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(id); } });
  }
  function line(map, x1, y1, x2, y2, cls) {
    map.appendChild(svg('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'flow-line' + (cls ? ' ' + cls : ''), 'marker-end': 'url(#head' + (cls ? '-req' : '') + ')' }));
  }

  function drawMap() {
    var map = $('flow-map');
    var defs = svg('defs', {});
    [['head', 'var(--arrow)'], ['head-req', 'var(--dirt)']].forEach(function (m) {
      var mk = svg('marker', { id: m[0], viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
      // CSS variables only resolve through style, not presentation attributes.
      mk.appendChild(svg('path', { d: 'M2 1L8 5L2 9', fill: 'none', style: 'stroke:' + m[1], 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      defs.appendChild(mk);
    });
    map.appendChild(defs);
    [['Làm ra đồ', 90], ['Kho', 360], ['Dùng đồ', 630]].forEach(function (c) {
      var t = svg('text', { x: c[1], y: 20, 'text-anchor': 'middle', class: 'col-label' });
      t.textContent = c[0];
      map.appendChild(t);
    });
    var rows = [36, 156, 276];
    // arrows first so nodes sit on top
    rows.forEach(function (y) {
      line(map, 166, y + 50, 281, 200);
      line(map, 436, 200, 551, y + 50);
    });
    line(map, 360, 388, 360, 264);
    map.appendChild(svg('path', { d: 'M630 378 L630 421 L464 421', class: 'flow-line req', 'marker-end': 'url(#head-req)' }));

    MC.flow.producers.forEach(function (id, i) { mapNode(map, id, 15, rows[i], 150, 100); });
    mapNode(map, 'warehouse', 285, 140, 150, 120, 'Courier chở ra vào');
    MC.flow.consumers.forEach(function (id, i) { mapNode(map, id, 555, rows[i], 150, 100); });

    var p = svg('g', { class: 'mapnode player', tabindex: '0', role: 'button', 'aria-label': 'Bạn, chủ làng' });
    p.dataset.id = 'player';
    p.appendChild(svg('rect', { x: 255, y: 390, width: 210, height: 64, rx: 12 }));
    p.appendChild(svg('image', { href: imgSrc('clipboard'), x: 267, y: 402, width: 40, height: 40, style: 'image-rendering: pixelated' }));
    var t1 = svg('text', { x: 317, y: 413, 'dominant-baseline': 'central' }); t1.textContent = 'Bạn, chủ làng';
    var t2 = svg('text', { x: 317, y: 432, 'dominant-baseline': 'central', class: 'sub' }); t2.textContent = 'Đưa đồ còn thiếu vào kho';
    p.appendChild(t1); p.appendChild(t2);
    bindSelect(p, 'player');
    map.appendChild(p);
    showDetail('warehouse');
  }

  // ------------------------------------------------------------ roadmap
  var done = new Set(load('mc-roadmap', []));
  function renderRoadmap() {
    var list = $('stages');
    list.innerHTML = '';
    MC.stages.forEach(function (s) {
      var items = MC.buildings.filter(function (b) { return b.stage === s.id; });
      var complete = items.every(function (b) { return done.has(b.id); });
      var li = el('li', { class: 'stage' + (complete ? ' done' : '') }, [
        el('div', { class: 'stage-head' }, [el('h3', { text: s.name }), el('span', { class: 'stage-num', text: 'Giai đoạn ' + s.id })]),
        el('p', { class: 'stage-goal', text: s.goal })
      ]);
      items.forEach(function (b) {
        var input = el('input', { type: 'checkbox' });
        input.checked = done.has(b.id);
        input.addEventListener('change', function () {
          if (input.checked) done.add(b.id); else done.delete(b.id);
          store('mc-roadmap', Array.from(done));
          renderRoadmap();
        });
        li.appendChild(el('label', { class: 'check' }, [input, el('img', { src: imgSrc(b.img), alt: '', width: 36, height: 36 }), el('span', { text: b.name })]));
      });
      list.appendChild(li);
    });
    var total = MC.buildings.length;
    $('progress-text').textContent = done.size + '/' + total;
    $('progress-bar').style.width = (done.size / total * 100) + '%';
    var next = MC.buildings.slice().sort(function (a, b) { return a.stage - b.stage; }).find(function (b) { return !done.has(b.id); });
    $('next-step').textContent = next
      ? 'Bước tiếp theo: xây ' + next.name + ' (giai đoạn ' + next.stage + ', ' + stageName[next.stage].toLowerCase() + '). ' + next.role
      : 'Đã xây đủ các công trình chính. Tiếp theo là nâng cấp chúng và nghiên cứu ở University.';
  }
  $('reset-progress').addEventListener('click', function () {
    if (!done.size || confirm('Bỏ tick toàn bộ lộ trình?')) { done.clear(); store('mc-roadmap', []); renderRoadmap(); }
  });

  // ------------------------------------------------------------ troubleshooting
  function showIssue(id, scroll) {
    var issue = issueById[id];
    document.querySelectorAll('.issue-btn').forEach(function (btn) { btn.setAttribute('aria-selected', btn.dataset.id === id ? 'true' : 'false'); });
    var box = $('issue-answer');
    box.innerHTML = '';
    var ol = el('ol');
    issue.steps.forEach(function (s) { ol.appendChild(el('li', { text: s })); });
    box.appendChild(el('h3', { text: issue.q }));
    box.appendChild(ol);
    var related = MC.buildings.filter(function (b) { return b.issues.indexOf(id) >= 0; });
    if (related.length) {
      var row = el('div', { class: 'related' }, [el('span', { text: 'Liên quan:' })]);
      related.forEach(function (b) {
        var chip = el('button', { class: 'chip', type: 'button', text: b.name });
        chip.addEventListener('click', function () { openCard({ kind: 'building', data: b }); });
        row.appendChild(chip);
      });
      box.appendChild(row);
    }
    if (scroll) $('help').scrollIntoView();
  }
  function renderIssues() {
    var list = $('issue-list');
    MC.issues.forEach(function (i) {
      var btn = el('button', { class: 'issue-btn', type: 'button', role: 'option', text: i.q });
      btn.dataset.id = i.id;
      btn.addEventListener('click', function () { showIssue(i.id); });
      list.appendChild(btn);
    });
    showIssue(MC.issues[0].id);
  }

  // ------------------------------------------------------------ lookup
  var filter = 'all';
  function entries() {
    return MC.buildings.map(function (b) { return { kind: 'building', data: b }; })
      .concat(MC.items.map(function (i) { return { kind: 'item', data: i }; }));
  }
  function renderFilters() {
    var box = $('stage-filter');
    [['all', 'Tất cả']].concat(MC.stages.map(function (s) { return [String(s.id), s.name]; })).concat([['item', 'Vật phẩm']]).forEach(function (f) {
      var chip = el('button', { class: 'chip', type: 'button', text: f[1], 'aria-pressed': f[0] === filter ? 'true' : 'false' });
      chip.addEventListener('click', function () {
        filter = f[0];
        box.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
        renderCards();
      });
      box.appendChild(chip);
    });
  }
  function renderCards() {
    var q = $('search').value.trim().toLowerCase();
    var grid = $('cards');
    grid.innerHTML = '';
    var shown = entries().filter(function (e) {
      if (filter === 'item' && e.kind !== 'item') return false;
      if (filter !== 'all' && filter !== 'item' && (e.kind !== 'building' || String(e.data.stage) !== filter)) return false;
      return !q || e.data.name.toLowerCase().indexOf(q) >= 0 || e.data.role.toLowerCase().indexOf(q) >= 0;
    });
    shown.forEach(function (e) {
      var d = e.data;
      var card = el('button', { class: 'card', type: 'button' }, [
        el('img', { src: imgSrc(d.img), alt: '', width: 56, height: 56, class: e.kind === 'item' ? 'pixel' : '' }),
        el('span', {}, [el('span', { class: 'kind', text: e.kind === 'item' ? 'Vật phẩm' : 'Giai đoạn ' + d.stage }), el('strong', { text: d.name })])
      ]);
      card.addEventListener('click', function () { openCard(e); });
      grid.appendChild(card);
    });
    $('no-result').hidden = shown.length > 0;
  }
  function openCard(e) {
    var body = $('dialog-body');
    body.innerHTML = '';
    var inner;
    if (e.kind === 'building') {
      inner = buildingDetail(e.data);
    } else {
      inner = el('div', { class: 'detail-inner' }, [
        el('div', { class: 'detail-head' }, [
          el('img', { src: imgSrc(e.data.img), alt: '', width: 72, height: 72, class: 'pixel' }),
          el('div', {}, [el('h3', { text: e.data.name, id: 'dialog-title' }), el('span', { class: 'stage-tag', text: 'Vật phẩm' })])
        ]),
        el('p', { text: e.data.role })
      ]);
    }
    body.appendChild(el('div', { class: 'detail' }, [inner]));
    var dlg = $('card-dialog');
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function closeDialog() { var dlg = $('card-dialog'); if (dlg.open) dlg.close(); }
  $('card-dialog').addEventListener('click', function (e) { if (e.target === this) closeDialog(); });
  $('search').addEventListener('input', renderCards);

  // ------------------------------------------------------------ settings + theme
  function renderSettings() {
    var body = $('settings-body');
    MC.settings.forEach(function (r) {
      body.appendChild(el('tr', {}, [el('th', { scope: 'row', text: r[0] }), el('td', { text: r[1] }), el('td', { class: 'muted', text: r[2] })]));
    });
  }
  $('theme-toggle').addEventListener('click', function () {
    var root = document.documentElement;
    var current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('mcl-theme', next); } catch (e) {}
  });

  drawMap();
  renderRoadmap();
  renderIssues();
  renderFilters();
  renderCards();
  renderSettings();
})();
