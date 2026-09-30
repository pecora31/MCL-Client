(function () {
  'use strict';
  // Live snapshot pushed by the Minecraft server (market_push.py on the VM) through the mcl-skin-service Worker.
  var API = 'https://mcl-skin-service.nazarick112.workers.dev/v1/market';
  var $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement;
  var data = null, lastOk = 0, range = 86400000, lastPrice = null;

  function money(n) { return n == null ? '-' : Math.round(n).toLocaleString('vi-VN') + ' đ'; }
  function num(n) { return n == null ? '-' : Math.round(n).toLocaleString('vi-VN'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function css(v) { return getComputedStyle(root).getPropertyValue(v).trim(); }
  function ago(t) {
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + ' giây trước';
    if (s < 3600) return Math.floor(s / 60) + ' phút trước';
    if (s < 86400) return Math.floor(s / 3600) + ' giờ trước';
    return Math.floor(s / 86400) + ' ngày trước';
  }
  function clock(ms) {
    var s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
  }
  function hhmm(t) { var d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  // ------------------------------------------------------------ theme
  $('theme-toggle').addEventListener('click', function () {
    var current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('mcl-theme', next); } catch (e) {}
    drawAll();
  });

  // ------------------------------------------------------------ canvas helpers
  function setup(canvas) {
    var dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    var g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    return { g: g, W: W, H: H };
  }
  function niceMax(v) { if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  function shortNum(v) { return v >= 1000 ? (v / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + 'k' : String(Math.round(v)); }

  function drawMoney() {
    var c = setup($('money-chart')), g = c.g, W = c.W, H = c.H;
    var pts = (data && data.series && data.series.money) || [];
    if (range) { var from = Date.now() - range; pts = pts.filter(function (p) { return p[0] >= from; }); }
    g.font = '11px "JetBrains Mono", monospace'; g.fillStyle = css('--muted');
    if (pts.length < 2) {
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(pts.length ? 'Đang ghi dữ liệu, biểu đồ hiện sau vài lần cập nhật (5 phút một điểm)' : 'Chưa có dữ liệu', W / 2, H / 2);
      return;
    }
    var L = 46, R = 10, T = 10, B = 24, pw = W - L - R, ph = H - T - B;
    var t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    var yMax = niceMax(Math.max.apply(null, pts.map(function (p) { return Math.max(p[1], p[2]); })) * 1.1);
    var x = function (t) { return L + (t1 === t0 ? 0 : (t - t0) / (t1 - t0) * pw); };
    var y = function (v) { return T + ph - v / yMax * ph; };
    g.strokeStyle = css('--line'); g.lineWidth = 1; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (var k = 0; k <= 4; k++) { var v = yMax * k / 4; g.beginPath(); g.moveTo(L, y(v)); g.lineTo(L + pw, y(v)); g.stroke(); g.fillText(shortNum(v), L - 6, y(v)); }
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (var j = 0; j <= 4; j++) { var t = t0 + (t1 - t0) * j / 4; g.fillText(range && range <= 86400000 ? hhmm(t) : new Date(t).getDate() + '/' + (new Date(t).getMonth() + 1), x(t), T + ph + 6); }
    // circulating money: area + line
    var grass = css('--grass');
    g.beginPath(); pts.forEach(function (p, i) { i ? g.lineTo(x(p[0]), y(p[1])) : g.moveTo(x(p[0]), y(p[1])); });
    g.lineTo(x(t1), y(0)); g.lineTo(x(t0), y(0)); g.closePath();
    g.fillStyle = css('--grass-soft'); g.fill();
    g.beginPath(); pts.forEach(function (p, i) { i ? g.lineTo(x(p[0]), y(p[1])) : g.moveTo(x(p[0]), y(p[1])); });
    g.strokeStyle = grass; g.lineWidth = 2.2; g.stroke();
    // treasury
    g.beginPath(); pts.forEach(function (p, i) { i ? g.lineTo(x(p[0]), y(p[2])) : g.moveTo(x(p[0]), y(p[2])); });
    g.strokeStyle = css('--dirt'); g.lineWidth = 1.6; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]);
    var last = pts[pts.length - 1];
    g.fillStyle = grass; g.beginPath(); g.arc(x(last[0]), y(last[1]), 4, 0, 7); g.fill();
  }

  function drawBids() {
    var c = setup($('bid-chart')), g = c.g, W = c.W, H = c.H;
    var a = data && data.auction, bids = (a && a.bids) || [];
    g.font = '11px "JetBrains Mono", monospace'; g.fillStyle = css('--muted'); g.textAlign = 'center'; g.textBaseline = 'middle';
    if (!bids.length) { g.fillText(a && a.status === 'open' ? 'Chưa có ai trả giá' : '', W / 2, H / 2); return; }
    var L = 6, R = 6, T = 8, B = 8, pw = W - L - R, ph = H - T - B;
    var t0 = a.openedAt || bids[0][0], t1 = Math.max(bids[bids.length - 1][0], a.status === 'open' ? Date.now() : (a.closedAt || bids[bids.length - 1][0]));
    var vMax = niceMax(bids[bids.length - 1][1] * 1.1);
    var x = function (t) { return L + (t1 === t0 ? pw : (t - t0) / (t1 - t0) * pw); };
    var y = function (v) { return T + ph - v / vMax * ph; };
    // step line: the price holds until the next bid
    var prev = 0;
    g.beginPath(); g.moveTo(x(t0), y(0));
    bids.forEach(function (b) { g.lineTo(x(b[0]), y(prev)); g.lineTo(x(b[0]), y(b[1])); prev = b[1]; });
    g.lineTo(x(t1), y(prev));
    g.strokeStyle = css('--grass'); g.lineWidth = 2; g.stroke();
    bids.forEach(function (b) { g.fillStyle = css('--grass'); g.beginPath(); g.arc(x(b[0]), y(b[1]), 2.5, 0, 7); g.fill(); });
  }

  function spark(points) {
    if (!points || points.length < 2) return '<span class="muted small">chưa đủ dữ liệu</span>';
    var vals = points.map(function (p) { return p[1]; }), mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var w = 130, h = 28, pad = 3, span = mx - mn || 1;
    var d = vals.map(function (v, i) { return (i ? 'L' : 'M') + (pad + i / (vals.length - 1) * (w - 2 * pad)).toFixed(1) + ' ' + (h - pad - (v - mn) / span * (h - 2 * pad)).toFixed(1); }).join(' ');
    var up = vals[vals.length - 1] >= vals[0];
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + (up ? 'var(--grass)' : 'var(--bad)') + '" stroke-width="1.8"/></svg>';
  }

  // ------------------------------------------------------------ render
  function render() {
    var d = data;
    var m = d.money || {};
    $('k-money').textContent = money(m.circulating);
    var s = (d.series && d.series.money) || [];
    var dayAgo = s.filter(function (p) { return p[0] <= Date.now() - 86400000; }).pop();
    if (dayAgo && m.circulating != null) {
      var ch = (m.circulating - dayAgo[1]) / dayAgo[1];
      $('k-money-sub').textContent = (ch >= 0 ? '+' : '') + (ch * 100).toFixed(1).replace('.', ',') + '% so với 24 giờ trước';
      $('k-money-sub').className = 'k-sub ' + (ch >= 0 ? 'up' : 'down');
    } else $('k-money-sub').textContent = m.starter ? 'gồm tiền khởi đầu ' + money(m.starter) + ' mỗi người' : '';
    $('k-treasury').textContent = money(m.treasury);
    $('k-escrow').textContent = money(m.escrow);
    $('k-accounts').textContent = num(m.accounts);
    $('k-accounts-sub').textContent = m.starterCount ? m.starterCount + ' người nhận tiền khởi đầu' : '';
    var sv = d.server || {};
    $('server-line').textContent = 'Server ' + (sv.state === 'running' ? 'đang chạy' : sv.state === 'unknown' ? 'không rõ' : 'đang tắt') + ' · ' + (sv.online || 0) + '/' + (sv.max || 20) + ' người online';

    // auction
    var a = d.auction, card = $('auction');
    if (a) {
      $('a-item').textContent = String(a.label || '').toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); });
      var st = $('a-status');
      if (a.status === 'open') { st.textContent = 'Đang diễn ra'; st.className = 'pill ok'; card.classList.add('hot'); }
      else if (a.status === 'closed') { st.textContent = 'Đã chốt'; st.className = 'pill'; card.classList.remove('hot'); }
      else { st.textContent = 'Đã hủy'; st.className = 'pill bad'; card.classList.remove('hot'); }
      if (lastPrice !== null && a.price !== lastPrice) { $('a-price').classList.remove('flash'); void $('a-price').offsetWidth; $('a-price').classList.add('flash'); }
      lastPrice = a.price;
      $('a-price').textContent = a.price ? money(a.price) : (a.status === 'open' ? '0 đ' : '-');
      $('a-bids').textContent = (a.bids || []).length;
      $('a-hint').innerHTML = a.status === 'closed'
        ? (a.winner ? '<strong>' + esc(a.winner) + '</strong> thắng với ' + money(a.price) + (a.claimed ? ', đã nhận trứng màu ' + esc(a.claimed) + '.' : '. Chờ người thắng nhận hàng.') : 'Phiên kết thúc, không có người mua.')
        : 'Trong game gõ <code>/daugia tra &lt;số tiền&gt;</code>. Người trả giá được giấu tên tới lúc chốt.';
    }
    tickAuction();

    // bulk market
    var bulk = (d.market && d.market.bulk) || [];
    $('bulk-day').textContent = d.market && d.market.day ? 'giá ngày ' + d.market.day.split('-').reverse().slice(0, 2).join('/') : '';
    $('bulk-body').innerHTML = bulk.map(function (b) {
      var h = b.history || [], prev = h.length > 1 ? h[h.length - 2][1] : null, cls = 'flat', txt = '0%';
      if (prev) { var c = (b.buy - prev) / prev; cls = c > 0.0005 ? 'up' : c < -0.0005 ? 'down' : 'flat'; txt = (c > 0 ? '+' : '') + (c * 100).toFixed(1).replace('.', ',') + '%'; }
      return '<tr><td>' + esc(b.name) + '</td><td class="r">' + b.lot + '</td><td class="r">' + money(b.buy) + '</td><td class="r">' + money(b.sell) + '</td><td class="r chg ' + cls + '">' + (cls === 'up' ? '▲ ' : cls === 'down' ? '▼ ' : '') + txt + '</td><td>' + spark(h) + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="muted">Chưa có dữ liệu</td></tr>';

    var mk = d.market || {};
    $('rare-body').innerHTML = (mk.special || []).concat(mk.rare || []).map(function (r) {
      return '<tr><td>' + esc(r.name) + (r.value ? ' <span class="pill ok">Đặc biệt</span>' : '') + '</td><td class="r">' + r.qty + '</td><td class="r">' + (r.value ? 'từ 0 đ' : money(r.floor)) + '</td></tr>';
    }).join('');
    $('ess-body').innerHTML = (mk.essentials || []).map(function (e) {
      return '<tr><td>' + esc(e.name) + '</td><td class="r">' + e.lot + '</td><td class="r">' + money(e.price) + '</td></tr>';
    }).join('');
    var cm = mk.commons || { weeks: 30, items: [] };
    var marks = [1, 5, 10, 15, 20, 25, 30].filter(function (w) { return w <= (cm.weeks || 30); });
    $('commons-head').innerHTML = '<tr><th>Mặt hàng</th><th class="r">Giá mỗi lô</th><th class="r">Tổng lô</th>' + marks.map(function (w) { return '<th class="r">Tuần ' + w + '</th>'; }).join('') + '<th class="spark-col">30 tuần</th></tr>';
    $('commons-body').innerHTML = (cm.items || []).map(function (it) {
      var sch = it.schedule || [], mx = Math.max.apply(null, sch.concat([1]));
      var bars = '<svg class="spark" viewBox="0 0 130 28" aria-hidden="true">' + sch.map(function (q, i) { var h = q / mx * 24; return '<rect x="' + (i * 130 / sch.length + 0.5).toFixed(1) + '" y="' + (27 - h).toFixed(1) + '" width="' + (130 / sch.length - 1).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="var(--grass)" opacity="0.7"/>'; }).join('') + '</svg>';
      return '<tr><td>' + esc(it.name) + ' <span class="muted small">(lô ' + it.lot + ')</span></td><td class="r">' + money(it.price) + '</td><td class="r">' + it.totalLots + '</td>' + marks.map(function (w) { return '<td class="r">' + (sch[w - 1] || 0) + '</td>'; }).join('') + '<td>' + bars + '</td></tr>';
    }).join('');

    $('col-body').innerHTML = (d.colonies || []).map(function (c) {
      return '<tr><td>' + esc(c.name) + '<br><span class="muted small">' + esc(c.owner) + '</span></td><td class="r">' + c.citizens + '</td><td class="r">' + String(c.happiness).replace('.', ',') + '</td><td><div class="qbar"><span><i style="width:' + Math.min(100, c.quality) + '%"></i></span><em>' + c.quality + '</em></div></td><td class="r">' + money(c.budget) + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="muted">Chưa có dữ liệu</td></tr>';

    $('feed').innerHTML = (d.activity || []).slice().reverse().map(function (e) {
      return '<li><time datetime="' + new Date(e.t).toISOString() + '" title="' + new Date(e.t).toLocaleString('vi-VN') + '">' + hhmm(e.t) + '</time><span>' + esc(e.text) + '</span></li>';
    }).join('') || '<li><span class="muted">Chưa có hoạt động</span></li>';

    drawAll();
  }

  function tickAuction() {
    var a = data && data.auction;
    if (!a) return;
    $('a-left').textContent = a.status === 'open' ? clock(a.endAt - Date.now()) : 'Hết giờ';
  }
  function drawAll() { if (data) { drawMoney(); drawBids(); } }

  function liveState() {
    var el = $('live'), txt = $('live-text');
    if (!lastOk) { el.className = 'live'; txt.textContent = 'Đang tải'; return; }
    var age = data && data.generated ? Date.now() - data.generated : Infinity;
    el.className = 'live ' + (age < 330000 ? 'on' : 'stale');
    txt.textContent = age < 330000 ? 'Trực tiếp · ' + ago(data.generated) : 'Server chưa gửi số liệu · ' + ago(data.generated);
  }

  function load() {
    fetch(API, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { data = j; lastOk = Date.now(); render(); liveState(); })
      .catch(function () { liveState(); if (!lastOk) $('server-line').textContent = 'Chưa lấy được số liệu, sẽ thử lại sau vài giây.'; })
      .then(function () { setTimeout(load, data && data.auction && data.auction.status === 'open' ? 5000 : 15000); });
  }

  document.querySelectorAll('.seg button').forEach(function (b) {
    b.addEventListener('click', function () {
      range = +b.dataset.range;
      document.querySelectorAll('.seg button').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
      drawMoney();
    });
  });
  setInterval(function () { tickAuction(); liveState(); }, 1000);
  window.addEventListener('resize', drawAll);
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawAll);
  load();
})();
