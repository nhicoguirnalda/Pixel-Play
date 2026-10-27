/* ============================================================
   Drone Defense — original game for PixelPlay
   Top-down arena defence: WASD moves the robot, the mouse aims
   an auto-firing blaster. Drones pour in from every edge.
   Five pickup types, run-long upgrades and an armoured boss
   every fifth wave.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 640, H = 480;
  var BEST_KEY = 'drone-defense';

  var state = 'ready';               /* ready | running | paused | over */
  var best = GameShell.best.get(BEST_KEY, 0);
  var rafId = 0, lastT = 0, newBest = false;

  var score = 0, hp = 100, maxHp = 100, wave = 1;
  var player = { x: W / 2, y: H / 2, r: 14 };
  var aim = { x: W / 2, y: 0 };
  var keys = { left: false, right: false, up: false, down: false };
  var firing = false, autoFire = true;

  var drones = [], bullets = [], eBullets = [], sparks = [], spawnQueue = [], pickups = [];
  var boss = null, bossCount = 0;
  var spawnCd = 0, invuln = 0, fireCd = 0;
  var between = false, waveGap = 0;

  var rapidMs = 0, tripleMs = 0, slowMs = 0, shield = 0;
  var choosing = false, choices = [];
  var upg = { dmg: 0, rate: 0, speed: 0, hp: 0, pierce: 0 };
  var phaseFlash = 0, phaseFlashText = '';

  var PLAYER_SPEED = 3.5;            /* px per 60fps frame */
  var BULLET_SPEED = 10.5;
  var FIRE_MS = 185;
  var CONTACT_PUSH = 30;
  var BOSS_EVERY = 5;

  var PICKUP_DEFS = {
    rapid:  { color: '#ec4899', icon: 'R', label: 'Rapid fire', ms: 9000 },
    triple: { color: '#22d3ee', icon: '3', label: 'Triple shot', ms: 9000 },
    shield: { color: '#60a5fa', icon: 'S', label: 'Shield' },
    repair: { color: '#4ade80', icon: '+', label: 'Repair' },
    slow:   { color: '#a78bfa', icon: 'Z', label: 'Slow field', ms: 7000 }
  };

  var DROP_TABLE = [
    ['rapid', 22], ['triple', 20], ['shield', 18], ['repair', 22], ['slow', 18]
  ];

  var UPG_DEFS = [
    { id: 'dmg',   name: 'Overcharged Cells', desc: '+1 blaster damage',     max: 5 },
    { id: 'rate',  name: 'Servo Trigger',     desc: '12% faster fire',       max: 5 },
    { id: 'speed', name: 'Tread Boost',       desc: '+0.35 move speed',      max: 4 },
    { id: 'hp',    name: 'Armour Plating',    desc: '+20 max HP & repair',   max: 4 },
    { id: 'pierce', name: 'Rail Rounds',      desc: '+1 bullet pierce',      max: 3 }
  ];

  var FALLBACK_UPG = { id: 'score', name: 'Bounty Cache', desc: '+1500 score', max: 99 };

  /* ---------------- helpers ---------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function spark(x, y, n, color, power) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var s = rnd(0.5, 3.6) * (power || 1);
      sparks.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rnd(240, 600), max: 600, r: rnd(1.4, 3.4), color: color
      });
    }
  }

  function slowFactor() { return slowMs > 0 ? 0.55 : 1; }

  function updateHud() {
    GameShell.hud(
      { Score: score, Best: Math.max(best, score), HP: Math.max(0, hp) + '/' + maxHp, Shield: shield },
      state === 'paused' ? '⏸ Paused'
        : (choosing ? '★ Upgrade ready' : 'Wave ' + wave)
    );
  }

  /* ---------------- waves ---------------- */

  var TYPES = {
    basic: { r: 15, hp: 2, speed: 0.92, cap: 2.1, score: 100, dmg: 10, color: '#a3e635' },
    fast:  { r: 11, hp: 1, speed: 1.62, cap: 2.9, score: 150, dmg: 7,  color: '#22d3ee' },
    tank:  { r: 22, hp: 6, speed: 0.62, cap: 1.35, score: 250, dmg: 15, color: '#f59e0b' }
  };

  /* Each warden is tougher than the last. Tier is picked by boss count,
     so the same wave can never roll an easier variant twice. */
  var BOSS_TITLES = ['WARDEN PRIME', 'WARDEN TITAN', 'WARDEN APEX', 'WARDEN OVERLORD'];
  var BOSS_COLORS = ['#fb7185', '#fb923c', '#a855f7', '#22d3ee'];
  var BOSS_DARK = ['#3f1d2b', '#3f2a10', '#2e1a45', '#0e2b36'];

  function queueWave() {
    spawnQueue = [];
    if (wave % BOSS_EVERY === 0) { spawnBoss(); return; }
    var n = Math.min(30, 3 + wave * 2);
    for (var i = 0; i < n; i++) {
      var roll = Math.random();
      var type = 'basic';
      if (wave >= 3 && roll < 0.22 + wave * 0.008) type = 'fast';
      if (wave >= 5 && roll > 0.86 - wave * 0.008) type = 'tank';
      spawnQueue.push(type);
    }
    spawnCd = Math.max(200, 430 - wave * 10);
  }

  function makeDrone(type, x, y) {
    var def = TYPES[type];
    var hpBonus = Math.floor(wave / 2);
    var dmgBonus = Math.floor(wave / 3) * 2;
    drones.push({
      x: x, y: y, r: def.r,
      hp: def.hp + hpBonus, maxHp: def.hp + hpBonus,
      speed: Math.min(def.cap + wave * 0.015, def.speed + wave * 0.04),
      score: def.score, dmg: def.dmg + dmgBonus, color: def.color,
      hitFlash: 0, wob: Math.random() * Math.PI * 2
    });
  }

  function spawnDrone(type) {
    var def = TYPES[type];
    var m = def.r + 10;
    var edge = Math.floor(Math.random() * 4);
    var x, y;
    if (edge === 0) { x = rnd(m, W - m); y = -m; }
    else if (edge === 1) { x = W + m; y = rnd(m, H - m); }
    else if (edge === 2) { x = rnd(m, W - m); y = H + m; }
    else { x = -m; y = rnd(m, H - m); }
    makeDrone(type, x, y);
  }

  function spawnMinion(type) {
    if (!boss) return;
    makeDrone(type, boss.x + rnd(-48, 48), boss.y + rnd(24, 56));
  }

  function spawnBoss() {
    bossCount++;
    var tier = Math.min(BOSS_TITLES.length - 1, bossCount - 1);
    var bhp = Math.round((90 + wave * 16) * (1 + (bossCount - 1) * 0.22));
    var bdmg = Math.round(14 + wave * 1.3 + (bossCount - 1) * 5);
    boss = {
      x: W / 2, y: -100, r: 48 + tier * 2,
      hp: bhp, maxHp: bhp, phase: 1, phase2: false, tier: tier,
      name: BOSS_TITLES[tier], col: BOSS_COLORS[tier], dark: BOSS_DARK[tier],
      dmg: bdmg,
      entering: true, t: 0, hitFlash: 0,
      radialCd: 1800, aimCd: 1100, summonCd: 5200, heavyCd: 7200,
      heavyTele: 0
    };
    phaseFlash = 1400;
    phaseFlashText = boss.name + ' INBOUND';
  }

  /* ---------------- shooting ---------------- */

  function shoot() {
    var a = Math.atan2(aim.y - player.y, aim.x - player.x);
    var dmg = 1 + upg.dmg;
    var offsets = [0];
    if (tripleMs > 0) { offsets = [-0.17, 0, 0.17]; }

    for (var i = 0; i < offsets.length; i++) {
      var ang = a + offsets[i];
      bullets.push({
        x: player.x + Math.cos(ang) * 18,
        y: player.y + Math.sin(ang) * 18,
        vx: Math.cos(ang) * BULLET_SPEED,
        vy: Math.sin(ang) * BULLET_SPEED,
        r: 4, dmg: dmg, pierce: upg.pierce, hits: []
      });
    }
  }

  function dropPickup(x, y) {
    var roll = Math.random() * 100;
    var kind = DROP_TABLE[0][0];
    for (var i = 0; i < DROP_TABLE.length; i++) {
      roll -= DROP_TABLE[i][1];
      if (roll <= 0) { kind = DROP_TABLE[i][0]; break; }
    }
    pickups.push({ x: x, y: y, r: 13, kind: kind, ttl: 15000, t: Math.random() * 6 });
  }

  function collectPickup(kind) {
    var def = PICKUP_DEFS[kind];
    if (kind === 'rapid') rapidMs = 9000;
    else if (kind === 'triple') tripleMs = 9000;
    else if (kind === 'shield') shield = Math.min(3, shield + 1);
    else if (kind === 'repair') hp = Math.min(maxHp, hp + 30);
    else if (kind === 'slow') slowMs = 7000;
    spark(player.x, player.y, 16, def ? def.color : '#a3e635', 0.9);
    updateHud();
  }

  function damageDrone(idx, dmg) {
    var d = drones[idx];
    if (!d) return;
    d.hp -= dmg;
    d.hitFlash = 80;
    if (d.hp > 0) { spark(d.x, d.y, 4, d.color, 0.6); return; }

    score += d.score;
    spark(d.x, d.y, 18, d.color, 1.1);
    drones.splice(idx, 1);
    if (Math.random() < 0.2) dropPickup(d.x, d.y);
    updateHud();
  }

  function damageBoss(dmg) {
    if (!boss) return;
    var b = boss;
    b.hp -= dmg;
    b.hitFlash = 80;
    spark(rnd(b.x - 30, b.x + 30), rnd(b.y - 20, b.y + 20), 3, '#fca5a5', 0.5);
    if (b.hp <= 0) {
      score += 2000 + wave * 200;
      spark(b.x, b.y, 70, '#fb7185', 2);
      for (var i = 0; i < 4; i++) dropPickup(b.x + rnd(-46, 46), b.y + rnd(-30, 30));
      boss = null;
      eBullets = [];
      updateHud();
    }
  }

  function hurtPlayer(d) {
    if (state !== 'running' || invuln > 0) return false;

    /* shove the robot away first, even when a shield absorbs the hit */
    var ax = player.x - d.x, ay = player.y - d.y;
    var len = Math.sqrt(ax * ax + ay * ay) || 1;
    player.x = clamp(player.x + (ax / len) * CONTACT_PUSH, player.r, W - player.r);
    player.y = clamp(player.y + (ay / len) * CONTACT_PUSH, player.r, H - player.r);
    d.x -= (ax / len) * CONTACT_PUSH * 0.6;
    d.y -= (ay / len) * CONTACT_PUSH * 0.6;

    if (shield > 0) {
      shield--;
      invuln = 800;
      spark(player.x, player.y, 18, '#60a5fa', 1.1);
      updateHud();
      return true;
    }

    hp -= d.dmg;
    invuln = 1500;
    spark(player.x, player.y, 22, '#f87171', 1.2);
    updateHud();
    if (hp <= 0) { hp = 0; gameOver(); }
    return true;
  }

  /* ---------------- boss ---------------- */

  function bossRadial(count, speed) {
    if (!boss) return;
    count += (boss.phase - 1) * 3 + boss.tier * 2;
    speed += (boss.phase - 1) * 0.3 + boss.tier * 0.12;
    var off = boss.t * 0.0011;
    for (var i = 0; i < count; i++) {
      var a = off + (i / count) * Math.PI * 2;
      eBullets.push({
        x: boss.x, y: boss.y, r: 5,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed
      });
    }
  }

  function bossVolley(count, speed, spread) {
    if (!boss) return;
    count += (boss.phase - 1) * 2 + boss.tier;
    speed += (boss.phase - 1) * 0.35 + boss.tier * 0.12;
    spread += boss.tier * 0.015;
    var base = Math.atan2(player.y - boss.y, player.x - boss.x);
    for (var i = 0; i < count; i++) {
      var a = base + (-spread + (count === 1 ? 0 : (i / (count - 1)) * spread * 2));
      eBullets.push({
        x: boss.x, y: boss.y, r: 5,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed
      });
    }
  }

  function bossHeavy() {
    if (!boss) return;
    var count = (boss.phase >= 3 ? 34 : boss.phase === 2 ? 28 : 22) + boss.tier * 2;
    var speed = 3.4 + (boss.phase - 1) * 0.25 + boss.tier * 0.12;
    var off = boss.t * 0.0007;
    for (var i = 0; i < count; i++) {
      if (i % 7 === 0) continue;      /* four safe gaps to dodge through */
      var a = off + (i / count) * Math.PI * 2;
      eBullets.push({
        x: boss.x, y: boss.y, r: 6,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed
      });
    }
    spark(boss.x, boss.y, 40, '#fb7185', 1.6);
    boss.radialCd = 700;
  }

  function updateBoss(dt, k) {
    if (!boss) return;
    var b = boss;
    b.t += dt * (slowMs > 0 ? 0.6 : 1);
    if (b.hitFlash > 0) b.hitFlash -= dt;

    if (b.entering) {
      b.y += 1.1 * k;
      if (b.y >= 96) { b.y = 96; b.entering = false; }
      return;
    }

    b.x = W / 2 + Math.sin(b.t * 0.0007) * 170;
    b.y = 96 + Math.sin(b.t * 0.0014) * 12;

    if (b.hp <= b.maxHp * 0.5 && !b.phase2) {
      b.phase2 = true;
      b.phase = 2;
      phaseFlash = 1600;
      phaseFlashText = b.name + ' — PHASE 2';
      b.heavyCd = Math.min(b.heavyCd, 2600);
      spark(b.x, b.y, 46, b.col, 1.7);
    }

    /* Veterans reach a desperate final phase at a quarter health. */
    if (b.tier >= 1 && b.phase === 2 && b.hp <= b.maxHp * 0.25) {
      b.phase = 3;
      phaseFlash = 1400;
      phaseFlashText = b.name + ' — ENRAGED';
      b.heavyCd = Math.min(b.heavyCd, 1800);
      b.radialCd = 400;
      spark(b.x, b.y, 40, b.col, 1.5);
    }

    if (b.heavyTele > 0) {
      b.heavyTele -= dt;
      if (b.heavyTele <= 0) { b.heavyTele = 0; bossHeavy(); }
      return;
    }

    b.radialCd -= dt;
    b.aimCd -= dt;
    b.summonCd -= dt;
    b.heavyCd -= dt;

    var tierRate = Math.max(0.58, 1 - b.tier * 0.11);

    if (b.heavyCd <= 0) {
      b.heavyCd = (b.phase >= 2 ? 5600 : 7600) * tierRate;
      b.heavyTele = 1000;
      b.radialCd = 500;
      return;
    }

    if (b.radialCd <= 0) {
      bossRadial(b.phase >= 2 ? 15 : 11, b.phase >= 2 ? 2.9 : 2.6);
      b.radialCd = (b.phase >= 3 ? 1200 : b.phase === 2 ? 1500 : 2100) * tierRate;
    }
    if (b.aimCd <= 0) {
      bossVolley(b.phase >= 2 ? 5 : 3, b.phase >= 2 ? 4.8 : 4.2, 0.14);
      b.aimCd = (b.phase >= 3 ? 680 : b.phase === 2 ? 850 : 1250) * tierRate;
    }
    if (b.summonCd <= 0) {
      if (drones.length < 12 + b.tier * 2) {
        spawnMinion(b.phase >= 2 ? 'fast' : 'basic');
        spawnMinion(b.phase >= 2 ? 'fast' : 'basic');
      }
      b.summonCd = (b.phase >= 2 ? 3800 : 5200) * tierRate;
    }
  }

  /* ---------------- upgrades ---------------- */

  function openUpgrade() {
    if (choosing) return;
    choosing = true;
    between = true;
    waveGap = 1500;

    var pool = [];
    for (var i = 0; i < UPG_DEFS.length; i++) {
      if ((upg[UPG_DEFS[i].id] || 0) < UPG_DEFS[i].max) pool.push(UPG_DEFS[i]);
    }
    for (var j = pool.length - 1; j > 0; j--) {
      var r = Math.floor(Math.random() * (j + 1));
      var tmp = pool[j]; pool[j] = pool[r]; pool[r] = tmp;
    }
    choices = pool.slice(0, 3);
    while (choices.length < 3) choices.push(FALLBACK_UPG);
    updateHud();
  }

  function selectUpgrade(index) {
    if (!choosing || !choices[index]) return;
    var def = choices[index];
    if (def.id === 'score') {
      score += 1500;
    } else {
      upg[def.id] = (upg[def.id] || 0) + 1;
      if (def.id === 'hp') {
        maxHp += 20;
        hp = Math.min(maxHp, hp + 20);
      }
    }
    spark(player.x, player.y, 20, '#facc15', 1.1);
    choices = [];
    choosing = false;
    waveGap = 1200;
    updateHud();
  }

  function cardRect(i) {
    var cw = 170, gap = 14;
    var total = cw * 3 + gap * 2;
    var x0 = (W - total) / 2;
    return { x: x0 + i * (cw + gap), y: H * 0.30, w: cw, h: 190 };
  }

  /* ---------------- state changes ---------------- */

  function reset() {
    score = 0; hp = 100; maxHp = 100; wave = 1; newBest = false;
    player.x = W / 2; player.y = H / 2;
    drones = []; bullets = []; eBullets = []; sparks = []; spawnQueue = []; pickups = [];
    boss = null; bossCount = 0;
    keys.left = keys.right = keys.up = keys.down = false;
    firing = false;
    spawnCd = 0; invuln = 1500; fireCd = 0;
    between = false; waveGap = 0;
    rapidMs = 0; tripleMs = 0; slowMs = 0; shield = 0;
    choosing = false; choices = [];
    upg = { dmg: 0, rate: 0, speed: 0, hp: 0, pierce: 0 };
    phaseFlash = 0; phaseFlashText = '';
    aim.x = W / 2; aim.y = 0;
    queueWave();
    updateHud();
  }

  function start() {
    reset();
    state = 'running';
    lastT = 0;
    GameShell.overlay.hide();
    updateHud();
    ensureLoop();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    keys.left = keys.right = keys.up = keys.down = false;
    firing = false;
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The arena is on hold. Resume when you are ready to face the swarm again.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Wave', value: wave },
        { label: 'HP', value: Math.max(0, hp) + '/' + maxHp }
      ],
      btn: '▶ Resume',
      action: resume
    });
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'running';
    lastT = 0;
    GameShell.overlay.hide();
    updateHud();
  }

  function gameOver() {
    state = 'over';
    if (score > best) { best = score; newBest = true; GameShell.best.set(BEST_KEY, best); }
    updateHud();
    GameShell.overlay.show({
      title: newBest ? 'New high score!' : 'Robot down',
      msg: 'You survived to wave ' + wave + ' and scored ' + score + ' points. Give the drones another go.',
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

  function update(dt, k) {
    if (choosing) return;

    if (invuln > 0) invuln -= dt;
    if (rapidMs > 0) rapidMs = Math.max(0, rapidMs - dt);
    if (tripleMs > 0) tripleMs = Math.max(0, tripleMs - dt);
    if (slowMs > 0) slowMs = Math.max(0, slowMs - dt);
    if (phaseFlash > 0) phaseFlash -= dt;

    var dx = 0, dy = 0;
    if (keys.left) dx -= 1;
    if (keys.right) dx += 1;
    if (keys.up) dy -= 1;
    if (keys.down) dy += 1;
    if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
    var speed = PLAYER_SPEED + upg.speed * 0.35;
    player.x = clamp(player.x + dx * speed * k, player.r, W - player.r);
    player.y = clamp(player.y + dy * speed * k, player.r, H - player.r);

    /* auto / held fire toward the cursor */
    fireCd -= dt;
    if (fireCd <= 0 && (firing || autoFire)) {
      fireCd = FIRE_MS * Math.pow(0.88, upg.rate) * (rapidMs > 0 ? 0.5 : 1);
      shoot();
    }

    /* bullets */
    for (var i = bullets.length - 1; i >= 0; i--) {
      var b = bullets[i];
      b.x += b.vx * k;
      b.y += b.vy * k;
      if (b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) {
        bullets.splice(i, 1);
        continue;
      }

      var remove = false;
      for (var j = drones.length - 1; j >= 0; j--) {
        var t = drones[j];
        var ddx = b.x - t.x, ddy = b.y - t.y;
        if (ddx * ddx + ddy * ddy < (t.r + b.r) * (t.r + b.r)) {
          if (b.pierce > 0 && b.hits.indexOf(t) < 0) {
            b.hits.push(t);
            b.pierce--;
            damageDrone(j, b.dmg);
          } else if (b.pierce <= 0) {
            remove = true;
            damageDrone(j, b.dmg);
            break;
          }
        }
      }

      if (!remove && boss) {
        var bx = b.x - boss.x, by = b.y - boss.y;
        if (bx * bx + by * by < (boss.r + b.r) * (boss.r + b.r)) {
          if (b.pierce > 0 && b.hits.indexOf(boss) < 0) {
            b.hits.push(boss);
            b.pierce--;
            damageBoss(b.dmg);
          } else if (b.pierce <= 0) {
            remove = true;
            damageBoss(b.dmg);
          }
        }
      }
      if (remove) bullets.splice(i, 1);
    }

    /* drones chase the robot */
    var sm = slowFactor();
    for (var e = 0; e < drones.length; e++) {
      var d = drones[e];
      if (d.hitFlash > 0) d.hitFlash -= dt;
      d.wob += 0.05 * k;

      var ax = player.x - d.x, ay = player.y - d.y;
      var len = Math.sqrt(ax * ax + ay * ay) || 1;
      d.x += (ax / len) * d.speed * sm * k;
      d.y += (ay / len) * d.speed * sm * k;
    }

    /* gentle separation so the swarm does not stack into one dot */
    for (var a = 0; a < drones.length; a++) {
      for (var c = a + 1; c < drones.length; c++) {
        var da = drones[a], dc = drones[c];
        var sx = dc.x - da.x, sy = dc.y - da.y;
        var dist2 = sx * sx + sy * sy;
        var want = (da.r + dc.r) * (da.r + dc.r);
        if (dist2 > 0.01 && dist2 < want) {
          var dist = Math.sqrt(dist2);
          var push = ((da.r + dc.r) - dist) * 0.16;
          var nx = sx / dist, ny = sy / dist;
          da.x -= nx * push; da.y -= ny * push;
          dc.x += nx * push; dc.y += ny * push;
        }
      }
    }

    /* boss behaviour */
    updateBoss(dt, k);

    /* contact damage */
    for (var q = drones.length - 1; q >= 0; q--) {
      var dr = drones[q];
      var hx = player.x - dr.x, hy = player.y - dr.y;
      if (hx * hx + hy * hy < (player.r + dr.r) * (player.r + dr.r)) {
        hurtPlayer(dr);
        if (state !== 'running') return;
      }
    }
    if (boss) {
      var hbx = player.x - boss.x, hby = player.y - boss.y;
      if (hbx * hbx + hby * hby < (player.r + boss.r) * (player.r + boss.r)) {
        hurtPlayer(boss);
        if (state !== 'running') return;
      }
    }

    /* boss bullets */
    for (var m = eBullets.length - 1; m >= 0; m--) {
      var eb = eBullets[m];
      eb.x += eb.vx * k * (slowMs > 0 ? 0.85 : 1);
      eb.y += eb.vy * k * (slowMs > 0 ? 0.85 : 1);
      if (eb.x < -24 || eb.x > W + 24 || eb.y < -24 || eb.y > H + 24) {
        eBullets.splice(m, 1);
        continue;
      }
      var edx = eb.x - player.x, edy = eb.y - player.y;
      if (edx * edx + edy * edy < (player.r + eb.r) * (player.r + eb.r)) {
        eBullets.splice(m, 1);
        hurtPlayer({ x: eb.x, y: eb.y, dmg: Math.round(7 + wave * 0.8) });
        if (state !== 'running') return;
      }
    }

    /* trickle the wave in */
    if (spawnQueue.length) {
      spawnCd -= dt;
      if (spawnCd <= 0) {
        spawnCd = 400;
        spawnDrone(spawnQueue.shift());
      }
    }

    /* pickups */
    for (var p = pickups.length - 1; p >= 0; p--) {
      var pk = pickups[p];
      pk.ttl -= dt;
      pk.t += 0.05 * k;
      if (pk.ttl <= 0) { pickups.splice(p, 1); continue; }
      var pdx = pk.x - player.x, pdy = pk.y - player.y;
      if (pdx * pdx + pdy * pdy < (player.r + pk.r + 4) * (player.r + pk.r + 4)) {
        collectPickup(pk.kind);
        pickups.splice(p, 1);
      }
    }

    /* sparks */
    for (var s = sparks.length - 1; s >= 0; s--) {
      var sk = sparks[s];
      sk.x += sk.vx * k;
      sk.y += sk.vy * k;
      sk.vx *= 0.96;
      sk.vy *= 0.96;
      sk.life -= dt;
      if (sk.life <= 0) sparks.splice(s, 1);
    }

    /* wave progression */
    if (!spawnQueue.length && !drones.length && !boss) {
      if (!between) {
        between = true;
        waveGap = 1500;
        score += 150 + wave * 75;
        openUpgrade();
        updateHud();
      } else if (!choosing) {
        waveGap -= dt;
        if (waveGap <= 0) {
          between = false;
          wave++;
          queueWave();
          hp = Math.min(maxHp, hp + 12);      /* a clean wave patches the robot */
          updateHud();
        }
      }
    }
  }

  /* ---------------- draw ---------------- */

  function drawArena() {
    var g = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.72);
    g.addColorStop(0, '#0d1526');
    g.addColorStop(1, '#05070e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,.045)';
    ctx.lineWidth = 1;
    for (var x = 40; x < W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
      ctx.stroke();
    }
    for (var y = 40; y < H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(34,211,238,.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(3, 3, W - 6, H - 6);
  }

  function drawRobot(t) {
    var blink = invuln > 0 && Math.floor(t / 90) % 2 === 0;
    var a = Math.atan2(aim.y - player.y, aim.x - player.x);

    if (slowMs > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(167,139,250,.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 58 + Math.sin(t / 220) * 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    /* blaster barrel */
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(a);
    ctx.fillStyle = '#a3e635';
    ctx.shadowColor = '#a3e635';
    ctx.shadowBlur = 10;
    ctx.fillRect(6, -3.5, 18, 7);
    ctx.restore();

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.shadowColor = '#a3e635';
    ctx.shadowBlur = 16;
    ctx.fillStyle = blink ? '#ecfccb' : '#65a30d';
    roundRect(-14, -14, 28, 28, 8);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.fillStyle = '#05070e';
    roundRect(-8, -8, 16, 16, 4);
    ctx.fill();
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.arc(-3.5, -2, 2.6, 0, Math.PI * 2);
    ctx.arc(3.5, -2, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (shield > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(96,165,250,.85)';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#60a5fa';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 24 + Math.sin(t / 230) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#bfdbfe';
      for (var s = 0; s < shield; s++) {
        var sa = t / 500 + (s / shield) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(player.x + Math.cos(sa) * 27, player.y + Math.sin(sa) * 27, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (invuln > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(252,211,77,.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 22 + Math.sin(t / 200) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawDrone(d) {
    var hurt = d.hitFlash > 0;

    ctx.save();
    ctx.shadowColor = hurt ? '#ffffff' : d.color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = hurt ? '#ffffff' : d.color;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#05070e';
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r * 0.46, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = hurt ? '#05070e' : d.color;
    ctx.beginPath();
    ctx.arc(d.x + Math.cos(d.wob) * d.r * 0.2,
            d.y + Math.sin(d.wob) * d.r * 0.2, d.r * 0.2, 0, Math.PI * 2);
    ctx.fill();

    /* health pips on the tougher drones */
    if (d.maxHp > 1) {
      var frac = Math.max(0, d.hp / d.maxHp);
      ctx.strokeStyle = 'rgba(232,238,252,.8)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
    }
  }

  function drawBoss(t) {
    if (!boss) return;
    var b = boss;
    var hurt = b.hitFlash > 0;

    if (b.heavyTele > 0) {
      var prog = 1 - b.heavyTele / 1000;
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.2 * Math.sin(t / 70);
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 90 + prog * 130, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = '#fca5a5';
      ctx.lineWidth = 3;
      ctx.setLineDash([12, 9]);
      ctx.beginPath();
      ctx.arc(b.x, b.y, 90 + prog * 130, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fef2f2';
      ctx.font = '800 15px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CHARGING — dodge the gaps!', b.x, b.y + 82);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.t * 0.0004);
    ctx.shadowColor = hurt ? '#ffffff' : b.col;
    ctx.shadowBlur = 24;
    ctx.fillStyle = hurt ? '#ffffff' : (b.phase >= 2 ? b.col : b.dark);
    ctx.beginPath();
    for (var i = 0; i < 8; i++) {
      var a = (i / 8) * Math.PI * 2;
      var rr = i % 2 === 0 ? b.r + 8 : b.r - 6;
      var px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hurt ? '#ffffff' : b.col;
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.fillStyle = hurt ? '#ffffff' : b.col;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#05070e';
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(-b.t * 0.0004);
    ctx.fillStyle = hurt ? '#ffffff' : b.col;
    for (var k = 0; k < 4; k++) {
      ctx.save();
      ctx.rotate((k / 4) * Math.PI * 2 + b.t * 0.0012);
      ctx.fillRect(b.r - 2, -5, 20, 10);
      ctx.restore();
    }
    ctx.restore();

    /* boss health bar */
    var bw = 420, bx = (W - bw) / 2, by = 12;
    var frac = Math.max(0, b.hp / b.maxHp);
    ctx.save();
    ctx.fillStyle = 'rgba(5,7,14,.75)';
    roundRect(bx - 6, by - 4, bw + 12, 30, 8);
    ctx.fill();
    ctx.fillStyle = b.col;
    ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.name + '  ·  PHASE ' + b.phase, W / 2, by + 3);
    ctx.fillStyle = 'rgba(255,255,255,.15)';
    roundRect(bx, by + 11, bw, 9, 4);
    ctx.fill();
    ctx.fillStyle = frac > 0.4 ? b.col : '#fbbf24';
    roundRect(bx, by + 11, Math.max(0, bw * frac), 9, 4);
    ctx.fill();
    ctx.restore();
  }

  function drawPickup(pk) {
    var def = PICKUP_DEFS[pk.kind] || PICKUP_DEFS.rapid;
    var bob = Math.sin(pk.t) * 3;
    var blink = pk.ttl < 3000 && Math.floor(pk.ttl / 200) % 2 === 0;

    ctx.save();
    ctx.globalAlpha = blink ? 0.4 : 1;
    ctx.translate(pk.x, pk.y + bob);
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(8,13,26,.85)';
    roundRect(-pk.r, -pk.r, pk.r * 2, pk.r * 2, 5);
    ctx.fill();
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = def.color;
    ctx.font = '800 14px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.icon, 0, 1);
    ctx.restore();
  }

  function drawPowerChips() {
    var chips = [];
    if (rapidMs > 0) chips.push({ id: 'rapid', ms: rapidMs });
    if (tripleMs > 0) chips.push({ id: 'triple', ms: tripleMs });
    if (slowMs > 0) chips.push({ id: 'slow', ms: slowMs });
    if (shield > 0) chips.push({ id: 'shield', ms: 0 });

    for (var i = 0; i < chips.length; i++) {
      var def = PICKUP_DEFS[chips[i].id];
      var x = 12, y = 58 + i * 26;
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = 'rgba(8,13,26,.72)';
      roundRect(x, y, 102, 21, 6);
      ctx.fill();
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = def.color;
      ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.icon, x + 6, y + 11);
      ctx.fillStyle = 'rgba(232,238,252,.9)';
      ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(def.label, x + 23, y + 11);
      if (chips[i].ms > 0) {
        var pct = clamp(chips[i].ms / (def.ms || 9000), 0, 1);
        ctx.fillStyle = 'rgba(255,255,255,.18)';
        ctx.fillRect(x + 23, y + 17, 70, 2);
        ctx.fillStyle = def.color;
        ctx.fillRect(x + 23, y + 17, 70 * pct, 2);
      }
      ctx.restore();
    }
  }

  function drawUpgradeSummary() {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(147,163,194,.9)';
    ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('DMG ' + (1 + upg.dmg) + '  ·  RATE ' + upg.rate +
                 '  ·  SPD ' + upg.speed + '  ·  PIERCE ' + upg.pierce,
                 W - 10, H - 14);
    ctx.restore();
  }

  function drawCrosshair(t) {
    var x = clamp(aim.x, 0, W), y = clamp(aim.y, 0, H);
    ctx.save();
    ctx.strokeStyle = 'rgba(163,230,53,.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 11 + Math.sin(t / 260) * 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 18, y); ctx.lineTo(x - 5, y);
    ctx.moveTo(x + 5, y);  ctx.lineTo(x + 18, y);
    ctx.moveTo(x, y - 18); ctx.lineTo(x, y - 5);
    ctx.moveTo(x, y + 5);  ctx.lineTo(x, y + 18);
    ctx.stroke();
    ctx.restore();
  }

  function drawBanner() {
    if (!between || choosing) return;
    var next = wave + 1;
    ctx.save();
    ctx.font = '800 34px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(232,238,252,.92)';
    ctx.fillText('Wave ' + next, W / 2, H / 2 - 12);
    ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(147,163,194,.95)';
    ctx.fillText(next % BOSS_EVERY === 0 ? 'Armoured warden inbound…' : 'Incoming drones…',
                 W / 2, H / 2 + 20);
    ctx.restore();
  }

  function drawUpgradePanel() {
    if (!choosing) return;
    ctx.save();
    ctx.fillStyle = 'rgba(3,6,13,.82)';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#e8eefc';
    ctx.font = '800 28px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Wave cleared — upgrade!', W / 2, H * 0.18);
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#93a3c2';
    ctx.fillText('Press 1, 2 or 3 — or click a card. Upgrades last for this run.', W / 2, H * 0.18 + 28);

    for (var i = 0; i < 3; i++) {
      var def = choices[i];
      if (!def) continue;
      var r = cardRect(i);
      var lvl = (upg[def.id] || 0);
      ctx.fillStyle = 'rgba(13,21,38,.96)';
      roundRect(r.x, r.y, r.w, r.h, 12);
      ctx.fill();
      ctx.strokeStyle = '#a3e635';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = 'rgba(163,230,53,.16)';
      roundRect(r.x + 12, r.y + 12, 26, 26, 6);
      ctx.fill();
      ctx.fillStyle = '#a3e635';
      ctx.font = '800 15px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), r.x + 25, r.y + 25);

      ctx.fillStyle = '#e8eefc';
      ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(def.name, r.x + r.w / 2, r.y + 70);

      ctx.fillStyle = '#93a3c2';
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(def.desc, r.x + r.w / 2, r.y + 96);

      ctx.fillStyle = '#facc15';
      ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
      if (def.id === 'score') ctx.fillText('Bonus', r.x + r.w / 2, r.y + 138);
      else ctx.fillText('Lv ' + lvl + ' → ' + (lvl + 1) + ' / ' + def.max, r.x + r.w / 2, r.y + 138);

      ctx.fillStyle = 'rgba(147,163,194,.7)';
      ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('click or press ' + (i + 1), r.x + r.w / 2, r.y + 166);
    }

    ctx.fillStyle = 'rgba(147,163,194,.8)';
    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Damage ' + (1 + upg.dmg) + '   ·   Fire rate ' + upg.rate +
                 '   ·   Speed ' + upg.speed + '   ·   Pierce ' + upg.pierce +
                 '   ·   HP ' + hp + '/' + maxHp, W / 2, H * 0.30 + 218);
    ctx.restore();
  }

  function draw(t) {
    drawArena();

    for (var i = 0; i < pickups.length; i++) drawPickup(pickups[i]);

    drawBoss(t);

    for (var d = 0; d < drones.length; d++) drawDrone(drones[d]);

    ctx.save();
    ctx.shadowColor = '#a3e635';
    ctx.shadowBlur = 10;
    for (var b = 0; b < bullets.length; b++) {
      ctx.fillStyle = '#d9f99d';
      ctx.beginPath();
      ctx.arc(bullets[b].x, bullets[b].y, bullets[b].r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    /* boss bullets */
    ctx.save();
    ctx.shadowColor = '#fb7185';
    ctx.shadowBlur = 10;
    for (var m = 0; m < eBullets.length; m++) {
      ctx.fillStyle = '#fecdd3';
      ctx.beginPath();
      ctx.arc(eBullets[m].x, eBullets[m].y, eBullets[m].r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (state !== 'over') drawRobot(t);

    for (var q = 0; q < sparks.length; q++) {
      var sk = sparks[q];
      ctx.globalAlpha = Math.max(0, Math.min(1, sk.life / sk.max));
      ctx.fillStyle = sk.color;
      ctx.beginPath();
      ctx.arc(sk.x, sk.y, sk.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (state === 'running' && !choosing) drawCrosshair(t);

    drawPowerChips();
    drawUpgradeSummary();
    drawBanner();

    if (phaseFlash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, phaseFlash / 500);
      ctx.fillStyle = '#fef3c7';
      ctx.font = '800 22px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(phaseFlashText, W / 2, H * 0.62);
      ctx.restore();
    }

    drawUpgradePanel();
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    if (!lastT) lastT = t;
    var dt = Math.min(50, t - lastT);      /* cap so tab jumps never teleport */
    lastT = t;
    var k = dt / 16.67;
    if (state === 'running') update(dt, k);
    draw(t);
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  function pointerToArena(e) {
    var rect = canvas.getBoundingClientRect();
    var sx = rect.width ? W / rect.width : 1;
    var sy = rect.height ? H / rect.height : 1;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  function inRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  canvas.addEventListener('pointermove', function (e) {
    var p = pointerToArena(e);
    aim.x = p.x; aim.y = p.y;
  });

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    var p = pointerToArena(e);
    if (choosing) {
      for (var i = 0; i < 3; i++) {
        if (choices[i] && inRect(p.x, p.y, cardRect(i))) {
          selectUpgrade(i);
          return;
        }
      }
      return;
    }
    aim.x = p.x; aim.y = p.y;
    firing = true;
    if (state === 'ready' || state === 'over') start();
  });

  document.addEventListener('pointerup', function () { firing = false; });

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;

    var key = e.key;

    if (choosing) {
      if (key === '1' || key === '2' || key === '3') {
        e.preventDefault();
        selectUpgrade(parseInt(key, 10) - 1);
      } else if (key === 'p' || key === 'P' || key === 'Escape') {
        if (state === 'paused') resume();
        else pause();
      }
      return;
    }

    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' ||
        key === 'ArrowRight' || key === ' ') {
      e.preventDefault();
    }

    if (key === 'ArrowLeft' || key === 'a' || key === 'A') keys.left = true;
    else if (key === 'ArrowRight' || key === 'd' || key === 'D') keys.right = true;
    else if (key === 'ArrowUp' || key === 'w' || key === 'W') keys.up = true;
    else if (key === 'ArrowDown' || key === 's' || key === 'S') keys.down = true;
    else if (key === ' ') {
      firing = true;
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
    } else if (key === 'Enter') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
      else if (state === 'running') pause();
    } else if (key === 'p' || key === 'P' || key === 'Escape') {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    }
  });

  document.addEventListener('keyup', function (e) {
    var key = e.key;
    if (key === 'ArrowLeft' || key === 'a' || key === 'A') keys.left = false;
    else if (key === 'ArrowRight' || key === 'd' || key === 'D') keys.right = false;
    else if (key === 'ArrowUp' || key === 'w' || key === 'W') keys.up = false;
    else if (key === 'ArrowDown' || key === 's' || key === 'S') keys.down = false;
    else if (key === ' ') firing = false;
  });

  window.addEventListener('blur', function () {
    keys.left = keys.right = keys.up = keys.down = false;
    firing = false;
  });

  /* on-screen direction pad */
  var padBtns = document.querySelectorAll('[data-dir]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      var dir = btn.getAttribute('data-dir');
      btn.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        keys[dir] = true;
        if (state === 'ready' || state === 'over') start();
      });
      btn.addEventListener('pointerup', function (ev) {
        if (ev) ev.preventDefault();
        keys[dir] = false;
      });
      btn.addEventListener('pointerleave', function () { keys[dir] = false; });
      btn.addEventListener('pointercancel', function () { keys[dir] = false; });
    })(padBtns[b]);
  }

  var actionBtns = document.querySelectorAll('[data-action]');
  for (var a = 0; a < actionBtns.length; a++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-action') !== 'pause') return;
        if (state === 'running') pause();
        else if (state === 'paused') resume();
      });
    })(actionBtns[a]);
  }

  /* auto-pause when the tab is hidden */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) return;
    keys.left = keys.right = keys.up = keys.down = false;
    firing = false;
    if (state === 'running') pause();
  });

  /* ---------------- read-only test hook ---------------- */

  window.__droneDefense = {
    state: function () { return state; },
    wave: function () { return wave; },
    score: function () { return score; },
    hp: function () { return hp; },
    maxHp: function () { return maxHp; },
    player: function () { return { x: player.x, y: player.y }; },
    drones: function () {
      var out = [];
      for (var i = 0; i < drones.length; i++) {
        out.push({ x: drones[i].x, y: drones[i].y, r: drones[i].r, hp: drones[i].hp });
      }
      return out;
    },
    boss: function () {
      if (!boss) return null;
      return {
        hp: boss.hp, maxHp: boss.maxHp, phase: boss.phase,
        x: boss.x, y: boss.y, telegraph: boss.heavyTele > 0
      };
    },
    powerups: function () {
      var active = [];
      if (rapidMs > 0) active.push({ kind: 'rapid', remaining: rapidMs });
      if (tripleMs > 0) active.push({ kind: 'triple', remaining: tripleMs });
      if (slowMs > 0) active.push({ kind: 'slow', remaining: slowMs });
      var drops = [];
      for (var i = 0; i < pickups.length; i++) {
        drops.push({ kind: pickups[i].kind, x: pickups[i].x, y: pickups[i].y });
      }
      return { active: active, shield: shield, drops: drops };
    },
    upgrades: function () {
      var picked = [];
      for (var i = 0; i < choices.length; i++) picked.push(choices[i].id);
      return {
        dmg: upg.dmg, rate: upg.rate, speed: upg.speed,
        hp: upg.hp, pierce: upg.pierce,
        choosing: choosing, choices: picked
      };
    }
  };

  /* ---------------- boot ---------------- */

  reset();
  state = 'ready';
  ensureLoop();
  GameShell.overlay.show({
    title: 'Drone Defense',
    msg: 'Drive the robot with WASD and aim with the mouse — the blaster fires on its own. Walk over coloured pickups for rapid fire, triple shot, a shield, repairs or a slow field. Every fifth wave sends an armoured warden: dodge its telegraphed burst, then pick a permanent upgrade with 1, 2 or 3.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* shared HUD reset button */
  if (typeof GameShell.onReset === 'function') GameShell.onReset(start);
})();
