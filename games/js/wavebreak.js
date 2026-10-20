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
  var credits = 0, kills = 0, shots = 0;
  var combo = 1, comboT = 0;
  var best = GameShell.best.get(BEST_KEY, 0);
  var drones = [], orbs = [], puffs = [];
  var queue = [], spawnT = 0, waveEndT = 0, breatherT = 0;
  var flow = null, flowT = 0;
  var player = { x: 10.5, y: 10.5, dir: 0, z: 0, vz: 0, onGround: true };
  var keys = { f: false, b: false, l: false, r: false, turnL: false, turnR: false, fire: false, jump: false, aimUp: false, aimDown: false };
  var fireCd = 0, mag = 14, reloading = false, reloadT = 0;
  var upgrades = { fire: 0, dmg: 0, armor: 0 };
  var hitMarker = 0, damageFlash = 0, shake = 0, muzzle = 0, recoil = 0;
  var bob = 0, bobT = 0, flashBanner = 0;
  var aimY = H / 2;                 /* vertical reticle position, screen px */
  var AIM_MARGIN = H * 0.28;        /* how far the reticle can travel up or down */
  var AIM_KEY_SPEED = 340;          /* px per second with ArrowUp / ArrowDown */
  var hitPops = [];
  var lastHit = { dist: 0, dmg: 0, mult: 1 };
  var hits = 0;
  var rafId = 0, last = 0;
  var zbuf = new Float32Array(COLS);
  var hudSig = '';
  var menuRects = [];

  var MAG_SIZE = 14, FIRE_CD = 0.16, RELOAD_TIME = 1.0;

  /* ---------------- helpers ---------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
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
    updateHud(true);
    return true;
  }

  function fireCooldown() {
    return Math.max(FIRE_CD * 0.5, FIRE_CD * Math.pow(0.85, upgrades.fire));
  }

  /* ---------------- HUD ---------------- */

  function updateHud(force) {
    var right;
    if (state === 'paused') right = '⏸ Paused · Wave ' + wave;
    else if (phase === 'wave' && document.pointerLockElement !== canvas) right = '🖱 Click the view to aim up/down · Space jump · F fire';
    else right = '⬡ ' + credits + ' credits' + (combo > 1 && phase === 'wave' ? ' · ×' + combo : '') + ' · Space = Jump';
    var sig = [score, Math.max(best, score), wave, Math.max(0, Math.ceil(hp)), right].join('|');
    if (!force && sig === hudSig) return;
    hudSig = sig;
    GameShell.hud(
      { Score: score, Best: Math.max(best, score), Wave: wave, HP: Math.max(0, Math.ceil(hp)) },
      right
    );
  }

  /* ---------------- waves ---------------- */

  function startWave() {
    phase = 'wave';
    queue = [];
    var n = Math.min(30, 4 + wave * 2);
    for (var i = 0; i < n; i++) {
      var roll = Math.random();
      var type = 'hopper';
      if (wave >= 3 && roll < 0.25) type = 'runner';
      if (wave >= 5 && roll > 0.86) type = 'heavy';
      queue.push(type);
    }
    spawnT = 0.9;
    waveEndT = 0;
    updateHud(true);
  }

  function spawnDrone(type) {
    var c = edgeCells[(Math.random() * edgeCells.length) | 0];
    var hpBase = 1 + Math.floor((wave - 1) / 2);
    var speed = Math.min(3.3, 1.65 + wave * 0.055);
    var scale = 0.95, creditsPay = 25 + wave * 5, scoreBase = 60 + wave * 10;
    var dmg = 6 + wave, orbSpeed = Math.min(9, 5.4 + wave * 0.22), interval = Math.max(0.9, 2.0 - wave * 0.06);

    if (type === 'runner') {
      speed *= 1.5;
      hpBase = Math.max(1, hpBase - 1);
      scale = 0.72;
      creditsPay = Math.round(creditsPay * 1.2);
      scoreBase = Math.round(scoreBase * 1.25);
    } else if (type === 'heavy') {
      speed *= 0.58;
      hpBase += 3;
      scale = 1.3;
      creditsPay = Math.round(creditsPay * 2.4);
      scoreBase = Math.round(scoreBase * 2.2);
      dmg += 4;
      interval *= 1.25;
    }

    drones.push({
      x: c.x, y: c.y, type: type,
      hp: hpBase, maxHp: hpBase,
      speed: speed, scale: scale,
      creditsPay: creditsPay, scoreBase: scoreBase,
      fireT: rnd(0.8, 2.0), interval: interval,
      orbSpeed: orbSpeed, dmg: dmg,
      alt: type === 'heavy' ? rnd(-0.06, 0.30) : rnd(-0.16, 0.34),
      flash: 0, wob: Math.random() * TAU
    });
    puffs.push({ x: c.x, y: c.y, t: 0, life: 0.4 });
  }

  /* ---------------- drones ---------------- */

  function updateDrones(dt) {
    var i, d;
    flowT -= dt;
    if (flowT <= 0) { buildFlow(); flowT = 0.35; }

    for (i = drones.length - 1; i >= 0; i--) {
      d = drones[i];
      if (d.flash > 0) d.flash -= dt;
      var dx = player.x - d.x, dy = player.y - d.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var los = dist < 0.001 || !losBlocked(d.x, d.y, player.x, player.y);

      if (los && dist < 6.2) {
        d.fireT -= dt;
        if (d.fireT <= 0) {
          d.fireT = d.interval;
          var a = Math.atan2(dy, dx) + rnd(-0.07, 0.07);
          orbs.push({
            x: d.x + Math.cos(a) * 0.4, y: d.y + Math.sin(a) * 0.4,
            vx: Math.cos(a) * d.orbSpeed, vy: Math.sin(a) * d.orbSpeed,
            dmg: d.dmg
          });
        }
        if (dist > 3.4) {
          var ml0 = dist || 1;
          tryMove(d, dx / ml0 * d.speed * 0.55 * dt, dy / ml0 * d.speed * 0.55 * dt, 0.26);
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
      if (ddx * ddx + ddy * ddy < 0.14) {
        hp -= o.dmg;
        damageFlash = 0.5;
        shake = 8;
        combo = 1; comboT = 0;
        orbs.splice(i, 1);
        updateHud();
        if (hp <= 0) { hp = 0; gameOver(); return; }
      }
    }
  }

  /* ---------------- shooting ---------------- */

  function beginReload() {
    if (reloading || mag === MAG_SIZE) return;
    reloading = true;
    reloadT = RELOAD_TIME;
  }

  function pickTarget() {
    var rdx = Math.cos(player.dir), rdy = Math.sin(player.dir);
    var horizon = horizonY();
    var best = null, bestDist = 1e9;
    for (var i = 0; i < drones.length; i++) {
      var d = drones[i];
      var vx = d.x - player.x, vy = d.y - player.y;
      var along = vx * rdx + vy * rdy;
      if (along <= 0.3 || along > 26) continue;
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

  function shoot() {
    if (state !== 'running' || phase !== 'wave') return;
    if (reloading || fireCd > 0) return;
    if (mag <= 0) { beginReload(); return; }
    fireCd = fireCooldown();
    mag--;
    shots++;
    muzzle = 0.06;
    recoil = 1;
    shake = Math.max(shake, 2.5);

    var rdx = Math.cos(player.dir), rdy = Math.sin(player.dir);
    var target = pickTarget();
    var wallHit = castRay(player.x, player.y, rdx, rdy).dist;
    if (target && target.dist < wallHit) {
      var hitD2 = target.drone;
      var mult = damageMultiplier(target.dist);
      var dmg = (1 + upgrades.dmg) * mult;
      hitMarker = 1;
      hits++;
      lastHit = { dist: target.dist, dmg: dmg, mult: mult };
      hitD2.hp -= dmg;
      hitD2.flash = 0.12;
      score += 5;
      hitPops.push({
        x: W / 2 + rnd(-11, 11), y: aimY - 12,
        t: 0, life: 0.65, val: dmg, mult: mult
      });
      if (hitPops.length > 24) hitPops.shift();
      if (hitD2.hp <= 0) {
        var idx = drones.indexOf(hitD2);
        if (idx >= 0) drones.splice(idx, 1);
        kills++;
        credits += hitD2.creditsPay;
        if (comboT > 0) combo = Math.min(10, combo + 1);
        else combo = 1;
        comboT = 2.6;
        score += hitD2.scoreBase * combo;
        puffs.push({ x: hitD2.x, y: hitD2.y, t: 0, life: 0.45 });
        updateHud();
      }
    }
    if (mag <= 0) beginReload();
  }

  /* ---------------- state transitions ---------------- */

  function start() {
    wave = 1; score = 0; hp = 100; maxHp = 100;
    credits = 0; kills = 0; shots = 0; combo = 1; comboT = 0;
    upgrades.fire = upgrades.dmg = upgrades.armor = 0;
    drones.length = 0; orbs.length = 0; puffs.length = 0;
    hitPops.length = 0;
    aimY = H / 2;
    lastHit = { dist: 0, dmg: 0, mult: 1 };
    hits = 0;
    player.x = 10.5; player.y = 10.5; player.dir = 0;
    reloading = false; mag = MAG_SIZE; fireCd = 0;
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
    updateHud(true);
    GameShell.overlay.show({
      title: isBest ? 'New high score!' : 'Overrun',
      msg: 'The swarm took the arena on wave ' + wave + '. You scored ' +
           score + ' point' + (score === 1 ? '' : 's') + ' and disabled ' + kills + ' drones.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Wave', value: wave },
        { label: 'Kills', value: kills }
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

    if (comboT > 0) {
      comboT -= dt;
      if (comboT <= 0) combo = 1;
    }
    if (flashBanner > 0) flashBanner -= dt;

    /* movement */
    var turn = 2.5 * dt;
    if (keys.turnL) player.dir -= turn;
    if (keys.turnR) player.dir += turn;
    player.dir = normAng(player.dir);

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

    /* firing / reload */
    if (fireCd > 0) fireCd -= dt;
    if (keys.fire) shoot();
    if (reloading) {
      reloadT -= dt;
      if (reloadT <= 0) { reloading = false; mag = MAG_SIZE; }
    }

    if (phase === 'wave') {
      if (queue.length && drones.length < 10) {
        spawnT -= dt;
        if (spawnT <= 0) {
          spawnT = Math.max(0.5, 1.5 - wave * 0.06);
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
          hp = Math.min(maxHp, hp + 30);
          reloading = false;
          mag = MAG_SIZE;
          combo = 1;
          comboT = 0;
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

  function drawDrone(cx, baseY, size, d, t) {
    var bobY = Math.sin(t / 210 + d.wob) * size * 0.06;
    var y = baseY - size * 0.55 + bobY;
    var white = d.flash > 0;
    var bodyCol = d.type === 'runner' ? '#22d3ee' : d.type === 'heavy' ? '#f59e0b' : '#8b5cf6';
    var darkCol = d.type === 'runner' ? '#177e96' : d.type === 'heavy' ? '#9a6a10' : '#5b3ea8';
    ctx.save();
    ctx.translate(cx, y);
    /* rotor ring */
    ctx.strokeStyle = white ? '#ffffff' : darkCol;
    ctx.lineWidth = Math.max(1.5, size * 0.05);
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.24, size * 0.42, size * 0.1, 0, 0, TAU);
    ctx.stroke();
    /* body */
    rr(-size * 0.28, -size * 0.18, size * 0.56, size * 0.36, size * 0.1);
    ctx.fillStyle = white ? '#ffffff' : bodyCol;
    ctx.fill();
    /* underside eye */
    ctx.fillStyle = white ? '#ffe9ee' : '#ff5c7a';
    ctx.beginPath();
    ctx.arc(0, size * 0.1, Math.max(1.5, size * 0.07), 0, TAU);
    ctx.fill();
    /* skids */
    ctx.strokeStyle = white ? '#ffffff' : darkCol;
    ctx.lineWidth = Math.max(1, size * 0.04);
    ctx.beginPath();
    ctx.moveTo(-size * 0.16, size * 0.18);
    ctx.lineTo(-size * 0.2, size * 0.34);
    ctx.moveTo(size * 0.16, size * 0.18);
    ctx.lineTo(size * 0.2, size * 0.34);
    ctx.stroke();
    ctx.restore();

    /* health bar for tough drones */
    if (d.maxHp > 2 && !white) {
      var bw = size * 0.4;
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(cx - bw / 2, y - size * 0.46, bw, Math.max(2, size * 0.05));
      ctx.fillStyle = '#2ee6a6';
      ctx.fillRect(cx - bw / 2, y - size * 0.46, bw * clamp(d.hp / d.maxHp, 0, 1), Math.max(2, size * 0.05));
    }
  }

  function drawOrb(cx, cy, size) {
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.5);
    g.addColorStop(0, 'rgba(230,200,255,.95)');
    g.addColorStop(0.45, 'rgba(168,120,255,.8)');
    g.addColorStop(1, 'rgba(140,80,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.5, 0, TAU);
    ctx.fill();
  }

  function drawPuff(cx, baseY, size, p) {
    var f = 1 - p.t / p.life;
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
      list.push({ x: o.x - player.x, y: o.y - player.y, kind: 'orb', ref: o, scale: 0.42 });
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
      else if (s2.kind === 'orb') drawOrb(screenX, baseY - size * 0.45, size);
      else drawPuff(screenX, baseY, size, s2.ref);
      ctx.restore();
    }
  }

  /* ---------------- rendering: viewmodel + overlays ---------------- */

  function drawViewmodel() {
    var bx = W / 2 + 34 + recoil * 3;
    var by = H - 64 + recoil * 9 + bob * 0.6;
    ctx.save();
    ctx.translate(bx, by);
    ctx.fillStyle = '#332a58';
    rr(-9, -86, 18, 58, 5);
    ctx.fill();
    ctx.fillStyle = '#4a3c80';
    rr(-12, -52, 24, 22, 6);
    ctx.fill();
    rr(-30, -34, 60, 44, 8);
    ctx.fillStyle = '#2c2350';
    ctx.fill();
    ctx.fillStyle = '#8b5cf6';
    rr(-26, -30, 52, 8, 4);
    ctx.fill();
    ctx.fillStyle = '#22d3ee';
    rr(-30, -6, 12, 26, 4);
    ctx.fill();
    ctx.fillStyle = '#1d1838';
    rr(-14, 4, 26, 42, 6);
    ctx.fill();
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.arc(16, -12, 6, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (muzzle > 0) {
      ctx.save();
      ctx.translate(bx, by - 88);
      ctx.fillStyle = 'rgba(190,235,255,.9)';
      ctx.beginPath();
      for (var i = 0; i < 8; i++) {
        var a = i / 8 * TAU;
        var r = i % 2 === 0 ? 22 : 9;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.8);
      }
      ctx.closePath();
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
      ctx.fillRect(pad + (drones[i].x - 0.25) * sc, pad + (drones[i].y - 0.25) * sc, sc * 0.5, sc * 0.5);
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
    /* wave + queue counter */
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(5,8,16,.66)';
    rr(W / 2 - 74, 10, 148, 26, 13);
    ctx.fill();
    ctx.fillStyle = '#e8eefc';
    ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
    var left = drones.length + queue.length;
    ctx.fillText('WAVE ' + wave + ' · ' + left + ' left', W / 2, 28);

    /* ammo */
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(5,8,16,.6)';
    rr(W - 108, H - 40, 98, 28, 8);
    ctx.fill();
    if (reloading) {
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('RELOADING…', W - 20, H - 21);
    } else {
      ctx.fillStyle = mag <= 3 ? '#ff9db4' : '#e8eefc';
      ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('▮'.repeat(Math.max(0, mag)) + ' ' + mag + '/' + MAG_SIZE, W - 20, H - 20);
    }
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
      if (e.repeat) return;
      start();
    } else if (k === '1') {
      if (!e.repeat) buy('fire');
    } else if (k === '2') {
      if (!e.repeat) buy('dmg');
    } else if (k === '3') {
      if (!e.repeat) buy('armor');
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
    msg: 'Endless drones, one blaster. Survive the waves, bank credits from every kill and spend them on faster fire, more damage or heavier armor between rounds. Move with WASD, jump with Space and fire with F or a click. Aim up and down with the mouse, the arrow keys or the ▲▼ buttons — shots hit hardest up close and lose power at range. Click the view to lock the mouse. How deep can you go?',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* Read-only snapshot hook for automated tests. */
  window.__wavebreak = function () {
    return {
      state: state, phase: phase,
      score: score, best: best,
      hp: hp, maxHp: maxHp,
      wave: wave, credits: credits, kills: kills, shots: shots,
      combo: combo, breatherT: breatherT,
      upgrades: { fire: upgrades.fire, dmg: upgrades.dmg, armor: upgrades.armor },
      costs: { fire: fireCost(), dmg: dmgCost(), armor: armorCost() },
      ammo: mag, reloading: reloading,
      aim: { y: aimY, min: H / 2 - AIM_MARGIN, max: H / 2 + AIM_MARGIN, margin: AIM_MARGIN },
      crosshair: { x: W / 2, y: aimY },
      lastHit: { dist: lastHit.dist, dmg: lastHit.dmg, mult: lastHit.mult },
      hits: hits,
      multAt: function (d) { return damageMultiplier(d); },
      hitPops: hitPops.length,
      target: (function () {
        var t = pickTarget();
        return t ? { type: t.drone.type, dist: t.dist, mult: damageMultiplier(t.dist) } : null;
      })(),
      player: { x: player.x, y: player.y, dir: player.dir, z: player.z, onGround: player.onGround },
      drones: drones.map(function (d) { return { x: d.x, y: d.y, hp: d.hp, maxHp: d.maxHp, type: d.type, alt: d.alt, scale: d.scale }; }),
      queued: queue.length,
      map: MAP.slice()
    };
  };
})();
