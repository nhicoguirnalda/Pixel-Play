/* ============================================================
   Stickman Fighter — original game for PixelPlay
   Canvas arena beat-em-up: endless waves of rival stick fighters,
   fast Strikers and heavy Brutes, with a named boss every 4th wave.
   Punch / kick / guard, combos, dodge bonuses, cartoon knockouts.
   Keyboard first, on-screen buttons for touch.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 600, H = 600;
  var TAU = Math.PI * 2;
  var BEST_KEY = 'stickman-fighter';
  var FONT = '"Segoe UI", system-ui, sans-serif';
  var GROUND = 500;                 /* foot line of the arena */

  /* GameShell is provided by ../js/game-page.js, which loads first.
     The no-op fallback only exists so this file can never throw. */
  var GameShell = window.GameShell;
  if (!GameShell) {
    GameShell = {
      hud: function () {},
      overlay: { show: function () {}, hide: function () {} },
      best: { get: function (k, f) { return f || 0; }, set: function () {} }
    };
  }

  var ENEMY_COLS = ['#ff5c7a', '#f59e0b', '#a855f7', '#2ee6a6'];
  var PLAYER_COL = '#22d3ee';

  /* Every 4th wave is a boss fight: 4, 8, 12, … */
  var BOSS_EVERY = 4;
  var BOSS_NAMES = ['Iron Overseer', 'Titan Warden', 'Crimson Colossus', 'Void Champion'];
  var BOSS_COL = '#f43f5e';

  /* Rival archetypes. hp/dmg/speed are multipliers over the wave baseline. */
  var ENEMY_TYPES = {
    grunt: {
      col: '#ff5c7a', hp: 1, dmg: 1, speed: 1, cd: 1,
      reach: 70, scale: 1, telegraph: 0.44, label: 'Rival'
    },
    striker: {
      col: '#2ee6a6', hp: 0.72, dmg: 0.82, speed: 1.5, cd: 0.68,
      reach: 78, scale: 0.9, telegraph: 0.29, label: 'Striker'
    },
    brute: {
      col: '#f97316', hp: 2.2, dmg: 1.75, speed: 0.6, cd: 1.45,
      reach: 86, scale: 1.28, telegraph: 0.62, label: 'Brute'
    }
  };

  /* attack tables: w0 = frame the strike resolves, all windows >= 0.05s */
  var ATK = {
    punch: { dur: 0.26, w0: 0.06, reach: 68, dmg: 7, kb: 90, stun: 0.24, cool: 0.08, pts: 10 },
    kick:  { dur: 0.46, w0: 0.15, reach: 88, dmg: 13, kb: 300, stun: 0.4, cool: 0.16, pts: 16 }
  };
  var ENEMY_REACH = 70;

  var IDLE_POSE = { crouch: 0, armF: 0.18, armB: -0.14, legF: 0.1, legB: -0.1, lean: 0.05, tilt: 0 };
  var KNOCK_POSE = { crouch: 0, armF: -1.3, armB: -1.05, legF: 0.9, legB: -0.8, lean: 0.2, tilt: 0.3 };

  /* ---------------- state ---------------- */

  var state = 'ready';            /* ready | running | paused | over | upgrade */
  var score = 0, wave = 1, knockouts = 0;
  var best = GameShell.best.get(BEST_KEY, 0);
  var player = null, enemies = [], particles = [], pops = [];
  var pickups = [], shockwaves = [], hitFlashes = [];
  var keys = { left: false, right: false, block: false };
  var combo = 0, comboT = 0;
  var phase = 'fight';            /* fight | breather */
  var spawnLeft = 0, spawnT = 0, spawnSide = 0, breatherT = 0;
  var boss = null;                /* live boss object, also present in enemies */
  var bossDefeated = false, bossNumber = 0;
  var banner = null;              /* { title, sub, t, t0 } */
  var flashT = 0, shake = 0, tGlobal = 0, hitStop = 0;
  var rafId = 0, last = 0;

  /* new systems: run upgrades, pickups and combat feedback */
  var upgradeChoices = [], upgradeRects = [], upgradeSel = 0, upgradesTaken = 0;
  var upDamage = 0, upSpeed = 0, upGuard = 0, upCombo = 0, comboBonus = 0;
  var dmgBoostT = 0, speedT = 0, shieldCharges = 0;
  var leftSideHits = 0, rightSideHits = 0, effectsSpawned = 0, shockSpawned = 0;
  var pickupsDropped = 0, pickupsTaken = 0;

  var UPGRADE_DEFS = {
    damage: { title: 'Heavy Hands', desc: '+18% strike damage', col: '#fb7185' },
    speed:  { title: 'Light Feet',  desc: '+12% move speed',   col: '#22d3ee' },
    heal:   { title: 'Second Wind', desc: 'Restore 45 HP',     col: '#2ee6a6' },
    guard:  { title: 'Iron Guard',  desc: 'Guard blocks more', col: '#a78bfa' },
    combo:  { title: 'Flow State',  desc: '+0.5s combo window', col: '#facc15' }
  };

  var PICKUP_DEFS = {
    heal:   { col: '#2ee6a6' },
    damage: { col: '#fb7185' },
    speed:  { col: '#22d3ee' },
    shield: { col: '#a78bfa' },
    combo:  { col: '#facc15' }
  };

  var GUARD_BASE = 0.3;
  var COMBO_BASE = 1.5;

  /* ---------------- helpers ---------------- */

  function rand(n) { return Math.floor(Math.random() * n); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function sfx(name) {
    if (window.PixelPlayAudio) window.PixelPlayAudio.sfx(name);
  }

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function newPose() {
    return { crouch: 0, armF: IDLE_POSE.armF, armB: IDLE_POSE.armB,
             legF: 0.1, legB: -0.1, lean: 0.05, tilt: 0 };
  }

  function lerpPose(p, target, dt) {
    var k = Math.min(1, dt * 16);
    p.crouch += (target.crouch - p.crouch) * k;
    p.armF += (target.armF - p.armF) * k;
    p.armB += (target.armB - p.armB) * k;
    p.legF += (target.legF - p.legF) * k;
    p.legB += (target.legB - p.legB) * k;
    p.lean += (target.lean - p.lean) * k;
    p.tilt += (target.tilt - p.tilt) * k;
  }

  function burst(x, y, col, n, stars) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var s = 50 + Math.random() * 190;
      var life = 0.3 + Math.random() * 0.45;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40,
        life: life, life0: life,
        size: 2 + Math.random() * 3,
        col: col, star: !!stars && i % 3 === 0
      });
    }
    if (particles.length > 300) particles.splice(0, particles.length - 300);
  }

  function pop(x, y, txt, col, size) {
    pops.push({ x: x, y: y, txt: txt, col: col, size: size || 15,
                t: 0, life: 0.95 });
    if (pops.length > 24) pops.shift();
  }

  function comboWindow() {
    return COMBO_BASE + upCombo * 0.5 + comboBonus;
  }

  function isBossWave(n) {
    return n % BOSS_EVERY === 0;
  }

  /* one place to read every progressive-difficulty dial for a wave */
  function waveDifficulty(n) {
    var t = Math.max(0, n - 1);
    return {
      wave: n,
      hpMul: 1 + t * 0.16,
      dmgMul: 1 + t * 0.10,
      speedMul: Math.min(1.8, 1 + t * 0.045),
      cooldownMul: Math.max(0.5, 1 - t * 0.04),
      spawnCount: Math.min(2 + Math.ceil(n * 1.1), 12),
      eliteChance: Math.min(0.7, Math.max(0, (n - 2) * 0.11))
    };
  }

  function eliteTypeForWave(n) {
    var d = waveDifficulty(n);
    if (n < 2) return 'grunt';
    var r = Math.random();
    if (n >= 3 && r < d.eliteChance * 0.45) return 'brute';
    if (r < d.eliteChance) return 'striker';
    return 'grunt';
  }

  function bossStats(n) {
    var num = Math.max(1, Math.round(n / BOSS_EVERY));
    return {
      num: num,
      index: (num - 1) % BOSS_NAMES.length,
      name: BOSS_NAMES[(num - 1) % BOSS_NAMES.length],
      maxHp: Math.round(170 + (num - 1) * 120 + n * 4),
      dmg: Math.round(11 + (num - 1) * 5 + n * 0.25),
      speed: 80 + (num - 1) * 14,
      chargeSpeed: 500 + (num - 1) * 55,
      slamRadius: 150 + Math.min(50, (num - 1) * 14)
    };
  }

  /* a cone of sparks hurled in the strike direction */
  function burstCone(x, y, dir, col, speed, n, arc) {
    arc = arc || 0.52;
    for (var i = 0; i < n; i++) {
      var a = (Math.random() - 0.5) * arc;
      var s = speed * (0.45 + Math.random() * 0.75);
      var life = 0.22 + Math.random() * 0.34;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * s * dir,
        vy: Math.sin(a) * s - 30,
        life: life, life0: life,
        size: 2 + Math.random() * 3.5,
        col: col, star: i % 4 === 0
      });
    }
    if (particles.length > 360) particles.splice(0, particles.length - 360);
  }

  function addShockwave(x, y, maxR, life, col, width, dbl) {
    shockwaves.push({ x: x, y: y, maxR: maxR, t: 0, life: life,
                      col: col, width: width || 3, dbl: !!dbl });
    shockSpawned++;
    if (shockwaves.length > 20) shockwaves.shift();
  }

  function addHitFlash(x, y, dir, col) {
    hitFlashes.push({ x: x, y: y, dir: dir, t: 0, life: 0.2, col: col });
    if (hitFlashes.length > 16) hitFlashes.shift();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function addScore(n) {
    score += n;
    updateHud();
  }

  function updateHud() {
    var map = {
      Score: score,
      Best: Math.max(best, score),
      Wave: wave,
      HP: (player ? Math.max(0, Math.round(player.hp)) : 0) + '/100'
    };
    if (boss && boss.hp > 0) {
      map.Boss = Math.max(0, Math.ceil(boss.hp)) + '/' + boss.maxHp;
    }
    GameShell.hud(
      map,
      state === 'paused' ? '⏸ Paused · Wave ' + wave
        : (state === 'upgrade' ? 'Choose an upgrade: 1 / 2 / 3'
          : (boss ? 'BOSS · phase ' + boss.phase + ' · Z punch · X kick · ↓ block'
                  : 'Z punch · X kick · ↓ block'))
    );
  }

  function drawStar(x, y, r, rot) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var rad = i % 2 === 0 ? r : r * 0.45;
      var a = rot + (i * Math.PI) / 5 - Math.PI / 2;
      var px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  /* ---------------- setup ---------------- */

  function makePlayer() {
    return {
      x: W / 2, hp: 100, maxHp: 100, face: 1, speed: 250,
      atk: null, atkT: 0, atkHit: false, atkId: 0, cool: 0,
      hurtT: 0, invuln: 0, walkP: 0,
      pose: newPose()
    };
  }

  function isBlocking() {
    return !!player && keys.block && !player.atk && player.hurtT <= 0;
  }

  function spawnEnemy(forceType) {
    var type = forceType || eliteTypeForWave(wave);
    var def = ENEMY_TYPES[type] || ENEMY_TYPES.grunt;
    var diff = waveDifficulty(wave);
    var side = spawnSide;
    spawnSide ^= 1;
    var hp = Math.max(6, Math.round((12 + wave * 4 + rand(5)) * def.hp));
    var dmg = Math.min(34, Math.max(3, Math.round((6 + wave * 1.5) * def.dmg)));
    enemies.push({
      x: side === 0 ? -26 : W + 26,
      face: side === 0 ? 1 : -1,
      type: type,
      elite: type !== 'grunt',
      isBoss: false,
      hp: hp,
      maxHp: hp,
      speed: Math.min(62 + wave * 8, 170) * def.speed * diff.speedMul *
             (0.9 + Math.random() * 0.2),
      prefer: 50 + rand(20),
      dmg: dmg,
      reach: def.reach,
      scale: def.scale,
      telegraph: def.telegraph,
      state: 'enter', t: 0, atkCd: (0.5 + Math.random() * 0.8) * diff.cooldownMul,
      strikeDone: false, dodgeX: 0, flashT: 0, hurtT: 0, kbV: 0,
      walkP: Math.random() * TAU, lastHitId: -1,
      col: def.col,
      pose: newPose(), knock: null
    });
  }

  function spawnBoss(n) {
    var st = bossStats(n);
    var b = {
      x: W + 78, face: -1, type: 'boss', elite: true, isBoss: true,
      bossNum: st.num, name: st.name,
      hp: st.maxHp, maxHp: st.maxHp, phase: 1,
      speed: st.speed, baseSpeed: st.speed, prefer: 110,
      dmg: st.dmg, baseDmg: st.dmg, reach: 96, scale: 1.55,
      telegraph: 0.7, chargeSpeed: st.chargeSpeed, slamRadius: st.slamRadius,
      state: 'enter', t: 0, atkCd: 1.1, think: 1.2, action: null, actionT: 0, chargeDir: -1,
      strikeDone: false, dodgeX: 0, flashT: 0, hurtT: 0, kbV: 0,
      walkP: 0, lastHitId: -1, col: BOSS_COL,
      pose: newPose(), knock: null, summons: 0
    };
    boss = b;
    bossNumber = st.num;
    bossDefeated = false;
    enemies.push(b);
    addShockwave(b.x, GROUND - 40, 90, 0.5, BOSS_COL, 4, true);
  }

  function beginWave(n) {
    wave = n;
    spawnSide = rand(2);
    phase = 'fight';
    boss = null;
    bossDefeated = false;
    if (isBossWave(n)) {
      spawnLeft = 0;
      spawnT = 1e9;
      spawnBoss(n);
      banner = {
        title: 'WARNING',
        sub: 'BOSS INCOMING · ' + boss.name,
        t: 2.2, t0: 2.2
      };
    } else {
      spawnLeft = waveDifficulty(n).spawnCount;
      spawnT = 0.8;
      bossNumber = Math.floor(n / BOSS_EVERY);
      banner = {
        title: 'WAVE ' + n,
        sub: wave >= 3 ? 'Elites detected · fighters incoming!' : 'Fighters incoming!',
        t: 1.7, t0: 1.7
      };
    }
    updateHud();
  }

  /* ---------------- every-third-wave upgrades ---------------- */

  function openUpgrade() {
    var pool = ['damage', 'speed', 'heal', 'guard', 'combo'];
    var picks = [], i, j, tmp;
    for (i = 0; i < pool.length; i++) picks.push(pool[i]);
    for (i = picks.length - 1; i > 0; i--) {
      j = rand(i + 1);
      tmp = picks[i]; picks[i] = picks[j]; picks[j] = tmp;
    }
    upgradeChoices = picks.slice(0, 3);
    upgradeRects = [];
    upgradeSel = 0;
    state = 'upgrade';
    releaseKeys();
    updateHud();
  }

  function applyUpgrade(id) {
    if (state !== 'upgrade' || !UPGRADE_DEFS[id]) return;
    var p = player;
    if (id === 'damage') upDamage++;
    else if (id === 'speed') upSpeed++;
    else if (id === 'heal') p.hp = Math.min(p.maxHp, p.hp + 45);
    else if (id === 'guard') upGuard++;
    else if (id === 'combo') upCombo++;

    upgradesTaken++;
    addScore(25);
    state = 'running';
    last = now();
    phase = 'breather';
    breatherT = 2;
    banner = { title: UPGRADE_DEFS[id].title.toUpperCase() + '!',
               sub: 'Next wave in 2s', t: 2, t0: 2 };
    upgradeChoices = [];
    upgradeRects = [];
    updateHud();
  }

  function upgradeAt(x, y) {
    for (var i = 0; i < upgradeRects.length; i++) {
      var r = upgradeRects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        applyUpgrade(upgradeChoices[i]);
        return true;
      }
    }
    return false;
  }

  function reset() {
    score = 0; wave = 1; knockouts = 0;
    combo = 0; comboT = 0;
    enemies = []; particles = []; pops = [];
    pickups = []; shockwaves = []; hitFlashes = [];
    boss = null; bossDefeated = false; bossNumber = 0;
    flashT = 0; shake = 0; hitStop = 0;
    upDamage = 0; upSpeed = 0; upGuard = 0; upCombo = 0; comboBonus = 0;
    dmgBoostT = 0; speedT = 0; shieldCharges = 0;
    leftSideHits = 0; rightSideHits = 0; effectsSpawned = 0; shockSpawned = 0;
    pickupsDropped = 0; pickupsTaken = 0;
    upgradesTaken = 0; upgradeChoices = []; upgradeRects = []; upgradeSel = 0;
    keys.left = keys.right = keys.block = false;
    player = makePlayer();
    beginWave(1);
  }

  /* ---------------- combat ---------------- */

  function tryAttack(type) {
    if (state !== 'running' || !player) return false;
    if (player.atk || player.hurtT > 0 || player.cool > 0) return false;
    player.atk = type;
    player.atkT = 0;
    player.atkHit = false;
    player.atkId++;
    return true;
  }

  function nearestEnemy() {
    var bestE = null, bestD = 1e9;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.state === 'knocked') continue;
      var d = Math.abs(e.x - player.x);
      if (d < bestD) { bestD = d; bestE = e; }
    }
    return bestE;
  }

  function pickPickupType() {
    var table = [['heal', 30], ['damage', 22], ['speed', 20], ['shield', 16], ['combo', 12]];
    var total = 0, i, r;
    for (i = 0; i < table.length; i++) total += table[i][1];
    r = Math.random() * total;
    for (i = 0; i < table.length; i++) {
      r -= table[i][1];
      if (r <= 0) return table[i][0];
    }
    return 'heal';
  }

  function spawnPickup(x, type) {
    pickups.push({
      x: clamp(x, 34, W - 34),
      y: GROUND - 46,
      type: type || pickPickupType(),
      t: Math.random() * TAU,
      life: 15
    });
    pickupsDropped++;
    if (pickups.length > 8) pickups.shift();
  }

  function collectPickup(pk) {
    var col = PICKUP_DEFS[pk.type].col;
    burst(pk.x, pk.y, col, 12);
    addShockwave(pk.x, pk.y, 34, 0.26, col, 2.5, false);
    if (pk.type === 'heal') {
      var before = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + 24);
      pop(pk.x, pk.y - 18, '+' + Math.round(player.hp - before) + ' HP', '#2ee6a6', 15);
    } else if (pk.type === 'damage') {
      dmgBoostT = 12;
      pop(pk.x, pk.y - 18, 'DAMAGE UP', '#fb7185', 14);
    } else if (pk.type === 'speed') {
      speedT = 12;
      pop(pk.x, pk.y - 18, 'SPEED UP', '#22d3ee', 14);
    } else if (pk.type === 'shield') {
      shieldCharges = Math.min(3, shieldCharges + 1);
      pop(pk.x, pk.y - 18, 'SHIELD +1', '#a78bfa', 14);
    } else {
      comboBonus = Math.min(3, comboBonus + 0.5);
      comboT = comboWindow();
      pop(pk.x, pk.y - 18, 'COMBO +', '#facc15', 14);
    }
    addScore(20);
    updateHud();
  }

  function knockout(e, dir) {
    e.state = 'knocked';
    e.knock = {
      x: e.x, y: GROUND,
      vx: dir * (300 + Math.random() * 90) * (e.isBoss ? 1.35 : 1),
      vy: -(240 + Math.random() * 110) * (e.isBoss ? 1.2 : 1),
      rot: 0, spin: dir * (5 + Math.random() * 3),
      life: e.isBoss ? 3 : 2.6, bounces: 0
    };
    knockouts++;
    var gain = e.isBoss ? 500 + e.bossNum * 250 : 50 + wave * 10;
    addScore(gain);
    pop(e.x, GROUND - (e.isBoss ? 104 : 74),
        (e.isBoss ? 'BOSS DOWN +' : 'KNOCKOUT +') + gain,
        e.isBoss ? '#f43f5e' : '#facc15', e.isBoss ? 22 : 17);
    burst(e.x, GROUND - 50, e.col, e.isBoss ? 34 : 16, true);
    addShockwave(e.x, GROUND - 50, e.isBoss ? 150 : 60, e.isBoss ? 0.7 : 0.36, e.col, e.isBoss ? 6 : 3, true);
    shake = Math.max(shake, e.isBoss ? 16 : 7);
    if (e.isBoss) {
      bossDefeated = true;
      boss = null;
      spawnPickup(e.x - 24);
      spawnPickup(e.x + 24);
    } else if (Math.random() < 0.55) {
      spawnPickup(e.x);
    }
  }

  /* resolve every connecting strike and its feedback */
  function hitFeedback(x, y, facing, type, dmg, leftSide) {
    effectsSpawned++;
    if (leftSide) {
      /* player is to the LEFT of the target and swinging rightwards:
         a big orange/white directional cone plus a double shockwave */
      leftSideHits++;
      burstCone(x, y, 1, '#fb923c', 300, 16, 0.62);
      burstCone(x, y, 1, '#ffffff', 220, 9, 0.42);
      addShockwave(x, y, type === 'kick' ? 64 : 54, 0.36, '#fb923c', 5, true);
      addShockwave(x, y, type === 'kick' ? 36 : 30, 0.24, '#ffffff', 2.5, false);
      addHitFlash(x, y, 1, '#fdba74');
      hitStop = Math.max(hitStop, type === 'kick' ? 0.085 : 0.065);
      shake = Math.max(shake, type === 'kick' ? 11 : 8);
      pop(x + 22, y - 30, 'LEFT ' + (type === 'kick' ? 'KICK' : 'HIT'), '#fdba74', 12);
    } else {
      /* strikes coming back the other way stay readable with a cyan/amber ring */
      rightSideHits++;
      var col = type === 'kick' ? '#f59e0b' : '#22d3ee';
      burstCone(x, y, -1, col, 210, 9, 0.8);
      burstCone(x, y, -1, '#e8eefc', 150, 4, 0.55);
      addShockwave(x, y, type === 'kick' ? 42 : 34, 0.28, col, 3.5, false);
      addHitFlash(x, y, -1, col);
      hitStop = Math.max(hitStop, type === 'kick' ? 0.05 : 0.035);
      shake = Math.max(shake, type === 'kick' ? 7 : 4);
    }
    pop(x, y - 4, '−' + dmg, '#ffffff', 17);
  }

  function playerStrike() {
    var atk = ATK[player.atk];
    var mult = 1 + upDamage * 0.18 + (dmgBoostT > 0 ? 0.45 : 0);
    var dmg = Math.max(1, Math.round(atk.dmg * mult));
    var hitAny = false;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.state === 'knocked' || e.lastHitId === player.atkId) continue;
      var dx = (e.x - player.x) * player.face;
      if (dx < -14 || dx > atk.reach) continue;
      e.lastHitId = player.atkId;
      hitAny = true;
      e.hp -= dmg;
      e.flashT = 0.14;
      if (e.isBoss) {
        /* bosses have poise: chip them without cancelling an active attack */
        e.hurtT = Math.min(0.14, atk.stun);
        e.kbV = player.face * atk.kb * 0.12;
        if (e.state === 'walk' || e.state === 'enter' || e.state === 'recover') {
          e.state = 'hurt';
          e.t = 0.12;
        }
      } else {
        e.hurtT = atk.stun;
        e.kbV = player.face * atk.kb;
        e.state = 'hurt';
        e.t = atk.stun;
      }
      combo++;
      comboT = comboWindow();
      var gain = atk.pts + Math.min(combo, 20) * 2;
      addScore(gain);
      var cx = e.x - player.face * 12;
      var cy = GROUND - 52;
      var fromLeft = player.face > 0 && e.x > player.x;
      hitFeedback(cx, cy, player.face, player.atk, dmg, fromLeft);
      pop(cx, GROUND - 86, '+' + gain, '#e8eefc', 14);
      if (e.hp <= 0) knockout(e, player.face);
    }
    if (hitAny) shake = Math.max(shake, player.atk === 'kick' ? 6 : 3);
  }

  function hurtPlayer(dmg, fromX) {
    if (state !== 'running' || player.invuln > 0) return;
    var blocked = isBlocking();

    if (!blocked && shieldCharges > 0) {
      shieldCharges--;
      player.invuln = 0.5;
      player.hurtT = 0.12;
      pop(player.x, GROUND - 80, 'SHIELD ABSORB', '#c4b5fd', 13);
      burst(player.x, GROUND - 50, '#a78bfa', 12);
      addShockwave(player.x, GROUND - 50, 44, 0.3, '#a78bfa', 3, true);
      shake = Math.max(shake, 5);
      updateHud();
      return;
    }

    var guardFactor = Math.max(0.12, GUARD_BASE - upGuard * 0.05);
    var d = blocked ? Math.max(1, Math.round(dmg * guardFactor)) : dmg;
    player.hp -= d;
    player.hurtT = blocked ? 0.18 : 0.34;
    player.invuln = blocked ? 0.3 : 0.55;
    combo = 0;
    comboT = 0;
    if (!blocked) {
      flashT = 0.32;
      shake = Math.max(shake, 10);
      var push = player.x >= fromX ? 1 : -1;
      player.x = clamp(player.x + push * 30, 24, W - 24);
      pop(player.x, GROUND - 76, '−' + d, '#ff5c7a', 16);
      burst(player.x, GROUND - 52, '#ff5c7a', 10);
    } else {
      pop(player.x, GROUND - 76, 'GUARD −' + d, '#2ee6a6', 13);
      burst(player.x, GROUND - 46, '#2ee6a6', 5);
      addShockwave(player.x, GROUND - 48, 30, 0.22, '#2ee6a6', 2.5, false);
    }
    updateHud();
    if (player.hp <= 0) {
      player.hp = 0;
      updateHud();
      gameOver();
    }
  }

  /* enemy strike resolution: returns nothing */
  function enemyStrike(e) {
    var dx = Math.abs(player.x - e.x);
    if (dx <= (e.reach || ENEMY_REACH)) {
      hurtPlayer(e.dmg, e.x);
    } else if (Math.abs(player.x - e.dodgeX) >= 22) {
      addScore(15);
      pop(player.x, GROUND - 76, 'DODGE +15', '#22d3ee', 15);
    }
  }

  /* ---------------- enemy AI ---------------- */

  function updateEnemy(e, dt) {
    var i;

    if (e.flashT > 0) e.flashT -= dt;
    if (e.kbV) {
      e.x += e.kbV * dt;
      e.kbV *= Math.max(0, 1 - dt * 7);
      if (Math.abs(e.kbV) < 4) e.kbV = 0;
    }

    if (e.state === 'knocked') {
      var k = e.knock;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      k.vy += 780 * dt;
      k.rot += k.spin * dt;
      k.life -= dt;
      if (k.y >= GROUND && k.bounces < 2 && k.vy > 0) {
        k.y = GROUND;
        k.vy = -k.vy * 0.42;
        k.vx *= 0.7;
        k.bounces++;
        burst(k.x, GROUND - 6, e.col, 5);
      }
      e.x = k.x;
      if (k.life <= 0 || k.x < -90 || k.x > W + 90 || k.y > H + 90) {
        e.remove = true;
      }
      return;
    }

    if (e.isBoss) {
      updateBoss(e, dt);
      return;
    }

    var target = player;
    var dxT = target.x - e.x;
    var ad = Math.abs(dxT);

    if (e.state === 'hurt') {
      e.t -= dt;
      if (e.t <= 0) { e.state = 'walk'; e.atkCd = Math.max(0.3, e.atkCd - 0.2); }
      poseEnemy(e, dt);
      return;
    }

    e.atkCd -= dt;
    e.face = dxT >= 0 ? 1 : -1;

    if (e.state === 'enter') {
      e.x += (e.face > 0 ? 1 : -1) * e.speed * dt;
      if (e.x > 16 && e.x < W - 16) e.state = 'walk';
      e.walkP += dt * e.speed * 0.045;
      poseEnemy(e, dt);
      return;
    }

    if (e.state === 'telegraph') {
      e.t -= dt;
      if (e.t <= 0) {
        e.state = 'attack';
        e.t = 0.26;
        e.strikeDone = false;
      }
      poseEnemy(e, dt);
      return;
    }

    if (e.state === 'attack') {
      e.t -= dt;
      if (!e.strikeDone && e.t <= 0.2) {
        e.strikeDone = true;
        enemyStrike(e);
      }
      if (e.t <= 0) {
        e.state = 'recover';
        e.t = Math.max(0.28, 0.5 - wave * 0.02);
        e.atkCd = Math.max(0.18,
          (0.45 + Math.random() * 0.6 - wave * 0.03) * waveDifficulty(wave).cooldownMul);
      }
      poseEnemy(e, dt);
      return;
    }

    if (e.state === 'recover') {
      e.t -= dt;
      if (e.t <= 0) e.state = 'walk';
      poseEnemy(e, dt);
      return;
    }

    /* walk / approach: close to strike range, then commit */
    var CLOSE = (e.reach || ENEMY_REACH) - 4;
    var moving = 0;
    if (ad > CLOSE) {
      e.x += (dxT > 0 ? 1 : -1) * e.speed * dt;
      moving = 1;
      e.walkP += dt * e.speed * 0.045;
    } else if (ad < e.prefer * 0.45) {
      e.x -= (dxT > 0 ? 1 : -1) * e.speed * 0.35 * dt;
      moving = 1;
      e.walkP += dt * e.speed * 0.03;
    }
    e.x = clamp(e.x, 14, W - 14);
    e.moving = moving;

    if (e.atkCd <= 0 && ad <= CLOSE) {
      e.state = 'telegraph';
      e.t = e.telegraph || 0.44;
      e.dodgeX = player.x;
      e.atkCd = 1e9; /* restored when the sequence finishes */
    }
    poseEnemy(e, dt);
  }

  function bossPhaseCheck(e) {
    if (e.phase !== 1 || e.hp > e.maxHp * 0.5) return;
    e.phase = 2;
    e.dmg = Math.round(e.baseDmg * 1.3);
    e.speed = e.baseSpeed * 1.3;
    e.telegraph = Math.max(0.44, e.telegraph * 0.82);
    e.chargeSpeed *= 1.15;
    shake = Math.max(shake, 14);
    addShockwave(e.x, GROUND - 40, 190, 0.8, '#f43f5e', 7, true);
    banner = { title: 'PHASE 2', sub: e.name + ' is enraged · reinforcements!', t: 1.8, t0: 1.8 };
    var count = e.bossNum > 1 ? 2 : 1;
    for (var i = 0; i < count; i++) spawnEnemy(i === 0 ? 'striker' : 'grunt');
    e.summons += count;
    e.state = 'recover';
    e.t = 0.75;
    e.action = null;
    sfx('explode');
    updateHud();
  }

  function updateBoss(e, dt) {
    bossPhaseCheck(e);

    var dxT = player.x - e.x;
    var ad = Math.abs(dxT);
    e.face = dxT >= 0 ? 1 : -1;

    if (e.state === 'hurt') {
      e.t -= dt;
      if (e.t <= 0) { e.state = 'walk'; e.think = Math.min(e.think, 0.35); }
      poseEnemy(e, dt);
      return;
    }

    if (e.state === 'enter') {
      e.x += (e.face > 0 ? 1 : -1) * e.speed * 1.3 * dt;
      if (e.x > 58 && e.x < W - 58) { e.state = 'walk'; e.think = 0.9; }
      e.walkP += dt * e.speed * 0.045;
      poseEnemy(e, dt);
      return;
    }

    if (e.state === 'telegraph') {
      e.actionT -= dt;
      if (e.actionT <= 0) {
        if (e.action === 'charge') {
          e.state = 'charge';
          e.actionT = 0.46;
          e.chargeDir = e.face;
          e.strikeDone = false;
          pop(e.x, GROUND - 118, 'CHARGE!', '#f43f5e', 16);
          sfx('dash');
        } else if (e.action === 'slam') {
          e.state = 'slam';
          e.actionT = 0.2;
          e.strikeDone = false;
          sfx('thud');
        } else {
          e.state = 'flurry';
          e.actionT = 1.15;
          e.flurryLeft = 3;
          e.nextStrike = 0.14;
          e.strikeDone = false;
          pop(e.x, GROUND - 118, 'FLURRY!', '#f43f5e', 16);
          sfx('hit');
        }
      }
      poseEnemy(e, dt);
      return;
    }

    if (e.state === 'charge') {
      e.actionT -= dt;
      e.face = e.chargeDir || e.face;
      e.x = clamp(e.x + e.face * e.chargeSpeed * dt, 20, W - 20);
      if (!e.strikeDone && ad <= e.reach * 0.8) {
        e.strikeDone = true;
        hurtPlayer(Math.round(e.dmg * 1.15), e.x);
        addHitFlash(player.x, GROUND - 52, e.face, '#f43f5e');
      }
      if (player && Math.abs(player.x - e.x) < 30) {
        player.x = clamp(player.x + (player.x >= e.x ? 1 : -1) * 16, 24, W - 24);
      }
      if (e.actionT <= 0 || e.x <= 20 || e.x >= W - 20) {
        e.state = 'recover';
        e.t = 0.55;
        shake = Math.max(shake, 8);
      }
      e.walkP += dt * 12;
      poseEnemy(e, dt);
      return;
    }

    if (e.state === 'slam') {
      e.actionT -= dt;
      if (!e.strikeDone && e.actionT <= 0) {
        e.strikeDone = true;
        if (Math.abs(player.x - e.x) <= e.slamRadius) {
          hurtPlayer(Math.round(e.dmg * 0.95), e.x);
        }
        addShockwave(e.x, GROUND - 4, e.slamRadius, 0.5, '#f43f5e', 6, true);
        addShockwave(e.x, GROUND - 4, e.slamRadius * 0.62, 0.36, '#fbbf24', 3, false);
        burst(e.x, GROUND - 8, '#f43f5e', 18);
        shake = Math.max(shake, 13);
        sfx('thud');
      }
      if (e.actionT <= 0) {
        e.state = 'recover';
        e.t = 0.62;
      }
      poseEnemy(e, dt);
      return;
    }

    if (e.state === 'flurry') {
      e.actionT -= dt;
      e.nextStrike -= dt;
      if (e.nextStrike <= 0 && e.flurryLeft > 0) {
        e.flurryLeft--;
        e.nextStrike = 0.23;
        if (Math.abs(player.x - e.x) <= e.reach) {
          hurtPlayer(Math.max(1, Math.round(e.dmg * 0.55)), e.x);
          addHitFlash(player.x, GROUND - 52, e.face, '#fb7185');
        } else {
          addScore(8);
          pop(player.x, GROUND - 76, 'DODGE +8', '#22d3ee', 13);
        }
        burstCone(e.x + e.face * 26, GROUND - 48, e.face, '#f43f5e', 220, 6, 0.7);
      }
      if (e.actionT <= 0) {
        e.state = 'recover';
        e.t = 0.7;
      }
      poseEnemy(e, dt);
      return;
    }

    if (e.state === 'recover') {
      e.t -= dt;
      if (e.t <= 0) {
        e.state = 'walk';
        e.think = Math.max(0.42, 1.0 - (e.bossNum - 1) * 0.08) * (e.phase === 2 ? 0.72 : 1);
      }
      poseEnemy(e, dt);
      return;
    }

    /* walk: keep pressure, then commit to a boss action */
    var CLOSE = 118;
    e.moving = 0;
    if (ad > CLOSE + 28) {
      e.x += e.face * e.speed * dt;
      e.walkP += dt * e.speed * 0.045;
      e.moving = 1;
    } else if (ad < CLOSE - 34) {
      e.x -= e.face * e.speed * 0.35 * dt;
      e.walkP += dt * e.speed * 0.03;
      e.moving = 1;
    }
    e.x = clamp(e.x, 26, W - 26);

    e.think -= dt;
    if (e.think <= 0) {
      var action;
      if (ad > 190) action = 'charge';
      else if (Math.random() < 0.48) action = 'slam';
      else action = 'flurry';
      e.action = action;
      e.state = 'telegraph';
      e.actionT = e.telegraph * (action === 'charge' ? 1.15 : 1);
      e.dodgeX = player.x;
      if (action === 'slam') {
        /* a red floor ring telegraphs exactly where the slam will land */
        addShockwave(e.x, GROUND - 4, e.slamRadius, e.actionT, 'rgba(244,63,94,.55)', 3, false);
        pop(e.x, GROUND - 118, 'SLAM!', '#fb7185', 15);
      } else if (action === 'charge') {
        pop(e.x, GROUND - 118, 'CHARGE!', '#f43f5e', 15);
      }
      sfx('select');
    }
    poseEnemy(e, dt);
  }

  function poseEnemy(e, dt) {
    var t = { crouch: 0, armF: 0.18, armB: -0.14, legF: 0.1, legB: -0.1, lean: 0.05, tilt: 0 };
    if (e.state === 'walk' || e.state === 'enter') {
      if (e.moving || e.state === 'enter') {
        var s = Math.sin(e.walkP);
        t.legF = s * 0.6; t.legB = -s * 0.6;
        t.armF = -s * 0.5 + 0.12; t.armB = s * 0.5;
        t.lean = 0.16;
      }
    } else if (e.state === 'telegraph') {
      t.armF = -1.05; t.armB = 0.55; t.lean = -0.14; t.crouch = 0.15;
      t.legF = 0.3; t.legB = -0.3; t.tilt = -0.08;
    } else if (e.state === 'attack') {
      t.armF = 1.5; t.armB = -0.55; t.lean = 0.2; t.crouch = 0.1;
      t.legF = 0.35; t.legB = -0.35;
    } else if (e.state === 'charge') {
      t.armF = 1.7; t.armB = -0.9; t.lean = 0.48; t.crouch = 0.18;
      t.legF = 0.8; t.legB = -0.75; t.tilt = 0.12;
    } else if (e.state === 'slam') {
      t.armF = 2.3; t.armB = 2.15; t.lean = -0.2; t.crouch = 0.35;
      t.legF = 0.5; t.legB = -0.55; t.tilt = -0.1;
    } else if (e.state === 'flurry') {
      t.armF = 1.55; t.armB = 1.1; t.lean = 0.25; t.crouch = 0.08;
      t.legF = 0.42; t.legB = -0.4;
    } else if (e.state === 'recover') {
      t.armF = 0.95; t.armB = -0.2; t.lean = 0.12; t.crouch = 0.08;
      t.legF = 0.28; t.legB = -0.3;
    } else if (e.state === 'hurt') {
      t.armF = -0.95; t.armB = -0.7; t.lean = -0.3; t.tilt = -0.25;
      t.legF = 0.4; t.legB = -0.5; t.crouch = 0.2;
    }
    lerpPose(e.pose, t, dt);
  }

  function updatePlayer(dt) {
    var p = player;
    if (p.cool > 0) p.cool -= dt;
    if (p.hurtT > 0) p.hurtT -= dt;
    if (p.invuln > 0) p.invuln -= dt;

    var canMove = !p.atk && p.hurtT <= 0;
    var vx = 0;
    if (canMove) {
      if (keys.left) vx -= 1;
      if (keys.right) vx += 1;
    }
    var sp = p.speed * (1 + upSpeed * 0.12) * (speedT > 0 ? 1.35 : 1) *
             (isBlocking() ? 0.4 : 1);
    if (vx !== 0) {
      p.x = clamp(p.x + vx * sp * dt, 24, W - 24);
      p.walkP += dt * sp * 0.05;
    }

    /* face the nearest rival so swings always connect toward the fight */
    var near = nearestEnemy();
    if (near) p.face = near.x >= p.x ? 1 : -1;
    else if (vx !== 0) p.face = vx > 0 ? 1 : -1;

    if (p.atk) {
      p.atkT += dt;
      var a = ATK[p.atk];
      if (!p.atkHit && p.atkT >= a.w0) {
        p.atkHit = true;
        playerStrike();
      }
      if (p.atkT >= a.dur) {
        p.atk = null;
        p.atkT = 0;
        p.cool = a.cool;
      }
    }

    /* pose targets */
    var t = { crouch: 0, armF: 0.18, armB: -0.14, legF: 0.1, legB: -0.1, lean: 0.05, tilt: 0 };
    if (p.hurtT > 0) {
      t.armF = -1.0; t.armB = -0.75; t.lean = -0.3; t.tilt = -0.28; t.crouch = 0.15;
      t.legF = 0.4; t.legB = -0.5;
    } else if (p.atk === 'punch') {
      if (p.atkT < a.w0) { t.armF = -0.75; t.lean = -0.06; }
      else { t.armF = 1.55; t.lean = 0.2; t.armB = -0.5; }
      t.legF = 0.3; t.legB = -0.35;
    } else if (p.atk === 'kick') {
      if (p.atkT < ATK.kick.w0) { t.legF = -0.45; t.lean = -0.05; t.armF = -0.3; t.armB = 0.5; }
      else { t.legF = 1.35; t.lean = -0.14; t.armF = -0.75; t.armB = 0.95; }
      t.legB = -0.4;
    } else if (isBlocking()) {
      t.crouch = 1; t.armF = 1.15; t.armB = 1.3; t.legF = 0.5; t.legB = -0.5; t.lean = 0.1;
    } else if (vx !== 0) {
      var s = Math.sin(p.walkP);
      t.legF = s * 0.65; t.legB = -s * 0.65;
      t.armF = -s * 0.5 + 0.15; t.armB = s * 0.5 - 0.05;
      t.lean = 0.16;
    } else {
      t.armF = 0.18 + Math.sin(tGlobal * 2.4) * 0.04;
      t.armB = -0.14 - Math.sin(tGlobal * 2.4) * 0.03;
    }
    lerpPose(p.pose, t, dt);
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    var i, j;
    tGlobal += dt;
    if (flashT > 0) flashT -= dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 55);
    if (dmgBoostT > 0) dmgBoostT = Math.max(0, dmgBoostT - dt);
    if (speedT > 0) speedT = Math.max(0, speedT - dt);

    if (comboT > 0) {
      comboT -= dt;
      if (comboT <= 0) combo = 0;
    }

    updatePlayer(dt);

    for (i = enemies.length - 1; i >= 0; i--) {
      updateEnemy(enemies[i], dt);
      if (enemies[i].remove) enemies.splice(i, 1);
    }

    /* keep rivals from stacking on one another */
    for (i = 0; i < enemies.length; i++) {
      for (j = i + 1; j < enemies.length; j++) {
        var a = enemies[i], b = enemies[j];
        if (a.state === 'knocked' || b.state === 'knocked') continue;
        var d = b.x - a.x;
        var minD = (a.isBoss || b.isBoss) ? 54 : 28;
        if (Math.abs(d) < minD) {
          var push = (minD - Math.abs(d)) / 2 * (d >= 0 ? 1 : -1);
          if (a.isBoss) push *= 0.35;
          a.x = clamp(a.x - push, 14, W - 14);
          b.x = clamp(b.x + push, 14, W - 14);
        }
      }
    }

    /* pickups dropped by defeated rivals */
    for (i = pickups.length - 1; i >= 0; i--) {
      var pk = pickups[i];
      pk.t += dt;
      pk.life -= dt;
      if (pk.life <= 0) { pickups.splice(i, 1); continue; }
      if (state === 'running' && player &&
          Math.abs(pk.x - player.x) < 30 && player.hp > 0) {
        pickups.splice(i, 1);
        pickupsTaken++;
        collectPickup(pk);
      }
    }

    /* impact rings and directional flashes age out */
    for (i = shockwaves.length - 1; i >= 0; i--) {
      shockwaves[i].t += dt;
      if (shockwaves[i].t >= shockwaves[i].life) shockwaves.splice(i, 1);
    }
    for (i = hitFlashes.length - 1; i >= 0; i--) {
      hitFlashes[i].t += dt;
      if (hitFlashes[i].t >= hitFlashes[i].life) hitFlashes.splice(i, 1);
    }

    /* spawning */
    if (phase === 'fight' && spawnLeft > 0) {
      spawnT -= dt;
      if (spawnT <= 0) {
        spawnEnemy();
        spawnLeft--;
        spawnT = Math.max(0.7, 1.5 - wave * 0.06);
      }
    }

    /* wave clear → two-second breather (or an upgrade every third wave) */
    if (state === 'running' && phase === 'fight' && spawnLeft === 0) {
      var alive = 0;
      for (i = 0; i < enemies.length; i++) {
        if (enemies[i].state !== 'knocked') alive++;
      }
      if (alive === 0 && (!isBossWave(wave) || bossDefeated)) {
        var bonus = 30 * wave;
        addScore(bonus);
        player.hp = Math.min(player.maxHp, player.hp + 12);
        banner = {
          title: isBossWave(wave) ? 'BOSS WAVE CLEAR' : 'WAVE ' + wave + ' CLEAR',
          sub: '+' + bonus, t: 2, t0: 2
        };
        if (wave % 3 === 0) {
          /* every third wave: freeze the arena and offer three upgrades */
          openUpgrade();
          banner.sub = 'Choose an upgrade';
        } else {
          phase = 'breather';
          breatherT = 2;
          banner.sub = '+' + bonus + ' · next wave in 2s';
        }
        updateHud();
      }
    } else if (state === 'running' && phase === 'breather') {
      breatherT -= dt;
      if (breatherT <= 0) beginWave(wave + 1);
    }

    /* particles + pops */
    for (i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 340 * dt;
      p.vx *= 0.98;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (i = pops.length - 1; i >= 0; i--) {
      var q = pops[i];
      q.t += dt;
      q.y -= 34 * dt;
      if (q.t >= q.life) pops.splice(i, 1);
    }

    if (banner) {
      banner.t -= dt;
      if (banner.t <= 0) banner = null;
    }
  }

  /* ---------------- drawing ---------------- */

  function drawStickman(x, y, facing, col, pose, opts) {
    opts = opts || {};
    var s = opts.scale || 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var hipY = y - 30 * s + pose.crouch * 14 * s;
    var shX = x + pose.lean * 12 * facing * s;
    var shY = hipY - 24 * s + pose.crouch * 6 * s;
    var headX = shX + pose.lean * 5 * facing * s + pose.tilt * 5 * s;
    var headY = shY - 13 * s;
    var lw = 3.4 * s;

    function foot(a) {
      return [x + Math.sin(a) * 30 * facing * s, hipY + Math.cos(a) * 30 * s];
    }
    function hand(a) {
      return [shX + Math.sin(a) * 24 * facing * s, shY + Math.cos(a) * 24 * s];
    }

    var col2 = opts.flash ? '#ffffff' : (opts.dim ? '#8892ab' : col);
    ctx.strokeStyle = col2;
    ctx.lineWidth = lw;

    var bf = foot(pose.legB), bb = hand(pose.armB);
    var ff = foot(pose.legF), fh = hand(pose.armF);

    /* back limbs */
    ctx.globalAlpha = opts.alpha !== undefined ? opts.alpha * 0.7 : 0.7;
    ctx.beginPath();
    ctx.moveTo(x, hipY);
    ctx.lineTo(bf[0], bf[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(shX, shY);
    ctx.lineTo(bb[0], bb[1]);
    ctx.stroke();
    ctx.globalAlpha = opts.alpha !== undefined ? opts.alpha : 1;

    /* torso */
    ctx.lineWidth = lw + 0.5;
    ctx.beginPath();
    ctx.moveTo(shX, shY);
    ctx.lineTo(x, hipY);
    ctx.stroke();

    /* front limbs */
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x, hipY);
    ctx.lineTo(ff[0], ff[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(shX, shY);
    ctx.lineTo(fh[0], fh[1]);
    ctx.stroke();

    /* head */
    ctx.beginPath();
    ctx.arc(headX, headY, 8.5 * s, 0, TAU);
    ctx.stroke();

    /* eye + headband */
    ctx.fillStyle = col2;
    ctx.beginPath();
    ctx.arc(headX + facing * 3.4 * s, headY - 1 * s, 1.5 * s, 0, TAU);
    ctx.fill();
    if (opts.headband) {
      ctx.strokeStyle = opts.headband;
      ctx.lineWidth = 2.4 * s;
      ctx.beginPath();
      ctx.arc(headX, headY, 8.5 * s, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(headX - facing * 8 * s, headY + 4 * s);
      ctx.lineTo(headX - facing * 15 * s, headY + 9 * s);
      ctx.stroke();
    }
    return { hx: headX, hy: headY };
  }

  function drawEnemy(e, t) {
    var col = e.col;
    var scale = e.scale || 1;
    var flash = false;
    if (e.state === 'telegraph' && Math.floor(t / 70) % 2 === 0) { flash = true; col = '#ffffff'; }
    if (e.flashT > 0) flash = true;

    /* ground shadow */
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.ellipse(e.x, GROUND + 3, 17 * scale, 4.5 * scale, 0, 0, TAU);
    ctx.fill();

    if (e.state === 'knocked') {
      var k = e.knock;
      var alpha = k.life < 0.5 ? k.life / 0.5 : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(k.x, k.y - 32);
      ctx.rotate(k.rot);
      ctx.translate(-k.x, -(k.y - 32));
      drawStickman(k.x, k.y, e.face, col, KNOCK_POSE,
        { flash: flash, scale: scale, headband: e.isBoss ? '#fbbf24' : (e.elite ? col : null) });
      ctx.restore();
      /* cartoon stars circle the tumbling fighter */
      ctx.fillStyle = '#facc15';
      ctx.globalAlpha = alpha;
      var starN = e.isBoss ? 8 : 5;
      for (var i = 0; i < starN; i++) {
        var a = t / 140 + (i * TAU) / starN;
        drawStar(k.x + Math.cos(a) * 30 * scale, k.y - 34 + Math.sin(a) * 26 * scale,
          e.isBoss ? 8 : 6, a);
      }
      ctx.globalAlpha = 1;
      return;
    }

    /* elites and bosses wear a coloured aura so their tier reads instantly */
    if (e.elite) {
      ctx.save();
      ctx.globalAlpha = e.isBoss ? 0.5 + 0.2 * Math.sin(t / 120) : 0.28;
      ctx.strokeStyle = e.isBoss ? '#f43f5e' : e.col;
      ctx.lineWidth = e.isBoss ? 3 : 2;
      ctx.beginPath();
      ctx.ellipse(e.x, GROUND - 44 * scale, 30 * scale, 50 * scale, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    var head = drawStickman(e.x, GROUND, e.face, col, e.pose,
      { flash: flash, scale: scale, headband: e.isBoss ? '#fbbf24' : (e.elite ? e.col : null) });

    /* boss crown: three hard spikes make a silhouette no regular rival shares */
    if (e.isBoss) {
      ctx.save();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 3;
      for (var c = 0; c < 3; c++) {
        var ca = -Math.PI / 2 + (c - 1) * 0.42;
        ctx.beginPath();
        ctx.moveTo(head.hx + Math.cos(ca) * 9 * scale, head.hy + Math.sin(ca) * 9 * scale);
        ctx.lineTo(head.hx + Math.cos(ca) * 21 * scale, head.hy + Math.sin(ca) * 21 * scale);
        ctx.stroke();
      }
      ctx.restore();
    } else if (e.elite) {
      /* elite marker diamond above the head */
      ctx.save();
      ctx.fillStyle = e.col;
      ctx.globalAlpha = 0.9;
      ctx.translate(e.x, GROUND - 106 * scale);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-3, -3, 6, 6);
      ctx.restore();
    }

    /* small hp pips above regular fighters; bosses use the big top bar */
    if (!e.isBoss && e.hp < e.maxHp) {
      var w = 30, frac = Math.max(0, e.hp / e.maxHp);
      var pipY = GROUND - 84 * scale;
      ctx.fillStyle = 'rgba(5,7,14,.8)';
      ctx.fillRect(e.x - w / 2, pipY, w, 4);
      ctx.fillStyle = frac > 0.4 ? '#2ee6a6' : '#ff5c7a';
      ctx.fillRect(e.x - w / 2, pipY, w * frac, 4);
    }
  }

  function drawArena(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070e';
    ctx.fillRect(0, 0, W, H);

    var g = ctx.createRadialGradient(W * 0.5, 120, 30, W * 0.5, 120, W * 0.85);
    g.addColorStop(0, 'rgba(168,85,247,.16)');
    g.addColorStop(0.55, 'rgba(34,211,238,.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* crowd dots */
    ctx.fillStyle = 'rgba(147,163,194,.14)';
    for (var r = 0; r < 4; r++) {
      var y = 150 + r * 46;
      for (var c = 0; c < 26; c++) {
        var x = 18 + c * 23 + (r % 2) * 11;
        ctx.globalAlpha = 0.06 + 0.1 * (0.5 + 0.5 * Math.sin(t / 520 + c * 1.7 + r));
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    /* pit ring + floor */
    ctx.strokeStyle = 'rgba(124,92,255,.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(W / 2, GROUND + 46, 330, 62, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(34,211,238,.55)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, GROUND + 5.5);
    ctx.lineTo(W, GROUND + 5.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(7,11,20,.85)';
    ctx.fillRect(0, GROUND + 7, W, H - GROUND - 7);
    ctx.strokeStyle = 'rgba(124,92,255,.25)';
    ctx.lineWidth = 1;
    for (var i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 80, H);
      ctx.lineTo(W / 2 + (i * 80 - W / 2) * 0.55, GROUND + 8);
      ctx.stroke();
    }
  }

  function drawHudCanvas() {
    /* HP bar */
    var hp = player ? Math.max(0, player.hp) : 0;
    var bx = 18, by = 18, bw = 170, bh = 15;
    ctx.fillStyle = 'rgba(5,7,14,.78)';
    ctx.fillRect(bx - 3, by - 3, bw + 6, bh + 6);
    ctx.fillStyle = '#1c2740';
    ctx.fillRect(bx, by, bw, bh);
    var frac = hp / 100;
    ctx.fillStyle = frac > 0.55 ? '#2ee6a6' : (frac > 0.25 ? '#f59e0b' : '#ff5c7a');
    ctx.fillRect(bx, by, bw * frac, bh);
    ctx.strokeStyle = 'rgba(232,238,252,.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx - 0.5, by - 0.5, bw + 1, bh + 1);
    ctx.fillStyle = '#e8eefc';
    ctx.font = '700 11px ' + FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('HP ' + Math.ceil(hp), bx + 6, by + bh / 2 + 1);

    /* boss health bar with name and phase */
    if (boss && boss.hp > 0) {
      var bw2 = 360, bx2 = (W - bw2) / 2, by2 = 56, bh2 = 14;
      var frac2 = Math.max(0, boss.hp / boss.maxHp);
      ctx.fillStyle = 'rgba(5,7,14,.82)';
      ctx.fillRect(bx2 - 3, by2 - 3, bw2 + 6, bh2 + 6);
      ctx.fillStyle = '#2a0f1a';
      ctx.fillRect(bx2, by2, bw2, bh2);
      var bg2 = ctx.createLinearGradient(bx2, 0, bx2 + bw2, 0);
      bg2.addColorStop(0, boss.phase === 2 ? '#fb7185' : '#f43f5e');
      bg2.addColorStop(1, '#fbbf24');
      ctx.fillStyle = bg2;
      ctx.fillRect(bx2, by2, bw2 * frac2, bh2);
      ctx.strokeStyle = 'rgba(251,191,36,.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx2 - 0.5, by2 - 0.5, bw2 + 1, bh2 + 1);
      ctx.fillStyle = '#e8eefc';
      ctx.font = '800 11px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        boss.name.toUpperCase() + ' · PHASE ' + boss.phase +
        ' · ' + Math.max(0, Math.ceil(boss.hp)) + '/' + boss.maxHp,
        W / 2, by2 + bh2 / 2 + 1
      );
      ctx.textAlign = 'left';
    }

    /* combo */
    if (combo >= 2) {
      ctx.textBaseline = 'alphabetic';
      ctx.font = '800 26px ' + FONT;
      ctx.fillStyle = '#facc15';
      ctx.fillText('×' + combo + ' COMBO', 18, 68);
      ctx.fillStyle = 'rgba(232,238,252,.65)';
      ctx.font = '600 12px ' + FONT;
      ctx.fillText(comboT.toFixed(1) + 's to keep it', 18, 86);
    }

    /* active pickup boosts */
    var by2 = 112;
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 12px ' + FONT;
    ctx.textAlign = 'left';
    if (dmgBoostT > 0) {
      ctx.fillStyle = '#fb7185';
      ctx.fillText('DAMAGE +45%  ' + Math.ceil(dmgBoostT) + 's', 18, by2);
      by2 += 18;
    }
    if (speedT > 0) {
      ctx.fillStyle = '#22d3ee';
      ctx.fillText('SPEED +35%  ' + Math.ceil(speedT) + 's', 18, by2);
      by2 += 18;
    }
    if (shieldCharges > 0) {
      ctx.fillStyle = '#c4b5fd';
      ctx.fillText('SHIELD ×' + shieldCharges, 18, by2);
    }

    /* wave label top-right */
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(147,163,194,.95)';
    ctx.font = '700 14px ' + FONT;
    ctx.fillText('WAVE ' + wave + '  ·  KOs ' + knockouts, W - 16, 32);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function drawPickup(pk) {
    var col = PICKUP_DEFS[pk.type].col;
    var bob = Math.sin(tGlobal * 3 + pk.t) * 4;
    var x = pk.x, y = pk.y + bob;
    ctx.save();
    ctx.globalAlpha = pk.life < 2.5 ? 0.45 + 0.55 * Math.abs(Math.sin(tGlobal * 8)) : 1;
    ctx.shadowColor = col;
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(6,10,20,.9)';
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    if (pk.type === 'heal') {
      ctx.fillRect(x - 2.5, y - 8, 5, 16);
      ctx.fillRect(x - 8, y - 2.5, 16, 5);
    } else if (pk.type === 'damage') {
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - 6, y + 7); ctx.lineTo(x + 6, y - 7);
      ctx.moveTo(x + 1, y - 7); ctx.lineTo(x + 7, y - 7); ctx.lineTo(x + 7, y - 1);
      ctx.stroke();
    } else if (pk.type === 'speed') {
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(x - 7, y - 7); ctx.lineTo(x, y); ctx.lineTo(x - 7, y + 7);
      ctx.moveTo(x + 1, y - 7); ctx.lineTo(x + 8, y); ctx.lineTo(x + 1, y + 7);
      ctx.stroke();
    } else if (pk.type === 'shield') {
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, TAU);
      ctx.stroke();
    } else {
      ctx.beginPath();
      drawStar(x, y, 8, tGlobal * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(5,7,14,.55)';
    ctx.beginPath();
    ctx.ellipse(pk.x, GROUND + 3, 11, 3, 0, 0, TAU);
    ctx.fill();
  }

  function drawEffects() {
    var i, f, rr;
    for (i = 0; i < shockwaves.length; i++) {
      var s = shockwaves[i];
      f = s.t / s.life;
      rr = s.maxR * (0.2 + 0.8 * f);
      ctx.globalAlpha = Math.max(0, 1 - f);
      ctx.strokeStyle = s.col;
      ctx.lineWidth = Math.max(0.8, s.width * (1 - f * 0.55));
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, rr, rr * 0.82, 0, 0, TAU);
      ctx.stroke();
      if (s.dbl) {
        ctx.globalAlpha = Math.max(0, 1 - f) * 0.8;
        ctx.lineWidth = Math.max(0.7, s.width * 0.55 * (1 - f));
        ctx.beginPath();
        ctx.ellipse(s.x - 6, s.y, rr * 0.62, rr * 0.5, 0, 0, TAU);
        ctx.stroke();
      }
    }
    for (i = 0; i < hitFlashes.length; i++) {
      var h = hitFlashes[i];
      f = h.t / h.life;
      ctx.globalAlpha = Math.max(0, 1 - f) * 0.95;
      ctx.fillStyle = h.col;
      ctx.beginPath();
      ctx.moveTo(h.x, h.y);
      ctx.lineTo(h.x + h.dir * 62, h.y - 30);
      ctx.lineTo(h.x + h.dir * 62, h.y + 30);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = Math.max(0, 1 - f);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(h.x, h.y);
      ctx.lineTo(h.x + h.dir * 36, h.y - 14);
      ctx.lineTo(h.x + h.dir * 36, h.y + 14);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawUpgradePanel() {
    ctx.save();
    ctx.fillStyle = 'rgba(4,7,14,.84)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#facc15';
    ctx.font = '800 26px ' + FONT;
    ctx.fillText('WAVE ' + wave + ' CLEAR — CHOOSE AN UPGRADE', W / 2, 150);
    ctx.fillStyle = 'rgba(232,238,252,.78)';
    ctx.font = '600 13px ' + FONT;
    ctx.fillText('Press 1, 2 or 3 — or click a card. The boost lasts all run.', W / 2, 180);

    var cw = 154, ch = 176, gap = 16;
    var total = cw * 3 + gap * 2;
    var x0 = (W - total) / 2, y0 = 220;
    upgradeRects = [];

    for (var i = 0; i < upgradeChoices.length; i++) {
      var id = upgradeChoices[i], def = UPGRADE_DEFS[id];
      var x = x0 + i * (cw + gap);
      upgradeRects.push({ x: x, y: y0, w: cw, h: ch });

      ctx.fillStyle = 'rgba(15,23,42,.94)';
      roundRect(x, y0, cw, ch, 13);
      ctx.fill();
      ctx.strokeStyle = def.col;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = def.col;
      ctx.font = '800 14px ' + FONT;
      ctx.fillText(def.title, x + cw / 2, y0 + 34);
      ctx.fillStyle = 'rgba(232,238,252,.8)';
      ctx.font = '600 12px ' + FONT;
      ctx.fillText(def.desc, x + cw / 2, y0 + 60);

      ctx.strokeStyle = def.col;
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (id === 'damage') {
        ctx.moveTo(x + cw / 2 - 11, y0 + 108); ctx.lineTo(x + cw / 2 + 11, y0 + 86);
        ctx.moveTo(x + cw / 2 + 3, y0 + 86); ctx.lineTo(x + cw / 2 + 11, y0 + 86); ctx.lineTo(x + cw / 2 + 11, y0 + 95);
      } else if (id === 'speed') {
        ctx.moveTo(x + cw / 2 - 12, y0 + 90); ctx.lineTo(x + cw / 2, y0 + 102); ctx.lineTo(x + cw / 2 - 12, y0 + 114);
        ctx.moveTo(x + cw / 2 + 1, y0 + 90); ctx.lineTo(x + cw / 2 + 13, y0 + 102); ctx.lineTo(x + cw / 2 + 1, y0 + 114);
      } else if (id === 'heal') {
        ctx.moveTo(x + cw / 2 - 12, y0 + 102); ctx.lineTo(x + cw / 2 + 12, y0 + 102);
        ctx.moveTo(x + cw / 2, y0 + 90); ctx.lineTo(x + cw / 2, y0 + 114);
      } else if (id === 'guard') {
        ctx.arc(x + cw / 2, y0 + 102, 13, 0, TAU);
      } else {
        drawStarOutline(x + cw / 2, y0 + 102, 14, tGlobal);
      }
      ctx.stroke();

      ctx.fillStyle = def.col;
      ctx.font = '700 12px ' + FONT;
      ctx.fillText('[' + (i + 1) + ']', x + cw / 2, y0 + ch - 18);
    }
    ctx.restore();
  }

  function drawStarOutline(x, y, r, rot) {
    for (var i = 0; i < 10; i++) {
      var rad = i % 2 === 0 ? r : r * 0.45;
      var a = rot + (i * Math.PI) / 5 - Math.PI / 2;
      var px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function draw(t) {
    drawArena(t);

    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    /* knockouts first (behind), then standing rivals, then the player */
    var i;
    for (i = 0; i < pickups.length; i++) drawPickup(pickups[i]);

    for (i = 0; i < enemies.length; i++) {
      if (enemies[i].state === 'knocked') drawEnemy(enemies[i], t);
    }
    for (i = 0; i < enemies.length; i++) {
      if (enemies[i].state !== 'knocked') drawEnemy(enemies[i], t);
    }

    if (player) {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath();
      ctx.ellipse(player.x, GROUND + 3, 17, 4.5, 0, 0, TAU);
      ctx.fill();
      if (!(player.invuln > 0 && Math.floor(t / 90) % 2 === 1 && player.hurtT <= 0)) {
        drawStickman(player.x, GROUND, player.face, PLAYER_COL, player.pose,
          { headband: '#e8eefc', flash: player.hurtT > 0 && Math.floor(t / 60) % 2 === 0 });
      }

      /* shield charges shimmer as a bubble around the fighter */
      if (shieldCharges > 0) {
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.25 * Math.sin(tGlobal * 5);
        ctx.strokeStyle = '#a78bfa';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(player.x, GROUND - 42, 30, 44, 0, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#c4b5fd';
        for (var sc = 0; sc < shieldCharges; sc++) {
          ctx.beginPath();
          ctx.arc(player.x - 12 + sc * 12, GROUND - 94, 3, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }

      /* strike arc flourish */
      if (player.atk && player.atkT >= ATK[player.atk].w0 &&
          player.atkT <= ATK[player.atk].w0 + 0.09) {
        var a = ATK[player.atk];
        ctx.strokeStyle = player.atk === 'kick' ? 'rgba(245,158,11,.75)' : 'rgba(232,238,252,.7)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(player.x + player.face * 26, GROUND - 44,
                a.reach * 0.75, -0.85, 0.85);
        ctx.stroke();
      }
    }

    /* particles */
    for (i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = Math.max(0, p.life / p.life0);
      ctx.fillStyle = p.col;
      if (p.star) drawStar(p.x, p.y, p.size + 1.5, p.life * 8);
      else ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    /* impact rings and directional bursts sit above the sparks */
    drawEffects();

    /* floating texts */
    ctx.textAlign = 'center';
    for (i = 0; i < pops.length; i++) {
      var q = pops[i];
      ctx.globalAlpha = Math.max(0, 1 - q.t / q.life);
      ctx.fillStyle = q.col;
      ctx.font = '800 ' + q.size + 'px ' + FONT;
      ctx.fillText(q.txt, q.x, q.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';

    ctx.restore();

    drawHudCanvas();

    /* wave banner */
    if (banner) {
      var a2 = Math.min(1, banner.t / 0.35, (banner.t0 - banner.t) / 0.2 + 0.2);
      ctx.globalAlpha = Math.max(0, Math.min(1, a2));
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(5,7,14,.72)';
      ctx.fillRect(0, H * 0.34, W, 96);
      ctx.fillStyle = '#e8eefc';
      ctx.font = '800 38px ' + FONT;
      ctx.fillText(banner.title, W / 2, H * 0.34 + 50);
      ctx.fillStyle = '#22d3ee';
      ctx.font = '600 16px ' + FONT;
      ctx.fillText(banner.sub, W / 2, H * 0.34 + 78);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }

    /* red damage flash */
    if (flashT > 0) {
      ctx.fillStyle = 'rgba(255,60,72,' + (Math.max(0, flashT) * 0.55) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    if (state === 'paused') {
      ctx.fillStyle = 'rgba(232,238,252,.75)';
      ctx.font = 'bold 22px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, 34);
      ctx.textAlign = 'left';
    }

    if (state === 'upgrade') drawUpgradePanel();
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    var dt = last ? (t - last) / 1000 : 0;
    last = t;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    if (state === 'running' && hitStop > 0) {
      /* brief freeze on impact so every hit reads */
      hitStop = Math.max(0, hitStop - dt);
    } else if (state === 'running') {
      update(dt);
    }
    draw(t);
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- states ---------------- */

  function releaseKeys() {
    keys.left = keys.right = keys.block = false;
  }

  function start() {
    reset();
    state = 'running';
    last = now();
    GameShell.overlay.hide();
    updateHud();
    ensureLoop();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    releaseKeys();
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'Catch your breath — the rivals will wait.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Wave', value: wave },
        { label: 'HP', value: Math.max(0, Math.round(player.hp)) }
      ],
      btn: '▶ Resume',
      action: resume
    });
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'running';
    last = now();
    GameShell.overlay.hide();
    updateHud();
    ensureLoop();
  }

  function gameOver() {
    if (state === 'over') return;
    state = 'over';
    releaseKeys();
    var isBest = score > best;
    if (isBest) {
      best = score;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: isBest ? 'New high score!' : 'Game over',
      msg: 'You fought through wave ' + wave + ', scored ' + score +
           ' point' + (score === 1 ? '' : 's') + ' and knocked out ' +
           knockouts + ' rival' + (knockouts === 1 ? '' : 's') + '.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Wave', value: wave },
        { label: 'Knockouts', value: knockouts }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  /* ---------------- input ---------------- */

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var k = e.key;
    if (k === undefined || k === null) return;

    /* the between-wave upgrade cards take 1 / 2 / 3 */
    if (state === 'upgrade') {
      if (k === '1' || k === '2' || k === '3') {
        var pick = parseInt(k, 10) - 1;
        if (pick >= 0 && pick < upgradeChoices.length) applyUpgrade(upgradeChoices[pick]);
      }
      return;
    }

    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowDown' ||
        k === ' ' || k === 'Enter') {
      if (e.preventDefault) e.preventDefault();
    }

    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = true;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = true;
    else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.block = true;
    else if (k === 'z' || k === 'Z') tryAttack('punch');
    else if (k === 'x' || k === 'X' || k === 'Shift') tryAttack('kick');
    else if (k === ' ') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
      else if (state === 'running') tryAttack('punch');
    } else if (k === 'Enter') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    }
  });

  document.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === undefined || k === null) return;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
    else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.block = false;
  });

  /* on-screen touch buttons */
  var padBtns = document.querySelectorAll('[data-act]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      var act = btn.getAttribute('data-act');
      function on() {
        if (state === 'ready' || state === 'over') { start(); return; }
        if (state === 'paused') { resume(); return; }
        if (state === 'upgrade') return;
        if (act === 'left') keys.left = true;
        else if (act === 'right') keys.right = true;
        else if (act === 'block') keys.block = true;
        else if (act === 'punch') tryAttack('punch');
        else if (act === 'kick') tryAttack('kick');
      }
      function off() {
        if (act === 'left') keys.left = false;
        else if (act === 'right') keys.right = false;
        else if (act === 'block') keys.block = false;
      }
      btn.addEventListener('pointerdown', function (ev) { if (ev.preventDefault) ev.preventDefault(); on(); });
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointerleave', off);
      btn.addEventListener('pointercancel', off);
    })(padBtns[b]);
  }

  /* click the arena to punch, or to claim an upgrade card */
  canvas.addEventListener('pointerdown', function (ev) {
    if (state === 'upgrade') {
      var rect = canvas.getBoundingClientRect
        ? canvas.getBoundingClientRect()
        : { left: 0, top: 0, width: W, height: H };
      var cx = (ev.clientX - rect.left) * (W / rect.width);
      var cy = (ev.clientY - rect.top) * (H / rect.height);
      upgradeAt(cx, cy);
      return;
    }
    if (state === 'ready' || state === 'over') { start(); return; }
    if (state === 'running') tryAttack('punch');
  });

  window.addEventListener('blur', releaseKeys);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- test snapshot (read-only) ---------------- */

  try {
    Object.defineProperty(window, '__stickmanFighter', {
      value: Object.freeze({
        snapshot: function () {
          var list = [], plist = [], typeCount = {};
          for (var i = 0; i < enemies.length; i++) {
            var e = enemies[i];
            typeCount[e.type] = (typeCount[e.type] || 0) + 1;
            list.push({
              x: Math.round(e.x * 10) / 10,
              hp: e.hp, maxHp: e.maxHp,
              state: e.state,
              knocked: e.state === 'knocked',
              type: e.type,
              elite: !!e.elite,
              isBoss: !!e.isBoss,
              scale: e.scale || 1,
              dmg: e.dmg,
              speed: Math.round((e.speed || 0) * 10) / 10,
              reach: e.reach || ENEMY_REACH
            });
          }
          for (var k = 0; k < pickups.length; k++) {
            plist.push({
              type: pickups[k].type,
              x: Math.round(pickups[k].x),
              life: Math.round(pickups[k].life * 10) / 10
            });
          }
          return {
            state: state,
            score: score,
            best: Math.max(best, score),
            wave: wave,
            knockouts: knockouts,
            hp: player ? player.hp : 0,
            maxHp: player ? player.maxHp : 0,
            playerX: player ? Math.round(player.x * 10) / 10 : 0,
            playerFace: player ? player.face : 0,
            playerAtk: player ? player.atk : null,
            playerAtkT: player ? Math.round(player.atkT * 1000) / 1000 : 0,
            playerCool: player ? Math.round(player.cool * 1000) / 1000 : 0,
            playerHurtT: player ? Math.round(player.hurtT * 1000) / 1000 : 0,
            playerInvuln: player ? Math.round(player.invuln * 1000) / 1000 : 0,
            playerAtkId: player ? player.atkId : 0,
            combo: combo,
            comboT: Math.round(comboT * 100) / 100,
            comboWindow: Math.round(comboWindow() * 100) / 100,
            phase: phase,
            spawnLeft: spawnLeft,
            hitStop: Math.round(hitStop * 1000) / 1000,
            waveIsBoss: isBossWave(wave),
            bossEvery: BOSS_EVERY,
            bossNumber: bossNumber,
            bossActive: !!boss,
            bossName: boss ? boss.name : null,
            bossHp: boss ? Math.max(0, boss.hp) : 0,
            bossMaxHp: boss ? boss.maxHp : 0,
            bossPhase: boss ? boss.phase : 0,
            bossDefeated: bossDefeated,
            boss: boss ? {
              active: true,
              number: boss.bossNum,
              name: boss.name,
              hp: Math.max(0, boss.hp),
              maxHp: boss.maxHp,
              phase: boss.phase,
              dmg: boss.dmg,
              speed: Math.round(boss.speed * 10) / 10,
              telegraph: Math.round(boss.telegraph * 100) / 100,
              state: boss.state,
              action: boss.action,
              summons: boss.summons,
              lastHitId: boss.lastHitId
            } : {
              active: false,
              number: bossNumber,
              name: null,
              hp: 0,
              maxHp: 0,
              phase: 0,
              dmg: 0,
              speed: 0,
              telegraph: 0,
              state: null,
              action: null,
              summons: 0
            },
            difficulty: waveDifficulty(wave),
            enemyTypes: typeCount,
            enemies: list,
            pickups: plist,
            upgrades: {
              damage: upDamage,
              speed: upSpeed,
              guard: upGuard,
              combo: upCombo,
              taken: upgradesTaken
            },
            upgradeChoices: upgradeChoices.slice(),
            active: {
              dmgBoostT: Math.round(dmgBoostT * 10) / 10,
              speedT: Math.round(speedT * 10) / 10,
              shieldCharges: shieldCharges,
              comboBonus: comboBonus,
              guardBlock: Math.max(0.12, GUARD_BASE - upGuard * 0.05)
            },
            effects: {
              leftSideHits: leftSideHits,
              rightSideHits: rightSideHits,
              totalHits: effectsSpawned,
              shockwavesActive: shockwaves.length,
              flashesActive: hitFlashes.length,
              shockwavesSpawned: shockSpawned
            },
            counters: {
              pickupsDropped: pickupsDropped,
              pickupsTaken: pickupsTaken
            }
          };
        },
        /* deterministic harness hooks that route through normal game systems */
        debug: {
          jumpToWave: function (n) {
            if (state !== 'running') return false;
            enemies.length = 0;
            boss = null;
            bossDefeated = false;
            beginWave(Math.max(1, Math.floor(n) || 1));
            return true;
          },
          damageBoss: function (amount) {
            if (!boss || boss.state === 'knocked') return false;
            boss.hp -= Math.max(1, Math.floor(amount) || 1);
            boss.flashT = 0.14;
            if (boss.hp <= 0) {
              boss.hp = 0;
              knockout(boss, player && player.x < boss.x ? 1 : -1);
            }
            updateHud();
            return true;
          },
          damagePlayer: function (amount) {
            if (state !== 'running' || !player) return false;
            hurtPlayer(Math.max(1, Math.floor(amount) || 10), player.x + 1);
            return true;
          },
          spawnElite: function (type) {
            if (state !== 'running') return false;
            spawnEnemy(type === 'brute' ? 'brute' : 'striker');
            return true;
          }
        }
      }),
      writable: false,
      configurable: false
    });
  } catch (e) { /* snapshot hook unavailable — ignore */ }

  /* ---------------- boot ---------------- */

  reset();
  updateHud();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Stickman Fighter',
    msg: 'Rival stick fighters — including fast Strikers and heavy Brutes — rush the arena from both sides. Every fourth wave brings a named boss with charge, slam and flurry attacks. Punch with Z, kick with X, hold ↓ to guard, and sidestep every flash for a dodge bonus.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* shared HUD reset button */
  if (typeof GameShell.onReset === 'function') GameShell.onReset(start);
})();
