/* ============================================================
   Sky Defense — original game for PixelPlay
   Canvas anti-aircraft shooter: track cartoon aircraft with the
   crosshair, manage a six-round magazine, build hit combos and
   keep the sky city above you safe.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  canvas.style.touchAction = 'none';   /* taps on the range must not scroll the page */

  /* ---------------- range geometry ---------------- */

  var W = 720, H = 420;
  var CITY_TOP = 330;                  /* rooftops start here */
  var MAG = 6;                         /* rounds per magazine */
  var RELOAD_MS = 650;
  var START_HEALTH = 5;
  var BEST_KEY = 'sky-defense';

  var TYPES = [
    { id: 'drone',  w: 30, h: 16, min: 78,  max: 130, pts: 20, color: '#4ade80' },
    { id: 'jet',    w: 52, h: 20, min: 92,  max: 150, pts: 15, color: '#38bdf8' },
    { id: 'glider', w: 64, h: 26, min: 48,  max: 78,  pts: 10, color: '#f59e0b' }
  ];

  /* ---------------- state ---------------- */

  var planes = [], particles = [], popups = [], marks = [];
  var stars = [], clouds = [], buildings = [];
  var ammo = MAG, reloading = false, reloadT = 0;
  var combo = 0, score = 0, health = START_HEALTH;
  var elapsed = 0, spawnTimer = 900;
  var mouseX = W / 2, mouseY = 210;
  var muzzle = 0, shake = 0, damageFlash = 0;
  var state = 'ready';                 /* ready | running | paused | over */
  var newBest = false;
  var best = GameShell.best.get(BEST_KEY, 0);
  var rafId = 0, lastFrame = 0;

  /* ---------------- helpers ---------------- */

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function shownBest() { return Math.max(best, score || 0); }

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function blurActive() {
    var el = document.activeElement;
    if (el && el.blur) { try { el.blur(); } catch (e) { /* ignore */ } }
  }

  function seedScene() {
    stars = [];
    for (var i = 0; i < 46; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * (CITY_TOP - 40),
        r: 0.6 + Math.random() * 1.3,
        p: Math.random() * Math.PI * 2
      });
    }
    clouds = [];
    for (var c = 0; c < 4; c++) {
      clouds.push({
        x: Math.random() * W,
        y: 60 + Math.random() * 140,
        w: 110 + Math.random() * 120,
        h: 22 + Math.random() * 14,
        s: 6 + Math.random() * 10
      });
    }
    buildings = [];
    var x = -10, seed = 7;
    while (x < W + 10) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      var bw = 42 + (seed % 26);
      seed = (seed * 1103515245 + 12345) % 2147483648;
      var bh = 34 + (seed % 58);
      buildings.push({ x: x, w: bw, h: bh, hit: false });
      x += bw + 3;
    }
  }

  /* darken one rooftop for every point of health the city has lost */
  function markDamage() {
    var order = [3, 8, 1, 11, 6];
    var hits = START_HEALTH - health;
    var i;
    for (i = 0; i < buildings.length; i++) buildings[i].hit = false;
    for (i = 0; i < hits && i < order.length; i++) {
      var b = buildings[order[i] % buildings.length];
      if (b) b.hit = true;
    }
  }

  function updateHud() {
    GameShell.hud(
      { Score: score || 0, Best: shownBest(), City: health > 0 ? health : 0 },
      'Ammo ' + ammo + (reloading ? ' · reloading' : '')
    );
  }

  /* ---------------- game states ---------------- */

  function reset() {
    planes = [];
    particles = [];
    popups = [];
    marks = [];
    ammo = MAG;
    reloading = false;
    reloadT = 0;
    combo = 0;
    score = 0;
    health = START_HEALTH;
    elapsed = 0;
    spawnTimer = 900;
    muzzle = 0;
    shake = 0;
    damageFlash = 0;
    newBest = false;
    for (var i = 0; i < buildings.length; i++) buildings[i].hit = false;
    updateHud();
  }

  function start() {
    reset();
    state = 'running';
    lastFrame = now();
    GameShell.overlay.hide();
    blurActive();
    updateHud();
    ensureLoop();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The sky is holding still. Press P or the button when you are ready.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: shownBest() },
        { label: 'City', value: health }
      ],
      btn: '▶ Resume',
      action: resume
    });
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'running';
    lastFrame = now();
    GameShell.overlay.hide();
    blurActive();
    updateHud();
  }

  function gameOver() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
      best = score;
      newBest = true;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: newBest ? 'New high score!' : 'City overrun',
      msg: 'The aircraft got through. You scored ' + score + ' point' +
           (score === 1 ? '' : 's') + ' and held the sky for ' +
           Math.round(elapsed) + ' seconds.',
      stats: [{ label: 'Score', value: score }, { label: 'Best', value: best }],
      btn: '▶ Play again',
      action: start
    });
  }

  /* ---------------- shooting ---------------- */

  function speedMul() {
    return 1 + Math.min(1, elapsed / 100);
  }

  function nextGap() {
    var base = Math.max(0.55, 1.4 - elapsed * 0.02);
    return (base * (0.75 + Math.random() * 0.6)) * 1000;
  }

  function spawnPlane() {
    var r = Math.random();
    var type = r < 0.3 ? TYPES[0] : (r < 0.78 ? TYPES[1] : TYPES[2]);
    var y = 44 + Math.random() * (CITY_TOP - 120);
    planes.push({
      type: type.id,
      x: -type.w - 6,
      y: y,
      w: type.w,
      h: type.h,
      pts: type.pts,
      color: type.color,
      speed: type.min + Math.random() * (type.max - type.min),
      bob: Math.random() * Math.PI * 2
    });
  }

  function startReload() {
    if (reloading) return;
    reloading = true;
    reloadT = RELOAD_MS;
    updateHud();
  }

  function burst(x, y, color, count) {
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 40 + Math.random() * 190;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 30,
        life: 1,
        color: Math.random() < 0.5 ? color : '#fef3c7',
        size: 1.6 + Math.random() * 2.6
      });
    }
  }

  function planeAt(x, y) {
    var found = null, foundD = Infinity;
    for (var i = 0; i < planes.length; i++) {
      var p = planes[i];
      var pad = 6;
      if (x < p.x - pad || x > p.x + p.w + pad) continue;
      if (y < p.y - pad || y > p.y + p.h + pad) continue;
      var dx = x - (p.x + p.w / 2), dy = y - (p.y + p.h / 2);
      var d = dx * dx + dy * dy;
      if (d < foundD) { foundD = d; found = p; }
    }
    return found;
  }

  function shootAt(x, y) {
    if (state !== 'running' || reloading || ammo <= 0) return;

    ammo--;
    muzzle = 1;

    var hit = planeAt(x, y);
    if (hit) {
      combo++;
      var mult = Math.min(5, combo);
      var gain = hit.pts * mult;
      score += gain;
      popups.push({
        x: hit.x + hit.w / 2,
        y: hit.y,
        text: '+' + gain + (mult > 1 ? ' ×' + mult : ''),
        t: 1,
        color: '#fde68a'
      });
      burst(hit.x + hit.w / 2, hit.y + hit.h / 2, hit.color, 16);
      marks.push({ x: x, y: y, t: 1, hit: true });
      var idx = planes.indexOf(hit);
      if (idx >= 0) planes.splice(idx, 1);
    } else {
      combo = 0;
      marks.push({ x: x, y: y, t: 1, hit: false });
    }

    if (ammo <= 0) startReload();
    updateHud();
  }

  function escapePlane(p) {
    health--;
    combo = 0;
    damageFlash = 1;
    shake = 9;
    markDamage();
    popups.push({
      x: p.x + p.w / 2 > W - 60 ? W - 70 : p.x + p.w / 2,
      y: CITY_TOP - 18,
      text: 'CITY HIT −1',
      t: 1,
      color: '#fca5a5'
    });
    var idx = planes.indexOf(p);
    if (idx >= 0) planes.splice(idx, 1);
    if (health <= 0) { health = 0; updateHud(); gameOver(); return; }
    updateHud();
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    var sec = dt / 1000;
    elapsed += sec;
    var mul = speedMul();

    if (reloading) {
      reloadT -= dt;
      if (reloadT <= 0) { reloading = false; reloadT = 0; ammo = MAG; updateHud(); }
    }

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnPlane();
      spawnTimer = nextGap();
    }

    for (var i = planes.length - 1; i >= 0; i--) {
      var p = planes[i];
      p.x += p.speed * mul * sec;
      p.bob += sec * 3;
      if (p.x > W + 14 + p.w) {
        escapePlane(p);
        if (state !== 'running') return;
      }
    }

    for (var j = particles.length - 1; j >= 0; j--) {
      var q = particles[j];
      q.x += q.vx * sec;
      q.y += q.vy * sec;
      q.vy += 240 * sec;
      q.life -= sec * 1.5;
      if (q.life <= 0) particles.splice(j, 1);
    }

    for (var k = popups.length - 1; k >= 0; k--) {
      popups[k].y -= 34 * sec;
      popups[k].t -= sec * 1.3;
      if (popups[k].t <= 0) popups.splice(k, 1);
    }

    for (var m = marks.length - 1; m >= 0; m--) {
      marks[m].t -= sec * 1.8;
      if (marks[m].t <= 0) marks.splice(m, 1);
    }

    for (var c = 0; c < clouds.length; c++) {
      clouds[c].x += clouds[c].s * sec;
      if (clouds[c].x > W + clouds[c].w) clouds[c].x = -clouds[c].w;
    }

    if (muzzle > 0) muzzle -= sec * 6;
    if (shake > 0) shake -= sec * 34;
    if (damageFlash > 0) damageFlash -= sec * 2.2;
  }

  /* ---------------- draw ---------------- */

  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b1a33');
    g.addColorStop(0.55, '#12365a');
    g.addColorStop(1, '#0a1626');
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    /* moon glow */
    var mg = ctx.createRadialGradient(W - 120, 62, 4, W - 120, 62, 120);
    mg.addColorStop(0, 'rgba(226,232,240,.28)');
    mg.addColorStop(1, 'rgba(226,232,240,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(W - 260, -40, 280, 240);

    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(W - 120, 62, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#12365a';
    ctx.beginPath();
    ctx.arc(W - 113, 56, 12, 0, Math.PI * 2);
    ctx.fill();

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(s.p + elapsed * 2));
      ctx.globalAlpha = tw;
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(148,163,184,.16)';
    for (var c = 0; c < clouds.length; c++) {
      var cl = clouds[c];
      ctx.beginPath();
      ctx.ellipse(cl.x, cl.y, cl.w / 2, cl.h / 2, 0, 0, Math.PI * 2);
      ctx.ellipse(cl.x + cl.w * 0.22, cl.y - cl.h * 0.3, cl.w / 3, cl.h / 2.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCity() {
    /* rooftops */
    ctx.fillStyle = '#0d1b2e';
    ctx.fillRect(0, CITY_TOP, W, H - CITY_TOP);

    for (var i = 0; i < buildings.length; i++) {
      var b = buildings[i];
      var top = CITY_TOP - b.h;
      ctx.fillStyle = b.hit ? '#1b2436' : '#16233b';
      ctx.fillRect(b.x, top, b.w, b.h + 4);
      ctx.fillStyle = 'rgba(226,232,240,.09)';
      ctx.fillRect(b.x, top, b.w, 3);

      if (!b.hit) {
        ctx.fillStyle = 'rgba(250,204,21,.55)';
        for (var wy = top + 8; wy < CITY_TOP - 8; wy += 12) {
          for (var wx = b.x + 6; wx < b.x + b.w - 7; wx += 12) {
            if ((wx + wy) % 5 === 0) continue;
            ctx.fillRect(wx, wy, 4, 6);
          }
        }
      } else {
        ctx.fillStyle = 'rgba(248,113,113,.25)';
        ctx.fillRect(b.x + 4, top + 8, 8, 8);
        ctx.fillRect(b.x + b.w - 14, top + 20, 6, 6);
      }
    }

    /* health pips */
    for (var h = 0; h < START_HEALTH; h++) {
      var on = h < health;
      ctx.fillStyle = on ? '#4ade80' : 'rgba(226,232,240,.16)';
      ctx.beginPath();
      ctx.arc(18 + h * 16, CITY_TOP + 16, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    /* defence tower */
    var tx = W / 2, ty = CITY_TOP + 12;
    ctx.fillStyle = '#1f2b45';
    rr(tx - 22, ty, 44, 46, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(226,232,240,.14)';
    rr(tx - 16, ty + 6, 32, 8, 4);
    ctx.fill();

    var ang = Math.atan2(mouseY - ty, mouseX - tx);
    ctx.save();
    ctx.translate(tx, ty + 4);
    ctx.rotate(ang);
    ctx.fillStyle = muzzle > 0 ? '#fde68a' : '#3f5680';
    rr(0, -4, 30, 8, 4);
    ctx.fill();
    ctx.restore();

    if (muzzle > 0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, muzzle);
      ctx.fillStyle = '#fde68a';
      ctx.beginPath();
      ctx.arc(tx + Math.cos(ang) * 32, ty + 4 + Math.sin(ang) * 32, 7 * muzzle + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawDrone(p) {
    var cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    ctx.strokeStyle = 'rgba(226,232,240,.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - p.w * 0.42, cy - p.h * 0.36);
    ctx.lineTo(cx + p.w * 0.42, cy - p.h * 0.36);
    ctx.moveTo(cx - p.w * 0.42, cy + p.h * 0.36);
    ctx.lineTo(cx + p.w * 0.42, cy + p.h * 0.36);
    ctx.stroke();

    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.arc(cx - p.w * 0.42, cy - p.h * 0.36, 4, 0, Math.PI * 2);
    ctx.arc(cx + p.w * 0.42, cy - p.h * 0.36, 4, 0, Math.PI * 2);
    ctx.arc(cx - p.w * 0.42, cy + p.h * 0.36, 4, 0, Math.PI * 2);
    ctx.arc(cx + p.w * 0.42, cy + p.h * 0.36, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = p.color;
    rr(cx - p.w * 0.3, cy - p.h * 0.3, p.w * 0.6, p.h * 0.6, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(11,26,51,.75)';
    ctx.beginPath();
    ctx.arc(cx + 3, cy, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawJet(p) {
    var x = p.x, y = p.y, w = p.w, h = p.h;
    ctx.fillStyle = '#1f2b45';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.28, y + h * 0.5);
    ctx.lineTo(x + w * 0.66, y + h * 0.5);
    ctx.lineTo(x + w * 0.44, y + h * 1.15);
    ctx.lineTo(x + w * 0.14, y + h * 1.15);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.2);
    ctx.lineTo(x + w * 0.72, y + h * 0.34);
    ctx.lineTo(x + w, y + h * 0.5);
    ctx.lineTo(x + w * 0.72, y + h * 0.66);
    ctx.lineTo(x, y + h * 0.8);
    ctx.lineTo(x + w * 0.18, y + h * 0.5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(226,232,240,.8)';
    ctx.beginPath();
    ctx.ellipse(x + w * 0.62, y + h * 0.46, w * 0.09, h * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGlider(p) {
    var x = p.x, y = p.y, w = p.w, h = p.h;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.42);
    ctx.lineTo(x + w * 0.5, y + h * 0.34);
    ctx.lineTo(x + w, y + h * 0.5);
    ctx.lineTo(x + w * 0.5, y + h * 0.66);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(15,23,42,.65)';
    rr(x + w * 0.16, y + h * 0.28, w * 0.62, h * 0.2, 5);
    ctx.fill();

    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.1, y + h * 0.5);
    ctx.lineTo(x + w * 0.52, y + h * 0.5);
    ctx.lineTo(x + w * 0.36, y + h * 1.18);
    ctx.lineTo(x + w * 0.04, y + h * 1.18);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(226,232,240,.75)';
    ctx.beginPath();
    ctx.arc(x + w * 0.56, y + h * 0.37, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPlanes() {
    for (var i = 0; i < planes.length; i++) {
      var p = planes[i];
      var yy = p.y + Math.sin(p.bob) * 3;

      /* contrail */
      ctx.strokeStyle = 'rgba(226,232,240,.12)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(Math.max(-10, p.x - 54), yy + p.h / 2);
      ctx.lineTo(p.x - 2, yy + p.h / 2);
      ctx.stroke();

      var saved = p.y;
      p.y = yy;
      if (p.type === 'drone') drawDrone(p);
      else if (p.type === 'jet') drawJet(p);
      else drawGlider(p);
      p.y = saved;
    }
  }

  function drawCrosshair() {
    var x = mouseX, y = mouseY;
    ctx.save();
    ctx.strokeStyle = reloading ? 'rgba(248,113,113,.9)' : 'rgba(74,222,128,.92)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 20, y); ctx.lineTo(x - 8, y);
    ctx.moveTo(x + 8, y); ctx.lineTo(x + 20, y);
    ctx.moveTo(x, y - 20); ctx.lineTo(x, y - 8);
    ctx.moveTo(x, y + 8); ctx.lineTo(x, y + 20);
    ctx.stroke();
    ctx.fillStyle = reloading ? 'rgba(248,113,113,.9)' : 'rgba(74,222,128,.9)';
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawAmmoBar() {
    var bw = 16, bh = 8, gap = 4;
    var total = MAG * bw + (MAG - 1) * gap;
    var x0 = W - 20 - total, y0 = H - 22;
    for (var i = 0; i < MAG; i++) {
      ctx.fillStyle = i < ammo ? '#4ade80' : 'rgba(226,232,240,.18)';
      rr(x0 + i * (bw + gap), y0, bw, bh, 3);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(148,163,184,.8)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(reloading ? 'RELOADING…' : 'MAGAZINE', x0 - 10, y0 + 8);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    if (shake > 0.2) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    drawSky();
    drawCity();

    /* tracer */
    if (muzzle > 0.25) {
      var tx = W / 2, ty = CITY_TOP + 16;
      ctx.save();
      ctx.globalAlpha = Math.min(1, muzzle);
      ctx.strokeStyle = 'rgba(253,230,138,.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tx + Math.cos(Math.atan2(mouseY - ty, mouseX - tx)) * 30,
                 ty + Math.sin(Math.atan2(mouseY - ty, mouseX - tx)) * 30);
      ctx.lineTo(mouseX, mouseY);
      ctx.stroke();
      ctx.restore();
    }

    drawPlanes();

    for (var i = 0; i < particles.length; i++) {
      var q = particles[i];
      ctx.globalAlpha = Math.max(0, q.life);
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (var m = 0; m < marks.length; m++) {
      var mk = marks[m];
      ctx.globalAlpha = Math.max(0, mk.t) * 0.8;
      ctx.strokeStyle = mk.hit ? '#fde68a' : 'rgba(226,232,240,.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mk.x, mk.y, 6 + (1 - mk.t) * 20, 0, Math.PI * 2);
      ctx.stroke();
      if (!mk.hit) {
        ctx.beginPath();
        ctx.moveTo(mk.x - 5, mk.y - 5); ctx.lineTo(mk.x + 5, mk.y + 5);
        ctx.moveTo(mk.x + 5, mk.y - 5); ctx.lineTo(mk.x - 5, mk.y + 5);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    if (state === 'running') drawCrosshair();

    if (combo > 1 && state === 'running') {
      ctx.save();
      ctx.fillStyle = '#fde68a';
      ctx.font = '800 20px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('×' + Math.min(5, combo) + ' COMBO', 18, 34);
      ctx.restore();
    }

    for (var k = 0; k < popups.length; k++) {
      var pu = popups[k];
      ctx.globalAlpha = Math.max(0, pu.t);
      ctx.fillStyle = pu.color;
      ctx.font = '800 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pu.text, pu.x, pu.y);
    }
    ctx.globalAlpha = 1;

    drawAmmoBar();

    if (damageFlash > 0) {
      ctx.fillStyle = 'rgba(248,113,113,' + (damageFlash * 0.24) + ')';
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }

    ctx.restore();
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    if (!lastFrame) lastFrame = t;
    var dt = t - lastFrame;
    lastFrame = t;
    if (dt > 50) dt = 50;
    if (dt < 0) dt = 0;

    if (state === 'running' && dt > 0) update(dt);
    draw();
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  function isForm(el) {
    var tag = el && el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function toCanvas(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    var x = (clientX - rect.left) * (W / rect.width);
    var y = (clientY - rect.top) * (H / rect.height);
    if (x < 0) x = 0; else if (x > W) x = W;
    if (y < 0) y = 0; else if (y > CITY_TOP + 20) y = CITY_TOP + 20;
    return { x: x, y: y };
  }

  canvas.addEventListener('pointermove', function (ev) {
    var p = toCanvas(ev.clientX, ev.clientY);
    if (!p) return;
    mouseX = p.x;
    mouseY = p.y;
  });

  canvas.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    var p = toCanvas(ev.clientX, ev.clientY);
    if (p) { mouseX = p.x; mouseY = p.y; }
    if (state === 'ready' || state === 'over') { start(); return; }
    shootAt(mouseX, mouseY);
  });

  canvas.addEventListener('touchmove', function (ev) {
    if (!ev.touches[0]) return;
    var p = toCanvas(ev.touches[0].clientX, ev.touches[0].clientY);
    if (!p) return;
    mouseX = p.x;
    mouseY = p.y;
  }, { passive: true });

  document.addEventListener('keydown', function (e) {
    if (isForm(e.target)) return;
    var k = e.key;

    if (k === ' ' || k === 'Enter') {
      e.preventDefault();
      if (state === 'ready' || state === 'over') start();
      else if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    }
  });

  var reloadBtn = document.getElementById('btnReload');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', function () {
      if (state === 'ready' || state === 'over') { start(); return; }
      if (state === 'running' && !reloading && ammo < MAG) startReload();
    });
  }

  var pauseBtn = document.getElementById('btnPause');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', function () {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- boot ---------------- */

  seedScene();
  reset();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Sky Defense',
    msg: 'Move the mouse or drag your finger to track the crosshair and click or tap to fire. ' +
         'Down the aircraft before they cross the sky — every one that escapes costs your ' +
         'city a point of health, and the magazine only holds six rounds.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* read-only snapshot for automated smoke tests */
  window.__skyDefense = {
    state: function () { return state; },
    score: function () { return score; },
    ammo: function () { return ammo; },
    health: function () { return health; },
    combo: function () { return combo; },
    planes: function () {
      return planes.map(function (p) {
        return { x: p.x, y: p.y, w: p.w, h: p.h, pts: p.pts, type: p.type };
      });
    }
  };

  /* shared HUD reset button */
  if (typeof GameShell.onReset === 'function') GameShell.onReset(start);
})();
