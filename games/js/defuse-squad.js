/* ============================================================
   Defuse Squad — original game for PixelPlay
   First-person raycasting raid: reach the marked site, hold the
   defuse key and hold off the defending bots for three rounds.
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
  var BEST_KEY = 'defuse-squad';
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

  /* ---------------- map ---------------- */

  var MAP = [
    '################',
    '#......#.......#',
    '#.oo.#.#.###.#.#',
    '#.oo.#.#.....#.#',
    '#......#.###.#.#',
    '###.#..#..B..#.#',
    '#...#..##.##...#',
    '#.====........##',
    '#......###.....#',
    '#.##..#...#.##.#',
    '#.##..#...#.#..#',
    '#......#...#...#',
    '#.====.#.###.#.#',
    '#......#.......#',
    '#S.............#',
    '################'
  ];
  var MH = MAP.length, MW = MAP[0].length;
  var site = { x: 10.5, y: 5.5 };
  var WALLS = { '#': [92, 120, 178], '=': [184, 138, 78], 'o': [118, 108, 198] };

  function cellAt(x, y) {
    if (x < 0 || y < 0 || x >= MW || y >= MH) return '#';
    return MAP[y].charAt(x);
  }

  function isSolid(x, y) {
    var c = cellAt(x, y);
    return c !== '.' && c !== 'B' && c !== 'S';
  }

  var openCells = [];
  (function () {
    for (var y = 0; y < MH; y++) {
      for (var x = 0; x < MW; x++) {
        if (!isSolid(x, y)) openCells.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
  })();

  /* ---------------- state ---------------- */

  var state = 'ready';              /* ready | running | paused | over */
  var phase = 'intro';              /* intro | fight | clear */
  var score = 0, hp = 100, round = 1;
  var kills = 0, shots = 0, hits = 0;
  var best = GameShell.best.get(BEST_KEY, 0);
  var bombTimer = 45, defuse = 0, defusing = false;
  var introT = 0, clearT = 0;
  var bots = [], orbs = [], puffs = [];
  var flow = null, flowT = 0;
  var spawnT = 0;
  var player = { x: 1.5, y: 14.5, dir: 0, z: 0, vz: 0, onGround: true };
  var keys = { f: false, b: false, l: false, r: false, turnL: false, turnR: false, use: false, fire: false, jump: false, space: false };
  var fireCd = 0, mag = 12, reloading = false, reloadT = 0;
  var hitMarker = 0, damageFlash = 0, shake = 0, muzzle = 0, recoil = 0;
  var bob = 0, bobT = 0;
  var rafId = 0, last = 0;
  var zbuf = new Float32Array(COLS);
  var hudSig = '';

  var MAG_SIZE = 12, FIRE_CD = 0.17, RELOAD_TIME = 1.05;
  var ROUNDS = 3;

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

  /* ---------------- flow field (bots path to the player) ---------------- */

  function buildFlow() {
    flow = new Int16Array(MW * MH).fill(-1);
    var sx = Math.floor(player.x), sy = Math.floor(player.y);
    if (isSolid(sx, sy)) return;
    var q = [sy * MW + sx], dist = 0;
    flow[sy * MW + sx] = 0;
    var head = 0;
    while (head < q.length) {
      var idx = q[head++];
      var cx = idx % MW, cy = (idx - cx) / MW;
      dist = flow[idx] + 1;
      var nb = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
      for (var i = 0; i < 4; i++) {
        var nx = nb[i][0], ny = nb[i][1];
        if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
        var ni = ny * MW + nx;
        if (flow[ni] === -1 && !isSolid(nx, ny)) { flow[ni] = dist; q.push(ni); }
      }
    }
  }

  /* ---------------- HUD ---------------- */

  function updateHud(force) {
    var right;
    if (state === 'paused') right = '⏸ Paused · Round ' + round;
    else if (document.pointerLockElement !== canvas) right = '🖱 Click the view to aim · WASD move · Space jump';
    else if (phase === 'clear') right = 'Site secured!';
    else if (phase === 'intro') right = '💣 ' + bombTimer.toFixed(1) + 's · Reach the site';
    else {
      right = '💣 ' + bombTimer.toFixed(1) + 's';
      if (defuse > 0) right += ' · Defusing ' + Math.floor(defuse * 100) + '%';
      else right += ' · Space = Jump';
    }
    var sig = [score, Math.max(best, score), Math.max(0, Math.ceil(hp)), round, right].join('|');
    if (!force && sig === hudSig) return;
    hudSig = sig;
    GameShell.hud(
      { Score: score, Best: Math.max(best, score), HP: Math.max(0, Math.ceil(hp)), Round: round + '/' + ROUNDS },
      right
    );
  }

  /* ---------------- rounds / state ---------------- */

  function botCountLeft() {
    return (3 + round * 2) - killsThisRound;
  }
  var killsThisRound = 0;

  function startRound() {
    phase = 'intro';
    introT = 2.2;
    clearT = 0;
    bombTimer = 45;
    defuse = 0;
    defusing = false;
    spawnT = 2.4;
    killsThisRound = 0;
    orbs.length = 0;
    bots.length = 0;
    flow = null;
    flowT = 0;
    reloading = false;
    mag = MAG_SIZE;
    updateHud(true);
  }

  function start() {
    score = 0; hp = 100; round = 1;
    kills = 0; shots = 0; hits = 0;
    player.x = 1.5; player.y = 14.5; player.dir = 0.2;
    player.z = 0; player.vz = 0; player.onGround = true;
    puffs.length = 0;
    releaseKeys();
    state = 'running';
    startRound();
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
      msg: 'The bomb is still ticking. Take a breath.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Round', value: round + '/' + ROUNDS },
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

  function endRun(won, reason) {
    if (state === 'over') return;
    state = 'over';
    releaseKeys();
    var acc = shots > 0 ? Math.round(hits / shots * 100) : 0;
    var isBest = score > best;
    if (isBest) {
      best = score;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud(true);
    GameShell.overlay.show({
      title: won ? 'Run complete!' : (isBest ? 'New high score!' : 'Game over'),
      msg: won
        ? 'All three sites are safe. You cleared the raid with ' + score + ' points.'
        : (reason || 'The raid fell apart.') + ' You reached round ' + round +
          ' and scored ' + score + ' point' + (score === 1 ? '' : 's') + '.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Rounds', value: (won ? ROUNDS : round - 1) + '/' + ROUNDS },
        { label: 'Kills', value: kills },
        { label: 'Accuracy', value: acc + '%' }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  function roundCleared() {
    var bonus = 350 * round + Math.floor(bombTimer) * 12;
    score += bonus;
    if (round >= ROUNDS) {
      score += 800;
      endRun(true);
      return;
    }
    phase = 'clear';
    clearT = 2.4;
    bots.length = 0;
    orbs.length = 0;
    hp = Math.min(100, hp + 20);
    reloading = false;
    mag = MAG_SIZE;
    defusing = false;
    updateHud(true);
  }

  function roundFailed(reason) {
    endRun(false, reason);
  }

  function nextRound() {
    round++;
    startRound();
  }

  function releaseKeys() {
    keys.f = keys.b = keys.l = keys.r = false;
    keys.turnL = keys.turnR = keys.use = keys.fire = false;
    keys.jump = keys.space = false;
    defusing = false;
  }

  /* ---------------- bots ---------------- */

  function spawnBot() {
    var c = null;
    for (var i = 0; i < 14; i++) {
      var t = openCells[(Math.random() * openCells.length) | 0];
      var d = Math.abs(t.x - player.x) + Math.abs(t.y - player.y);
      if (d > 7) { c = t; break; }
    }
    if (!c) c = openCells[(Math.random() * openCells.length) | 0];
    bots.push({
      x: c.x, y: c.y,
      hp: Math.min(3, 1 + Math.floor((round - 1) / 2) + (round >= 3 && Math.random() < 0.3 ? 1 : 0)),
      speed: 1.45 + round * 0.22,
      fireT: rnd(0.8, 1.8),
      interval: Math.max(1.05, 2.3 - round * 0.35),
      orbSpeed: 5 + round * 0.6,
      dmg: 6 + round * 2,
      flash: 0, wob: Math.random() * TAU
    });
    puffs.push({ x: c.x, y: c.y, t: 0, life: 0.4 });
  }

  function updateBots(dt) {
    var i, b;
    flowT -= dt;
    if (flowT <= 0) { buildFlow(); flowT = 0.35; }

    for (i = bots.length - 1; i >= 0; i--) {
      b = bots[i];
      if (b.flash > 0) b.flash -= dt;
      var dx = player.x - b.x, dy = player.y - b.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var los = d < 0.001 || !losBlocked(b.x, b.y, player.x, player.y);

      if (los && d < 4.6) {
        /* in range with a line of fire — shoot */
        b.fireT -= dt;
        if (b.fireT <= 0) {
          b.fireT = b.interval;
          var a = Math.atan2(dy, dx) + rnd(-0.06, 0.06);
          orbs.push({
            x: b.x + Math.cos(a) * 0.4, y: b.y + Math.sin(a) * 0.4,
            vx: Math.cos(a) * b.orbSpeed, vy: Math.sin(a) * b.orbSpeed,
            dmg: b.dmg
          });
        }
      } else {
        /* advance along the flow field */
        var mvx = 0, mvy = 0;
        if (los) { mvx = dx / (d || 1); mvy = dy / (d || 1); }
        else if (flow) {
          var cx = Math.floor(b.x), cy = Math.floor(b.y);
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
          if (tx >= 0) { mvx = (tx + 0.5 - b.x); mvy = (ty + 0.5 - b.y); }
          else { mvx = dx / (d || 1); mvy = dy / (d || 1); }
        } else { mvx = dx / (d || 1); mvy = dy / (d || 1); }
        var ml = Math.sqrt(mvx * mvx + mvy * mvy) || 1;
        tryMove(b, mvx / ml * b.speed * dt, mvy / ml * b.speed * dt, 0.26);
      }
    }

    /* orbs */
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
        orbs.splice(i, 1);
        updateHud();
        if (hp <= 0) { hp = 0; updateHud(); roundFailed('Your bot was disabled in the field.'); return; }
      }
    }
  }

  /* ---------------- shooting ---------------- */

  function beginReload() {
    if (reloading || mag === MAG_SIZE) return;
    reloading = true;
    reloadT = RELOAD_TIME;
  }

  function shoot() {
    if (state !== 'running' || phase === 'clear') return;
    if (reloading || fireCd > 0) return;
    if (mag <= 0) { beginReload(); return; }
    fireCd = FIRE_CD;
    mag--;
    shots++;
    muzzle = 0.06;
    recoil = 1;
    shake = Math.max(shake, 2.5);

    /* hitscan along the view centre */
    var rdx = Math.cos(player.dir), rdy = Math.sin(player.dir);
    var hitB = null, hitD = 1e9;
    for (var i = 0; i < bots.length; i++) {
      var b = bots[i];
      var vx = b.x - player.x, vy = b.y - player.y;
      var along = vx * rdx + vy * rdy;
      if (along <= 0 || along > 24) continue;
      var perp = Math.abs(vx * rdy - vy * rdx);
      if (perp > 0.34) continue;
      if (along < hitD && !losBlocked(player.x, player.y, b.x, b.y)) {
        hitD = along;
        hitB = b;
      }
    }
    var wallHit = castRay(player.x, player.y, rdx, rdy).dist;
    if (hitB && hitD < wallHit) {
      hits++;
      hitMarker = 1;
      hitB.hp--;
      hitB.flash = 0.12;
      score += 10;
      if (hitB.hp <= 0) {
        var idx = bots.indexOf(hitB);
        if (idx >= 0) bots.splice(idx, 1);
        kills++;
        killsThisRound++;
        score += 70 + round * 50;
        puffs.push({ x: hitB.x, y: hitB.y, t: 0, life: 0.45 });
      }
      updateHud();
    }
    if (mag <= 0) beginReload();
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    var i;

    /* jump/gravity */
    if ((keys.jump || keys.space) && player.onGround) {
      player.vz = JUMP_VEL;
      player.onGround = false;
      keys.space = keys.jump = false;
    }
    player.z += player.vz * dt;
    player.vz -= GRAVITY * dt;
    if (player.z < 0) {
      player.z = 0;
      player.vz = 0;
      player.onGround = true;
    }

    if (phase === 'intro') {
      introT -= dt;
      if (introT <= 0) phase = 'fight';
    } else if (phase === 'clear') {
      clearT -= dt;
      if (clearT <= 0) { nextRound(); return; }
    }

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
      var sp = 2.9 * dt / ml;
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

    /* defuse */
    var dxs = player.x - site.x, dys = player.y - site.y;
    var nearSite = dxs * dxs + dys * dys < 2.35;
    defusing = false;
    if (phase === 'fight') {
      bombTimer -= dt;
      if (keys.use && nearSite && defuse < 1) {
        defusing = true;
        defuse = Math.min(1, defuse + dt / 3);
        if (defuse >= 1) { roundCleared(); updateHud(); return; }
      } else if (defuse > 0) {
        defuse = Math.max(0, defuse - dt * 0.09);
      }
      if (bombTimer <= 0) { bombTimer = 0; updateHud(); roundFailed('The bomb detonated before the site was safe.'); return; }
    }

    /* bots */
    if (phase === 'fight' && introT <= 0 && botCountLeft() > 0) {
      spawnT -= dt * (defusing ? 1.55 : 1);
      if (spawnT <= 0 && bots.length < 6) {
        spawnT = Math.max(1.4, 4.0 - round * 0.8);
        spawnBot();
      }
    }
    if (bots.length || orbs.length) updateBots(dt);
    else { flowT -= dt; if (flowT <= 0) { buildFlow(); flowT = 0.35; } }

    /* fx timers */
    for (i = puffs.length - 1; i >= 0; i--) {
      puffs[i].t += dt;
      if (puffs[i].t >= puffs[i].life) puffs.splice(i, 1);
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
    /* ceiling + floor shading */
    var g1 = ctx.createLinearGradient(0, 0, 0, horizon);
    g1.addColorStop(0, '#070b16');
    g1.addColorStop(1, '#182238');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, horizon);
    var g2 = ctx.createLinearGradient(0, horizon, 0, H);
    g2.addColorStop(0, '#141d31');
    g2.addColorStop(1, '#0a0e1a');
    ctx.fillStyle = g2;
    ctx.fillRect(0, horizon, W, H - horizon);
    ctx.fillStyle = 'rgba(245,158,11,.05)';
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
      var f = clamp(1.12 - dist * 0.085, 0.15, 1) * (hit.side === 1 ? 0.72 : 1);
      if (hit.wallX < 0.05 || hit.wallX > 0.95) f *= 0.55;
      else if (Math.sin(hit.wallX * Math.PI * 4) > 0.86) f *= 0.82;
      var r = base[0] * f + 8 * (1 - f);
      var g = base[1] * f + 12 * (1 - f);
      var b = base[2] * f + 24 * (1 - f);
      ctx.fillStyle = 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
      ctx.fillRect(x * STRIP, top, STRIP, lineH);
    }
  }

  /* ---------------- rendering: sprites ---------------- */

  function drawBot(cx, baseY, size, b, t) {
    var bobY = Math.sin(t / 240 + b.wob) * size * 0.05;
    var y = baseY - size * 0.52 + bobY;
    ctx.save();
    ctx.translate(cx, y);
    var white = b.flash > 0;
    /* hover glow */
    ctx.fillStyle = 'rgba(255,92,122,.18)';
    ctx.beginPath();
    ctx.ellipse(0, size * 0.46 - bobY, size * 0.3, size * 0.08, 0, 0, TAU);
    ctx.fill();
    /* legs */
    ctx.fillStyle = white ? '#ffffff' : '#3d4668';
    ctx.fillRect(-size * 0.2, size * 0.12, size * 0.11, size * 0.3);
    ctx.fillRect(size * 0.09, size * 0.12, size * 0.11, size * 0.3);
    /* body */
    rr(-size * 0.26, -size * 0.1, size * 0.52, size * 0.34, size * 0.09);
    ctx.fillStyle = white ? '#ffffff' : '#5a6896';
    ctx.fill();
    /* head */
    rr(-size * 0.19, -size * 0.42, size * 0.38, size * 0.3, size * 0.08);
    ctx.fillStyle = white ? '#ffffff' : '#6d7cae';
    ctx.fill();
    /* visor */
    rr(-size * 0.13, -size * 0.32, size * 0.26, size * 0.09, size * 0.04);
    ctx.fillStyle = white ? '#ffe9ee' : '#ff5c7a';
    ctx.fill();
    /* antenna */
    ctx.strokeStyle = white ? '#ffffff' : '#8b9ac9';
    ctx.lineWidth = Math.max(1, size * 0.025);
    ctx.beginPath();
    ctx.moveTo(size * 0.12, -size * 0.42);
    ctx.lineTo(size * 0.16, -size * 0.56);
    ctx.stroke();
    ctx.fillStyle = '#ffb02e';
    ctx.beginPath();
    ctx.arc(size * 0.16, -size * 0.56, Math.max(1, size * 0.035), 0, TAU);
    ctx.fill();
    ctx.restore();

    /* health pip above the bot */
    if (b.hp > 1 && !white) {
      var w = size * 0.3, frac = b.hp / 3;
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(cx - w / 2, y - size * 0.68, w, Math.max(2, size * 0.04));
      ctx.fillStyle = '#ff5c7a';
      ctx.fillRect(cx - w / 2, y - size * 0.68, w * clamp(frac, 0, 1), Math.max(2, size * 0.04));
    }
  }

  function drawOrb(cx, cy, size) {
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.5);
    g.addColorStop(0, 'rgba(255,214,170,.95)');
    g.addColorStop(0.45, 'rgba(255,140,90,.8)');
    g.addColorStop(1, 'rgba(255,90,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.5, 0, TAU);
    ctx.fill();
  }

  function drawBeacon(cx, baseY, size, t) {
    var pulse = 0.7 + 0.3 * Math.sin(t / 320);
    var top = baseY - size * 1.5;
    var g = ctx.createLinearGradient(0, top, 0, baseY);
    g.addColorStop(0, 'rgba(14,165,233,0)');
    g.addColorStop(0.6, 'rgba(14,165,233,' + (0.22 * pulse).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(14,165,233,' + (0.4 * pulse).toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(cx - size * 0.16, top, size * 0.32, size * 1.5);
    /* base ring */
    ctx.strokeStyle = 'rgba(245,158,11,' + (0.75 * pulse).toFixed(3) + ')';
    ctx.lineWidth = Math.max(1.5, size * 0.03);
    ctx.beginPath();
    ctx.ellipse(cx, baseY, size * 0.42, size * 0.12, 0, 0, TAU);
    ctx.stroke();
    /* floating marker */
    var my = top + size * 0.1 + Math.sin(t / 260) * size * 0.05;
    ctx.save();
    ctx.translate(cx, my);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#f59e0b';
    var s = size * 0.1;
    ctx.fillRect(-s, -s, s * 2, s * 2);
    ctx.restore();
  }

  function drawPuff(cx, baseY, size, p) {
    var f = 1 - p.t / p.life;
    ctx.fillStyle = 'rgba(180,200,255,' + (0.5 * f).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(cx, baseY - size * 0.4, size * (0.2 + 0.3 * (1 - f)), 0, TAU);
    ctx.fill();
  }

  function renderSprites(dirX, dirY, plX, plY, horizon, t) {
    var list = [];
    var i;
    for (i = 0; i < bots.length; i++) {
      var b = bots[i];
      var dx = b.x - player.x, dy = b.y - player.y;
      list.push({ x: dx, y: dy, kind: 'bot', ref: b, scale: 0.95 });
    }
    for (i = 0; i < orbs.length; i++) {
      var o = orbs[i];
      list.push({ x: o.x - player.x, y: o.y - player.y, kind: 'orb', ref: o, scale: 0.42 });
    }
    for (i = 0; i < puffs.length; i++) {
      var pf = puffs[i];
      list.push({ x: pf.x - player.x, y: pf.y - player.y, kind: 'puff', ref: pf, scale: 0.7 });
    }
    list.push({ x: site.x - player.x, y: site.y - player.y, kind: 'beacon', ref: null, scale: 1 });

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
      var baseY = horizon + (H * 0.5) / s2.trY;
      if (screenX < -size || screenX > W + size) continue;

      var halfW = size * (s2.kind === 'beacon' ? 0.55 : s2.kind === 'orb' ? 0.5 : 0.42);
      var x0 = Math.max(0, Math.ceil(screenX - halfW));
      var x1 = Math.min(W - STRIP, Math.floor(screenX + halfW));
      if (x1 < x0) continue;

      /* visible stripe runs (walls occlude sprites) */
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
      if (s2.kind === 'bot') drawBot(screenX, baseY, size, s2.ref, t);
      else if (s2.kind === 'orb') drawOrb(screenX, baseY - size * 0.45, size);
      else if (s2.kind === 'beacon') drawBeacon(screenX, baseY, size, t);
      else drawPuff(screenX, baseY, size, s2.ref);
      ctx.restore();
    }
  }

  /* ---------------- rendering: viewmodel + overlays ---------------- */

  function drawViewmodel(t) {
    var bx = W / 2 + 34 + recoil * 3;
    var by = H - 64 + recoil * 9 + bob * 0.6;
    ctx.save();
    ctx.translate(bx, by);
    /* barrel */
    ctx.fillStyle = '#2c3554';
    rr(-9, -86, 18, 58, 5);
    ctx.fill();
    ctx.fillStyle = '#3f4d7a';
    rr(-12, -52, 24, 22, 6);
    ctx.fill();
    /* body */
    rr(-30, -34, 60, 44, 8);
    ctx.fillStyle = '#273050';
    ctx.fill();
    ctx.fillStyle = '#0ea5e9';
    rr(-26, -30, 52, 8, 4);
    ctx.fill();
    /* grip */
    ctx.fillStyle = '#1e2742';
    rr(-14, 4, 26, 42, 6);
    ctx.fill();
    /* amber core light */
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(16, -12, 6, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (muzzle > 0) {
      ctx.save();
      ctx.translate(bx, by - 88);
      ctx.fillStyle = 'rgba(255,210,120,.9)';
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
    var cx = W / 2, cy = H / 2;
    ctx.strokeStyle = 'rgba(232,238,252,.9)';
    ctx.lineWidth = 2;
    var g = 6, l = 8;
    ctx.beginPath();
    ctx.moveTo(cx - g - l, cy); ctx.lineTo(cx - g, cy);
    ctx.moveTo(cx + g, cy); ctx.lineTo(cx + g + l, cy);
    ctx.moveTo(cx, cy - g - l); ctx.lineTo(cx, cy - g);
    ctx.moveTo(cx, cy + g); ctx.lineTo(cx, cy + g + l);
    ctx.stroke();
    ctx.fillStyle = 'rgba(245,158,11,.9)';
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
  }

  function drawMinimap() {
    var sc = 3.4, pad = 10;
    var mw = MW * sc, mh = MH * sc;
    ctx.fillStyle = 'rgba(5,8,16,.72)';
    rr(pad - 4, pad - 4, mw + 8, mh + 8, 6);
    ctx.fill();
    for (var y = 0; y < MH; y++) {
      for (var x = 0; x < MW; x++) {
        if (isSolid(x, y)) {
          var c = cellAt(x, y);
          ctx.fillStyle = c === '=' ? 'rgba(184,138,78,.75)'
                        : c === 'o' ? 'rgba(118,108,198,.75)'
                                    : 'rgba(92,120,178,.6)';
          ctx.fillRect(pad + x * sc, pad + y * sc, sc, sc);
        }
      }
    }
    /* site waypoint */
    var pulse = 0.55 + 0.45 * Math.sin(Date.now() / 260);
    ctx.fillStyle = 'rgba(245,158,11,' + pulse.toFixed(2) + ')';
    ctx.fillRect(pad + (site.x - 0.4) * sc, pad + (site.y - 0.4) * sc, sc * 0.8, sc * 0.8);
    /* bots */
    ctx.fillStyle = '#ff5c7a';
    for (var i = 0; i < bots.length; i++) {
      ctx.fillRect(pad + (bots[i].x - 0.25) * sc, pad + (bots[i].y - 0.25) * sc, sc * 0.5, sc * 0.5);
    }
    /* player + view cone */
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

  function drawWaypoint(dirX, dirY, plX, plY) {
    var wx = site.x - player.x, wy = site.y - player.y;
    var dist = Math.sqrt(wx * wx + wy * wy);
    var trY = (-plY * wx + plX * wy) * (1 / (plX * dirY - dirX * plY));
    var trX = (dirY * wx - dirX * wy) * (1 / (plX * dirY - dirX * plY));
    if (trY > 0.2) {
      var screenX = (W / 2) * (1 + trX / trY);
      if (screenX >= 40 && screenX <= W - 40) return; /* visible on screen, beacon draws it */
    }
    var a = Math.atan2(wy, wx) - player.dir;
    a = normAng(a);
    var margin = 46;
    var ex = W / 2 + Math.cos(a) * (W / 2 - margin);
    var ey = H / 2 + Math.sin(a) * (H / 2 - margin);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(245,158,11,.92)';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-6, -9);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-6, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(245,158,11,.9)';
    ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(dist) + 'm', ex, ey + 22);
  }

  function drawBanner() {
    ctx.textAlign = 'center';
    if (phase === 'intro' && introT > 0) {
      ctx.fillStyle = 'rgba(232,238,252,.95)';
      ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('ROUND ' + round + ' — REACH THE SITE', W / 2, 120);
      ctx.fillStyle = 'rgba(14,165,233,.95)';
      ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('Follow the amber waypoint, then hold F to defuse', W / 2, 148);
    } else if (phase === 'clear' && clearT > 0) {
      ctx.fillStyle = 'rgba(46,230,166,.95)';
      ctx.font = 'bold 32px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('SITE SECURED!', W / 2, H * 0.4);
      ctx.fillStyle = 'rgba(232,238,252,.9)';
      ctx.font = 'bold 16px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('Round ' + round + ' cleared · repairing for round ' + (round + 1), W / 2, H * 0.4 + 28);
    }
  }

  function drawStatus() {
    /* bomb timer pill */
    var danger = bombTimer <= 10 && phase === 'fight';
    ctx.textAlign = 'center';
    ctx.fillStyle = danger ? 'rgba(255,92,122,.22)' : 'rgba(5,8,16,.66)';
    rr(W / 2 - 62, 10, 124, 26, 13);
    ctx.fill();
    ctx.fillStyle = danger ? '#ff9db4' : '#e8eefc';
    ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('💣 ' + Math.max(0, bombTimer).toFixed(1) + 's', W / 2, 28);

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

    /* defuse bar */
    var dxs = player.x - site.x, dys = player.y - site.y;
    var nearSite = dxs * dxs + dys * dys < 2.35;
    if (phase === 'fight' && (defuse > 0 || nearSite)) {
      var bw = 260, bx = W / 2 - bw / 2, by = H - 96;
      ctx.fillStyle = 'rgba(5,8,16,.7)';
      rr(bx - 8, by - 26, bw + 16, 44, 10);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      rr(bx, by, bw, 10, 5);
      ctx.fill();
      if (defuse > 0) {
        ctx.fillStyle = defusing ? '#2ee6a6' : '#f59e0b';
        rr(bx, by, Math.max(4, bw * defuse), 10, 5);
        ctx.fill();
      }
      ctx.fillStyle = '#e8eefc';
      ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      if (nearSite) {
        ctx.fillText(defusing ? 'DEFUSING… hold ' : 'HOLD F (or E) TO DEFUSE',
          W / 2, by + 22 - 4);
      } else if (defuse > 0) {
        ctx.fillStyle = 'rgba(245,158,11,.95)';
        ctx.fillText('DEFUSE PAUSED — ' + Math.floor(defuse * 100) + '% · get back to the site!', W / 2, by + 18);
      }
    }
  }

  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070e';
    ctx.fillRect(0, 0, W, H);

    var dirX = Math.cos(player.dir), dirY = Math.sin(player.dir);
    var plX = -dirY * FOV_PLANE, plY = dirX * FOV_PLANE;
    var horizon = H / 2 + bob + player.z * 260;

    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    renderWalls(dirX, dirY, plX, plY, horizon);
    renderSprites(dirX, dirY, plX, plY, horizon, t);
    drawWaypoint(dirX, dirY, plX, plY);
    drawViewmodel(t);
    ctx.restore();

    drawCrosshair();
    drawMinimap();
    drawStatus();
    drawBanner();

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

    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === ' ') e.preventDefault();

    if (k === 'w' || k === 'W') keys.f = true;
    else if (k === 's' || k === 'S') keys.b = true;
    else if (k === 'a' || k === 'A') keys.l = true;
    else if (k === 'd' || k === 'D') keys.r = true;
    else if (k === 'ArrowLeft') keys.turnL = true;
    else if (k === 'ArrowRight') keys.turnR = true;
    else if (k === 'f' || k === 'F' || k === 'e' || k === 'E') keys.use = true;
    else if (k === ' ') {
      if (e.repeat) return;
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
      else keys.jump = true;
    } else if (k === 'z' || k === 'Z') {
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
    else if (k === 'f' || k === 'F' || k === 'e' || k === 'E') keys.use = false;
    else if (k === ' ') keys.jump = false;
    else if (k === 'z' || k === 'Z') keys.fire = false;
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
      }
      function off() {
        if (act === 'fire') keys.fire = false;
        else if (act === 'jump') keys.jump = false;
        else if (act === 'left') keys.turnL = false;
        else if (act === 'right') keys.turnR = false;
      }
      btn.addEventListener('pointerdown', function (ev) { ev.preventDefault(); on(); });
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointerleave', off);
      btn.addEventListener('pointercancel', off);
    })(padBtns[pb]);
  }

  var dragX = null;
  canvas.addEventListener('pointerdown', function (ev) {
    if (state !== 'running') return;
    if (ev.pointerType !== 'touch' && document.pointerLockElement !== canvas &&
        canvas.requestPointerLock) {
      /* first click locks the mouse (like a classic PC shooter); locked clicks fire.
         dragX is kept so dragging still turns if the browser refuses the lock. */
      dragX = ev.clientX;
      try {
        var pr = canvas.requestPointerLock();
        if (pr && pr.catch) pr.catch(function () { /* lock refused */ });
      } catch (err) { /* pointer lock unavailable */ }
      return;
    }
    dragX = ev.clientX;
    if (ev.button === 0 || ev.button === undefined) keys.fire = true;
  });

  window.addEventListener('pointerup', function () {
    keys.fire = false;
    dragX = null;
  });

  document.addEventListener('mousemove', function (e) {
    if (state !== 'running') return;
    var mx = 0;
    if (document.pointerLockElement === canvas) {
      mx = e.movementX || 0;
      player.dir = normAng(player.dir + mx * 0.0024);
    } else if (dragX !== null && e.clientX !== undefined) {
      player.dir = normAng(player.dir + (e.clientX - dragX) * 0.005);
      dragX = e.clientX;
    }
  });

  document.addEventListener('pointerlockchange', function () {
    if (document.pointerLockElement === canvas) updateHud(true);
    else if (state === 'running') pause();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  window.addEventListener('blur', function () {
    if (state === 'running') pause();
  });

  /* ---------------- boot ---------------- */

  startRound();
  updateHud(true);
  ensureLoop();
  GameShell.overlay.show({
    title: 'Defuse Squad',
    msg: 'Raid the compound in first person: reach the glowing site, hold F to defuse and keep the defending bots off your back before the 45-second timer runs out. Click the view to lock the mouse for smooth aiming — press Space to jump and Z or a click to fire. Three rounds — go.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* Read-only snapshot hooks for automated tests. */
  window.__defuseSquad = window['__defuse-squad'] = function () {
    return {
      state: state, phase: phase,
      score: score, best: best, hp: hp, round: round, maxRound: ROUNDS,
      kills: kills, shots: shots, hits: hits,
      defuse: defuse, defusing: defusing, bombTimer: bombTimer,
      ammo: mag, reloading: reloading,
      player: { x: player.x, y: player.y, dir: player.dir, z: player.z, onGround: player.onGround },
      site: { x: site.x, y: site.y },
      bots: bots.map(function (b) { return { x: b.x, y: b.y, hp: b.hp }; }),
      map: MAP.slice()
    };
  };
})();
