(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement;
  function money(n) { return Math.round(n).toLocaleString('vi-VN') + ' đ'; }
  function pct(n, d) { return (n * 100).toFixed(d || 0).replace('.', ',') + '%'; }

  // ------------------------------------------------------------ theme (same key as the landing page)
  $('theme-toggle').addEventListener('click', function () {
    var current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('mcl-theme', next); } catch (e) {}
    drawSim();
  });

  // ------------------------------------------------------------ credit and loan calculators
  var TIERS = [
    { name: 'Khóa', min: 0, limit: 0, rate: 0 },
    { name: 'Đồng', min: 200, limit: 300, rate: 0.10 },
    { name: 'Bạc', min: 400, limit: 1000, rate: 0.09 },
    { name: 'Vàng', min: 600, limit: 2500, rate: 0.07 },
    { name: 'Kim cương', min: 800, limit: 5000, rate: 0.05 }
  ];
  function tierOf(score) { var t = TIERS[0]; TIERS.forEach(function (x) { if (score >= x.min) t = x; }); return t; }
  function questGain(score) { return 3000 / (score + 100); }

  function updateCredit() {
    var s = +$('cur-score').value, t = tierOf(s);
    $('o-cur-score').textContent = s;
    var next = TIERS.filter(function (x) { return x.min > s; })[0];
    if (!next) { $('quest-need').innerHTML = 'Bạn đang ở bậc <strong>' + t.name + '</strong>, bậc cao nhất. Mỗi nhiệm vụ lúc này cộng khoảng ' + questGain(s).toFixed(1).replace('.', ',') + ' điểm.'; return; }
    var n = 0, x = s;
    while (x < next.min && n < 1000) { x += questGain(x); n++; }
    $('quest-need').innerHTML = 'Bậc <strong>' + t.name + '</strong>. Cần khoảng <strong>' + n + ' nhiệm vụ</strong> để lên ' + next.name + ' (' + next.min + ' điểm), hoặc ít hơn nếu có trả nợ đúng hạn.';
  }

  function updateLoan() {
    var amt = +$('loan-amt').value, late = +$('loan-late').value, s = +$('cur-score').value, t = tierOf(s);
    $('o-loan-amt').textContent = money(amt);
    $('o-loan-late').textContent = late ? late + ' ngày' : 'không';
    if (amt > t.limit) {
      $('loan-out').innerHTML = 'Vượt hạn mức bậc ' + t.name + ' (' + money(t.limit) + '). Kéo điểm tín dụng lên hoặc vay ít hơn.';
      return;
    }
    var interest = amt * t.rate, fee = amt * 0.02 * late, total = amt + interest + fee;
    var scoreHit = late ? -10 * late : '+15 đến +40';
    $('loan-out').innerHTML = 'Lãi 7 ngày ' + pct(t.rate) + ': trả <strong>' + money(total) + '</strong>' +
      (late ? ' (trong đó phạt trễ ' + money(fee) + ')' : '') + '. Điểm tín dụng: <strong>' + scoreHit + '</strong>.' +
      (amt > 1000 ? ' Khoản này cần đồ thế chấp.' : '');
  }
  ['cur-score', 'loan-amt', 'loan-late'].forEach(function (id) {
    $(id).addEventListener('input', function () { updateCredit(); updateLoan(); });
  });
  updateCredit(); updateLoan();

  // ------------------------------------------------------------ 12-week inflation model
  // Loans create money, repaid principal is destroyed, interest and shop profit go to the bank, the bank pays quests (goods come
  // in), defaults leave money in circulation with nothing behind it. Four hidden warm-up weeks fix the base money/goods ratio.
  var S = { def: 5, quest: 100 };
  var PRESETS = { 'p-normal': { def: 5, quest: 100 }, 'p-default': { def: 40, quest: 100, borrow: 60 }, 'p-greedy': { def: 5, quest: 40 } };
  var borrow = 40, PLAYERS = 6;

  function simulate() {
    var WARM = 4, weeks = 12 + WARM, M = PLAYERS * 320, P = 1, rate = 0.10, prevLoans = 0, treasuryIn = 250, base = null, out = [];
    for (var w = 1; w <= weeks; w++) {
      var p = w <= WARM ? { def: 5, quest: 100, borrow: 40 } : { def: S.def, quest: S.quest, borrow: borrow };
      var limitF = Math.max(0.4, 1 - 2 * Math.max(0, (out.length ? out[out.length - 1].inf : 0) - 0.05));
      var loans = PLAYERS * (p.borrow / 100) * 600 * P * limitF;
      var principalBack = prevLoans * (1 - p.def / 100);
      var interest = principalBack * rate;
      var recovered = prevLoans * (p.def / 100) * 0.6;
      var shopSales = loans * 0.8 + M * 0.10;
      var shopProfit = shopSales * 0.3;
      var questPay = (p.quest / 100) * treasuryIn + (w <= 3 ? 150 : 0);
      M = Math.max(50, M + loans - principalBack - interest - recovered - shopProfit + questPay);
      var goods = questPay / P + shopSales * 0.2 / P + 1, ratio = M / goods;
      treasuryIn = interest + shopProfit + recovered;
      prevLoans = loans;
      if (w <= WARM) { base = ratio; rate = 0.10; continue; }
      var next = P + 0.5 * (ratio / base - P);
      next = Math.min(P * 1.15, Math.max(P * 0.85, next));
      var inf = next / P - 1;
      P = next;
      rate = Math.min(0.25, Math.max(0.04, 0.10 + 1.5 * (inf - 0.02)));
      out.push({ w: w - WARM, P: P, M: M, rate: rate, inf: inf });
    }
    return out;
  }

  var canvas = $('chart');
  function css(v) { return getComputedStyle(root).getPropertyValue(v).trim(); }
  function drawSim() {
    $('o-default').textContent = S.def + '%';
    $('o-quest').textContent = S.quest + '%';
    var data = simulate(), last = data[data.length - 1];
    var dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    var g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    var L = 40, R = 12, T = 10, B = 24, pw = W - L - R, ph = H - T - B;
    var ps = data.map(function (d) { return d.P; });
    var pMax = Math.max(1.3, Math.ceil(Math.max.apply(null, ps) * 10) / 10), pMin = Math.min(0.8, Math.floor(Math.min.apply(null, ps) * 10) / 10);
    var mMax = Math.max.apply(null, data.map(function (d) { return d.M; })) * 1.15;
    var x = function (i) { return L + (i / (data.length - 1)) * pw; };
    var yP = function (v) { return T + ph - (v - pMin) / (pMax - pMin) * ph; };
    g.font = '11px "JetBrains Mono", monospace'; g.strokeStyle = css('--line'); g.fillStyle = css('--muted'); g.lineWidth = 1;
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (var k = 0; k <= 4; k++) {
      var v = pMin + (pMax - pMin) * k / 4, yy = yP(v);
      g.beginPath(); g.moveTo(L, yy); g.lineTo(L + pw, yy); g.stroke();
      g.fillText(v.toFixed(2).replace('.', ','), L - 6, yy);
    }
    g.textAlign = 'center'; g.textBaseline = 'top';
    data.forEach(function (d, i) { if (i % 3 === 0 || i === data.length - 1) g.fillText('T' + d.w, x(i), T + ph + 6); });
    var bw = Math.max(5, pw / data.length * 0.45);
    g.fillStyle = css('--dirt'); g.globalAlpha = 0.28;
    data.forEach(function (d, i) { var h = d.M / mMax * ph; g.fillRect(x(i) - bw / 2, T + ph - h, bw, h); });
    g.globalAlpha = 1;
    g.strokeStyle = css('--grass'); g.lineWidth = 2.5; g.beginPath();
    data.forEach(function (d, i) { if (i) g.lineTo(x(i), yP(d.P)); else g.moveTo(x(i), yP(d.P)); });
    g.stroke();
    g.fillStyle = css('--grass'); g.beginPath(); g.arc(x(data.length - 1), yP(last.P), 4, 0, 7); g.fill();
    var avg = Math.pow(last.P, 1 / data.length) - 1;
    $('sim-out').innerHTML = 'Sau 12 tuần giá bằng <strong>' + last.P.toFixed(2).replace('.', ',') + ' lần</strong> lúc đầu, trung bình ' +
      pct(avg, 1) + ' mỗi tuần, lãi suất cuối kỳ ' + pct(last.rate) + '.';
  }
  ['s-default', 's-quest'].forEach(function (id) {
    var key = id === 's-default' ? 'def' : 'quest';
    $(id).value = S[key];
    $(id).addEventListener('input', function () { S[key] = +$(id).value; borrow = 40; setPressed(null); drawSim(); });
  });
  function setPressed(id) { Object.keys(PRESETS).forEach(function (b) { $(b).setAttribute('aria-pressed', String(b === id)); }); }
  Object.keys(PRESETS).forEach(function (id) {
    $(id).addEventListener('click', function () {
      var p = PRESETS[id]; S.def = p.def; S.quest = p.quest; borrow = p.borrow || 40;
      $('s-default').value = S.def; $('s-quest').value = S.quest;
      setPressed(id); drawSim();
    });
  });
  window.addEventListener('resize', drawSim);
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawSim);
  drawSim();
})();
