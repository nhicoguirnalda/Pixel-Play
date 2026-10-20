/* ============================================================
   Turret Guard — original game for PixelPlay
   Wave-defence shooter: robots march a winding road toward your
   base. Aim the turret with the mouse / a finger and hold to
   fire. Spend credits on six upgrades, and survive an armoured
   walker boss every fifth wave.
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
  var SLOW_C = { x: 588, y: 302 };     /* centre of the slow field upgrade */

  /* ---------------- robot types ---------------- */

  var TYPES = {
    scout:   { hp: 2,  speed: 60, r: 11, dmg: 1,  score: 10,  credits: 2,  body: '#22c55e', dark: '#0f7a3a' },
    crawler: { hp: 3,  speed: 96, r: 9,  dmg: 1,  score: 15,  credits: 3,  body: '#38bdf8', dark: '#0369a1' },
    tank:    { hp: 8,  speed: 34, r: 15, dmg: 3,  score: 30,  credits: 5,  body: '#6366f1', dark: '#312e81' },
    boss:    { hp: 70, speed: 24, r: 27, dmg: 10, score: 300, credits: 32, body: '#fb923c', dark: '#7c2d12' }
  };

  /* ---------------- mutable game state ---------------- */

  var units, bullets, bits, texts, rings, spawnQueue;
  var wave, waveState, gapMs, spawnMs, spawnEvery;
  var score, credits, baseHp, kills, nextId;
  var upg, weapon = { rate: 0.26, dmg: 1, splashR: 0, splashFrac: 0, pierce: 0, slowR: 0, slowFactor: 1 };
  var aim = { x: 240, y: 130 };
  var firing = false, cooldown = 0;
  var shake = 0, hurtFlash = 0, muzzle = 0, clock = 0;
  var newBest = false, rafId = 0, lastT = 0, hudT = 0, hudDirty = false;

  var turret = { x: BASE.x, y: BASE.y, a: Math.PI };

  /* on-canvas upgrade panels (hit-tested with canvas coordinates) */
  var BTN = {
    rate:   { x: 14,  y: H - 94, w: 200, h: 38 },
    dmg:    { x: 224, y: H - 94, w: 200, h: 38 },
    splash: { x: 434, y: H - 94, w: 200, h: 38 },
    pierce: { x: 14,  y: H - 50, w: 200, h: 38 },
    slow:   { x: 224, y: H - 50, w: 200, h: 38 },
    repair: { x: 434, y: H - 50, w: 200, h: 38 }
  };

  var MAX_SPLASH = 4, MAX_PIERCE = 3, MAX_SLOW = 3, MAX_RATE = 5;

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
    if (bits.length > 260) bits.splice(0, bits.length - 260);
  }

  function toast(x, y, txt, colour) {
    texts.push({ x: x, y: y, txt: txt, colour: colour || '#e8eefc', life: 1000, max: 1000 });
    if (texts.length > 26) texts.shift();
  }

  function findBoss() {
    for (var i = 0; i < units.length; i++) {
      if (units[i].boss) return units[i];
    }
    return null;
  }

  /* ---------------- upgrades ---------------- */

  function rateCost() { return 8 + upg.rate * 7; }
  function dmgCost() { return 10 + upg.dmg * 9; }
  function splashCost() { return 16 + upg.splash * 10; }
  function pierceCost() { return 20 + upg.pierce * 12; }
  function slowCost() { return 15 + upg.slow * 9; }
  function repairCost() { return 12 + upg.repair * 4; }

  function costOf(kind) {
    if (kind === 'rate') return rateCost();
    if (kind === 'dmg') return dmgCost();
    if (kind === 'splash') return splashCost();
    if (kind === 'pierce') return pierceCost();
    if (kind === 'slow') return slowCost();
    return repairCost();
  }

  function maxed(kind) {
    if (kind === 'rate') return upg.rate >= MAX_RATE;
    if (kind === 'splash') return upg.splash >= MAX_SPLASH;
    if (kind === 'pierce') return upg.pierce >= MAX_PIERCE;
    if (kind === 'slow') return upg.slow >= MAX_SLOW;
    return false;
  }

  function refreshWeapon() {
    weapon.rate = Math.max(0.085, 0.26 - upg.rate * 0.035);   /* seconds between shots */
    weapon.dmg = 1 + upg.dmg;
    weapon.splashR = upg.splash ? 34 + upg.splash * 10 : 0;
    weapon.splashFrac = upg.splash ? 0.4 + upg.splash * 0.12 : 0;
    weapon.pierce = upg.pierce;
    weapon.slowR = upg.slow ? 90 + upg.slow * 40 : 0;
    weapon.slowFactor = Math.max(0.42, 0.68 - upg.slow * 0.07);
  }

  function buy(kind) {
    if (state !== 'running') return false;
    if (maxed(kind)) {
      toast(BASE.x, BASE.y - 40, 'Already maxed', '#fbbf24');
      return false;
    }
    if (kind === 'repair' && baseHp >= BASE_MAX) {
      toast(BASE.x, BASE.y - 40, 'Base at full HP', '#fbbf24');
      return false;
    }
    var cost = costOf(kind);
    if (credits < cost) {
      toast(BASE.x, BASE.y - 40, 'Need ' + cost + 'cr', '#f87171');
      return false;
    }
    credits -= cost;
    if (kind === 'repair') {
      baseHp = Math.min(BASE_MAX, baseHp + 6);
      upg.repair++;
    } else {
      upg[kind]++;
    }
    refreshWeapon();
    var msg;
    if (kind === 'rate') msg = '⚡ Fire rate up';
    else if (kind === 'dmg') msg = '💥 Damage up';
    else if (kind === 'splash') msg = '✷ Splash up';
    else if (kind === 'pierce') msg = '➤ Piercing rounds';
    else if (kind === 'slow') msg = '◷ Slow field up';
    else msg = '🔧 Base repaired +6';
    toast(BASE.x, BASE.y - 40, msg, '#a7f3d0');
    burst(BASE.x, BASE.y, 10, '#a7f3d0', 90);
    updateHud();
    return true;
  }

  /* ---------------- HUD ---------------- */

  var buyBtns = document.querySelectorAll('[data-buy]');

  function labelOf(kind) {
    if (kind === 'rate') return '⚡ Fire rate Lv' + (upg.rate + 1);
    if (kind === 'dmg') return '💥 Damage Lv' + (upg.dmg + 1);
    if (kind === 'splash') return '✷ Splash Lv' + (upg.splash + 1);
    if (kind === 'pierce') return '➤ Pierce Lv' + (upg.pierce + 1);
    if (kind === 'slow') return '◷ Slow field Lv' + (upg.slow + 1);
    return '🔧 Repair +6 HP';
  }

  function plainLabel(kind) {
    if (kind === 'rate') return '⚡ Fire rate';
    if (kind === 'dmg') return '💥 Damage';
    if (kind === 'splash') return '✷ Splash';
    if (kind === 'pierce') return '➤ Pierce';
    if (kind === 'slow') return '◷ Slow field';
    return '🔧 Repair +6 HP';
  }

  function refreshBuy() {
    for (var i = 0; i < buyBtns.length; i++) {
      var kind = buyBtns[i].getAttribute('data-buy');
      if (kind === 'repair' && baseHp >= BASE_MAX) {
        buyBtns[i].textContent = '🔧 Base full';
        buyBtns[i].disabled = true;
        continue;
      }
      if (maxed(kind)) {
        buyBtns[i].textContent = plainLabel(kind) + ' · MAX';
        buyBtns[i].disabled = true;
        continue;
      }
      buyBtns[i].textContent = labelOf(kind) + ' · ' + costOf(kind) + 'cr';
      buyBtns[i].disabled = credits < costOf(kind);
    }
  }

  function updateHud() {
    var boss = findBoss();
    GameShell.hud(
      {
        Score: score,
        Best: Math.max(best, score),
        Base: baseHp + '/' + BASE_MAX,
        Credits: credits
      },
      state === 'paused' ? '⏸ Paused' : ('Wave ' + wave + (boss ? ' · BOSS' : ''))
    );
    refreshBuy();
  }

  function markHud() { hudDirty = true; }

  /* ---------------- waves ---------------- */

  function buildQueue(n) {
    var q = [], i;
    if (n % 5 === 0) {
      /* boss wave: fewer escorts so the walker can be the focus */
      q.push('boss');
      for (i = 0; i < 3 + Math.floor(n / 2); i++) q.push('scout');
      for (i = 0; i < Math.floor(n / 3); i++) q.push('tank');
      for (i = 0; i < Math.floor(n / 4); i++) q.push('crawler');
      return q;
    }
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
    var q = buildQueue(n);
    var bossFirst = q[0] === 'boss';
    if (bossFirst) q.shift();
    spawnQueue = (bossFirst ? ['boss'] : []).concat(interleave(q));
    spawnEvery = Math.max(300, 1000 - n * 50);
    spawnMs = bossFirst ? 600 : 700;
    if (bossFirst) {
      toast(W / 2, 86, '⚠ WAVE ' + n + ' — ARMOURED WALKER', '#fdba74');
      shake = Math.max(shake, 6);
    } else {
      toast(W / 2, 92, 'Wave ' + n, '#a5b4fc');
    }
    updateHud();
  }

  function scaledHp(type, def) {
    if (type === 'boss') {
      var tier = Math.max(1, Math.floor(wave / 5));
      return Math.round(def.hp * Math.pow(1.55, tier - 1) * (1 + (wave - 1) * 0.035));
    }
    return Math.round(def.hp * Math.pow(1.13, wave - 1));
  }

  function spawnUnit(type, startD) {
    if (units.length >= 80) return null;
    var def = TYPES[type];
    var d0 = Math.max(0, startD || 0);
    var hp = scaledHp(type, def);
    var u = {
      id: nextId++,
      type: type, def: def, d: d0, x: PATH[0].x, y: PATH[0].y,
      hp: hp, maxHp: hp, r: def.r,
      speed: def.speed + (type === 'boss' ? Math.min(10, (wave - 1) * 0.4) : Math.min(36, (wave - 1) * 2.2)),
      step: Math.random() * 6, hurt: 0,
      boss: type === 'boss', phase: 1, summonT: -1, phaseFlash: 0
    };
    var p = { x: 0, y: 0 };
    posAt(d0, p);
    u.x = p.x;
    u.y = p.y;
    units.push(u);
    return u;
  }

  /* ---------------- damage ---------------- */

  function leak(u) {
    if (state !== 'running') return;
    baseHp -= u.def.dmg;
    shake = Math.max(shake, u.boss ? 16 : 9);
    hurtFlash = u.boss ? 420 : 260;
    burst(640, u.y, u.boss ? 26 : 14, '#f87171', 130);
    toast(BASE.x - 20, BASE.y - 90, '-' + u.def.dmg + ' base', '#fca5a5');
    if (baseHp <= 0) { baseHp = 0; gameOver(); }
    else updateHud();
  }

  function killUnit(u) {
    var index = units.indexOf(u);
    if (index < 0) return;
    units.splice(index, 1);
    score += u.def.score;
    credits += u.def.credits;
    kills++;
    burst(u.x, u.y, u.boss ? 34 : 16, u.def.body, u.boss ? 210 : 150);
    toast(u.x, u.y - 16, '+' + u.def.score, '#dcfce7');
    if (u.boss) {
      var bonus = 10 + Math.floor(wave / 5) * 3;
      credits += bonus;
      baseHp = Math.min(BASE_MAX, baseHp + 2);
      shake = Math.max(shake, 15);
      toast(u.x, u.y - 38, 'WALKER DOWN +' + bonus + 'cr', '#fdba74');
      burst(u.x, u.y, 26, '#fdba74', 180);
    }
    markHud();
  }

  function damageUnit(u, amount) {
    u.hp -= amount;
    u.hurt = 90;
    if (u.hp <= 0) killUnit(u);
  }

  function splashDamage(x, y, amount, skipId) {
    if (!weapon.splashR) return;
    var i, u, dx, dy;
    for (i = units.length - 1; i >= 0; i--) {
      u = units[i];
      if (u.id === skipId) continue;
      dx = u.x - x;
      dy = u.y - y;
      if (dx * dx + dy * dy <= (weapon.splashR + u.r) * (weapon.splashR + u.r)) {
        burst(u.x, u.y, 5, '#fde68a', 90);
        u.hp -= amount;
        u.hurt = 90;
        if (u.hp <= 0) killUnit(u);
      }
    }
  }

  function addRing(x, y, r, colour) {
    rings.push({ x: x, y: y, r0: 8, r1: r, life: 280, max: 280, colour: colour || '#fde68a' });
    if (rings.length > 20) rings.shift();
  }

  function fire() {
    var a = turret.a;
    bullets.push({
      x: turret.x + Math.cos(a) * 26,
      y: turret.y + Math.sin(a) * 26,
      vx: Math.cos(a) * 700,
      vy: Math.sin(a) * 700,
      life: 1.3,
      dmg: weapon.dmg,
      pierceLeft: weapon.pierce,
      hit: {}
    });
    if (bullets.length > 240) bullets.shift();
    muzzle = 70;
    shake = Math.max(shake, 2);
  }

  function summonMinions(u) {
    var kind = (wave >= 10 && Math.random() < 0.5) ? 'crawler' : 'scout';
    for (var i = 0; i < 2; i++) {
      var d = Math.max(0, u.d - 26 - i * 24);
      spawnUnit(kind, d);
    }
    toast(u.x, u.y - 46, 'MINIONS!', '#fdba74');
    burst(u.x, u.y, 14, '#fdba74', 130);
    shake = Math.max(shake, 6);
  }

  function updateBossUnit(u, dt) {
    if (u.phaseFlash > 0) u.phaseFlash -= dt;
    if (u.phase === 1 && u.hp <= u.maxHp * 0.5) {
      u.phase = 2;
      u.phaseFlash = 1300;
      u.speed *= 1.3;
      u.summonT = 1500;
      toast(u.x, u.y - 52, '⚠ WALKER PHASE 2', '#fca5a5');
      burst(u.x, u.y, 26, '#f97316', 190);
      shake = Math.max(shake, 12);
    }
    if (u.phase === 2) {
      if (u.summonT < 0) u.summonT = 1600;
      u.summonT -= dt;
      if (u.summonT <= 0) {
        u.summonT = Math.max(4200, 7000 - wave * 90);
        summonMinions(u);
      }
    }
  }

  /* ---------------- state changes ---------------- */

  function start() {
    score = 0;
    credits = 0;
    kills = 0;
    baseHp = BASE_MAX;
    nextId = 1;
    upg = { rate: 0, dmg: 0, splash: 0, pierce: 0, slow: 0, repair: 0 };
    refreshWeapon();
    units = [];
    bullets = [];
    bits = [];
    texts = [];
    rings = [];
    shotStateClear();
    hudT = 0;
    hudDirty = false;
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

    /* batch score/credit HUD rebuilds after splash chains */
    hudT -= dt;
    if (hudDirty && hudT <= 0) {
      hudDirty = false;
      hudT = 150;
      updateHud();
    }

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
        gapMs = 1800;
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
      while (cooldown <= 0 && guard++ < 5) {
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
      if (u.boss) updateBossUnit(u, dt);
      if (u.hurt > 0) u.hurt -= dt;

      var slowMul = 1;
      if (weapon.slowR > 0) {
        var sdx = u.x - SLOW_C.x, sdy = u.y - SLOW_C.y;
        if (sdx * sdx + sdy * sdy <= weapon.slowR * weapon.slowR) {
          slowMul = u.boss ? 1 - (1 - weapon.slowFactor) * 0.35 : weapon.slowFactor;
        }
      }

      u.d += u.speed * slowMul * s;
      if (u.d >= pathLen) {
        leak(u);
        var gone = units.indexOf(u);
        if (gone >= 0) units.splice(gone, 1);
        continue;
      }
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
      for (j = 0; j < units.length; j++) {
        u = units[j];
        if (b.hit[u.id]) continue;
        var dx = u.x - b.x, dy = u.y - b.y;
        var reach = u.r + 5;
        if (dx * dx + dy * dy <= reach * reach) {
          b.hit[u.id] = 1;
          burst(b.x, b.y, 4, '#ecfdf5', 70);
          damageUnit(u, b.dmg);
          if (weapon.splashR > 0) {
            splashDamage(b.x, b.y, Math.max(1, Math.round(b.dmg * weapon.splashFrac)), u.id);
            addRing(b.x, b.y, weapon.splashR, '#fde68a');
          }
          if (b.pierceLeft > 0) {
            b.pierceLeft--;
          } else {
            bullets.splice(i, 1);
          }
          break;
        }
      }
    }

    /* --- particles, rings & floating text --- */
    for (i = bits.length - 1; i >= 0; i--) {
      var bit = bits[i];
      bit.x += bit.vx * s;
      bit.y += bit.vy * s;
      bit.vx *= 0.965;
      bit.vy *= 0.965;
      bit.life -= dt;
      if (bit.life <= 0) bits.splice(i, 1);
    }
    for (i = rings.length - 1; i >= 0; i--) {
      rings[i].life -= dt;
      if (rings[i].life <= 0) rings.splice(i, 1);
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

  function drawSlowField() {
    if (!weapon.slowR) return;
    ctx.save();
    ctx.fillStyle = 'rgba(56, 189, 248, .055)';
    ctx.beginPath();
    ctx.arc(SLOW_C.x, SLOW_C.y, weapon.slowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, .30)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 9]);
    ctx.beginPath();
    ctx.arc(SLOW_C.x, SLOW_C.y, weapon.slowR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(125, 211, 252, .6)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SLOW FIELD', SLOW_C.x, SLOW_C.y - weapon.slowR + 12);
    ctx.restore();
  }

  function drawBossBar() {
    var b = findBoss();
    if (!b) return;
    var bw = 340, bx = (W - bw) / 2, by = 10, bh = 12;
    var frac = clamp(b.hp / b.maxHp, 0, 1);
    ctx.save();
    ctx.fillStyle = 'rgba(5,7,14,.75)';
    rr(bx - 8, by - 5, bw + 16, bh + 26, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(232,238,252,.10)';
    ctx.fillRect(bx, by, bw, bh);
    var hg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    hg.addColorStop(0, b.phase === 2 ? '#ef4444' : '#fb923c');
    hg.addColorStop(1, b.phase === 2 ? '#f97316' : '#fbbf24');
    ctx.fillStyle = hg;
    ctx.fillRect(bx, by, bw * frac, bh);
    /* half-way phase marker */
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.fillRect(bx + bw * 0.5, by, 1.5, bh);
    ctx.strokeStyle = 'rgba(232,238,252,.24)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = b.phase === 2 ? '#fca5a5' : '#fdba74';
    ctx.fillText('ARMOURED WALKER · PHASE ' + b.phase + ' OF 2', W / 2, by + bh + 9);
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

  function drawBossUnit(u) {
    var def = u.def;
    var bob = Math.sin(clock / 100 + u.step) * 1.2;
    var x = u.x, y = u.y + bob;
    var swing = Math.sin(clock / 80 + u.step) * u.r * 0.4;
    var hot = u.phase === 2;

    ctx.save();
    /* shadow */
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath();
    ctx.ellipse(u.x, u.y + u.r * 1.05, u.r * 1.15, u.r * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();

    /* legs */
    ctx.strokeStyle = def.dark;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - u.r * 0.6, y + u.r * 0.5);
    ctx.lineTo(x - u.r * 0.7 + swing, y + u.r * 1.35);
    ctx.moveTo(x + u.r * 0.6, y + u.r * 0.5);
    ctx.lineTo(x + u.r * 0.7 - swing, y + u.r * 1.35);
    ctx.stroke();

    /* armoured body */
    ctx.fillStyle = u.hurt > 0 ? '#ffffff' : def.body;
    rr(x - u.r * 1.15, y - u.r * 0.95, u.r * 2.3, u.r * 1.75, 7);
    ctx.fill();
    ctx.strokeStyle = hot ? '#fca5a5' : def.dark;
    ctx.lineWidth = 3;
    rr(x - u.r * 1.15, y - u.r * 0.95, u.r * 2.3, u.r * 1.75, 7);
    ctx.stroke();

    /* shoulder plates */
    ctx.fillStyle = hot ? '#7f1d1d' : def.dark;
    rr(x - u.r * 1.3, y - u.r * 0.85, u.r * 0.5, u.r * 0.9, 4);
    ctx.fill();
    rr(x + u.r * 0.8, y - u.r * 0.85, u.r * 0.5, u.r * 0.9, 4);
    ctx.fill();

    /* core eye */
    var eye = u.hurt > 0 ? '#ffffff' : (hot ? '#ef4444' : '#fef3c7');
    ctx.shadowColor = hot ? '#ef4444' : '#fbbf24';
    ctx.shadowBlur = hot ? 22 : 14;
    ctx.fillStyle = eye;
    ctx.beginPath();
    ctx.arc(x, y - u.r * 0.1, u.r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    /* antenna */
    ctx.strokeStyle = def.dark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - u.r * 0.95);
    ctx.lineTo(x + 3, y - u.r * 1.45);
    ctx.stroke();
    ctx.fillStyle = hot ? '#ef4444' : '#fbbf24';
    ctx.beginPath();
    ctx.arc(x + 3, y - u.r * 1.45, 2.5, 0, Math.PI * 2);
    ctx.fill();

    /* phase-change flash / summon telegraph */
    if (u.phaseFlash > 0) {
      ctx.strokeStyle = 'rgba(248, 113, 113, ' + (0.35 + 0.4 * Math.abs(Math.sin(clock / 80))) + ')';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(u.x, u.y, u.r + 18 + Math.sin(clock / 120) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (u.phase === 2 && u.summonT >= 0 && u.summonT < 1500) {
      var warn = 0.45 + 0.45 * Math.abs(Math.sin(clock / 110));
      ctx.strokeStyle = 'rgba(251, 146, 60, ' + warn + ')';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.arc(u.x, u.y, u.r + 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(253, 186, 116, ' + warn + ')';
      ctx.fillText('⚠ SUMMON', u.x, u.y - u.r - 16);
    }
    ctx.restore();
  }

  function drawUnit(u) {
    if (u.boss) { drawBossUnit(u); return; }

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
    function panel(key, title, level, cost, affordable, maxedOut) {
      var b = BTN[key];
      ctx.save();
      ctx.fillStyle = affordable ? 'rgba(34,197,94,.16)' : 'rgba(255,255,255,.05)';
      rr(b.x, b.y, b.w, b.h, 10);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = affordable ? 'rgba(34,197,94,.85)' : 'rgba(255,255,255,.14)';
      ctx.stroke();
      ctx.textBaseline = 'middle';
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = affordable ? '#dcfce7' : 'rgba(232,238,252,.5)';
      ctx.fillText(title + ' Lv' + level, b.x + 10, b.y + b.h / 2 + 1);
      ctx.textAlign = 'right';
      ctx.fillStyle = affordable ? '#86efac' : 'rgba(232,238,252,.4)';
      ctx.fillText(maxedOut ? 'MAX' : cost + 'cr', b.x + b.w - 10, b.y + b.h / 2 + 1);
      ctx.restore();
    }

    panel('rate', '⚡ Fire rate', Math.min(MAX_RATE, upg.rate + 1), rateCost(), credits >= rateCost(), upg.rate >= MAX_RATE);
    panel('dmg', '💥 Damage', upg.dmg + 1, dmgCost(), credits >= dmgCost(), false);
    panel('splash', '✷ Splash', upg.splash + 1, splashCost(), credits >= splashCost(), upg.splash >= MAX_SPLASH);
    panel('pierce', '➤ Pierce', upg.pierce + 1, pierceCost(), credits >= pierceCost(), upg.pierce >= MAX_PIERCE);
    panel('slow', '◷ Slow field', upg.slow + 1, slowCost(), credits >= slowCost(), upg.slow >= MAX_SLOW);

    /* repair is a consumable, so it shows its effect rather than a level */
    var b = BTN.repair;
    var canRepair = baseHp < BASE_MAX && credits >= repairCost();
    ctx.save();
    ctx.fillStyle = canRepair ? 'rgba(34,197,94,.16)' : 'rgba(255,255,255,.05)';
    rr(b.x, b.y, b.w, b.h, 10);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = canRepair ? 'rgba(34,197,94,.85)' : 'rgba(255,255,255,.14)';
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = canRepair ? '#dcfce7' : 'rgba(232,238,252,.5)';
    ctx.fillText('🔧 Repair +6', b.x + 10, b.y + b.h / 2 + 1);
    ctx.textAlign = 'right';
    ctx.fillStyle = canRepair ? '#86efac' : 'rgba(232,238,252,.4)';
    ctx.fillText(baseHp >= BASE_MAX ? 'FULL' : repairCost() + 'cr', b.x + b.w - 10, b.y + b.h / 2 + 1);
    ctx.restore();

    ctx.save();
    ctx.font = '700 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('Credits ' + credits, W - 16, 74);
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
    drawSlowField();
    drawBase();
    drawBossBar();

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

    /* splash rings */
    for (i = 0; i < rings.length; i++) {
      var ring = rings[i];
      var k = 1 - ring.life / ring.max;
      ctx.globalAlpha = Math.max(0, ring.life / ring.max) * 0.55;
      ctx.strokeStyle = ring.colour;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r0 + (ring.r1 - ring.r0) * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

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
      ctx.fillText(((wave + 1) % 5 === 0 ? 'Boss wave incoming…' : 'Wave ' + (wave + 1) + ' incoming…'), W / 2, 208);
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
    if (hitPanel(p, 'splash')) { buy('splash'); return; }
    if (hitPanel(p, 'pierce')) { buy('pierce'); return; }
    if (hitPanel(p, 'slow')) { buy('slow'); return; }
    if (hitPanel(p, 'repair')) { buy('repair'); return; }
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
    } else if (k === '3') {
      buy('splash');
    } else if (k === '4') {
      buy('pierce');
    } else if (k === '5') {
      buy('slow');
    } else if (k === '6') {
      buy('repair');
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

  /* ---------------- read-only test hook ---------------- */

  window.__turretGuard = {
    state: function () {
      var boss = findBoss();
      return {
        state: state,
        wave: wave,
        waveState: waveState,
        score: score,
        credits: credits,
        baseHp: baseHp,
        kills: kills,
        units: units.length,
        boss: boss ? { hp: boss.hp, maxHp: boss.maxHp, phase: boss.phase, progress: boss.d } : null
      };
    },
    wave: function () { return wave; },
    bossHp: function () {
      var boss = findBoss();
      return boss ? { hp: boss.hp, maxHp: boss.maxHp, phase: boss.phase } : null;
    },
    powerups: function () {
      return {
        splashR: weapon.splashR,
        pierce: weapon.pierce,
        slowR: weapon.slowR,
        slowFactor: weapon.slowFactor,
        fireRate: weapon.rate,
        damage: weapon.dmg
      };
    },
    upgrades: function () {
      return {
        rate: upg.rate, dmg: upg.dmg, splash: upg.splash,
        pierce: upg.pierce, slow: upg.slow, repair: upg.repair
      };
    },
    units: function () {
      var out = [], i;
      for (i = 0; i < units.length; i++) {
        out.push({
          id: units[i].id, type: units[i].type, boss: units[i].boss,
          x: Math.round(units[i].x), y: Math.round(units[i].y),
          hp: units[i].hp, maxHp: units[i].maxHp,
          d: Math.round(units[i].d), phase: units[i].phase
        });
      }
      return out;
    }
  };

  /* ---------------- boot ---------------- */

  score = 0;
  credits = 0;
  kills = 0;
  baseHp = BASE_MAX;
  nextId = 1;
  upg = { rate: 0, dmg: 0, splash: 0, pierce: 0, slow: 0, repair: 0 };
  refreshWeapon();
  units = [];
  bullets = [];
  bits = [];
  texts = [];
  rings = [];
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
    msg: 'Marching robots are heading for your base. Aim with the mouse or a finger and hold to fire. Every fifth wave sends an armoured walker — spend credits on fire rate, damage, splash, piercing, slow fields or repairs to hold the line.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });
})();
