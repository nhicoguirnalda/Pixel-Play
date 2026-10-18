/* ============================================================
   Turret Guard — original game for PixelPlay
   Wave-defence shooter: robots march a winding road toward your
   base. Aim the turret with the mouse / a finger and hold to
   fire; spend the credits you earn on two simple upgrades.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 720, H = 420;
  var BEST_KEY = 'turret-guard';
  var BASE_MAX = 20;

  var state = 'ready';                 /* ready | running | paused | over */
  var best = GameShell.best.get(BEST_KEY, 0);

  /* ---------------- the road the robots march along ---------------- */

  var PATH = [
    { x: -40, y: 112 }, { x: 130, y: 112 }, { x: 130, y: 300 },
    { x: 336, y: 300 }, { x: 336, y: 164 }, { x: 508, y: 164 },
    { x: 508, y: 302 }, { x: 640, y: 302 }
  ];
  var segs = [], pathLen = 0;
  (function buildPath() {
    for (var i = 1; i < PATH.length; i++) {
      var a = PATH[i - 1], b = PATH[i];
      var len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
      segs.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, len: len });
      pathLen += len;
    }
  })();

  function posAt(d, out) {
    var i, s, k;
    for (i = 0; i < segs.length; i++) {
      s = segs[i];
      if (d <= s.len) {
        k = s.len ? d / s.len : 0;
        out.x = s.x0 + (s.x1 - s.x0) * k;
        out.y = s.y0 + (s.y1 - s.y0) * k;
        return out;
      }
      d -= s.len;
    }
    s = segs[segs.length - 1];
    out.x = s.x1;
    out.y = s.y1;
    return out;
  }

  var BASE = { x: 668, y: 302 };

  /* ---------------- robot types ---------------- */

  var TYPES = {
    scout:   { hp: 2, speed: 60, r: 11, dmg: 1, score: 10, credits: 2, body: '#22c55e', dark: '#0f7a3a' },
    crawler: { hp: 3, speed: 96, r: 9,  dmg: 1, score: 15, credits: 3, body: '#38bdf8', dark: '#0369a1' },
    tank:    { hp: 8, speed: 34, r: 15, dmg: 3, score: 30, credits: 5, body: '#6366f1', dark: '#312e81' }
  };

  /* ---------------- mutable game state ---------------- */

  var units, bullets, bits, texts, spawnQueue;
  var wave, waveState, gapMs, spawnMs, spawnEvery;
  var score, credits, baseHp, kills;
  var upg, weapon = { rate: 0.26, dmg: 1 };
  var aim = { x: 240, y: 130 };
  var firing = false, cooldown = 0;
  var shake = 0, hurtFlash = 0, muzzle = 0, clock = 0;
  var newBest = false, rafId = 0, lastT = 0;

  var turret = { x: BASE.x, y: BASE.y, a: Math.PI };

  /* on-canvas upgrade panels (hit-tested with canvas coordinates) */
  var BTN = {
    rate: { x: 14, y: H - 56, w: 200, h: 42 },
    dmg:  { x: 224, y: H - 56, w: 200, h: 42 }
  };

  /* ---------------- helpers ---------------- */

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function angleLerp(a, b, t) {
    var d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return a + d * t;
  }

  function burst(x, y, n, colour, power) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = (0.4 + Math.random()) * power;
      bits.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 320 + Math.random() * 320, max: 640, size: 1.5 + Math.random() * 2.5, colour: colour
      });
    }
    if (bits.length > 240) bits.splice(0, bits.length - 240);
  }

  function toast(x, y, txt, colour) {
    texts.push({ x: x, y: y, txt: txt, colour: colour || '#e8eefc', life: 1000, max: 1000 });
    if (texts.length > 24) texts.shift();
  }

  /* ---------------- upgrades ---------------- */

  function rateCost() { return 8 + upg.rate * 7; }
  function dmgCost() { return 10 + upg.dmg * 9; }

  function refreshWeapon() {
    weapon.rate = Math.max(0.085, 0.26 - upg.rate * 0.035);   /* seconds between shots */
    weapon.dmg = 1 + upg.dmg;
  }

  function buy(kind) {
    if (state !== 'running') return false;
    var cost = kind === 'rate' ? rateCost() : dmgCost();
    if (credits < cost) {
      toast(BASE.x, BASE.y - 40, 'Need ' + cost + 'cr', '#f87171');
      return false;
    }
    credits -= cost;
    if (kind === 'rate') upg.rate++; else upg.dmg++;
    refreshWeapon();
    toast(BASE.x, BASE.y - 40, kind === 'rate' ? '⚡ Fire rate up' : '💥 Damage up', '#a7f3d0');
    burst(BASE.x, BASE.y, 10, '#a7f3d0', 90);
    updateHud();
    return true;
  }

  /* ---------------- HUD ---------------- */

  var buyBtns = document.querySelectorAll('[data-buy]');

  function refreshBuy() {
    for (var i = 0; i < buyBtns.length; i++) {
      var kind = buyBtns[i].getAttribute('data-buy');
      if (kind === 'rate') {
        buyBtns[i].textContent = '⚡ Fire rate Lv' + (upg.rate + 1) + ' · ' + rateCost() + 'cr';
        buyBtns[i].disabled = credits < rateCost();
      } else {
        buyBtns[i].textContent = '💥 Damage Lv' + (upg.dmg + 1) + ' · ' + dmgCost() + 'cr';
        buyBtns[i].disabled = credits < dmgCost();
      }
    }
  }

  function updateHud() {
    GameShell.hud(
      { Score: score, Best: Math.max(best, score), Base: baseHp + ' HP' },
      state === 'paused' ? '⏸ Paused' : 'Wave ' + wave
    );
    refreshBuy();
  }

  /* ---------------- waves ---------------- */

  function buildQueue(n) {
    var q = [], i;
    for (i = 0; i < 4 + n; i++) q.push('scout');
    if (n >= 2) for (i = 0; i < Math.floor(n / 2); i++) q.push('tank');
    if (n >= 3) for (i = 0; i < n - 2; i++) q.push('crawler');
    return q;
  }

  /* keep the armoured units spread through the squad instead of bunched */
  function interleave(q) {
    var light = [], heavy = [], i, out = [], h = 0;
    for (i = 0; i < q.length; i++) (q[i] === 'scout' ? light : heavy).push(q[i]);
    var stride = heavy.length ? Math.max(2, Math.floor(light.length / (heavy.length + 1))) : 0;
    for (i = 0; i < light.length; i++) {
      out.push(light[i]);
      if (stride && (i + 1) % stride === 0 && h < heavy.length) out.push(heavy[h++]);
    }
    while (h < heavy.length) out.push(heavy[h++]);
    return out;
  }

  function startWave(n) {
    wave = n;
    waveState = 'fighting';
    spawnQueue = interleave(buildQueue(n));
    spawnEvery = Math.max(0.42, 1.15 - n * 0.05) * 1000;
    spawnMs = 700;
    toast(BASE.x, BASE.y - 70, 'Wave ' + n, '#a5b4fc');
    updateHud();
  }

  function spawnUnit(type) {
    var def = TYPES[type];
    var bonus = Math.floor((wave - 1) * 0.6);
    var hp = def.hp + bonus;
    units.push({
      type: type, def: def, d: 0, x: PATH[0].x, y: PATH[0].y,
      hp: hp, maxHp: hp, r: def.r,
      speed: def.speed + Math.min(34, (wave - 1) * 2),
      step: Math.random() * 6, hurt: 0
    });
  }

  /* ---------------- damage ---------------- */

  function leak(u) {
    if (state !== 'running') return;
    baseHp -= u.def.dmg;
    shake = Math.max(shake, 9);
    hurtFlash = 260;
    burst(640, u.y, 14, '#f87171', 130);
    toast(BASE.x - 20, BASE.y - 90, '-' + u.def.dmg + ' base', '#fca5a5');
    if (baseHp <= 0) { baseHp = 0; gameOver(); }
    else updateHud();
  }

  function killUnit(u, index) {
    units.splice(index, 1);
    score += u.def.score;
    credits += u.def.credits;
    kills++;
    burst(u.x, u.y, 16, u.def.body, 150);
    toast(u.x, u.y - 16, '+' + u.def.score, '#dcfce7');
    updateHud();
  }

  function fire() {
    var a = turret.a;
    bullets.push({
      x: turret.x + Math.cos(a) * 26,
      y: turret.y + Math.sin(a) * 26,
      vx: Math.cos(a) * 700,
      vy: Math.sin(a) * 700,
      life: 1.3,
      dmg: weapon.dmg
    });
    if (bullets.length > 220) bullets.shift();
    muzzle = 70;
    shake = Math.max(shake, 2);
  }

  /* ---------------- state changes ---------------- */

  function start() {
    score = 0;
    credits = 0;
    kills = 0;
    baseHp = BASE_MAX;
    upg = { rate: 0, dmg: 0 };
    refreshWeapon();
    units = [];
    bullets = [];
    bits = [];
    texts = [];
    shotStateClear();
    state = 'running';
    GameShell.overlay.hide();
    startWave(1);
    updateHud();
    ensureLoop();
  }

  function shotStateClear() {
    firing = false;
    cooldown = 0;
    shake = 0;
    hurtFlash = 0;
    muzzle = 0;
    newBest = false;
    gapMs = 0;
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    firing = false;
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The robots are frozen in their tracks. Resume when you are ready.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Wave', value: wave },
        { label: 'Base', value: baseHp + ' HP' }
      ],
      btn: '▶ Resume',
      action: resume
    });
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'running';
    GameShell.overlay.hide();
    updateHud();
  }

  function gameOver() {
    state = 'over';
    if (score > best) {
      best = score;
      newBest = true;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: newBest ? 'New high score!' : 'Base destroyed',
      msg: 'The robots broke through on wave ' + wave + '. You scored ' + score +
           ' point' + (score === 1 ? '' : 's') + ' and destroyed ' + kills + ' unit' + (kills === 1 ? '' : 's') + '.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Wave', value: wave },
        { label: 'Best', value: best }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    var s = dt / 1000;
    var i, j, u, b;

    if (shake > 0) shake -= dt;
    if (hurtFlash > 0) hurtFlash -= dt;
    if (muzzle > 0) muzzle -= dt;

    /* --- spawn / wave flow --- */
    if (waveState === 'fighting') {
      if (spawnQueue.length) {
        spawnMs -= dt;
        if (spawnMs <= 0) {
          spawnMs = spawnEvery;
          spawnUnit(spawnQueue.shift());
        }
      } else if (!units.length) {
        waveState = 'gap';
        gapMs = 2200;
        credits += 4 + wave;
        toast(BASE.x, BASE.y - 70, 'Wave ' + wave + ' cleared +' + (4 + wave) + 'cr', '#22c55e');
        updateHud();
      }
    } else {
      gapMs -= dt;
      if (gapMs <= 0) startWave(wave + 1);
    }

    /* --- aim --- */
    turret.a = angleLerp(turret.a, Math.atan2(aim.y - turret.y, aim.x - turret.x), Math.min(1, s * 14));

    /* --- firing --- */
    if (firing) {
      cooldown -= dt;
      var guard = 0;
      while (cooldown <= 0 && guard++ < 4) {
        fire();
        cooldown += weapon.rate * 1000;
      }
    } else {
      cooldown = 0;
    }

    /* --- robots march --- */
    var p = { x: 0, y: 0 };
    for (i = units.length - 1; i >= 0; i--) {
      u = units[i];
      u.d += u.speed * s;
      if (u.hurt > 0) u.hurt -= dt;
      if (u.d >= pathLen) { leak(u); units.splice(i, 1); continue; }
      posAt(u.d, p);
      u.x = p.x;
      u.y = p.y;
    }

    /* --- bullets --- */
    for (i = bullets.length - 1; i >= 0; i--) {
      b = bullets[i];
      b.x += b.vx * s;
      b.y += b.vy * s;
      b.life -= s;
      if (b.life <= 0 || b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30) {
        bullets.splice(i, 1);
        continue;
      }
      for (j = units.length - 1; j >= 0; j--) {
        u = units[j];
        var dx = u.x - b.x, dy = u.y - b.y;
        var reach = u.r + 5;
        if (dx * dx + dy * dy <= reach * reach) {
          u.hp -= b.dmg;
          u.hurt = 90;
          burst(b.x, b.y, 4, '#ecfdf5', 70);
          bullets.splice(i, 1);
          if (u.hp <= 0) killUnit(u, j);
          break;
        }
      }
    }

    /* --- particles & floating text --- */
    for (i = bits.length - 1; i >= 0; i--) {
      var bit = bits[i];
      bit.x += bit.vx * s;
      bit.y += bit.vy * s;
      bit.vx *= 0.965;
      bit.vy *= 0.965;
      bit.life -= dt;
      if (bit.life <= 0) bits.splice(i, 1);
    }
    for (i = texts.length - 1; i >= 0; i--) {
      texts[i].y -= 22 * s;
      texts[i].life -= dt;
      if (texts[i].life <= 0) texts.splice(i, 1);
    }
  }

  /* ---------------- draw ---------------- */

  function drawRoad() {
    var i, s, path = PATH;

    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d1526');
    g.addColorStop(1, '#05070e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* faint grid */
    ctx.strokeStyle = 'rgba(255,255,255,.035)';
    ctx.lineWidth = 1;
    for (i = 0; i < W; i += 40) {
      ctx.beginPath(); ctx.moveTo(i + .5, 0); ctx.lineTo(i + .5, H); ctx.stroke();
    }
    for (i = 0; i < H; i += 40) {
      ctx.beginPath(); ctx.moveTo(0, i + .5); ctx.lineTo(W, i + .5); ctx.stroke();
    }

    function trace() {
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (s = 1; s < path.length; s++) ctx.lineTo(path[s].x, path[s].y);
    }

    /* road surface */
    ctx.linejoin = 'round';
    ctx.linecap = 'round';
    ctx.strokeStyle = 'rgba(99,102,241,.10)';
    ctx.lineWidth = 54;
    trace(); ctx.stroke();
    ctx.strokeStyle = '#141d33';
    ctx.lineWidth = 44;
    trace(); ctx.stroke();
    ctx.strokeStyle = 'rgba(34,197,94,.20)';
    ctx.lineWidth = 46;
    ctx.setLineDash([14, 16]);
    trace(); ctx.stroke();
    ctx.setLineDash([]);

    /* corner posts so the route reads clearly */
    ctx.fillStyle = 'rgba(34,197,94,.35)';
    for (i = 1; i < path.length - 1; i++) {
      ctx.beginPath();
      ctx.arc(path[i].x, path[i].y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    /* danger zone in front of the base */
    ctx.save();
    ctx.fillStyle = 'rgba(248,113,113,.06)';
    ctx.fillRect(608, 0, W - 608, H);
    ctx.restore();
  }

  function drawBase() {
    var frac = baseHp / BASE_MAX;

    /* shield bar above the gate */
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    rr(576, 26, 128, 12, 6);
    ctx.fill();
    ctx.fillStyle = frac > 0.5 ? '#22c55e' : (frac > 0.25 ? '#f59e0b' : '#ef4444');
    rr(576, 26, Math.max(6, 128 * frac), 12, 6);
    ctx.fill();
    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(232,238,252,.75)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('BASE ' + baseHp + '/' + BASE_MAX, 576, 52);
    ctx.restore();

    /* gate structure */
    ctx.save();
    ctx.fillStyle = '#111a2e';
    rr(BASE.x - 26, BASE.y - 26, 52, 52, 13);
    ctx.fill();
    ctx.strokeStyle = 'rgba(99,102,241,.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    /* barrel */
    ctx.save();
    ctx.translate(BASE.x, BASE.y);
    ctx.rotate(turret.a);
    ctx.fillStyle = '#334155';
    rr(0, -5, 30, 10, 5);
    ctx.fill();
    ctx.fillStyle = '#22c55e';
    rr(20, -4, 12, 8, 4);
    ctx.fill();
    if (muzzle > 0) {
      ctx.globalAlpha = Math.min(1, muzzle / 70);
      ctx.fillStyle = '#fef3c7';
      ctx.beginPath();
      ctx.arc(34, 0, 8 * (muzzle / 70) + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    /* dome */
    ctx.fillStyle = '#6366f1';
    ctx.beginPath();
    ctx.arc(BASE.x, BASE.y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hurtFlash > 0 ? '#fecaca' : '#a5b4fc';
    ctx.beginPath();
    ctx.arc(BASE.x - 3, BASE.y - 3, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawUnit(u) {
    var def = u.def;
    var bob = Math.sin(clock / 90 + u.step) * 1.6;
    var x = u.x, y = u.y + bob;
    var swing = Math.sin(clock / 70 + u.step) * u.r * 0.5;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.ellipse(u.x, u.y + u.r * 1.0, u.r * 0.9, u.r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = def.dark;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - u.r * 0.4, y + u.r * 0.5);
    ctx.lineTo(x - u.r * 0.4 + swing, y + u.r * 1.25);
    ctx.moveTo(x + u.r * 0.4, y + u.r * 0.5);
    ctx.lineTo(x + u.r * 0.4 - swing, y + u.r * 1.25);
    ctx.stroke();

    ctx.fillStyle = u.hurt > 0 ? '#ffffff' : def.body;
    rr(x - u.r, y - u.r, u.r * 2, u.r * 2, u.r * 0.45);
    ctx.fill();
    ctx.strokeStyle = def.dark;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#05070e';
    ctx.beginPath();
    ctx.arc(x + u.r * 0.15, y - u.r * 0.1, u.r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = u.hurt > 0 ? '#fca5a5' : '#ecfdf5';
    ctx.beginPath();
    ctx.arc(x + u.r * 0.22, y - u.r * 0.1, u.r * 0.14, 0, Math.PI * 2);
    ctx.fill();

    if (u.hp < u.maxHp) {
      var w = u.r * 2, f = Math.max(0, u.hp / u.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(x - w / 2, y - u.r - 9, w, 4);
      ctx.fillStyle = f > 0.5 ? '#22c55e' : '#f59e0b';
      ctx.fillRect(x - w / 2, y - u.r - 9, w * f, 4);
    }
    ctx.restore();
  }

  function drawSlots() {
    /* upgrade panels drawn on the field */
    function panel(key, title, level, cost, affordable) {
      var b = BTN[key];
      ctx.save();
      ctx.fillStyle = affordable ? 'rgba(34,197,94,.16)' : 'rgba(255,255,255,.05)';
      rr(b.x, b.y, b.w, b.h, 10);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = affordable ? 'rgba(34,197,94,.85)' : 'rgba(255,255,255,.14)';
      ctx.stroke();
      ctx.textBaseline = 'middle';
      ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = affordable ? '#dcfce7' : 'rgba(232,238,252,.5)';
      ctx.fillText(title + ' Lv' + level, b.x + 12, b.y + b.h / 2 + 1);
      ctx.textAlign = 'right';
      ctx.fillStyle = affordable ? '#86efac' : 'rgba(232,238,252,.4)';
      ctx.fillText(cost + 'cr', b.x + b.w - 12, b.y + b.h / 2 + 1);
      ctx.restore();
    }

    panel('rate', '⚡ Fire rate', upg.rate + 1, rateCost(), credits >= rateCost());
    panel('dmg', '💥 Damage', upg.dmg + 1, dmgCost(), credits >= dmgCost());

    ctx.save();
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('Credits ' + credits, W - 16, H - 35);
    ctx.restore();
  }

  function drawReticle() {
    var x = clamp(aim.x, 0, W), y = clamp(aim.y, 0, H);
    ctx.save();
    ctx.strokeStyle = 'rgba(34,197,94,.14)';
    ctx.setLineDash([6, 10]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(BASE.x, BASE.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = firing ? 'rgba(34,197,94,.95)' : 'rgba(232,238,252,.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 19, y); ctx.lineTo(x - 6, y);
    ctx.moveTo(x + 6, y);  ctx.lineTo(x + 19, y);
    ctx.moveTo(x, y - 19); ctx.lineTo(x, y - 6);
    ctx.moveTo(x, y + 6);  ctx.lineTo(x, y + 19);
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    drawRoad();
    drawBase();

    var i;
    for (i = 0; i < units.length; i++) drawUnit(units[i]);

    ctx.save();
    ctx.shadowColor = '#bbf7d0';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = '#ecfdf5';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (i = 0; i < bullets.length; i++) {
      var b = bullets[i];
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012);
      ctx.stroke();
    }
    ctx.restore();

    for (i = 0; i < bits.length; i++) {
      var bit = bits[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, bit.life / bit.max));
      ctx.fillStyle = bit.colour;
      ctx.fillRect(bit.x - bit.size / 2, bit.y - bit.size / 2, bit.size, bit.size);
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.font = '700 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (i = 0; i < texts.length; i++) {
      var t = texts[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, t.life / t.max));
      ctx.fillStyle = t.colour;
      ctx.fillText(t.txt, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    drawSlots();
    drawReticle();

    if (state === 'running' && waveState === 'gap') {
      ctx.save();
      ctx.fillStyle = 'rgba(232,238,252,.8)';
      ctx.font = '700 18px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Wave ' + (wave + 1) + ' incoming…', W / 2, 200);
      ctx.restore();
    }

    ctx.restore();

    if (hurtFlash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.5, hurtFlash / 520);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    if (!lastT) lastT = t;
    var dt = Math.min(50, t - lastT);
    lastT = t;
    clock += dt;
    if (state === 'running') update(dt);
    draw();
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  function toCanvas(e) {
    if (typeof e.clientX !== 'number' || typeof e.clientY !== 'number') {
      return { x: aim.x, y: aim.y };
    }
    var rect = canvas.getBoundingClientRect();
    var sx = rect.width ? W / rect.width : 1;
    var sy = rect.height ? H / rect.height : 1;
    return {
      x: clamp((e.clientX - rect.left) * sx, 0, W),
      y: clamp((e.clientY - rect.top) * sy, 0, H)
    };
  }

  function hitPanel(p, key) {
    var b = BTN[key];
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (state !== 'running') return;
    var p = toCanvas(e);
    if (hitPanel(p, 'rate')) { buy('rate'); return; }
    if (hitPanel(p, 'dmg')) { buy('dmg'); return; }
    aim.x = p.x;
    aim.y = p.y;
    firing = true;
    if (canvas.setPointerCapture && typeof e.pointerId === 'number') {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    if (typeof e.clientX !== 'number') return;
    var p = toCanvas(e);
    aim.x = p.x;
    aim.y = p.y;
  });

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  document.addEventListener('pointerup', function () { firing = false; });
  document.addEventListener('pointercancel', function () { firing = false; });
  window.addEventListener('blur', function () { firing = false; });

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    var k = e.key;
    if (k === ' ' || k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
    }

    if (k === ' ' || k === 'Enter') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (k === 'r' || k === 'R') {
      start();
    } else if (k === '1') {
      buy('rate');
    } else if (k === '2') {
      buy('dmg');
    }
  });

  var actionBtns = document.querySelectorAll('[data-action]');
  for (var ab = 0; ab < actionBtns.length; ab++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        if (state === 'running') pause();
        else if (state === 'paused') resume();
      });
    })(actionBtns[ab]);
  }

  for (var bb = 0; bb < buyBtns.length; bb++) {
    (function (btn) {
      btn.addEventListener('click', function () { buy(btn.getAttribute('data-buy')); });
    })(buyBtns[bb]);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      firing = false;
      if (state === 'running') pause();
    }
  });

  /* ---------------- boot ---------------- */

  score = 0;
  credits = 0;
  kills = 0;
  baseHp = BASE_MAX;
  upg = { rate: 0, dmg: 0 };
  refreshWeapon();
  units = [];
  bullets = [];
  bits = [];
  texts = [];
  spawnQueue = [];
  wave = 1;
  waveState = 'gap';
  gapMs = 999999;
  spawnMs = 0;
  spawnEvery = 1100;
  updateHud();
  ensureLoop();

  GameShell.overlay.show({
    title: 'Turret Guard',
    msg: 'Marching robots are heading for your base. Aim with the mouse or a finger, hold to fire, and spend credits on upgrades between waves.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });
})();
