/* ============================================================
   Wavebreak — original game for PixelPlay
   First-person raycasting arena: hold out against endless waves
   of attack drones, earn credits and buy upgrades between waves.
   Keyboard, mouse (pointer lock) and on-screen touch buttons.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 600, H = 600;
  var STRIP = 2;                    /* wall strip width in px */
  var COLS = W / STRIP;
  var FOV_PLANE = 0.66;             /* camera plane length (~66° FOV) */
  var BEST_KEY = 'wavebreak';
  var TAU = Math.PI * 2;

  /* Jump / gravity (Space) */
  var JUMP_VEL = 2.6;
  var GRAVITY = 11.5;

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

  /* ---------------- arena ---------------- */

  var MAP = [
    '####################',
    '#..................#',
    '#..oo..........oo..#',
    '#..oo....==....oo..#',
    '#........==........#',
    '#..................#',
    '#.====....##....==.#',
    '#..................#',
    '#..................#',
    '#....oo......oo....#',
    '#....oo......oo....#',
    '#..................#',
    '#..................#',
    '#.====....##....==.#',
    '#..................#',
    '#........==........#',
    '#..oo....==....oo..#',
    '#..oo..........oo..#',
    '#..................#',
    '####################'
  ];
  var MH = MAP.length, MW = MAP[0].length;
  var WALLS = { '#': [94, 84, 168], '=': [64, 150, 190], 'o': [110, 96, 200] };

  function cellAt(x, y) {
    if (x < 0 || y < 0 || x >= MW || y >= MH) return '#';
    return MAP[y].charAt(x);
  }

  function isSolid(x, y) {
    var c = cellAt(x, y);
    return c !== '.';
  }

  var openCells = [], edgeCells = [];
  (function () {
    for (var y = 0; y < MH; y++) {
      for (var x = 0; x < MW; x++) {
        if (!isSolid(x, y)) {
          openCells.push({ x: x + 0.5, y: y + 0.5 });
          if (x === 1 || y === 1 || x === MW - 2 || y === MH - 2) {
            edgeCells.push({ x: x + 0.5, y: y + 0.5 });
          }
        }
      }
    }
  })();

  /* ---------------- state ---------------- */

  var state = 'ready';              /* ready | running | paused | over */
  var phase = 'wave';               /* wave | breather */
  var wave = 1, score = 0;
  var hp = 100, maxHp = 100;
  var credits = 0, kills = 0, shots = 0, bossKills = 0;
  var combo = 1, comboT = 0;
  var best = GameShell.best.get(BEST_KEY, 0);
  var drones = [], orbs = [], puffs = [];
  var queue = [], spawnT = 0, waveEndT = 0, breatherT = 0;
  var flow = null, flowT = 0;
  var player = { x: 10.5, y: 10.5, dir: 0, z: 0, vz: 0, onGround: true, vx: 0, vy: 0 };
  /* Boss encounter state (alive boss also lives in drones[] so guns can hit it). */
  var boss = null, bossWarn = 0, bossName = '', bossTier = 0;
  var bannerT = 0, bannerTitle = '', bannerSub = '', bannerTone = '#ff5c7a';
  /* Developer/test bridge, off unless the page opts in before load. */
  var devMode = !!window.__WAVEBREAK_DEV__;
  var godMode = false;
  var keys = { f: false, b: false, l: false, r: false, turnL: false, turnR: false, fire: false, jump: false, aimUp: false, aimDown: false };
  var fireCd = 0;
  var upgrades = { fire: 0, dmg: 0, armor: 0 };
  var hitMarker = 0, damageFlash = 0, shake = 0, muzzle = 0, recoil = 0, tracer = 0;
  var bob = 0, bobT = 0, flashBanner = 0;
  var aimY = H / 2;                 /* vertical reticle position, screen px */
  var AIM_MARGIN = H * 0.28;        /* how far the reticle can travel up or down */
  var AIM_KEY_SPEED = 340;          /* px per second with ArrowUp / ArrowDown */
  var hitPops = [];
  var lastHit = { dist: 0, dmg: 0, mult: 1, resisted: false };
  var lastShot = { hit: false, dist: 0, wall: 0 };
  var hits = 0;
  var rafId = 0, last = 0;
  var zbuf = new Float32Array(COLS);
  var hudSig = '';
  var menuRects = [];

  /* ---------------- weapons ---------------- */

  /* Three right-handed guns. Ammo and reload timers are tracked per slot,
     so switching never refills a magazine; only a wave-clear resupply does. */
  var WEAPONS = [
    {
      id: 'blaster', name: 'Blaster', slot: 1,
      mag: 14, fireCd: 0.16, reloadTime: 1.0, damage: 1.0, recoil: 1.0,
      sfx: 'shoot', sfx2: '', accent: '#22d3ee', accent2: '#8b5cf6',
      len: 186, bulk: 1.0, flash: 20
    },
    {
      id: 'rifle', name: 'Rifle', slot: 2,
      mag: 8, fireCd: 0.44, reloadTime: 1.55, damage: 2.6, recoil: 2.4,
      sfx: 'laser', sfx2: 'thud', accent: '#f59e0b', accent2: '#ff7a45',
      len: 232, bulk: 0.82, flash: 26
    },
    {
      id: 'smg', name: 'SMG', slot: 3,
      mag: 26, fireCd: 0.085, reloadTime: 1.3, damage: 0.62, recoil: 0.45,
      sfx: 'shoot', sfx2: 'point', accent: '#2ee6a6', accent2: '#22d3ee',
      len: 158, bulk: 1.24, flash: 16
    }
  ];
  var gun = 0;
  var ammo = [WEAPONS[0].mag, WEAPONS[1].mag, WEAPONS[2].mag];
  var reloadT = [0, 0, 0];          /* seconds left per weapon, 0 = not reloading */
  var gunY = H * 0.57;              /* smoothed vertical anchor of the right-side gun */
  var VM_BASE_Y = H * 0.57;
  var VM_AIM_TRAVEL = H * 0.20;

  /* ---------------- enemies, threat and boss tuning ---------------- */

  /* Base stats before the per-wave difficulty multipliers are applied.
     hp/speed/dmg/orbSpeed grow with the wave; interval shrinks. */
  var ENEMY_TYPES = {
    hopper: {
      name: 'Hopper', hp: 1.7, speed: 1.72, scale: 0.95,
      pay: 1.0, score: 1.0, dmg: 6.0, orbSpeed: 5.2, interval: 1.9,
      alt: [-0.16, 0.34], blurb: 'baseline hover drone'
    },
    runner: {
      name: 'Runner', hp: 1.3, speed: 2.6, scale: 0.72,
      pay: 1.2, score: 1.25, dmg: 5.0, orbSpeed: 5.9, interval: 2.1,
      alt: [-0.22, 0.30], blurb: 'fast flanker'
    },
    heavy: {
      name: 'Heavy', hp: 5.2, speed: 1.05, scale: 1.3,
      pay: 2.4, score: 2.2, dmg: 10.0, orbSpeed: 4.9, interval: 2.5,
      alt: [-0.06, 0.30], blurb: 'armoured orb lobber'
    },
    bulwark: {
      name: 'Bulwark', hp: 8.5, speed: 0.82, scale: 1.45,
      pay: 3.0, score: 2.8, dmg: 11.0, orbSpeed: 4.6, interval: 2.4,
      alt: [-0.08, 0.26], frontResist: 0.42, turn: 1.35,
      blurb: 'frontal shield takes 42% damage; flank it'
    },
    stinger: {
      name: 'Stinger', hp: 2.4, speed: 2.85, scale: 0.7,
      pay: 1.7, score: 1.7, dmg: 4.6, orbSpeed: 7.4, interval: 2.3,
      alt: [-0.18, 0.32], burst: 3,
      blurb: 'strafes and spits three-orb bursts'
    },
    sniper: {
      name: 'Sniper', hp: 2.8, speed: 1.35, scale: 0.9,
      pay: 2.1, score: 2.1, dmg: 11.0, orbSpeed: 9.6, interval: 3.4,
      alt: [-0.10, 0.24], telegraph: 0.95,
      blurb: 'telegraphed predictive rail shot'
    },
    boss: {
      name: 'Boss', hp: 120, speed: 1.5, scale: 2.1,
      pay: 9.0, score: 9.0, dmg: 10.0, orbSpeed: 6.2, interval: 1.6,
      alt: [0.04, 0.12], blurb: 'wave-5 encounter, scales every five waves'
    }
  };

  var THREAT_NAMES = ['CALM', 'ELEVATED', 'HIGH', 'SEVERE', 'CRITICAL', 'APEX'];
  var BOSS_NAMES = ['OVERSEER', 'MONOLITH', 'ARBITER', 'SOVEREIGN', 'OMEGA'];

  /* Explicit difficulty tier: every two waves raise it one step, so the
     threat readout always moves ahead of the raw wave counter. */
  function waveThreat(w) { return 1 + Math.floor((Math.max(1, w) - 1) / 2); }
  function threatName(t) {
    return THREAT_NAMES[Math.min(THREAT_NAMES.length - 1, Math.max(0, t - 1))];
  }

  function waveDifficulty(w) {
    var t = waveThreat(w);
    var k = Math.max(0, w - 1);
    var fireRate = Math.min(2.5, 1 + k * 0.08);
    return {
      wave: w, tier: t, name: threatName(t),
      hpMul: Math.round((1 + k * 0.17) * 100) / 100,
      speedMul: Math.round(Math.min(1.75, 1 + k * 0.042) * 100) / 100,
      dmgMul: Math.round((1 + k * 0.085) * 100) / 100,
      orbSpeedMul: Math.round(Math.min(1.95, 1 + k * 0.05) * 100) / 100,
      fireRateMul: Math.round(fireRate * 100) / 100,
      spawnGap: Math.round(Math.max(0.34, 1.35 - k * 0.045) * 100) / 100,
      maxAlive: Math.min(16, 5 + t + Math.floor(w / 2)),
      queueSize: Math.min(34, 4 + w * 2 + Math.floor(w / 4)),
      bossWave: w % 5 === 0
    };
  }

  function bossSpec(w) {
    var tier = Math.max(1, Math.round(w / 5));
    return {
      tier: tier,
      name: (BOSS_NAMES[Math.min(BOSS_NAMES.length - 1, tier - 1)] || 'OMEGA') +
            (tier > BOSS_NAMES.length ? ' ' + tier : ''),
      maxHp: Math.round(80 + tier * 45 + w * 4 + (tier - 1) * tier * 14),
      speed: Math.round((1.05 + tier * 0.19) * 100) / 100,
      orbSpeed: Math.round((5.3 + w * 0.12 + tier * 0.4) * 100) / 100,
      dmg: Math.round((7 + w * 0.32 + tier * 1.5) * 10) / 10,
      interval: Math.round(Math.max(0.6, 1.8 - tier * 0.14) * 100) / 100,
      scale: Math.round((2.0 + tier * 0.22) * 100) / 100,
      radial: Math.min(20, 6 + tier * 2),
      escorts: Math.min(5, 2 + Math.floor(tier / 2)),
      credits: 200 + tier * 110 + w * 15,
      score: 640 + tier * 300 + w * 30
    };
  }

  /* ---------------- helpers ---------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function sfx(name) {
    if (window.PixelPlayAudio && window.PixelPlayAudio.sfx) {
      try { window.PixelPlayAudio.sfx(name); } catch (e) { /* audio unavailable */ }
    }
  }

  function weapon() { return WEAPONS[gun]; }
  function isReloading() { return reloadT[gun] > 0; }

  function selectWeapon(idx) {
    if (idx < 0 || idx >= WEAPONS.length || idx === gun) return false;
    gun = idx;
    /* Fixed draw time on a swap: never faster than the new gun's own cycle,
       and a long Rifle cooldown does not carry over to the SMG. */
    fireCd = 0.15;
    sfx('select');
    updateHud(true);
    return true;
  }

  function cycleWeapon() {
    return selectWeapon((gun + 1) % WEAPONS.length);
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function normAng(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }
  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  /* ---------------- aiming / damage falloff ---------------- */

  function horizonY() {
    return H / 2 + bob + player.z * 260;
  }

  function clampAim(y) {
    return clamp(y, H / 2 - AIM_MARGIN, H / 2 + AIM_MARGIN);
  }

  /* Shots land harder up close and lose punch with distance:
     ~x1.65 point-blank, x1.0 at mid range, x0.5 at maximum range. */
  function damageMultiplier(dist) {
    return clamp(1.65 - dist * 0.045, 0.5, 1.65);
  }

  function castRay(px, py, rdx, rdy) {
    var mapX = Math.floor(px), mapY = Math.floor(py);
    var deltaX = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
    var deltaY = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
    var stepX, stepY, sideX, sideY;
    if (rdx < 0) { stepX = -1; sideX = (px - mapX) * deltaX; }
    else { stepX = 1; sideX = (mapX + 1 - px) * deltaX; }
    if (rdy < 0) { stepY = -1; sideY = (py - mapY) * deltaY; }
    else { stepY = 1; sideY = (mapY + 1 - py) * deltaY; }
    var side = 0, cell = '#', guard = 0;
    while (guard++ < 160) {
      if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
      else { sideY += deltaY; mapY += stepY; side = 1; }
      cell = cellAt(mapX, mapY);
      if (isSolid(mapX, mapY)) break;
    }
    var dist = side === 0 ? (sideX - deltaX) : (sideY - deltaY);
    if (!(dist > 0)) dist = 1e-4;
    var wallX = side === 0 ? py + dist * rdy : px + dist * rdx;
    wallX -= Math.floor(wallX);
    return { dist: dist, side: side, cell: cell, wallX: wallX };
  }

  function losBlocked(ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.001) return false;
    var steps = Math.ceil(d / 0.18);
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      if (isSolid(Math.floor(ax + dx * t), Math.floor(ay + dy * t))) return true;
    }
    return false;
  }

  function tryMove(o, dx, dy, r) {
    var nx = o.x + dx;
    if (!isSolid(Math.floor(nx + (dx > 0 ? r : -r)), Math.floor(o.y)) &&
        !isSolid(Math.floor(nx + (dx > 0 ? r : -r)), Math.floor(o.y - r)) &&
        !isSolid(Math.floor(nx + (dx > 0 ? r : -r)), Math.floor(o.y + r))) o.x = nx;
    var ny = o.y + dy;
    if (!isSolid(Math.floor(o.x), Math.floor(ny + (dy > 0 ? r : -r))) &&
        !isSolid(Math.floor(o.x - r), Math.floor(ny + (dy > 0 ? r : -r))) &&
        !isSolid(Math.floor(o.x + r), Math.floor(ny + (dy > 0 ? r : -r)))) o.y = ny;
  }

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------- flow field (drones path to the player) ---------------- */

  function buildFlow() {
    flow = new Int16Array(MW * MH).fill(-1);
    var sx = Math.floor(player.x), sy = Math.floor(player.y);
    if (isSolid(sx, sy)) return;
    var q = [sy * MW + sx];
    flow[sy * MW + sx] = 0;
    var head = 0;
    while (head < q.length) {
      var idx = q[head++];
      var cx = idx % MW, cy = (idx - cx) / MW;
      var dist = flow[idx] + 1;
      var nb = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
      for (var i = 0; i < 4; i++) {
        var nx = nb[i][0], ny = nb[i][1];
        if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
        var ni = ny * MW + nx;
        if (flow[ni] === -1 && !isSolid(nx, ny)) { flow[ni] = dist; q.push(ni); }
      }
    }
  }

  /* ---------------- upgrades ---------------- */

  function fireCost() { return 120 + upgrades.fire * 90; }
  function dmgCost() { return 150 + upgrades.dmg * 110; }
  function armorCost() { return 130 + upgrades.armor * 90; }

  function buy(kind) {
    if (phase !== 'breather') return false;
    var cost = kind === 'fire' ? fireCost() : kind === 'dmg' ? dmgCost() : armorCost();
    if (credits < cost) return false;
    credits -= cost;
    if (kind === 'fire') upgrades.fire++;
    else if (kind === 'dmg') upgrades.dmg++;
    else {
      upgrades.armor++;
      maxHp += 25;
      hp = Math.min(maxHp, hp + 40);
    }
    flashBanner = 0.8;
    sfx('coin');
    updateHud(true);
    return true;
  }

  function fireCooldown() {
    var w = weapon();
    return Math.max(w.fireCd * 0.5, w.fireCd * Math.pow(0.85, upgrades.fire));
  }

  function ammoText() {
    var w = weapon();
    return w.name + ' ' + (isReloading() ? 'reloading' : ammo[gun] + '/' + w.mag);
  }

  /* ---------------- HUD ---------------- */

  function updateHud(force) {
    var right, wtxt = ammoText();
    if (state === 'paused') right = '⏸ Paused · Wave ' + wave + ' · ' + wtxt;
    else if (phase === 'wave' && document.pointerLockElement !== canvas) right = '🖱 Click to aim · ' + wtxt + ' · 1/2/3 or Q switch · Space jump';
    else right = '⬡ ' + credits + ' credits' + (combo > 1 && phase === 'wave' ? ' · ×' + combo : '') + ' · ' + wtxt + ' · Space jump';
    var sig = [score, Math.max(best, score), wave, Math.max(0, Math.ceil(hp)), gun, ammo[gun], isReloading(), right].join('|');
    if (!force && sig === hudSig) return;
    hudSig = sig;
    GameShell.hud(
      { Score: score, Best: Math.max(best, score), Wave: wave, HP: Math.max(0, Math.ceil(hp)) },
      right
    );
  }

  /* ---------------- waves ---------------- */

  function showBanner(title, sub, tone, life) {
    bannerTitle = title;
    bannerSub = sub || '';
    bannerTone = tone || '#ff5c7a';
    bannerT = life || 2.0;
  }

  function pickOpenCell(minDist) {
    var fallback = openCells[0];
    for (var i = 0; i < 48; i++) {
      var c = openCells[(Math.random() * openCells.length) | 0];
      fallback = c;
      var dx = c.x - player.x, dy = c.y - player.y;
      if (Math.sqrt(dx * dx + dy * dy) >= minDist) return c;
    }
    return fallback;
  }

  function pickType() {
    var roll = Math.random();
    if (wave >= 9 && roll > 0.93) return 'sniper';
    if (wave >= 7 && roll > 0.82) return 'stinger';
    if (wave >= 6 && roll > 0.71) return 'bulwark';
    if (wave >= 4 && roll > 0.58) return 'heavy';
    if (wave >= 2 && roll > 0.34) return 'runner';
    return 'hopper';
  }

  function pickEscortType() {
    var roll = Math.random();
    if (wave >= 9 && roll > 0.90) return 'sniper';
    if (wave >= 7 && roll > 0.72) return 'stinger';
    if (wave >= 6 && roll > 0.50) return 'bulwark';
    if (wave >= 4 && roll > 0.26) return 'heavy';
    return 'runner';
  }

  function startWave() {
    phase = 'wave';
    queue = [];
    boss = null;
    bossWarn = 0;
    var diff = waveDifficulty(wave);
    var i;

    if (diff.bossWave) {
      spawnBoss();
      var escorts = bossSpec(wave).escorts;
      for (i = 0; i < escorts; i++) queue.push(pickEscortType());
      spawnT = 1.7;
    } else {
      var n = diff.queueSize;
      for (i = 0; i < n; i++) queue.push(pickType());
      spawnT = 0.9;
      if (state !== 'ready') showBanner('WAVE ' + wave, 'THREAT ' + diff.tier + ' · ' + diff.name, '#22d3ee', 1.9);
    }
    waveEndT = 0;
    if (state === 'running') sfx('powerup');   /* wave-start cue */
    updateHud(true);
  }

  function spawnBoss() {
    var spec = bossSpec(wave);
    var c = pickOpenCell(8.5);
    var d = {
      x: c.x, y: c.y, type: 'boss', boss: true,
      name: spec.name, tier: spec.tier, phase: 1,
      hp: spec.maxHp, maxHp: spec.maxHp,
      speed: spec.speed, scale: spec.scale,
      creditsPay: spec.credits, scoreBase: spec.score,
      fireT: 2.4, interval: spec.interval,
      orbSpeed: spec.orbSpeed, dmg: spec.dmg,
      radial: spec.radial, escortCap: spec.escorts,
      alt: 0.08, flash: 0, wob: Math.random() * TAU,
      strafeDir: Math.random() < 0.5 ? -1 : 1, strafeT: 1.6,
      tele: null, cycle: 0, face: Math.atan2(player.y - c.y, player.x - c.x),
      frontResist: 1
    };
    drones.push(d);
    boss = d;
    bossName = spec.name;
    bossTier = spec.tier;
    bossWarn = 3.0;
    puffs.push({ x: c.x, y: c.y, t: 0, life: 0.6 });
    showBanner('⚠ WARNING ⚠', 'BOSS INBOUND — ' + spec.name, '#ff5c7a', 3.2);
    if (state === 'running') { sfx('powerup'); sfx('thud'); }
    return d;
  }

  function spawnDrone(type, at) {
    var spec = ENEMY_TYPES[type] || ENEMY_TYPES.hopper;
    var diff = waveDifficulty(wave);
    var c = at || pickOpenCell(6.5);
    var hpBase = Math.max(1, Math.round(spec.hp * diff.hpMul * 10) / 10);
    var alt = rnd(spec.alt[0], spec.alt[1]);
    drones.push({
      x: c.x, y: c.y, type: type,
      hp: hpBase, maxHp: hpBase,
      speed: Math.round(spec.speed * diff.speedMul * 100) / 100,
      scale: spec.scale,
      creditsPay: Math.round(spec.pay * (20 + wave * 4)),
      scoreBase: Math.round(spec.score * (50 + wave * 8)),
      fireT: rnd(0.8, 2.0) / Math.min(1.6, diff.fireRateMul),
      interval: Math.max(0.45, spec.interval / diff.fireRateMul),
      orbSpeed: spec.orbSpeed * diff.orbSpeedMul,
      dmg: spec.dmg * diff.dmgMul,
      alt: alt,
      face: Math.atan2(player.y - c.y, player.x - c.x),
      frontResist: spec.frontResist || 1,
      turn: spec.turn || 0,
      burstLeft: 0, burstMax: spec.burst || 0, burstT: 0,
      aimT: 0, teleLen: spec.telegraph || 0, aimX: 0, aimY: 0,
      flash: 0, wob: Math.random() * TAU
    });
    puffs.push({ x: c.x, y: c.y, t: 0, life: 0.4 });
  }

  /* ---------------- enemies ---------------- */

  function fireOrb(x, y, angle, speed, dmg, bossShot) {
    orbs.push({
      x: x + Math.cos(angle) * 0.35,
      y: y + Math.sin(angle) * 0.35,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      dmg: dmg,
      boss: !!bossShot,
      r: bossShot ? 0.6 : 0.45
    });
  }

  function updateBoss(d, dt) {
    var dx = player.x - d.x, dy = player.y - d.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
    var los = !losBlocked(d.x, d.y, player.x, player.y);
    if (d.flash > 0) d.flash -= dt;

    /* Phase 2 at half health: faster cycles, spiral radial bursts. */
    var wantPhase = d.hp <= d.maxHp * 0.5 ? 2 : 1;
    if (wantPhase !== d.phase) {
      d.phase = wantPhase;
      if (d.phase === 2) {
        showBanner('PHASE 2', d.name + ' IS ENRAGED', '#f59e0b', 2.0);
        if (state === 'running') sfx('laser');
        d.tele = null;
        d.fireT = Math.min(d.fireT, 0.55);
      }
    }

    /* Strafe around the player at a respectful distance, or path around
       crates when the line of sight is broken. */
    d.strafeT -= dt;
    if (d.strafeT <= 0) {
      d.strafeT = rnd(1.5, 2.9);
      d.strafeDir = Math.random() < 0.5 ? -1 : 1;
    }
    var toP = Math.atan2(dy, dx);
    var mx = 0, my = 0;
    if (los) {
      var radial = 5.4 + (d.tier % 3) * 0.5;
      var push = clamp((dist - radial) * 0.55, -1, 1);
      mx = Math.cos(toP) * push + Math.cos(toP + Math.PI / 2) * d.strafeDir;
      my = Math.sin(toP) * push + Math.sin(toP + Math.PI / 2) * d.strafeDir;
    } else if (flow) {
      var bcx = Math.floor(d.x), bcy = Math.floor(d.y);
      var here = flow[bcy * MW + bcx];
      var bestV = here < 0 ? 1e9 : here;
      var btx = -1, bty = -1;
      var bnb = [[bcx + 1, bcy], [bcx - 1, bcy], [bcx, bcy + 1], [bcx, bcy - 1]];
      for (var bj = 0; bj < 4; bj++) {
        var bnx = bnb[bj][0], bny = bnb[bj][1];
        if (bnx < 0 || bny < 0 || bnx >= MW || bny >= MH) continue;
        var bv = flow[bny * MW + bnx];
        if (bv >= 0 && bv < bestV) { bestV = bv; btx = bnx; bty = bny; }
      }
      if (btx >= 0) { mx = btx + 0.5 - d.x; my = bty + 0.5 - d.y; }
      else { mx = dx / dist; my = dy / dist; }
    } else {
      mx = dx / dist;
      my = dy / dist;
    }
    var ml = Math.sqrt(mx * mx + my * my) || 1;
    var step = d.speed * (d.phase === 2 ? 1.18 : 1) * dt;
    tryMove(d, mx / ml * step, my / ml * step, 0.4);
    d.face = toP;

    /* Attacks: telegraphed radial, aimed volley, or a summon. */
    if (d.tele) {
      d.tele.t -= dt;
      if (d.tele.t <= 0) {
        var kind = d.tele.kind;
        var n, a, i;
        d.tele = null;
        d.fireT = d.interval * (d.phase === 2 ? 0.62 : 1);
        if (kind === 'radial') {
          n = d.radial + (d.phase === 2 ? 4 : 0);
          d.cycle++;
          var offset = d.phase === 2 ? (d.cycle * 0.33) : 0;
          for (i = 0; i < n; i++) {
            a = offset + i / n * TAU;
            fireOrb(d.x, d.y, a, d.orbSpeed * 0.72, d.dmg * 0.8, true);
          }
          if (state === 'running') sfx('shoot');
        } else if (kind === 'volley') {
          n = d.phase === 2 ? 4 : 3;
          for (i = 0; i < n; i++) {
            a = toP + (i - (n - 1) / 2) * 0.075;
            fireOrb(d.x, d.y, a, d.orbSpeed * 1.18, d.dmg, true);
          }
          if (state === 'running') sfx('laser');
        } else {
          /* summon escorts near the boss, capped so it cannot swarm forever */
          var alive = 0;
          for (i = 0; i < drones.length; i++) if (drones[i].type !== 'boss') alive++;
          var canSummon = Math.min(2 + (d.phase === 2 ? 1 : 0), d.escortCap - alive);
          for (i = 0; i < canSummon; i++) {
            var ang = rnd(0, TAU);
            spawnDrone(pickEscortType(), {
              x: clamp(d.x + Math.cos(ang) * 1.6, 1.5, MW - 1.5),
              y: clamp(d.y + Math.sin(ang) * 1.6, 1.5, MH - 1.5)
            });
          }
          if (canSummon > 0 && state === 'running') sfx('dash');
        }
      }
    } else if (los && dist < 16) {
      d.fireT -= dt;
      if (d.fireT <= 0) {
        var choice = d.cycle % 3;
        if (choice === 2) {
          var escAlive = 0;
          for (var e = 0; e < drones.length; e++) if (drones[e].type !== 'boss') escAlive++;
          if (escAlive >= d.escortCap) choice = 0;
        }
        d.tele = {
          kind: choice === 0 ? 'radial' : choice === 1 ? 'volley' : 'summon',
          t: (choice === 1 ? 0.6 : 0.8) * (d.phase === 2 ? 0.75 : 1),
          total: 0.8
        };
        d.tele.total = d.tele.t;
        d.cycle++;
      }
    }
  }

  function updateDrones(dt) {
    var i, d;
    flowT -= dt;
    if (flowT <= 0) { buildFlow(); flowT = 0.35; }

    for (i = drones.length - 1; i >= 0; i--) {
      d = drones[i];
      if (d.type === 'boss') { updateBoss(d, dt); continue; }
      if (d.flash > 0) d.flash -= dt;

      var dx = player.x - d.x, dy = player.y - d.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var los = dist < 0.001 || !losBlocked(d.x, d.y, player.x, player.y);
      var toP = Math.atan2(dy, dx);

      /* Bulwarks turn slowly, so circling them exposes the unshielded rear. */
      if (d.turn) {
        var turnBy = clamp(normAng(toP - d.face), -d.turn * dt, d.turn * dt);
        d.face = normAng(d.face + turnBy);
      }

      /* Sniper: telegraph, then a fast predictive rail orb. */
      if (d.teleLen) {
        if (d.aimT > 0) {
          d.aimT -= dt;
          if (d.aimT <= 0) {
            var railAng = Math.atan2(d.aimY - d.y, d.aimX - d.x);
            fireOrb(d.x, d.y, railAng, d.orbSpeed, d.dmg, false);
            if (state === 'running') sfx('laser');
          }
        } else {
          d.fireT -= dt;
          if (d.fireT <= 0 && los && dist > 5.5 && dist < 20) {
            d.fireT = d.interval;
            d.aimT = d.teleLen;
            d.aimX = player.x + player.vx * 0.5;
            d.aimY = player.y + player.vy * 0.5;
            if (state === 'running') sfx('point');
          }
        }
      }

      if (los && dist < 6.2 && !d.aimT && !d.teleLen) {
        if (d.burstMax) {
          if (d.burstLeft > 0) {
            d.burstT -= dt;
            if (d.burstT <= 0) {
              d.burstT = 0.15;
              d.burstLeft--;
              fireOrb(d.x, d.y, toP + rnd(-0.09, 0.09), d.orbSpeed, d.dmg, false);
            }
          } else {
            d.fireT -= dt;
            if (d.fireT <= 0) {
              d.fireT = d.interval;
              d.burstLeft = d.burstMax;
              d.burstT = 0;
            }
          }
        } else {
          d.fireT -= dt;
          if (d.fireT <= 0) {
            d.fireT = d.interval;
            fireOrb(d.x, d.y, toP + rnd(-0.07, 0.07), d.orbSpeed, d.dmg, false);
          }
        }
      }

      var strafe = d.type === 'stinger' ? 1 : 0;
      var holdAt = d.type === 'stinger' ? 4.6 : d.type === 'bulwark' ? 3.2
                 : d.type === 'sniper' ? 8.0 : 3.4;
      if (los && dist < (d.type === 'stinger' ? 7.4 : d.type === 'sniper' ? 11 : 6.2)) {
        if (strafe) {
          /* Stingers orbit instead of charging, making them awkward targets. */
          var orbit = toP + Math.PI / 2 * (Math.sin(d.wob) > 0 ? 1 : -1);
          var radialPush = clamp((dist - holdAt) * 0.5, -1, 1);
          var ovx = Math.cos(orbit) + Math.cos(toP) * radialPush;
          var ovy = Math.sin(orbit) + Math.sin(toP) * radialPush;
          var ol = Math.sqrt(ovx * ovx + ovy * ovy) || 1;
          tryMove(d, ovx / ol * d.speed * 0.8 * dt, ovy / ol * d.speed * 0.8 * dt, 0.26);
        } else if (d.type === 'sniper') {
          /* Snipers hold a long lane: back off when crowded, close when far. */
          var sr = dist < 6 ? -1 : (dist > 10 ? 1 : 0);
          if (sr) tryMove(d, dx / (dist || 1) * d.speed * sr * dt, dy / (dist || 1) * d.speed * sr * dt, 0.26);
        } else if (dist > holdAt) {
          tryMove(d, dx / (dist || 1) * d.speed * 0.55 * dt, dy / (dist || 1) * d.speed * 0.55 * dt, 0.26);
        }
      } else {
        var mvx = 0, mvy = 0;
        if (los) { mvx = dx / (dist || 1); mvy = dy / (dist || 1); }
        else if (flow) {
          var cx = Math.floor(d.x), cy = Math.floor(d.y);
          var here = flow[cy * MW + cx];
          var bestV = here < 0 ? 1e9 : here;
          var tx = -1, ty = -1;
          var nb = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
          for (var j = 0; j < 4; j++) {
            var nx = nb[j][0], ny = nb[j][1];
            if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
            var v = flow[ny * MW + nx];
            if (v >= 0 && v < bestV) { bestV = v; tx = nx; ty = ny; }
          }
          if (tx >= 0) { mvx = (tx + 0.5 - d.x); mvy = (ty + 0.5 - d.y); }
          else { mvx = dx / (dist || 1); mvy = dy / (dist || 1); }
        } else { mvx = dx / (dist || 1); mvy = dy / (dist || 1); }
        var ml = Math.sqrt(mvx * mvx + mvy * mvy) || 1;
        tryMove(d, mvx / ml * d.speed * dt, mvy / ml * d.speed * dt, 0.26);
      }
    }

    for (i = orbs.length - 1; i >= 0; i--) {
      var o = orbs[i];
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (isSolid(Math.floor(o.x), Math.floor(o.y))) {
        puffs.push({ x: o.x, y: o.y, t: 0, life: 0.25 });
        orbs.splice(i, 1);
        continue;
      }
      var ddx = o.x - player.x, ddy = o.y - player.y;
      var hitR = o.boss ? 0.20 : 0.14;
      if (ddx * ddx + ddy * ddy < hitR) {
        var taken = o.dmg * (godMode ? 0 : 1);
        hp -= taken;
        damageFlash = 0.5;
        shake = o.boss ? 11 : 8;
        combo = 1; comboT = 0;
        sfx('thud');
        orbs.splice(i, 1);
        updateHud();
        if (hp <= 0) { hp = 0; gameOver(); return; }
      }
    }
  }


  /* ---------------- shooting ---------------- */

  function beginReload() {
    var w = weapon();
    if (isReloading() || ammo[gun] >= w.mag) return false;
    reloadT[gun] = w.reloadTime;
    sfx('reload');
    updateHud(true);
    return true;
  }

  function pickTarget() {
    var rdx = Math.cos(player.dir), rdy = Math.sin(player.dir);
    var horizon = horizonY();
    /* The crosshair ray must reach the drone: otherwise a corner between the
       reticle and the drone would silently swallow the shot. */
    var wallDist = castRay(player.x, player.y, rdx, rdy).dist;
    var best = null, bestDist = 1e9;
    for (var i = 0; i < drones.length; i++) {
      var d = drones[i];
      var vx = d.x - player.x, vy = d.y - player.y;
      var along = vx * rdx + vy * rdy;
      if (along <= 0.3 || along > 26 || along > wallDist) continue;
      var perp = Math.abs(vx * rdy - vy * rdx);
      if (perp > 0.34 * d.scale) continue;
      /* Match the projection used by renderSprites so the reticle has to sit
         on the drone's drawn body, not merely on its compass bearing. */
      var size = Math.abs(H / along) * 0.9 * d.scale;
      var baseY = horizon + (H * 0.5) / along - (d.alt || 0) * (H / along);
      var top = baseY - size * 0.90;
      var bot = baseY - size * 0.20;
      if (aimY < top || aimY > bot) continue;
      if (along >= bestDist) continue;
      if (losBlocked(player.x, player.y, d.x, d.y)) continue;
      bestDist = along;
      best = d;
    }
    return best ? { drone: best, dist: bestDist } : null;
  }

  function onBossDeath(d) {
    bossKills++;
    boss = null;
    bossWarn = 0;
    shake = 16;
    for (var i = 0; i < 12; i++) {
      puffs.push({
        x: d.x + rnd(-0.55, 0.55), y: d.y + rnd(-0.55, 0.55),
        t: -i * 0.03, life: rnd(0.45, 0.8)
      });
    }
    /* Boss death pops the escorts, clears incoming fire and empties the queue
       so the wave can only resolve through this payout. */
    var shock = drones.slice();
    for (var e = 0; e < shock.length; e++) {
      var escort = shock[e];
      if (escort.type === 'boss') continue;
      var ei = drones.indexOf(escort);
      if (ei >= 0) drones.splice(ei, 1);
      kills++;
      credits += escort.creditsPay;
      score += escort.scoreBase * combo;
      puffs.push({ x: escort.x, y: escort.y, t: 0, life: 0.5 });
    }
    queue.length = 0;
    orbs.length = 0;
    showBanner('BOSS DOWN', d.name + ' DESTROYED · WAVE CLEAR', '#2ee6a6', 2.6);
    if (state === 'running') { sfx('explode'); sfx('win'); }
    updateHud(true);
  }

  function killDrone(d) {
    var idx = drones.indexOf(d);
    if (idx >= 0) drones.splice(idx, 1);
    kills++;
    credits += d.creditsPay;
    if (comboT > 0) combo = Math.min(10, combo + 1);
    else combo = 1;
    comboT = 2.6;
    score += d.scoreBase * combo;
    puffs.push({ x: d.x, y: d.y, t: 0, life: 0.45 });
    sfx('explode');
    if (d.type === 'boss') onBossDeath(d);
    updateHud();
  }

  function shoot() {
    var w = weapon();
    if (state !== 'running' || phase !== 'wave') return;
    if (isReloading() || fireCd > 0) return;
    if (ammo[gun] <= 0) { beginReload(); return; }
    fireCd = fireCooldown();
    ammo[gun]--;
    shots++;
    muzzle = w.id === 'rifle' ? 0.09 : 0.06;
    tracer = 1;
    recoil = w.recoil;
    shake = Math.max(shake, 1.6 + w.recoil * 0.8);
    sfx(w.sfx);
    if (w.sfx2) sfx(w.sfx2);

    var rdx = Math.cos(player.dir), rdy = Math.sin(player.dir);
    var target = pickTarget();
    var wallHit = castRay(player.x, player.y, rdx, rdy).dist;
    lastShot = { hit: !!(target && target.dist < wallHit), dist: target ? target.dist : 0, wall: wallHit };
    if (target && target.dist < wallHit) {
      var hitD2 = target.drone;
      var mult = damageMultiplier(target.dist);
      var dmg = (w.damage + upgrades.dmg) * mult;
      var resisted = false;
      /* Bulwark front plate: only shots into the shield arc are reduced.
         Circling it exposes the flanks and rear at full damage. */
      if (hitD2.frontResist && hitD2.frontResist < 1) {
        var toPlayer = Math.atan2(player.y - hitD2.y, player.x - hitD2.x);
        if (Math.abs(normAng(hitD2.face - toPlayer)) < 1.0) {
          dmg *= hitD2.frontResist;
          resisted = true;
        }
      }
      hitMarker = 1;
      hits++;
      lastHit = { dist: target.dist, dmg: dmg, mult: mult, resisted: resisted };
      hitD2.hp -= dmg;
      hitD2.flash = 0.12;
      score += 5;
      sfx('hit');
      hitPops.push({
        x: W / 2 + rnd(-11, 11), y: aimY - 12,
        t: 0, life: 0.65, val: dmg, mult: mult, resisted: resisted
      });
      if (hitPops.length > 24) hitPops.shift();
      if (hitD2.hp <= 0) killDrone(hitD2);
    }
    if (ammo[gun] <= 0) beginReload();
  }

  /* ---------------- state transitions ---------------- */

  function start() {
    wave = 1; score = 0; hp = 100; maxHp = 100;
    credits = 0; kills = 0; shots = 0; bossKills = 0; combo = 1; comboT = 0;
    upgrades.fire = upgrades.dmg = upgrades.armor = 0;
    drones.length = 0; orbs.length = 0; puffs.length = 0;
    hitPops.length = 0;
    boss = null; bossWarn = 0; bossName = ''; bossTier = 0;
    bannerT = 0;
    aimY = H / 2;
    gunY = VM_BASE_Y;
    lastHit = { dist: 0, dmg: 0, mult: 1, resisted: false };
    lastShot = { hit: false, dist: 0, wall: 0 };
    hits = 0;
    player.x = 10.5; player.y = 10.5; player.dir = 0;
    player.vx = player.vy = 0;
    gun = 0; fireCd = 0;
    for (var i = 0; i < WEAPONS.length; i++) {
      ammo[i] = WEAPONS[i].mag;
      reloadT[i] = 0;
    }
    releaseKeys();
    state = 'running';
    startWave();
    last = now();
    GameShell.overlay.hide();
    ensureLoop();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    releaseKeys();
    try {
      if (document.exitPointerLock && document.pointerLockElement === canvas) document.exitPointerLock();
    } catch (e) { /* ignore */ }
    updateHud(true);
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The drones will wait. Briefly.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Wave', value: wave },
        { label: 'HP', value: Math.max(0, Math.ceil(hp)) }
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
    updateHud(true);
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
    sfx('lose');
    updateHud(true);
    GameShell.overlay.show({
      title: isBest ? 'New high score!' : 'Overrun',
      msg: 'The swarm took the arena on wave ' + wave + ' (' + threatName(waveThreat(wave)) +
           ' threat). You scored ' + score + ' point' + (score === 1 ? '' : 's') +
           ', disabled ' + kills + ' drones and broke ' + bossKills + ' boss' +
           (bossKills === 1 ? '' : 'es') + '.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Wave', value: wave },
        { label: 'Kills', value: kills },
        { label: 'Bosses', value: bossKills }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  function releaseKeys() {
    keys.f = keys.b = keys.l = keys.r = false;
    keys.turnL = keys.turnR = keys.fire = keys.jump = false;
    keys.aimUp = keys.aimDown = false;
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    var i;

    /* jump / gravity */
    if (keys.jump && player.onGround) {
      player.vz = JUMP_VEL;
      player.onGround = false;
      keys.jump = false;
      sfx('jump');
    }
    player.z += player.vz * dt;
    player.vz -= GRAVITY * dt;
    if (player.z < 0) {
      player.z = 0;
      player.vz = 0;
      player.onGround = true;
    }

    if (keys.aimUp) aimY -= AIM_KEY_SPEED * dt;
    if (keys.aimDown) aimY += AIM_KEY_SPEED * dt;
    aimY = clampAim(aimY);

    /* The right-hand viewmodel tracks the reticle smoothly. The clamp only
       bites at the far ends, keeping the whole silhouette on screen. */
    var aimT = (aimY - H / 2) / AIM_MARGIN;
    var gunTarget = VM_BASE_Y + aimT * VM_AIM_TRAVEL;
    gunY += (gunTarget - gunY) * Math.min(1, dt * 12);
    gunY = clamp(gunY, H * 0.24, H * 0.80);

    if (comboT > 0) {
      comboT -= dt;
      if (comboT <= 0) combo = 1;
    }
    if (flashBanner > 0) flashBanner -= dt;
    if (bannerT > 0) bannerT -= dt;
    if (bossWarn > 0) bossWarn -= dt;

    /* movement */
    var turn = 2.5 * dt;
    if (keys.turnL) player.dir -= turn;
    if (keys.turnR) player.dir += turn;
    player.dir = normAng(player.dir);

    var px0 = player.x, py0 = player.y;
    var mx = 0, my = 0;
    var cdir = Math.cos(player.dir), sdir = Math.sin(player.dir);
    if (keys.f) { mx += cdir; my += sdir; }
    if (keys.b) { mx -= cdir; my -= sdir; }
    if (keys.l) { mx += sdir; my -= cdir; }
    if (keys.r) { mx -= sdir; my += cdir; }
    var ml = Math.sqrt(mx * mx + my * my);
    if (ml > 0) {
      var sp = 3.1 * dt / ml;
      tryMove(player, mx * sp, my * sp, 0.22);
      bobT += dt * 9;
      bob = Math.sin(bobT) * 3.2;
    } else {
      bob *= 0.9;
    }
    /* Measured velocity feeds the Sniper's predictive rail shot. */
    if (dt > 0) {
      player.vx = (player.x - px0) / dt;
      player.vy = (player.y - py0) / dt;
    }

    /* firing / reload */
    if (fireCd > 0) fireCd -= dt;
    if (keys.fire) shoot();
    if (reloadT[gun] > 0) {
      reloadT[gun] -= dt;
      if (reloadT[gun] <= 0) {
        reloadT[gun] = 0;
        ammo[gun] = weapon().mag;
        sfx('select');
      }
    }

    if (phase === 'wave') {
      var diffNow = waveDifficulty(wave);
      if (queue.length && drones.length < diffNow.maxAlive) {
        spawnT -= dt;
        if (spawnT <= 0) {
          spawnT = diffNow.spawnGap;
          spawnDrone(queue.shift());
        }
      }
      if (!queue.length && !drones.length) {
        waveEndT += dt;
        if (waveEndT > 0.45) {
          /* wave cleared — breather + upgrade menu */
          phase = 'breather';
          breatherT = 3.2;
          drones.length = 0;
          orbs.length = 0;
          boss = null;
          bossWarn = 0;
          hp = Math.min(maxHp, hp + 30);
          /* Deliberate between-wave resupply: every magazine is topped up. */
          for (i = 0; i < WEAPONS.length; i++) {
            ammo[i] = WEAPONS[i].mag;
            reloadT[i] = 0;
          }
          combo = 1;
          comboT = 0;
          sfx('win');
          showBanner('WAVE ' + wave + ' CLEAR', 'THREAT ' + diffNow.tier + ' · ' + diffNow.name +
                     ' · next wave ' + (wave + 1), '#2ee6a6', 2.0);
          try {
            if (document.exitPointerLock && document.pointerLockElement) document.exitPointerLock();
          } catch (e) { /* pointer lock unavailable */ }
          updateHud(true);
        }
      }
    } else if (phase === 'breather') {
      breatherT -= dt;
      if (breatherT <= 0) {
        wave++;
        startWave();
        return;
      }
    }

    if (drones.length || orbs.length) updateDrones(dt);
    else { flowT -= dt; if (flowT <= 0) { buildFlow(); flowT = 0.35; } }

    /* fx timers */
    for (i = puffs.length - 1; i >= 0; i--) {
      puffs[i].t += dt;
      if (puffs[i].t >= puffs[i].life) puffs.splice(i, 1);
    }
    for (i = hitPops.length - 1; i >= 0; i--) {
      hitPops[i].t += dt;
      if (hitPops[i].t >= hitPops[i].life) hitPops.splice(i, 1);
    }
    if (hitMarker > 0) hitMarker -= dt * 3.2;
    if (damageFlash > 0) damageFlash -= dt * 1.7;
    if (shake > 0) shake = Math.max(0, shake - dt * 26);
    if (muzzle > 0) muzzle -= dt;
    if (recoil > 0) recoil = Math.max(0, recoil - dt * 7);
    if (tracer > 0) tracer = Math.max(0, tracer - dt * 10);

    updateHud();
  }

  /* ---------------- rendering: world ---------------- */

  function renderWalls(dirX, dirY, plX, plY, horizon) {
    var g1 = ctx.createLinearGradient(0, 0, 0, horizon);
    g1.addColorStop(0, '#0a0716');
    g1.addColorStop(1, '#1b1633');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, horizon);
    var g2 = ctx.createLinearGradient(0, horizon, 0, H);
    g2.addColorStop(0, '#171230');
    g2.addColorStop(1, '#090714');
    ctx.fillStyle = g2;
    ctx.fillRect(0, horizon, W, H - horizon);
    ctx.fillStyle = 'rgba(139,92,246,.06)';
    ctx.fillRect(0, horizon - 3, W, 6);

    for (var x = 0; x < COLS; x++) {
      var camX = 2 * (x * STRIP) / W - 1;
      var rdx = dirX + plX * camX;
      var rdy = dirY + plY * camX;
      var hit = castRay(player.x, player.y, rdx, rdy);
      var dist = hit.dist;
      zbuf[x] = dist;
      var lineH = H / dist;
      var top = horizon - lineH / 2;
      var base = WALLS[hit.cell] || WALLS['#'];
      var f = clamp(1.12 - dist * 0.082, 0.15, 1) * (hit.side === 1 ? 0.72 : 1);
      if (hit.wallX < 0.05 || hit.wallX > 0.95) f *= 0.55;
      else if (Math.sin(hit.wallX * Math.PI * 4) > 0.86) f *= 0.82;
      var r = base[0] * f + 10 * (1 - f);
      var g = base[1] * f + 8 * (1 - f);
      var b = base[2] * f + 26 * (1 - f);
      ctx.fillStyle = 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
      ctx.fillRect(x * STRIP, top, STRIP, lineH);
    }
  }

  /* ---------------- rendering: sprites ---------------- */

  var DRONE_LOOK = {
    hopper:  { body: '#8b5cf6', dark: '#5b3ea8', eye: '#ff5c7a', trim: '#c4b5fd' },
    runner:  { body: '#22d3ee', dark: '#177e96', eye: '#ff5c7a', trim: '#a5f3fc' },
    heavy:   { body: '#f59e0b', dark: '#9a6a10', eye: '#ff5c7a', trim: '#fde68a' },
    bulwark: { body: '#64748b', dark: '#334155', eye: '#f59e0b', trim: '#cbd5e1' },
    stinger: { body: '#facc15', dark: '#a16207', eye: '#ff2d55', trim: '#fef08a' },
    sniper:  { body: '#e879f9', dark: '#86198f', eye: '#22d3ee', trim: '#f5d0fe' },
    boss:    { body: '#dc2626', dark: '#7f1d1d', eye: '#fbbf24', trim: '#fca5a5' }
  };

  function drawBoss(cx, baseY, size, d, t) {
    var y = baseY - size * 0.5 + Math.sin(t / 260 + d.wob) * size * 0.025;
    var white = d.flash > 0;
    var phase2 = d.phase === 2;
    var body = white ? '#ffffff' : (phase2 ? '#ef4444' : '#b91c1c');
    var dark = white ? '#ffffff' : '#5b0f12';
    var trim = white ? '#ffffff' : (phase2 ? '#fbbf24' : '#f87171');
    var R = size * 0.32;

    ctx.save();
    ctx.translate(cx, y);

    /* Telegraph halo: grows during the wind-up, then snaps away. */
    if (d.tele) {
      var f = clamp(1 - d.tele.t / (d.tele.total || 1), 0, 1);
      ctx.strokeStyle = 'rgba(255,92,122,' + (0.25 + 0.55 * f).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1.5, size * 0.018);
      ctx.beginPath();
      ctx.arc(0, 0, R * (1.2 + 0.55 * f), 0, TAU);
      ctx.stroke();
      if (d.tele.kind === 'volley') {
        ctx.strokeStyle = 'rgba(251,191,36,' + (0.35 + 0.5 * f).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(R * 2.4, 0);
        ctx.stroke();
      }
    }

    /* Counter-rotating outer rings. */
    ctx.strokeStyle = white ? '#ffffff' : 'rgba(248,113,113,.55)';
    ctx.lineWidth = Math.max(1.2, size * 0.02);
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 1.28, R * 0.52, t / 1400, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = white ? '#ffffff' : 'rgba(251,191,36,.45)';
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 1.05, R * 0.4, -t / 1000, 0, TAU);
    ctx.stroke();

    /* Four cannon pods. */
    for (var p = 0; p < 4; p++) {
      var pa = Math.PI / 4 + p * Math.PI / 2;
      var px2 = Math.cos(pa) * R * 0.92, py2 = Math.sin(pa) * R * 0.62;
      ctx.fillStyle = dark;
      rr(px2 - size * 0.06, py2 - size * 0.05, size * 0.12, size * 0.1, size * 0.02);
      ctx.fill();
      ctx.fillStyle = trim;
      ctx.beginPath();
      ctx.arc(px2, py2, Math.max(1.4, size * 0.022), 0, TAU);
      ctx.fill();
    }

    /* Hex hull. */
    ctx.fillStyle = body;
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(1.4, size * 0.018);
    ctx.beginPath();
    for (var h = 0; h < 6; h++) {
      var ha = h / 6 * TAU - Math.PI / 2;
      var hx = Math.cos(ha) * R, hy = Math.sin(ha) * R * 0.78;
      if (h === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    /* Armoured brow and glowing core. */
    ctx.fillStyle = dark;
    rr(-R * 0.62, -R * 0.34, R * 1.24, R * 0.3, size * 0.02);
    ctx.fill();
    var glow = ctx.createRadialGradient(0, R * 0.05, 0, 0, R * 0.05, R * 0.5);
    glow.addColorStop(0, white ? '#ffffff' : (phase2 ? 'rgba(255,220,120,.95)' : 'rgba(251,191,36,.9)'));
    glow.addColorStop(1, 'rgba(248,113,113,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, R * 0.05, R * 0.5, 0, TAU);
    ctx.fill();

    /* Central eye slit. */
    ctx.fillStyle = white ? '#ffe9ee' : (phase2 ? '#fff3c4' : '#fbbf24');
    rr(-R * 0.3, -R * 0.02, R * 0.6, R * 0.16, R * 0.08);
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(-R * 0.05, -R * 0.02, R * 0.1, R * 0.16);

    /* Phase 2 spines. */
    if (phase2 && !white) {
      ctx.strokeStyle = trim;
      ctx.lineWidth = Math.max(1.6, size * 0.016);
      for (var s = 0; s < 6; s++) {
        var sa = s / 6 * TAU + Math.PI / 6;
        ctx.beginPath();
        ctx.moveTo(Math.cos(sa) * R * 0.9, Math.sin(sa) * R * 0.7);
        ctx.lineTo(Math.cos(sa) * R * 1.25, Math.sin(sa) * R * 0.95);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function drawDrone(cx, baseY, size, d, t) {
    if (d.type === 'boss') { drawBoss(cx, baseY, size, d, t); return; }
    var bobY = Math.sin(t / 210 + d.wob) * size * 0.06;
    var y = baseY - size * 0.55 + bobY;
    var white = d.flash > 0;
    var look = DRONE_LOOK[d.type] || DRONE_LOOK.hopper;
    var bodyCol = white ? '#ffffff' : look.body;
    var darkCol = white ? '#ffffff' : look.dark;
    var trimCol = white ? '#ffffff' : look.trim;

    ctx.save();
    ctx.translate(cx, y);

    /* Rotor ring shared by every drone. */
    ctx.strokeStyle = darkCol;
    ctx.lineWidth = Math.max(1.5, size * 0.05);
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.24, size * 0.42, size * 0.1, 0, 0, TAU);
    ctx.stroke();

    if (d.type === 'runner') {
      /* Sleek arrowhead with swept fins. */
      ctx.fillStyle = bodyCol;
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.26);
      ctx.lineTo(size * 0.33, size * 0.16);
      ctx.lineTo(0, size * 0.05);
      ctx.lineTo(-size * 0.33, size * 0.16);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = trimCol;
      ctx.lineWidth = Math.max(1, size * 0.035);
      ctx.beginPath();
      ctx.moveTo(-size * 0.26, size * 0.12);
      ctx.lineTo(0, -size * 0.12);
      ctx.lineTo(size * 0.26, size * 0.12);
      ctx.stroke();
      ctx.fillStyle = white ? '#ffe9ee' : look.eye;
      ctx.beginPath();
      ctx.arc(0, size * 0.02, Math.max(1.4, size * 0.06), 0, TAU);
      ctx.fill();
    } else if (d.type === 'heavy') {
      /* Wide armoured carrier with two shoulder pods. */
      ctx.fillStyle = darkCol;
      rr(-size * 0.44, -size * 0.12, size * 0.2, size * 0.26, size * 0.05);
      ctx.fill();
      rr(size * 0.24, -size * 0.12, size * 0.2, size * 0.26, size * 0.05);
      ctx.fill();
      ctx.fillStyle = bodyCol;
      rr(-size * 0.3, -size * 0.2, size * 0.6, size * 0.38, size * 0.09);
      ctx.fill();
      ctx.fillStyle = trimCol;
      rr(-size * 0.24, -size * 0.16, size * 0.48, size * 0.07, size * 0.03);
      ctx.fill();
      ctx.fillStyle = white ? '#ffe9ee' : look.eye;
      ctx.beginPath();
      ctx.arc(0, size * 0.09, Math.max(1.6, size * 0.075), 0, TAU);
      ctx.fill();
      ctx.strokeStyle = darkCol;
      ctx.lineWidth = Math.max(1, size * 0.04);
      ctx.beginPath();
      ctx.moveTo(-size * 0.17, size * 0.2);
      ctx.lineTo(-size * 0.22, size * 0.36);
      ctx.moveTo(size * 0.17, size * 0.2);
      ctx.lineTo(size * 0.22, size * 0.36);
      ctx.stroke();
    } else if (d.type === 'bulwark') {
      /* Slow slab: a big frontal shield plate with a bright amber seam.
         Chips appear as health drops. */
      ctx.fillStyle = darkCol;
      rr(-size * 0.38, -size * 0.24, size * 0.76, size * 0.22, size * 0.05);
      ctx.fill();
      ctx.fillStyle = bodyCol;
      ctx.beginPath();
      ctx.moveTo(-size * 0.4, -size * 0.06);
      ctx.lineTo(size * 0.4, -size * 0.06);
      ctx.lineTo(size * 0.3, size * 0.42);
      ctx.lineTo(-size * 0.3, size * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = trimCol;
      ctx.lineWidth = Math.max(1.2, size * 0.03);
      ctx.stroke();
      ctx.fillStyle = white ? '#ffe9ee' : look.eye;
      rr(-size * 0.2, size * 0.06, size * 0.4, size * 0.06, size * 0.02);
      ctx.fill();
      /* rivets */
      ctx.fillStyle = 'rgba(15,23,42,.55)';
      var rv;
      for (rv = 0; rv < 3; rv++) {
        ctx.beginPath();
        ctx.arc(-size * 0.22 + rv * size * 0.22, size * 0.3, Math.max(1, size * 0.022), 0, TAU);
        ctx.fill();
      }
      /* battle damage scales with missing health */
      var hurt = 1 - clamp(d.hp / d.maxHp, 0, 1);
      if (hurt > 0.15 && !white) {
        ctx.strokeStyle = 'rgba(15,23,42,' + (0.3 + hurt * 0.5).toFixed(2) + ')';
        ctx.lineWidth = Math.max(1, size * 0.02);
        ctx.beginPath();
        ctx.moveTo(-size * 0.1, size * 0.1);
        ctx.lineTo(size * 0.06, size * 0.22);
        ctx.lineTo(-size * 0.02, size * 0.34);
        ctx.moveTo(size * 0.2, size * 0.14);
        ctx.lineTo(size * 0.12, size * 0.28);
        ctx.stroke();
      }
    } else if (d.type === 'stinger') {
      /* Needle drone: diamond core, long side prongs. */
      ctx.strokeStyle = trimCol;
      ctx.lineWidth = Math.max(1.2, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(-size * 0.1, 0);
      ctx.lineTo(-size * 0.46, -size * 0.08);
      ctx.moveTo(size * 0.1, 0);
      ctx.lineTo(size * 0.46, -size * 0.08);
      ctx.stroke();
      ctx.fillStyle = bodyCol;
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.3);
      ctx.lineTo(size * 0.22, size * 0.08);
      ctx.lineTo(0, size * 0.26);
      ctx.lineTo(-size * 0.22, size * 0.08);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = white ? '#ffe9ee' : look.eye;
      ctx.beginPath();
      ctx.arc(0, size * 0.03, Math.max(1.4, size * 0.065), 0, TAU);
      ctx.fill();
      /* burst vents */
      ctx.fillStyle = darkCol;
      ctx.fillRect(-size * 0.04, size * 0.18, size * 0.08, size * 0.12);
    } else if (d.type === 'sniper') {
      /* Tall rail drone with a scope lens and long emitter. */
      ctx.fillStyle = darkCol;
      rr(-size * 0.16, -size * 0.32, size * 0.32, size * 0.48, size * 0.07);
      ctx.fill();
      ctx.fillStyle = bodyCol;
      rr(-size * 0.11, -size * 0.26, size * 0.22, size * 0.34, size * 0.06);
      ctx.fill();
      ctx.strokeStyle = trimCol;
      ctx.lineWidth = Math.max(1.2, size * 0.035);
      ctx.beginPath();
      ctx.moveTo(0, size * 0.1);
      ctx.lineTo(0, size * 0.5);
      ctx.stroke();
      ctx.fillStyle = white ? '#ffffff' : look.eye;
      ctx.beginPath();
      ctx.arc(0, -size * 0.18, Math.max(1.4, size * 0.07), 0, TAU);
      ctx.fill();
      /* charging rail glow during the telegraph */
      if (d.aimT > 0 && !white) {
        var ch = 1 - clamp(d.aimT / (d.teleLen || 1), 0, 1);
        ctx.strokeStyle = 'rgba(34,211,238,' + (0.25 + 0.65 * ch).toFixed(2) + ')';
        ctx.lineWidth = Math.max(1, size * 0.03);
        ctx.beginPath();
        ctx.moveTo(0, size * 0.1);
        ctx.lineTo(0, size * (0.5 + ch * 0.4));
        ctx.stroke();
      }
      /* side vanes */
      ctx.fillStyle = darkCol;
      ctx.beginPath();
      ctx.moveTo(-size * 0.16, size * 0.14);
      ctx.lineTo(-size * 0.3, size * 0.3);
      ctx.lineTo(-size * 0.16, size * 0.28);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(size * 0.16, size * 0.14);
      ctx.lineTo(size * 0.3, size * 0.3);
      ctx.lineTo(size * 0.16, size * 0.28);
      ctx.closePath();
      ctx.fill();
    } else {
      /* Hopper: the original rounded chassis. */
      ctx.fillStyle = bodyCol;
      rr(-size * 0.28, -size * 0.18, size * 0.56, size * 0.36, size * 0.1);
      ctx.fill();
      ctx.fillStyle = white ? '#ffe9ee' : look.eye;
      ctx.beginPath();
      ctx.arc(0, size * 0.1, Math.max(1.5, size * 0.07), 0, TAU);
      ctx.fill();
      ctx.strokeStyle = darkCol;
      ctx.lineWidth = Math.max(1, size * 0.04);
      ctx.beginPath();
      ctx.moveTo(-size * 0.16, size * 0.18);
      ctx.lineTo(-size * 0.2, size * 0.34);
      ctx.moveTo(size * 0.16, size * 0.18);
      ctx.lineTo(size * 0.2, size * 0.34);
      ctx.stroke();
    }
    ctx.restore();

    /* health bar for tough drones */
    if (d.maxHp > 2 && !white) {
      var bw = size * (d.type === 'bulwark' ? 0.56 : 0.4);
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(cx - bw / 2, y - size * 0.46, bw, Math.max(2, size * 0.05));
      ctx.fillStyle = d.type === 'bulwark' ? '#f59e0b' : '#2ee6a6';
      ctx.fillRect(cx - bw / 2, y - size * 0.46, bw * clamp(d.hp / d.maxHp, 0, 1), Math.max(2, size * 0.05));
    }
  }

  function drawOrb(cx, cy, size, bossShot) {
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.5);
    if (bossShot) {
      g.addColorStop(0, 'rgba(255,235,200,.98)');
      g.addColorStop(0.45, 'rgba(248,113,113,.9)');
      g.addColorStop(1, 'rgba(220,38,38,0)');
    } else {
      g.addColorStop(0, 'rgba(230,200,255,.95)');
      g.addColorStop(0.45, 'rgba(168,120,255,.8)');
      g.addColorStop(1, 'rgba(140,80,255,0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.5, 0, TAU);
    ctx.fill();
  }

  function drawPuff(cx, baseY, size, p) {
    if (p.t < 0) return;
    var f = clamp(1 - p.t / p.life, 0, 1);
    ctx.fillStyle = 'rgba(180,210,255,' + (0.5 * f).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(cx, baseY - size * 0.4, size * (0.2 + 0.3 * (1 - f)), 0, TAU);
    ctx.fill();
  }

  function renderSprites(dirX, dirY, plX, plY, horizon, t) {
    var list = [];
    var i;
    for (i = 0; i < drones.length; i++) {
      var d = drones[i];
      list.push({ x: d.x - player.x, y: d.y - player.y, kind: 'drone', ref: d, scale: 0.9 * d.scale, alt: d.alt || 0 });
    }
    for (i = 0; i < orbs.length; i++) {
      var o = orbs[i];
      list.push({ x: o.x - player.x, y: o.y - player.y, kind: 'orb', ref: o, scale: o.boss ? 0.66 : 0.42 });
    }
    for (i = 0; i < puffs.length; i++) {
      var pf = puffs[i];
      list.push({ x: pf.x - player.x, y: pf.y - player.y, kind: 'puff', ref: pf, scale: 0.7 });
    }

    var invDet = 1 / (plX * dirY - dirX * plY);
    for (i = 0; i < list.length; i++) {
      var s = list[i];
      s.trY = invDet * (-plY * s.x + plX * s.y);
      s.trX = invDet * (dirY * s.x - dirX * s.y);
    }
    list.sort(function (a, b2) { return b2.trY - a.trY; });

    for (i = 0; i < list.length; i++) {
      var s2 = list[i];
      if (s2.trY <= 0.15) continue;
      var screenX = (W / 2) * (1 + s2.trX / s2.trY);
      var size = Math.abs(H / s2.trY) * s2.scale;
      var baseY = horizon + (H * 0.5) / s2.trY - (s2.alt || 0) * (H / s2.trY);
      if (screenX < -size || screenX > W + size) continue;

      var halfW = size * (s2.kind === 'orb' ? 0.5 : 0.46);
      var x0 = Math.max(0, Math.ceil(screenX - halfW));
      var x1 = Math.min(W - STRIP, Math.floor(screenX + halfW));
      if (x1 < x0) continue;

      var runs = [], runStart = -1, sx;
      for (sx = x0; sx <= x1; sx += STRIP) {
        var vis = s2.trY < zbuf[(sx / STRIP) | 0];
        if (vis && runStart < 0) runStart = sx;
        if ((!vis || sx + STRIP > x1) && runStart >= 0) {
          runs.push([runStart, sx + (vis ? STRIP : 0)]);
          runStart = -1;
        }
      }
      if (!runs.length) continue;

      ctx.save();
      ctx.beginPath();
      for (var r = 0; r < runs.length; r++) ctx.rect(runs[r][0], 0, runs[r][1] - runs[r][0], H);
      ctx.clip();
      if (s2.kind === 'drone') drawDrone(screenX, baseY, size, s2.ref, t);
      else if (s2.kind === 'orb') drawOrb(screenX, baseY - size * 0.45, size, s2.ref.boss);
      else drawPuff(screenX, baseY, size, s2.ref);
      ctx.restore();
    }
  }

  /* ---------------- rendering: viewmodel + overlays ---------------- */

  /* First-person geometry: the grip anchors at the lower right while the
     receiver runs up/forward toward the centre. The muzzle sits just below
     and right of the reticle, so the barrel reads as receding into the
     screen instead of a left-facing side profile. Recoil kicks it up/right. */
  function viewmodelGeom() {
    var w = weapon();
    /* A fixed forward/up barrel vector keeps the gun pointing into the
       screen at every aim height. The grip still tracks `gunY`, so the
       whole weapon rises and dips with the reticle without flattening
       into the old left-facing side profile. */
    var gx = W - 52 + recoil * 10;
    var gy = gunY + 94 - recoil * 13 + bob * 0.55;
    var mx = W * 0.62 - (w.len - 186) * 0.28 - recoil * 7;
    var my = gunY - 30 - recoil * 18 + bob * 0.30;
    var dx = mx - gx, dy = my - gy;
    return {
      w: w, x: gx, y: gy, gripX: gx, gripY: gy,
      muzzleX: mx, muzzleY: my, dx: dx, dy: dy,
      len: Math.sqrt(dx * dx + dy * dy),
      angle: Math.atan2(dy, dx)
    };
  }

  /* Local frame: +x runs down the barrel toward the muzzle, +y is the top
     face of the gun (screen-up side). "Below" the gun is -y. */
  function vmTaper(x0, x1, w0, w1, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x0, -w0);
    ctx.lineTo(x1, -w1);
    ctx.lineTo(x1, w1);
    ctx.lineTo(x0, w0);
    ctx.closePath();
    ctx.fill();
  }

  function vmTop(x0, x1, w0, w1, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x0, w0 * 0.2);
    ctx.lineTo(x1, w1 * 0.2);
    ctx.lineTo(x1, w1);
    ctx.lineTo(x0, w0);
    ctx.closePath();
    ctx.fill();
  }

  function vmQuad(ax, ay, bx, by, cx, cy, dx2, dy2, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.lineTo(dx2, dy2);
    ctx.closePath();
    ctx.fill();
  }

  function vmMuzzle(L, w) {
    ctx.fillStyle = '#0b0a14';
    ctx.beginPath();
    ctx.arc(L, 0, L * 0.058, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = w.accent;
    ctx.lineWidth = Math.max(1.4, L * 0.012);
    ctx.beginPath();
    ctx.arc(L, 0, L * 0.052, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.beginPath();
    ctx.arc(L - L * 0.012, L * 0.016, L * 0.022, 0, TAU);
    ctx.fill();
  }

  function drawVmArm(L) {
    /* Forearm and sleeve enter from the lower right of the screen,
       which is the -x / -y corner of the rotated gun frame. */
    ctx.fillStyle = '#221c3c';
    ctx.beginPath();
    ctx.moveTo(-L * 0.10, -L * 0.10);
    ctx.lineTo(-L * 0.46, -L * 0.44);
    ctx.lineTo(-L * 0.22, -L * 0.76);
    ctx.lineTo(L * 0.08, -L * 0.36);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3a2f63';
    ctx.beginPath();
    ctx.moveTo(-L * 0.46, -L * 0.44);
    ctx.lineTo(-L * 0.64, -L * 0.60);
    ctx.lineTo(-L * 0.42, -L * 0.88);
    ctx.lineTo(-L * 0.22, -L * 0.76);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#4a3c80';
    ctx.beginPath();
    ctx.moveTo(-L * 0.06, -L * 0.32);
    ctx.lineTo(L * 0.16, -L * 0.18);
    ctx.lineTo(L * 0.06, -L * 0.42);
    ctx.lineTo(-L * 0.14, -L * 0.48);
    ctx.closePath();
    ctx.fill();
  }

  function drawVmGrip(L) {
    /* Stock behind the grip. */
    vmTaper(-L * 0.30, -L * 0.02, L * 0.105, L * 0.14, '#241d3f');
    vmTop(-L * 0.30, -L * 0.02, L * 0.105, L * 0.14, '#3a2f63');
    /* Pistol grip hanging below the receiver. */
    vmQuad(L * 0.02, -L * 0.02, L * 0.17, -L * 0.02,
           L * 0.06, -L * 0.40, -L * 0.10, -L * 0.36, '#1d1838');
    ctx.strokeStyle = '#4a3c80';
    ctx.lineWidth = Math.max(1, L * 0.012);
    ctx.beginPath();
    ctx.moveTo(L * 0.035, -L * 0.12);
    ctx.lineTo(L * 0.105, -L * 0.10);
    ctx.stroke();
    /* Trigger guard. */
    ctx.strokeStyle = '#141126';
    ctx.lineWidth = Math.max(1.5, L * 0.018);
    ctx.beginPath();
    ctx.arc(L * 0.13, -L * 0.03, L * 0.075, 0.15, Math.PI * 0.95);
    ctx.stroke();
  }

  function drawBlasterModel(w, L) {
    drawVmGrip(L);
    /* Chunky receiver, short shroud, glowing capacitor. */
    vmTaper(-L * 0.02, L * 0.60, L * 0.155, L * 0.115, '#2c2350');
    vmTop(-L * 0.02, L * 0.60, L * 0.155, L * 0.115, '#4a3c80');
    vmTaper(L * 0.56, L * 0.94, L * 0.10, L * 0.062, '#1d1838');
    vmTop(L * 0.56, L * 0.94, L * 0.10, L * 0.062, '#3a2f63');
    vmTaper(L * 0.91, L * 1.0, L * 0.078, L * 0.062, '#645a92');
    /* Top rail and front sight block. */
    vmQuad(L * 0.05, L * 0.135, L * 0.54, L * 0.105,
           L * 0.54, L * 0.16, L * 0.05, L * 0.19, '#12101f');
    ctx.fillStyle = '#12101f';
    rr(L * 0.30, L * 0.15, L * 0.07, L * 0.13, L * 0.015);
    ctx.fill();
    ctx.fillStyle = w.accent;
    rr(L * 0.325, L * 0.245, L * 0.03, L * 0.035, L * 0.01);
    ctx.fill();
    /* Capacitor coil + accent stripes. */
    ctx.fillStyle = w.accent2;
    rr(L * 0.585, -L * 0.075, L * 0.05, L * 0.15, L * 0.02);
    ctx.fill();
    ctx.fillStyle = w.accent;
    vmQuad(L * 0.10, L * 0.04, L * 0.50, L * 0.028,
           L * 0.50, L * 0.075, L * 0.10, L * 0.095, w.accent);
    vmQuad(L * 0.12, -L * 0.10, L * 0.42, -L * 0.085,
           L * 0.42, -L * 0.055, L * 0.12, -L * 0.07, w.accent2);
    vmMuzzle(L, w);
  }

  function drawRifleModel(w, L) {
    drawVmGrip(L);
    /* Long, slim receiver with a cheek rest and scope. */
    vmTaper(-L * 0.04, L * 0.50, L * 0.125, L * 0.085, '#2a2148');
    vmTop(-L * 0.04, L * 0.50, L * 0.125, L * 0.085, '#4a3c80');
    /* Cheek rest above the stock. */
    vmQuad(-L * 0.28, L * 0.12, -L * 0.05, L * 0.135,
           -L * 0.05, L * 0.23, -L * 0.26, L * 0.20, '#3a2f63');
    /* Barrel and shroud run well past the receiver. */
    vmTaper(L * 0.46, L * 0.88, L * 0.075, L * 0.042, '#1d1838');
    vmTop(L * 0.46, L * 0.88, L * 0.075, L * 0.042, '#3a2f63');
    vmTaper(L * 0.86, L * 1.0, L * 0.058, L * 0.05, '#645a92');
    /* Scope tube. */
    ctx.fillStyle = '#12101f';
    rr(L * 0.16, L * 0.13, L * 0.30, L * 0.10, L * 0.035);
    ctx.fill();
    ctx.fillStyle = '#0b0a14';
    rr(L * 0.44, L * 0.145, L * 0.05, L * 0.07, L * 0.02);
    ctx.fill();
    ctx.fillStyle = w.accent;
    ctx.beginPath();
    ctx.arc(L * 0.47, L * 0.18, L * 0.022, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#12101f';
    rr(L * 0.22, L * 0.225, L * 0.05, L * 0.045, L * 0.012);
    ctx.fill();
    /* Side vents + accent rail. */
    ctx.fillStyle = w.accent2;
    vmQuad(L * 0.05, -L * 0.095, L * 0.40, -L * 0.075,
           L * 0.40, -L * 0.03, L * 0.05, -L * 0.05, w.accent2);
    ctx.fillStyle = w.accent;
    vmQuad(L * 0.52, -L * 0.045, L * 0.84, -L * 0.026,
           L * 0.84, -L * 0.004, L * 0.52, -L * 0.014, w.accent);
    /* Muzzle brake fins. */
    ctx.fillStyle = '#645a92';
    rr(L * 0.895, -L * 0.075, L * 0.022, L * 0.15, L * 0.008);
    ctx.fill();
    vmMuzzle(L, w);
  }

  function drawSMGModel(w, L) {
    drawVmGrip(L);
    /* Short, wide body with a fat magazine and a reflex sight. */
    vmTaper(-L * 0.02, L * 0.52, L * 0.19, L * 0.145, '#2c2350');
    vmTop(-L * 0.02, L * 0.52, L * 0.19, L * 0.145, '#4a3c80');
    vmTaper(L * 0.48, L * 0.86, L * 0.115, L * 0.075, '#1d1838');
    vmTaper(L * 0.84, L * 1.0, L * 0.09, L * 0.07, '#645a92');
    /* Magazine hanging below. */
    vmQuad(L * 0.10, -L * 0.16, L * 0.30, -L * 0.14,
           L * 0.24, -L * 0.52, L * 0.04, -L * 0.48, '#241d3f');
    ctx.fillStyle = w.accent2;
    rr(L * 0.08, -L * 0.34, L * 0.16, L * 0.035, L * 0.012);
    ctx.fill();
    /* Angled foregrip. */
    vmQuad(L * 0.42, -L * 0.12, L * 0.52, -L * 0.10,
           L * 0.46, -L * 0.32, L * 0.35, -L * 0.30, '#1d1838');
    /* Reflex sight. */
    ctx.fillStyle = '#12101f';
    rr(L * 0.26, L * 0.135, L * 0.14, L * 0.09, L * 0.02);
    ctx.fill();
    ctx.fillStyle = w.accent;
    ctx.beginPath();
    ctx.arc(L * 0.33, L * 0.185, L * 0.022, 0, TAU);
    ctx.fill();
    /* Accent bands. */
    ctx.fillStyle = w.accent;
    vmQuad(L * 0.02, L * 0.05, L * 0.46, L * 0.035,
           L * 0.46, L * 0.085, L * 0.02, L * 0.105, w.accent);
    ctx.fillStyle = w.accent2;
    rr(L * 0.56, -L * 0.075, L * 0.045, L * 0.15, L * 0.015);
    ctx.fill();
    vmMuzzle(L, w);
  }

  function drawViewmodel() {
    var g = viewmodelGeom();
    if (tracer > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(tracer, 0, 1) * 0.7;
      ctx.strokeStyle = g.w.accent;
      ctx.lineWidth = g.w.id === 'rifle' ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(g.muzzleX, g.muzzleY);
      ctx.lineTo(W / 2, aimY);
      ctx.stroke();
      ctx.restore();
    }

    var L = g.len;
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.angle);
    drawVmArm(L);
    if (g.w.id === 'rifle') drawRifleModel(g.w, L);
    else if (g.w.id === 'smg') drawSMGModel(g.w, L);
    else drawBlasterModel(g.w, L);
    ctx.restore();

    if (muzzle > 0) {
      var mf = clamp(muzzle * 14, 0, 1);
      var R = g.w.flash * (0.72 + 0.28 * mf);
      ctx.save();
      ctx.translate(g.muzzleX, g.muzzleY);
      ctx.rotate(g.angle);
      /* Forward cone toward the reticle, then a white-hot core. */
      ctx.fillStyle = 'rgba(255,255,255,.24)';
      ctx.beginPath();
      ctx.ellipse(R * 0.75, 0, R * 1.5, R * 0.42, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = g.w.accent;
      ctx.beginPath();
      for (var i = 0; i < 10; i++) {
        var a = i / 10 * TAU;
        var r2 = i % 2 === 0 ? R : R * 0.34;
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2 * 0.82);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.34, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawCrosshair() {
    var cx = W / 2, cy = aimY;
    ctx.strokeStyle = 'rgba(232,238,252,.9)';
    ctx.lineWidth = 2;
    var g = 6, l = 8;
    ctx.beginPath();
    ctx.moveTo(cx - g - l, cy); ctx.lineTo(cx - g, cy);
    ctx.moveTo(cx + g, cy); ctx.lineTo(cx + g + l, cy);
    ctx.moveTo(cx, cy - g - l); ctx.lineTo(cx, cy - g);
    ctx.moveTo(cx, cy + g); ctx.lineTo(cx, cy + g + l);
    ctx.stroke();
    ctx.fillStyle = 'rgba(34,211,238,.9)';
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
    if (hitMarker > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,' + clamp(hitMarker, 0, 1).toFixed(2) + ')';
      ctx.lineWidth = 2.5;
      var m = 5, ml = 9;
      ctx.beginPath();
      ctx.moveTo(cx - m, cy - m); ctx.lineTo(cx - m - ml, cy - m - ml);
      ctx.moveTo(cx + m, cy - m); ctx.lineTo(cx + m + ml, cy - m - ml);
      ctx.moveTo(cx - m, cy + m); ctx.lineTo(cx - m - ml, cy + m + ml);
      ctx.moveTo(cx + m, cy + m); ctx.lineTo(cx + m + ml, cy + m + ml);
      ctx.stroke();
    }
    if (combo > 1 && state === 'running') {
      ctx.fillStyle = 'rgba(34,211,238,.95)';
      ctx.font = 'bold 16px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('×' + combo, cx + 26, cy - 18);
    }
    /* Range + damage multiplier readout while a drone is under the reticle. */
    if (state === 'running' && phase === 'wave') {
      var tgt = pickTarget();
      if (tgt) {
        var mult = damageMultiplier(tgt.dist);
        ctx.textAlign = 'center';
        ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = mult >= 1.1 ? '#2ee6a6' : (mult <= 0.8 ? '#ff9db4' : 'rgba(232,238,252,.85)');
        ctx.fillText(tgt.dist.toFixed(1) + 'm · ×' + mult.toFixed(2), cx, cy + 34);
      }
    }
  }

  function drawHitPops() {
    for (var i = 0; i < hitPops.length; i++) {
      var p = hitPops[i];
      var f = 1 - p.t / p.life;
      ctx.globalAlpha = clamp(f * 1.5, 0, 1);
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = p.mult >= 1.1 ? '#ffd166' : (p.mult <= 0.8 ? '#9aa7c7' : '#e8eefc');
      ctx.fillText('-' + p.val.toFixed(1), p.x, p.y - (1 - f) * 30);
    }
    ctx.globalAlpha = 1;
  }

  function drawMinimap() {
    var sc = 2.9, pad = 10;
    var mw = MW * sc, mh = MH * sc;
    ctx.fillStyle = 'rgba(5,8,16,.72)';
    rr(pad - 4, pad - 4, mw + 8, mh + 8, 6);
    ctx.fill();
    for (var y = 0; y < MH; y++) {
      for (var x = 0; x < MW; x++) {
        if (isSolid(x, y)) {
          var c = cellAt(x, y);
          ctx.fillStyle = c === '=' ? 'rgba(64,150,190,.75)'
                        : c === 'o' ? 'rgba(110,96,200,.75)'
                                    : 'rgba(94,84,168,.6)';
          ctx.fillRect(pad + x * sc, pad + y * sc, sc, sc);
        }
      }
    }
    ctx.fillStyle = '#ff5c7a';
    for (var i = 0; i < drones.length; i++) {
      var dd = drones[i];
      if (dd.type === 'boss') {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.moveTo(pad + dd.x * sc, pad + (dd.y - 0.45) * sc);
        ctx.lineTo(pad + (dd.x + 0.45) * sc, pad + (dd.y + 0.4) * sc);
        ctx.lineTo(pad + (dd.x - 0.45) * sc, pad + (dd.y + 0.4) * sc);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ff5c7a';
      } else {
        ctx.fillRect(pad + (dd.x - 0.25) * sc, pad + (dd.y - 0.25) * sc, sc * 0.5, sc * 0.5);
      }
    }
    ctx.save();
    ctx.translate(pad + player.x * sc, pad + player.y * sc);
    ctx.rotate(player.dir);
    ctx.fillStyle = 'rgba(34,211,238,.25)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(sc * 3.2, -sc * 1.6);
    ctx.lineTo(sc * 3.2, sc * 1.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.arc(0, 0, sc * 0.6, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawStatus() {
    var diff = waveDifficulty(wave);
    var left = drones.length + queue.length;

    /* wave + threat readout */
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(5,8,16,.72)';
    rr(W / 2 - 110, 8, 220, 46, 12);
    ctx.fill();
    ctx.strokeStyle = diff.bossWave ? 'rgba(248,113,113,.7)' : 'rgba(139,92,246,.4)';
    ctx.lineWidth = 1;
    rr(W / 2 - 110, 8, 220, 46, 12);
    ctx.stroke();
    ctx.fillStyle = '#e8eefc';
    ctx.font = 'bold 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('WAVE ' + wave + ' · ' + left + ' LEFT', W / 2, 25);
    ctx.fillStyle = diff.tier >= 4 ? '#ff8fa3' : diff.tier >= 2 ? '#f59e0b' : '#22d3ee';
    ctx.font = 'bold 10px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('THREAT ' + diff.tier + ' · ' + diff.name + (diff.bossWave ? ' · BOSS' : ''), W / 2, 43);

    /* weapon + ammo panel (bottom-left, clear of the right-side gun) */
    var w = weapon();
    var bx = 12, by = H - 60, bw = 216, bh = 50;
    ctx.fillStyle = 'rgba(5,8,16,.68)';
    rr(bx, by, bw, bh, 9);
    ctx.fill();
    ctx.strokeStyle = 'rgba(139,92,246,.38)';
    ctx.lineWidth = 1;
    rr(bx, by, bw, bh, 9);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = w.accent;
    ctx.font = 'bold 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(w.name.toUpperCase(), bx + 11, by + 19);
    ctx.fillStyle = 'rgba(195,205,227,.62)';
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(phase === 'breather' ? '1/2/3 BUY · Q CYCLE' : 'Q CYCLE · 1/2/3 SWITCH', bx + 11, by + 35);
    ctx.textAlign = 'right';
    if (isReloading()) {
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('RELOAD ' + Math.max(0, reloadT[gun]).toFixed(1) + 's', bx + bw - 11, by + 19);
      var prog = 1 - reloadT[gun] / w.reloadTime;
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.fillRect(bx + 11, by + 41, bw - 22, 3);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(bx + 11, by + 41, (bw - 22) * clamp(prog, 0, 1), 3);
    } else {
      ctx.fillStyle = ammo[gun] <= Math.max(1, Math.ceil(w.mag * 0.2)) ? '#ff9db4' : '#e8eefc';
      ctx.font = 'bold 17px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(ammo[gun] + ' / ' + w.mag, bx + bw - 11, by + 21);
      ctx.fillStyle = 'rgba(195,205,227,.55)';
      ctx.font = '10px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(w.damage.toFixed(2) + ' DMG · ' + Math.round(60 / w.fireCd) + ' RPM', bx + bw - 11, by + 36);
    }
  }

  function drawBossBar(t) {
    if (!boss) return;
    var bw = 392, bx = W / 2 - bw / 2, by = 64;
    var pct = clamp(boss.hp / boss.maxHp, 0, 1);
    var phase2 = boss.phase === 2;

    ctx.textAlign = 'left';
    ctx.fillStyle = phase2 ? '#fbbf24' : '#ff8fa3';
    ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('☠ ' + bossName + ' · TIER ' + boss.tier, bx, by - 5);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(232,238,252,.9)';
    ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(Math.ceil(Math.max(0, boss.hp)) + ' / ' + boss.maxHp, bx + bw, by - 5);

    ctx.fillStyle = 'rgba(5,8,16,.8)';
    rr(bx, by, bw, 14, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(248,113,113,.6)';
    ctx.lineWidth = 1;
    rr(bx, by, bw, 14, 7);
    ctx.stroke();
    var fillW = (bw - 4) * pct;
    if (fillW > 0) {
      ctx.fillStyle = phase2 ? '#fbbf24' : '#f43f5e';
      rr(bx + 2, by + 2, Math.max(3, fillW), 10, 5);
      ctx.fill();
    }
    /* half-health phase marker */
    ctx.fillStyle = 'rgba(5,8,16,.85)';
    ctx.fillRect(bx + bw * 0.5 - 1, by + 1, 2, 12);

    ctx.textAlign = 'center';
    ctx.font = 'bold 9px "Segoe UI", system-ui, sans-serif';
    if (boss.tele) {
      ctx.fillStyle = boss.tele.kind === 'volley' ? '#fbbf24' : '#ff8fa3';
      ctx.fillText(boss.tele.kind === 'volley' ? 'AIMED VOLLEY' :
                   boss.tele.kind === 'summon' ? 'SUMMONING' : 'RADIAL BURST',
                   W / 2, by + 24);
    } else {
      ctx.fillStyle = phase2 ? '#fbbf24' : 'rgba(195,205,227,.6)';
      ctx.fillText(phase2 ? 'PHASE 2 — ENRAGED' : 'PHASE 1', W / 2, by + 23);
    }
  }

  function drawBanner() {
    if (bannerT <= 0) return;
    var alpha = clamp(bannerT / 0.45, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(5,8,16,.78)';
    ctx.fillRect(0, H * 0.27, W, 82);
    ctx.strokeStyle = bannerTone;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.27);
    ctx.lineTo(W, H * 0.27);
    ctx.moveTo(0, H * 0.27 + 82);
    ctx.lineTo(W, H * 0.27 + 82);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = bannerTone;
    ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(bannerTitle, W / 2, H * 0.27 + 40);
    if (bannerSub) {
      ctx.fillStyle = 'rgba(232,238,252,.9)';
      ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(bannerSub, W / 2, H * 0.27 + 63);
    }
    ctx.restore();
  }

  function drawUpgradeMenu() {
    var mw2 = 340, mx0 = W / 2 - mw2 / 2, my0 = 150;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(5,8,16,.82)';
    rr(mx0, my0, mw2, 176, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(139,92,246,.6)';
    ctx.lineWidth = 1.5;
    rr(mx0, my0, mw2, 176, 12);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8eefc';
    ctx.font = 'bold 17px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('UPGRADE — next wave in ' + Math.max(0, breatherT).toFixed(1) + 's', W / 2, my0 + 26);

    menuRects = [
      { x: mx0 + 10, y: my0 + 38, w: mw2 - 20, h: 40, kind: 'fire' },
      { x: mx0 + 10, y: my0 + 84, w: mw2 - 20, h: 40, kind: 'dmg' },
      { x: mx0 + 10, y: my0 + 130, w: mw2 - 20, h: 40, kind: 'armor' }
    ];
    var rows = [
      { key: '1', label: 'Rapid Fire', sub: 'Lv ' + upgrades.fire + ' · faster shots', cost: fireCost(), kind: 'fire' },
      { key: '2', label: 'Overcharge', sub: 'Lv ' + upgrades.dmg + ' · +1 damage', cost: dmgCost(), kind: 'dmg' },
      { key: '3', label: 'Armor Plating', sub: 'Lv ' + upgrades.armor + ' · +25 max HP, repair', cost: armorCost(), kind: 'armor' }
    ];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], rect = menuRects[i];
      var afford = credits >= r.cost;
      ctx.fillStyle = flashBanner > 0 && afford ? 'rgba(139,92,246,.28)' : 'rgba(255,255,255,.06)';
      rr(rect.x, rect.y, rect.w, rect.h, 8);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = '#8b5cf6';
      ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(r.key, rect.x + 12, rect.y + 25);
      ctx.fillStyle = '#e8eefc';
      ctx.fillText(r.label, rect.x + 34, rect.y + 17);
      ctx.fillStyle = 'rgba(195,205,227,.75)';
      ctx.font = '12px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(r.sub, rect.x + 34, rect.y + 33);
      ctx.textAlign = 'right';
      ctx.fillStyle = afford ? '#2ee6a6' : '#ff5c7a';
      ctx.font = 'bold 14px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('⬡ ' + r.cost, rect.x + rect.w - 12, rect.y + 25);
    }
  }

  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070e';
    ctx.fillRect(0, 0, W, H);

    var dirX = Math.cos(player.dir), dirY = Math.sin(player.dir);
    var plX = -dirY * FOV_PLANE, plY = dirX * FOV_PLANE;
    var horizon = horizonY();

    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    renderWalls(dirX, dirY, plX, plY, horizon);
    renderSprites(dirX, dirY, plX, plY, horizon, t);
    drawViewmodel();
    ctx.restore();

    drawCrosshair();
    drawHitPops();
    drawMinimap();
    drawStatus();
    drawBossBar(t);
    drawBanner();

    if (phase === 'breather' && state === 'running') {
      drawUpgradeMenu();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(46,230,166,.95)';
      ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('WAVE ' + wave + ' CLEAR!', W / 2, 110);
    }

    if (damageFlash > 0) {
      ctx.fillStyle = 'rgba(255,70,90,' + (clamp(damageFlash, 0, 1) * 0.34).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    if (bossWarn > 0) {
      var warnPulse = 0.25 + 0.25 * Math.sin(t / 130);
      ctx.strokeStyle = 'rgba(248,113,113,' + warnPulse.toFixed(3) + ')';
      ctx.lineWidth = 18;
      ctx.strokeRect(9, 9, W - 18, H - 18);
    }
    if (hp <= 30 && state === 'running') {
      var pulse = 0.1 + 0.08 * Math.sin(t / 240);
      ctx.strokeStyle = 'rgba(255,92,122,' + pulse.toFixed(3) + ')';
      ctx.lineWidth = 14;
      ctx.strokeRect(7, 7, W - 14, H - 14);
    }
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    var dt = last ? (t - last) / 1000 : 0;
    last = t;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    if (state === 'running') update(dt);
    draw(t);
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var k = e.key;

    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown' || k === ' ') e.preventDefault();

    if (k === 'w' || k === 'W') keys.f = true;
    else if (k === 's' || k === 'S') keys.b = true;
    else if (k === 'a' || k === 'A') keys.l = true;
    else if (k === 'd' || k === 'D') keys.r = true;
    else if (k === 'ArrowLeft') keys.turnL = true;
    else if (k === 'ArrowRight') keys.turnR = true;
    else if (k === 'ArrowUp') keys.aimUp = true;
    else if (k === 'ArrowDown') keys.aimDown = true;
    else if (k === ' ') {
      if (e.repeat) return;
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
      else if (phase === 'breather') breatherT = Math.min(breatherT, 0.05);
      else keys.jump = true;
    } else if (k === 'f' || k === 'F') {
      if (e.repeat) return;
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
      else keys.fire = true;
    } else if (k === 'Enter') {
      if (e.repeat) return;
      if (state === 'ready' || state === 'over') start();
      else if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (e.repeat) return;
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (k === 'r' || k === 'R') {
      if (!e.repeat && state === 'running') beginReload();
    } else if (k === 'q' || k === 'Q') {
      if (!e.repeat && state === 'running') cycleWeapon();
    } else if (k === '1') {
      if (e.repeat) return;
      if (state === 'running' && phase === 'breather') buy('fire');
      else if (state === 'running') selectWeapon(0);
    } else if (k === '2') {
      if (e.repeat) return;
      if (state === 'running' && phase === 'breather') buy('dmg');
      else if (state === 'running') selectWeapon(1);
    } else if (k === '3') {
      if (e.repeat) return;
      if (state === 'running' && phase === 'breather') buy('armor');
      else if (state === 'running') selectWeapon(2);
    }
  });

  document.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === 'w' || k === 'W') keys.f = false;
    else if (k === 's' || k === 'S') keys.b = false;
    else if (k === 'a' || k === 'A') keys.l = false;
    else if (k === 'd' || k === 'D') keys.r = false;
    else if (k === 'ArrowLeft') keys.turnL = false;
    else if (k === 'ArrowRight') keys.turnR = false;
    else if (k === 'ArrowUp') keys.aimUp = false;
    else if (k === 'ArrowDown') keys.aimDown = false;
    else if (k === 'f' || k === 'F') keys.fire = false;
    else if (k === ' ') keys.jump = false;
  });

  var padBtns = document.querySelectorAll('[data-act]');
  for (var pb = 0; pb < padBtns.length; pb++) {
    (function (btn) {
      var act = btn.getAttribute('data-act');
      function on() {
        if (state === 'ready' || state === 'over') { start(); return; }
        if (state === 'paused') { resume(); return; }
        if (act === 'weapon') { cycleWeapon(); return; }
        if (act === 'fire') keys.fire = true;
        else if (act === 'jump') keys.jump = true;
        else if (act === 'left') keys.turnL = true;
        else if (act === 'right') keys.turnR = true;
        else if (act === 'aimUp') keys.aimUp = true;
        else if (act === 'aimDown') keys.aimDown = true;
      }
      function off() {
        if (act === 'fire') keys.fire = false;
        else if (act === 'jump') keys.jump = false;
        else if (act === 'left') keys.turnL = false;
        else if (act === 'right') keys.turnR = false;
        else if (act === 'aimUp') keys.aimUp = false;
        else if (act === 'aimDown') keys.aimDown = false;
      }
      btn.addEventListener('pointerdown', function (ev) { ev.preventDefault(); on(); });
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointerleave', off);
      btn.addEventListener('pointercancel', off);
    })(padBtns[pb]);
  }

  var dragX = null, dragY = null;
  canvas.addEventListener('pointerdown', function (ev) {
    if (state !== 'running') return;
    if (phase === 'breather') {
      /* upgrade menu is clickable during the breather */
      var rect = canvas.getBoundingClientRect();
      if (rect.width && rect.height) {
        var cx2 = (ev.clientX - rect.left) * (W / rect.width);
        var cy2 = (ev.clientY - rect.top) * (H / rect.height);
        for (var i = 0; i < menuRects.length; i++) {
          var m = menuRects[i];
          if (cx2 >= m.x && cx2 <= m.x + m.w && cy2 >= m.y && cy2 <= m.y + m.h) {
            buy(m.kind);
            return;
          }
        }
      }
      return;
    }
    if (ev.pointerType !== 'touch' && document.pointerLockElement !== canvas &&
        canvas.requestPointerLock) {
      /* first click locks the mouse (like a classic PC shooter); locked clicks fire */
      dragX = ev.clientX;
      dragY = ev.clientY;
      try {
        var pr = canvas.requestPointerLock();
        if (pr && pr.catch) pr.catch(function () { /* lock refused */ });
      } catch (err) { /* pointer lock unavailable */ }
      return;
    }
    dragX = ev.clientX;
    dragY = ev.clientY;
    if (ev.button === 0 || ev.button === undefined) keys.fire = true;
  });

  window.addEventListener('pointerup', function () {
    keys.fire = false;
    dragX = null;
    dragY = null;
  });

  document.addEventListener('mousemove', function (e) {
    if (state !== 'running' || phase !== 'wave') return;
    if (document.pointerLockElement === canvas) {
      var mx = e.movementX || 0;
      var my = e.movementY || 0;
      player.dir = normAng(player.dir + mx * 0.0024);
      aimY = clampAim(aimY + my * 0.9);
    } else if (dragX !== null && e.clientX !== undefined) {
      player.dir = normAng(player.dir + (e.clientX - dragX) * 0.005);
      dragX = e.clientX;
      if (dragY !== null && e.clientY !== undefined) {
        aimY = clampAim(aimY + (e.clientY - dragY) * 0.8);
        dragY = e.clientY;
      }
    }
  });

  document.addEventListener('pointerlockchange', function () {
    if (document.pointerLockElement === canvas) updateHud(true);
    /* Losing the lock mid-fight pauses; the wave-clear breather deliberately
       releases it so the upgrade buttons can be clicked. */
    else if (state === 'running' && phase === 'wave') pause();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  window.addEventListener('blur', function () {
    if (state === 'running') pause();
  });

  /* ---------------- boot ---------------- */

  startWave();
  updateHud(true);
  ensureLoop();
  GameShell.overlay.show({
    title: 'Wavebreak',
    msg: 'Endless drones, three guns — and every fifth wave a boss. The Blaster is a 14-round all-rounder, the Rifle hits hard with 8 slow shots, and the SMG sprays 26 fast rounds. Switch with 1/2/3 during a wave or Q to cycle, and watch the right-hand gun rise and fall with your reticle. Clear waves to bank credits and spend them on faster fire, more damage or heavier armor between rounds. Watch for the shielded Bulwark, the strafing Stinger and the telegraphed Sniper as the threat tier climbs, then survive the Overseer boss with its radial orbs, aimed volleys and drone summons. Move with WASD, jump with Space and fire with F or a click. Aim up and down with the mouse, the arrow keys or the ▲▼ buttons — shots hit hardest up close and lose power at range. How deep can you go?',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* Read-only snapshot hook for automated tests. */
  window.__wavebreak = function () {
    var vm = viewmodelGeom();
    var diff = waveDifficulty(wave);
    var bossActive = !!(boss && drones.indexOf(boss) >= 0);
    var counts = {};
    var bossOrbs = 0;
    var i;
    for (i = 0; i < orbs.length; i++) if (orbs[i].boss) bossOrbs++;
    for (i = 0; i < drones.length; i++) {
      counts[drones[i].type] = (counts[drones[i].type] || 0) + 1;
    }
    var types = {};
    for (var key in ENEMY_TYPES) {
      if (!ENEMY_TYPES.hasOwnProperty(key)) continue;
      var spec = ENEMY_TYPES[key];
      types[key] = {
        name: spec.name, hp: spec.hp, speed: spec.speed, scale: spec.scale,
        dmg: spec.dmg, orbSpeed: spec.orbSpeed, interval: spec.interval,
        burst: spec.burst || 0, telegraph: spec.telegraph || 0,
        frontResist: spec.frontResist || 1, blurb: spec.blurb
      };
    }
    var mdx = vm.muzzleX - W / 2, mdy = vm.muzzleY - aimY;
    return {
      state: state, phase: phase,
      score: score, best: best,
      hp: hp, maxHp: maxHp,
      wave: wave, credits: credits, kills: kills, shots: shots,
      bossKills: bossKills,
      combo: combo, breatherT: breatherT,
      upgrades: { fire: upgrades.fire, dmg: upgrades.dmg, armor: upgrades.armor },
      costs: { fire: fireCost(), dmg: dmgCost(), armor: armorCost() },
      weapon: gun,
      weaponId: weapon().id,
      weaponName: weapon().name,
      magSize: weapon().mag,
      ammo: ammo[gun],
      reloading: isReloading(),
      reloadLeft: reloadT[gun],
      ammoAll: ammo.slice(),
      reloadAll: reloadT.slice(),
      weapons: WEAPONS.map(function (w, i2) {
        return {
          id: w.id, name: w.name, slot: w.slot,
          mag: w.mag, fireCd: w.fireCd, reloadTime: w.reloadTime,
          damage: w.damage, recoil: w.recoil,
          ammo: ammo[i2], reloading: reloadT[i2] > 0, reloadLeft: reloadT[i2],
          currentDmg: function () { return (w.damage + upgrades.dmg); }
        };
      }),
      viewmodel: {
        x: vm.x, y: vm.y,
        gunY: gunY,
        gripX: vm.gripX, gripY: vm.gripY,
        muzzleX: vm.muzzleX, muzzleY: vm.muzzleY,
        rightHalf: vm.x > W / 2,
        muzzleRightHalf: vm.muzzleX > W / 2,
        barrel: {
          dx: vm.dx, dy: vm.dy, len: vm.len, angle: vm.angle,
          pointsForward: vm.dx < 0 && vm.dy < 0,
          pointsUpScreen: vm.dy < 0,
          muzzleLeftOfGrip: vm.muzzleX < vm.gripX,
          muzzleToCrosshair: Math.sqrt(mdx * mdx + mdy * mdy)
        }
      },
      jump: { z: player.z, vz: player.vz, onGround: player.onGround, vel: JUMP_VEL },
      aim: { y: aimY, min: H / 2 - AIM_MARGIN, max: H / 2 + AIM_MARGIN, margin: AIM_MARGIN },
      crosshair: { x: W / 2, y: aimY },
      lastHit: { dist: lastHit.dist, dmg: lastHit.dmg, mult: lastHit.mult, resisted: !!lastHit.resisted },
      lastShot: { hit: !!lastShot.hit, dist: lastShot.dist, wall: lastShot.wall },
      hits: hits,
      multAt: function (d) { return damageMultiplier(d); },
      hitPops: hitPops.length,
      target: (function () {
        var t = pickTarget();
        return t ? { type: t.drone.type, dist: t.dist, mult: damageMultiplier(t.dist) } : null;
      })(),
      player: { x: player.x, y: player.y, dir: player.dir, z: player.z, onGround: player.onGround, vx: player.vx, vy: player.vy },
      drones: drones.map(function (d) {
        return {
          x: d.x, y: d.y, hp: d.hp, maxHp: d.maxHp, type: d.type, alt: d.alt, scale: d.scale,
          name: d.name || '', tier: d.tier || 0, phase: d.phase || 0,
          face: d.face || 0, aiming: (d.aimT || 0) > 0,
          telegraph: d.tele ? { kind: d.tele.kind, t: d.tele.t } : null
        };
      }),
      queued: queue.length,
      queueTypes: queue.slice(),
      orbCount: orbs.length,
      bossOrbCount: bossOrbs,
      enemyCounts: counts,
      enemyTypes: types,
      difficulty: {
        tier: diff.tier, name: diff.name, hpMul: diff.hpMul, speedMul: diff.speedMul,
        dmgMul: diff.dmgMul, orbSpeedMul: diff.orbSpeedMul, fireRateMul: diff.fireRateMul,
        spawnGap: diff.spawnGap, maxAlive: diff.maxAlive, queueSize: diff.queueSize,
        bossWave: diff.bossWave
      },
      threat: {
        tier: diff.tier, name: diff.name, wave: wave,
        hpMul: diff.hpMul, speedMul: diff.speedMul, dmgMul: diff.dmgMul,
        orbSpeedMul: diff.orbSpeedMul, fireRateMul: diff.fireRateMul,
        spawnGap: diff.spawnGap, bossWave: diff.bossWave
      },
      threatAt: function (w) { return waveDifficulty(w); },
      boss: {
        active: bossActive,
        name: bossActive ? bossName : '',
        hp: bossActive ? Math.max(0, boss.hp) : 0,
        maxHp: bossActive ? boss.maxHp : 0,
        phase: bossActive ? boss.phase : 0,
        tier: bossActive ? boss.tier : 0,
        x: bossActive ? boss.x : 0,
        y: bossActive ? boss.y : 0,
        telegraph: (bossActive && boss.tele) ? { kind: boss.tele.kind, t: boss.tele.t } : null,
        scale: bossActive ? boss.scale : 0
      },
      bossWarn: bossWarn,
      bossNameFor: function (w) { return bossSpec(w).name; },
      bossHpFor: function (w) { return bossSpec(w).maxHp; },
      bossTierFor: function (w) { return bossSpec(w).tier; },
      bossSpecAt: function (w) { return bossSpec(w); },
      banner: { title: bannerTitle, sub: bannerSub, t: bannerT, tone: bannerTone },
      map: MAP.slice()
    };
  };

  /* Testing bridge: only present when the page sets __WAVEBREAK_DEV__ before
     this file loads. It is inert during normal play. */
  if (devMode) {
    window.__wavebreakDev = {
      setWave: function (n) {
        wave = Math.max(1, Math.min(999, Math.floor(n) || 1));
        drones.length = 0;
        orbs.length = 0;
        puffs.length = 0;
        queue.length = 0;
        boss = null;
        bossWarn = 0;
        phase = 'wave';
        state = 'running';
        startWave();
        last = now();
        ensureLoop();
        updateHud(true);
        return { wave: wave, boss: !!boss };
      },
      skipBreather: function () { if (phase === 'breather') breatherT = 0.01; },
      heal: function () { hp = maxHp; },
      noDamage: function (on) { godMode = on !== false; },
      hurtBoss: function (frac) {
        if (boss) boss.hp = Math.max(0.1, boss.maxHp * clamp(frac, 0, 1));
      },
      killBoss: function () { if (boss) { boss.hp = 0; killDrone(boss); boss = null; } },
      clearEscorts: function () {
        for (var e = drones.length - 1; e >= 0; e--) {
          if (drones[e].type !== 'boss') {
            puffs.push({ x: drones[e].x, y: drones[e].y, t: 0, life: 0.4 });
            drones.splice(e, 1);
          }
        }
      },
      clearWave: function () { queue.length = 0; drones.length = 0; orbs.length = 0; }
    };
  }

  /* shared HUD reset button */
  if (typeof GameShell.onReset === 'function') GameShell.onReset(start);
})();
