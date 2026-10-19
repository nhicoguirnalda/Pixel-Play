/* ============================================================
   Strike Zone — original game for PixelPlay
   Canvas first-person shooter: hand-written raycasting engine,
   textured wall strips, depth-buffered robot sprites, corner
   minimap, three maze zones and hostile training bots.
   Keyboard is enough: WASD + arrows + Space. Mouse look with
   pointer lock is a bonus.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 640, H = 480;
  var BEST_KEY = 'strike-zone';
  var FONT = '"Segoe UI", system-ui, sans-serif';
  var FOV_PLANE = 0.66;                  /* ~66° horizontal field of view */
  var TURN_SPEED = 2.4;                  /* rad/s with arrow keys */
  var MOUSE_SENS = 0.0023;
  var MOVE_SPEED = 3.2, STRAFE_SPEED = 2.8;
  var PLAYER_R = 0.28;

  /* Jump / gravity (Space) */
  var JUMP_VEL = 2.6;
  var GRAVITY = 11.5;

  var MAX_HP = 100;
  var MAG = 14, FIRE_CD = 0.16, RELOAD_TIME = 1.05;

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

  /* ---------------- maps ----------------
     #  hard brick wall      =  panel wall      *  neon-striped wall
     .  open floor           P  player start    B  training-bot spawn  */

  var MAP1 = [
    '################',
    '#P.......#.....#',
    '#.....B..#.....#',
    '#..##....#.....#',
    '#..##.........##',
    '#.....###......#',
    '#..B...........#',
    '#.....###......#',
    '#......B.......#',
    '#..##.......#..#',
    '#..#........#..#',
    '#..#........#..#',
    '#..............#',
    '#....###...#...#',
    '#..............#',
    '################'
  ];

  var MAP2 = [
    '################',
    '#P....=........#',
    '#.....=..###...#',
    '#..#.....#.....#',
    '#..#..=..#..#..#',
    '#.....=.....B..#',
    '#.###...####...#',
    '#...#......#...#',
    '#......B...#...#',
    '###..###...#...#',
    '#......#...#...#',
    '#..##..#...#.B.#',
    '#......#.......#',
    '#..B...####..#.#',
    '#.....B........#',
    '################'
  ];

  var MAP3 = [
    '################',
    '#P....#.....#..#',
    '#..B..#..#..#..#',
    '#.....#..#.....#',
    '#.##..#..####..#',
    '#.....#........#',
    '###.####.###...#',
    '#......*.......#',
    '#..#...*...#...#',
    '#..B...*...#..B#',
    '#......*...B...#',
    '#..##..*..##...#',
    '#..B...#......B#',
    '#.....##...B...#',
    '#......*.......#',
    '################'
  ];

  var LEVELS = [
    { name: 'Training Hall', map: MAP1, fireCd: 1.7, dmg: 7, speed: 1.6, hp: 2,  angle: 0 },
    { name: 'Circuit Maze',  map: MAP2, fireCd: 1.4, dmg: 8, speed: 1.85, hp: 2, angle: 0 },
    { name: 'Core Reactor',  map: MAP3, fireCd: 1.15, dmg: 9, speed: 2.05, hp: 3, angle: 0 }
  ];

  /* ---------------- state ---------------- */

  var state = 'ready';            /* ready | running | paused | over */
  var best = GameShell.best.get(BEST_KEY, 0);
  var score = 0, hp = MAX_HP, level = 1;
  var grid = [], mapW = 16, mapH = 16;
  var player = { x: 1.5, y: 1.5, a: 0 };
  var bots = [], botsAlive = 0;
  var ammo = MAG, reloading = 0, fireCd = 0;
  var keys = {
    fwd: false, back: false, left: false, right: false,
    turnL: false, turnR: false, space: false, jump: false, fire: false, mouse: false
  };
  var muzzleT = 0, hitT = 0, dmgFlash = 0, recoil = 0;
  var bannerT = 0, banner1 = '', banner2 = '';
  var pendingLevel = 0;
  var zBuf = new Float64Array(W);
  var rafId = 0, last = 0;

  /* ---------------- helpers ---------------- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rand(n) { return Math.floor(Math.random() * n); }

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function isWall(x, y) {
    var mx = Math.floor(x), my = Math.floor(y);
    if (mx < 0 || my < 0 || mx >= mapW || my >= mapH) return true;
    return grid[my][mx] !== 0;
  }

  function cellOpen(mx, my) {
    if (mx < 0 || my < 0 || mx >= mapW || my >= mapH) return false;
    return grid[my][mx] === 0;
  }

  /* circle vs walls: used for the player and the bots */
  function blocked(x, y, r) {
    return isWall(x - r, y - r) || isWall(x + r, y - r) ||
           isWall(x - r, y + r) || isWall(x + r, y + r);
  }

  /* ---------------- raycasting ---------------- */

  /* DDA grid march from (ox,oy) along (rdx,rdy).
     Perpendicular distance works for camera rays; with a unit
     direction it is also the plain world distance (hitscan/LOS). */
  function castDDA(ox, oy, rdx, rdy) {
    var mapX = Math.floor(ox), mapY = Math.floor(oy);
    var ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
    var ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
    var stepX, stepY, sideX, sideY;
    if (rdx < 0) { stepX = -1; sideX = (ox - mapX) * ddx; }
    else { stepX = 1; sideX = (mapX + 1 - ox) * ddx; }
    if (rdy < 0) { stepY = -1; sideY = (oy - mapY) * ddy; }
    else { stepY = 1; sideY = (mapY + 1 - oy) * ddy; }

    var side = 0, type = 0, guard = 0;
    while (guard++ < 96) {
      if (sideX < sideY) { sideX += ddx; mapX += stepX; side = 0; }
      else { sideY += ddy; mapY += stepY; side = 1; }
      if (mapX < 0 || mapY < 0 || mapX >= mapW || mapY >= mapH) { type = 1; break; }
      type = grid[mapY][mapX];
      if (type) break;
    }

    var dist = side === 0 ? (sideX - ddx) : (sideY - ddy);
    if (!(dist > 0.0001)) dist = 0.0001;

    var wallX = side === 0 ? oy + dist * rdy : ox + dist * rdx;
    wallX -= Math.floor(wallX);
    var texX = Math.floor(wallX * 64);
    if (texX < 0) texX = 0; else if (texX > 63) texX = 63;
    if (side === 0 && rdx > 0) texX = 63 - texX;
    if (side === 1 && rdy < 0) texX = 63 - texX;

    return { dist: dist, side: side, type: type || 1, texX: texX };
  }

  function lineOfSight(ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.001) return true;
    var hit = castDDA(ax, ay, dx / d, dy / d);
    return hit.dist >= d - 0.3;
  }

  /* ---------------- wall textures (procedural) ---------------- */

  var TEX = null;

  function makeTexture(kind) {
    var c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    var s = c.getContext('2d');
    if (!s) return null;

    if (kind === 1) {                       /* brick */
      s.fillStyle = '#1b2440';
      s.fillRect(0, 0, 64, 64);
      s.fillStyle = '#141b31';
      for (var y = 0; y < 64; y += 16) s.fillRect(0, y + 14, 64, 2);
      for (var row = 0; row < 4; row++) {
        var off = (row % 2) ? 16 : 48;
        s.fillRect(off, row * 16, 2, 14);
        s.fillRect((off + 32) % 64, row * 16, 2, 14);
      }
      s.fillStyle = 'rgba(120,150,220,.10)';
      for (y = 0; y < 64; y += 16) s.fillRect(0, y, 64, 2);
    } else if (kind === 2) {                /* metal panel */
      s.fillStyle = '#27344f';
      s.fillRect(0, 0, 64, 64);
      s.fillStyle = '#1d2740';
      s.fillRect(4, 4, 56, 56);
      s.fillStyle = 'rgba(96,130,190,.35)';
      s.fillRect(8, 8, 48, 2);
      s.fillStyle = 'rgba(8,12,24,.6)';
      s.fillRect(8, 54, 48, 2);
      s.fillStyle = 'rgba(140,175,235,.55)';
      s.fillRect(10, 10, 3, 3);
      s.fillRect(51, 10, 3, 3);
      s.fillRect(10, 51, 3, 3);
      s.fillRect(51, 51, 3, 3);
      s.fillStyle = 'rgba(34,211,238,.5)';
      s.fillRect(24, 26, 16, 3);
    } else {                                /* neon stripes */
      s.fillStyle = '#0f1626';
      s.fillRect(0, 0, 64, 64);
      s.fillStyle = '#131c30';
      for (y = 0; y < 64; y += 8) s.fillRect(0, y + 6, 64, 2);
      s.fillStyle = '#a3e635';
      s.fillRect(0, 20, 64, 5);
      s.fillStyle = 'rgba(163,230,53,.35)';
      s.fillRect(0, 25, 64, 3);
      s.fillRect(0, 17, 64, 3);
      s.fillStyle = '#22d3ee';
      s.fillRect(0, 46, 64, 3);
    }
    return c;
  }

  /* ---------------- sprite scratch ---------------- */

  var scratch = null;

  function drawBotSprite(bot) {
    if (!scratch) return;
    var s = scratch.getContext('2d');
    if (!s) return;
    var flash = bot.hitT > 0;
    var eye = flash ? '#ffffff' : (bot.alert ? '#ff5c7a' : '#22d3ee');
    s.clearRect(0, 0, 64, 96);

    /* treads */
    s.fillStyle = flash ? '#e8eefc' : '#1c2438';
    s.beginPath();
    if (s.roundRect) s.roundRect(6, 70, 52, 22, 8);
    else s.rect(6, 70, 52, 22);
    s.fill();
    s.fillStyle = '#2c3854';
    for (var i = 0; i < 4; i++) {
      s.beginPath();
      s.arc(14 + i * 12, 81, 5, 0, Math.PI * 2);
      s.fill();
    }

    /* torso */
    s.fillStyle = flash ? '#ffffff' : '#3d4d70';
    s.beginPath();
    if (s.roundRect) s.roundRect(12, 34, 40, 38, 7);
    else s.rect(12, 34, 40, 38);
    s.fill();
    s.fillStyle = flash ? '#ffffff' : (bot.alert ? '#ff5c7a' : '#2ee6a6');
    s.beginPath();
    s.arc(32, 50, 5, 0, Math.PI * 2);
    s.fill();

    /* arms */
    s.fillStyle = flash ? '#e8eefc' : '#4a5b82';
    s.fillRect(5, 38, 8, 26);
    s.fillRect(51, 38, 8, 26);

    /* head + visor */
    s.fillStyle = flash ? '#ffffff' : '#4a5b82';
    s.beginPath();
    if (s.roundRect) s.roundRect(16, 10, 32, 24, 6);
    else s.rect(16, 10, 32, 24);
    s.fill();
    s.fillStyle = '#0b1020';
    s.fillRect(20, 16, 24, 10);

    /* glowing eye */
    s.fillStyle = eye;
    s.beginPath();
    s.arc(32, 21, bot.eyeT > 0 ? 6 : 4, 0, Math.PI * 2);
    s.fill();

    /* antenna */
    s.fillStyle = '#8fa3c8';
    s.fillRect(31, 2, 2, 9);
    s.fillStyle = bot.eyeT > 0 ? '#ff5c7a' : '#f59e0b';
    s.beginPath();
    s.arc(32, 3, 3, 0, Math.PI * 2);
    s.fill();
  }

  /* ---------------- map loading ---------------- */

  function loadLevel(n) {
    var L = LEVELS[n - 1];
    if (!L) L = LEVELS[LEVELS.length - 1];
    level = n;

    grid = [];
    bots = [];
    var spawn = null, botSpots = [];
    for (var y = 0; y < L.map.length; y++) {
      var row = L.map[y];
      var line = [];
      for (var x = 0; x < row.length; x++) {
        var ch = row.charAt(x);
        if (ch === '#') line.push(1);
        else if (ch === '=') line.push(2);
        else if (ch === '*') line.push(3);
        else {
          line.push(0);
          if (ch === 'P') spawn = { x: x + 0.5, y: y + 0.5 };
          else if (ch === 'B') botSpots.push({ x: x + 0.5, y: y + 0.5 });
        }
      }
      grid.push(line);
    }
    mapH = grid.length;
    mapW = grid[0] ? grid[0].length : 16;

    player.x = spawn ? spawn.x : 1.5;
    player.y = spawn ? spawn.y : 1.5;
    player.a = L.angle || 0;
    player.z = 0; player.vz = 0; player.onGround = true;

    for (var i = 0; i < botSpots.length; i++) {
      bots.push({
        x: botSpots[i].x, y: botSpots[i].y,
        hp: L.hp, maxHp: L.hp, alive: true,
        alert: false, yaw: 0,
        fireT: 1.1 + Math.random() * 0.9,
        chargeT: 0, eyeT: 0, hitT: 0, tracerT: 0,
        repathT: 0, path: null,
        patrolT: Math.random() * 1.5, patrolDir: rand(4),
        orbit: Math.random() * 6
      });
    }
    botsAlive = bots.length;

    ammo = MAG;
    reloading = 0;
    fireCd = 0;
    bannerT = 0;
    pendingLevel = 0;
    updateHud();
  }

  /* ---------------- pathfinding (bots) ---------------- */

  function bfsStep(sx, sy, tx, ty) {
    if (sx === tx && sy === ty) return null;
    var n = mapW * mapH;
    var prev = new Int32Array(n);
    for (var i = 0; i < n; i++) prev[i] = -1;
    var start = sy * mapW + sx;
    var goal = ty * mapW + tx;
    prev[start] = -1;
    var q = [start], head = 0, found = -1;
    while (head < q.length) {
      var cur = q[head++];
      if (cur === goal) { found = cur; break; }
      var cx = cur % mapW, cy = (cur - cx) / mapW;
      if (cx > 0 && cellOpen(cx - 1, cy) && prev[cur - 1] === -1) { prev[cur - 1] = cur; q.push(cur - 1); }
      if (cx < mapW - 1 && cellOpen(cx + 1, cy) && prev[cur + 1] === -1) { prev[cur + 1] = cur; q.push(cur + 1); }
      if (cy > 0 && cellOpen(cx, cy - 1) && prev[cur - mapW] === -1) { prev[cur - mapW] = cur; q.push(cur - mapW); }
      if (cy < mapH - 1 && cellOpen(cx, cy + 1) && prev[cur + mapW] === -1) { prev[cur + mapW] = cur; q.push(cur + mapW); }
    }
    if (found < 0) return null;
    var step = found;
    while (prev[step] !== start) {
      step = prev[step];
      if (step < 0) return null;
    }
    var sxp = step % mapW, syp = (step - sxp) / mapW;
    return { x: sxp, y: syp };
  }

  /* ---------------- HUD / states ---------------- */

  function updateHud() {
    var hint;
    if (state === 'paused') hint = '⏸ Paused';
    else if (document.pointerLockElement !== canvas) hint = '🖱 Click the view to aim · WASD move · Space jump';
    else if (reloading > 0) hint = '⟳ Reloading…';
    else hint = 'Ammo ' + ammo + ' / ' + MAG + ' · F/Click = Fire · Space = Jump';
    GameShell.hud(
      { Score: score, Best: Math.max(best, score), HP: Math.max(0, Math.ceil(hp)), Level: level },
      hint
    );
  }

  function start() {
    score = 0;
    hp = MAX_HP;
    dmgFlash = 0;
    muzzleT = hitT = recoil = 0;
    loadLevel(1);
    state = 'running';
    last = now();
    GameShell.overlay.hide();
    updateHud();
    ensureLoop();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    try {
      if (document.exitPointerLock && document.pointerLockElement === canvas) document.exitPointerLock();
    } catch (e) { /* ignore */ }
    releaseKeys();
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The training bots are holding position. Take a breath.',
      stats: [
        { label: 'Score', value: score },
        { label: 'HP', value: Math.max(0, Math.ceil(hp)) },
        { label: 'Level', value: level }
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

  function finish(win, title, msg) {
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
      title: isBest ? 'New high score!' : title,
      msg: msg,
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Level', value: level },
        { label: 'HP', value: Math.max(0, Math.ceil(hp)) }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  function gameOver() {
    finish(false, 'Game over',
      'The training bots overwhelmed you in zone ' + level + '. Score: ' + score + '.');
  }

  function winGame() {
    finish(true, 'Zone cleared!',
      'All three zones are clear — every training bot is down. Final score: ' + score + '.');
  }

  function releaseKeys() {
    keys.fwd = keys.back = keys.left = keys.right = false;
    keys.turnL = keys.turnR = keys.space = keys.jump = keys.fire = keys.mouse = false;
  }

  /* ---------------- combat ---------------- */

  function startReload() {
    if (reloading > 0 || ammo === MAG) return;
    reloading = RELOAD_TIME;
    updateHud();
  }

  function fire() {
    if (state !== 'running' || fireCd > 0 || reloading > 0) return;
    if (ammo <= 0) { startReload(); return; }
    ammo--;
    fireCd = FIRE_CD;
    muzzleT = 0.055;
    recoil = 1;

    var a = player.a + (Math.random() - 0.5) * 0.02;
    var dx = Math.cos(a), dy = Math.sin(a);
    var wallHit = castDDA(player.x, player.y, dx, dy);
    var bestBot = null, bestT = wallHit.dist;

    for (var i = 0; i < bots.length; i++) {
      var b = bots[i];
      if (!b.alive) continue;
      var rx = b.x - player.x, ry = b.y - player.y;
      var tProj = rx * dx + ry * dy;
      if (tProj <= 0.25 || tProj >= bestT) continue;
      var perp = Math.abs(rx * dy - ry * dx);
      if (perp <= 0.38 && tProj < bestT) { bestT = tProj; bestBot = b; }
    }

    if (bestBot) {
      bestBot.hp--;
      bestBot.hitT = 0.14;
      bestBot.alert = true;
      hitT = 0.2;
      if (bestBot.hp <= 0) killBot(bestBot);
    }

    /* a gunshot sounds the alarm: every bot in the zone comes for you */
    for (var j = 0; j < bots.length; j++) {
      if (bots[j].alive) { bots[j].alert = true; bots[j].path = null; }
    }

    if (ammo <= 0) startReload();
    updateHud();
  }

  function killBot(bot) {
    bot.alive = false;
    botsAlive--;
    score += 100 * level;
    updateHud();
    if (botsAlive <= 0) zoneCleared();
  }

  function zoneCleared() {
    score += 250 * level;
    if (level >= LEVELS.length) {
      updateHud();
      winGame();
      return;
    }
    bannerT = 1.5;
    banner1 = 'ZONE ' + level + ' CLEARED!';
    banner2 = 'Entering ' + LEVELS[level].name + '…';
    pendingLevel = level + 1;
    updateHud();
  }

  function hurt(dmg) {
    if (state !== 'running') return;
    hp -= dmg;
    dmgFlash = 1;
    if (hp <= 0) {
      hp = 0;
      updateHud();
      gameOver();
    } else {
      updateHud();
    }
  }

  /* ---------------- bots ---------------- */

  function botShoot(bot, dist) {
    var L = LEVELS[level - 1] || LEVELS[0];
    bot.fireT = L.fireCd * (0.8 + Math.random() * 0.5);
    bot.tracerT = 0.15;
    var acc = clamp(0.5 - dist * 0.045, 0.16, 0.45);
    if (keys.fwd || keys.back || keys.left || keys.right) acc *= 0.55;  /* strafing dodges */
    if (Math.random() < acc) hurt(L.dmg);
  }

  function moveBot(bot, dx, dy) {
    var nx = bot.x + dx, ny = bot.y + dy;
    var pdx = nx - player.x, pdy = ny - player.y;
    if (pdx * pdx + pdy * pdy < 0.64) return;      /* keep a shooting distance */
    if (!blocked(nx, bot.y, 0.3)) bot.x = nx;
    if (!blocked(bot.x, ny, 0.3)) bot.y = ny;
  }

  function updateBot(bot, dt) {
    if (!bot.alive) return;
    if (bot.hitT > 0) bot.hitT -= dt;
    if (bot.eyeT > 0) bot.eyeT -= dt;
    if (bot.tracerT > 0) bot.tracerT -= dt;

    var dx = player.x - bot.x, dy = player.y - bot.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
    var los = lineOfSight(bot.x, bot.y, player.x, player.y);

    if (!bot.alert) {
      if ((los && dist < 13) || dist < 9) {
        bot.alert = true;
        bot.path = null;
      }
    }

    var L = LEVELS[level - 1] || LEVELS[0];

    if (bot.alert) {
      bot.yaw = Math.atan2(dy, dx);

      if (dist > 2.4 || !los) {
        /* approach: straight line with line of sight, BFS step without it */
        var mx = 0, my = 0;
        if (los) {
          mx = dx / dist; my = dy / dist;
        } else {
          bot.repathT -= dt;
          if (bot.repathT <= 0 || !bot.path) {
            bot.repathT = 0.5 + Math.random() * 0.3;
            bot.path = bfsStep(Math.floor(bot.x), Math.floor(bot.y),
                               Math.floor(player.x), Math.floor(player.y));
          }
          if (bot.path) {
            var tx = bot.path.x + 0.5, ty = bot.path.y + 0.5;
            var vx = tx - bot.x, vy = ty - bot.y;
            var vd = Math.sqrt(vx * vx + vy * vy) || 0.001;
            if (vd < 0.18) { bot.path = null; }
            else { mx = vx / vd; my = vy / vd; }
          }
        }
        moveBot(bot, mx * L.speed * dt, my * L.speed * dt);
      } else {
        /* in range: orbit sideways so the fight keeps moving */
        bot.orbit += dt * 1.6;
        var px = -dy / dist, py = dx / dist;
        var sway = Math.sin(bot.orbit) * 0.55 * L.speed;
        moveBot(bot, px * sway * dt, py * sway * dt);
      }

      if (los && dist < 11) {
        if (bot.chargeT > 0) {
          bot.chargeT -= dt;
          if (bot.chargeT <= 0) botShoot(bot, dist);
        } else {
          bot.fireT -= dt;
          if (bot.fireT <= 0) {
            bot.chargeT = 0.35;
            bot.eyeT = 0.45;
          }
        }
      } else {
        bot.chargeT = 0;
      }
    } else {
      /* idle patrol: wander a few steps, pause, pick a new heading */
      bot.patrolT -= dt;
      if (bot.patrolT <= 0) {
        bot.patrolT = 1 + Math.random() * 1.5;
        bot.patrolDir = rand(4);
      }
      var px2 = 0, py2 = 0;
      if (bot.patrolDir === 0) px2 = 1;
      else if (bot.patrolDir === 1) px2 = -1;
      else if (bot.patrolDir === 2) py2 = 1;
      else py2 = -1;
      moveBot(bot, px2 * L.speed * 0.4 * dt, py2 * L.speed * 0.4 * dt);
    }
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    var i;

    if (bannerT > 0) {
      bannerT -= dt;
      if (bannerT <= 0 && pendingLevel) {
        var nl = pendingLevel;
        pendingLevel = 0;
        loadLevel(nl);
      }
    }

    /* --- turn --- */
    if (keys.turnL) player.a -= TURN_SPEED * dt;
    if (keys.turnR) player.a += TURN_SPEED * dt;

    /* --- jump (Space) --- */
    if ((keys.space || keys.jump) && player.onGround && state === 'running') {
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

    /* --- move --- */
    var mx = 0, my = 0;
    var cos = Math.cos(player.a), sin = Math.sin(player.a);
    if (keys.fwd) { mx += cos; my += sin; }
    if (keys.back) { mx -= cos; my -= sin; }
    if (keys.left) { mx += sin; my -= cos; }
    if (keys.right) { mx -= sin; my += cos; }
    var ml = Math.sqrt(mx * mx + my * my);
    if (ml > 0.001) {
      var speed = (Math.abs(keys.fwd) + Math.abs(keys.back)) > 0 ? MOVE_SPEED : STRAFE_SPEED;
      if (!player.onGround) speed *= 0.85;
      var vx = (mx / ml) * speed * dt, vy = (my / ml) * speed * dt;
      if (!blocked(player.x + vx, player.y, PLAYER_R)) player.x += vx;
      if (!blocked(player.x, player.y + vy, PLAYER_R)) player.y += vy;
    }

    /* --- weapons --- */
    if (fireCd > 0) fireCd -= dt;
    if (reloading > 0) {
      reloading -= dt;
      if (reloading <= 0) {
        reloading = 0;
        ammo = MAG;
        updateHud();
      }
    }
    if ((keys.fire || keys.mouse) && fireCd <= 0) fire();
    if (muzzleT > 0) muzzleT -= dt;
    if (recoil > 0) recoil = Math.max(0, recoil - dt * 6);

    /* --- effects --- */
    if (hitT > 0) hitT -= dt;
    if (dmgFlash > 0) dmgFlash = Math.max(0, dmgFlash - dt * 1.7);

    /* --- bots --- */
    for (i = 0; i < bots.length; i++) updateBot(bots[i], dt);
  }

  /* ---------------- drawing ---------------- */

  function drawScene() {
    /* ceiling + floor shading (horizon stays at H/2; walls shift with z) */
    ctx.fillStyle = ceilsGrad;
    ctx.fillRect(0, 0, W, H / 2);
    ctx.fillStyle = floorsGrad;
    ctx.fillRect(0, H / 2, W, H / 2);

    var dirX = Math.cos(player.a), dirY = Math.sin(player.a);
    var planeX = -dirY * FOV_PLANE, planeY = dirX * FOV_PLANE;

    var x, i;
    for (x = 0; x < W; x++) {
      var cameraX = 2 * x / W - 1;
      var rdx = dirX + planeX * cameraX;
      var rdy = dirY + planeY * cameraX;
      var hit = castDDA(player.x, player.y, rdx, rdy);
      var perp = hit.dist;
      if (perp < 0.001) perp = 0.001;
      zBuf[x] = perp;

      var lh = H / perp;
      if (lh > 4000) lh = 4000;
      var top = (H - lh) / 2 + player.z * lh;
      var tex = TEX[hit.type] || TEX[1];
      if (tex) ctx.drawImage(tex, hit.texX, 0, 1, 64, x, top, 1, lh);

      var shade = Math.min(0.82, perp * 0.062) + (hit.side ? 0.14 : 0);
      if (shade > 0.02) {
        ctx.fillStyle = 'rgba(4,7,14,' + (shade > 0.85 ? 0.85 : shade).toFixed(3) + ')';
        ctx.fillRect(x, top, 1, lh);
      }
    }

    /* --- bots, far to near, depth-sliced against the z-buffer --- */
    var order = [];
    for (i = 0; i < bots.length; i++) {
      if (!bots[i].alive) continue;
      var ddx = bots[i].x - player.x, ddy = bots[i].y - player.y;
      bots[i]._d = ddx * ddx + ddy * ddy;
      order.push(bots[i]);
    }
    order.sort(function (a, b) { return b._d - a._d; });

    for (i = 0; i < order.length; i++) drawBot(order[i], dirX, dirY, planeX, planeY);

    /* bot tracers flying at the player */
    for (i = 0; i < order.length; i++) {
      var tb = order[i];
      if (tb.tracerT <= 0 || tb.sx === undefined || tb.sdist < 0.2) continue;
      ctx.globalAlpha = Math.min(1, tb.tracerT / 0.15);
      ctx.strokeStyle = '#ff5c7a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tb.sx, tb.sy);
      ctx.lineTo(W / 2, H / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawBot(bot, dirX, dirY, planeX, planeY) {
    drawBotSprite(bot);
    if (!scratch) return;

    var relX = bot.x - player.x, relY = bot.y - player.y;
    var invDet = 1 / (planeX * dirY - dirX * planeY);
    var trX = invDet * (dirY * relX - dirX * relY);
    var trY = invDet * (-planeY * relX + planeX * relY);
    bot.sx = undefined; bot.sy = 0; bot.sdist = trY;
    if (trY < 0.2) return;

    var screenX = (W / 2) * (1 + trX / trY);
    var lh = H / trY;
    var spriteH = lh * 0.95;
    var top = H / 2 + lh / 2 - spriteH + player.z * lh;
    var spriteW = spriteH * (64 / 96);
    var startX = Math.floor(screenX - spriteW / 2);
    var endX = Math.ceil(screenX + spriteW / 2);

    bot.sx = screenX;
    bot.sy = top + spriteH * 0.35;

    for (var x = Math.max(0, startX); x < Math.min(W, endX); x++) {
      if (trY >= zBuf[x]) continue;
      var texX = Math.floor((x - startX) * 64 / spriteW);
      if (texX < 0 || texX > 63) continue;
      ctx.drawImage(scratch, texX, 0, 1, 64, x, top, 1, spriteH);
    }

    /* health pips above tougher bots */
    if (bot.maxHp > 1 && trY < 9 && screenX > 12 && screenX < W - 12) {
      var bw = Math.max(14, Math.min(46, spriteW * 0.7));
      var frac = bot.hp / bot.maxHp;
      var by = top - 7;
      ctx.fillStyle = 'rgba(5,8,15,.75)';
      ctx.fillRect(screenX - bw / 2, by, bw, 4);
      ctx.fillStyle = frac > 0.5 ? '#2ee6a6' : '#ff5c7a';
      ctx.fillRect(screenX - bw / 2, by, bw * frac, 4);
    }
  }

  function drawGun(t) {
    var moving = keys.fwd || keys.back || keys.left || keys.right;
    var bob = moving ? Math.sin(t / 95) * 3 : Math.sin(t / 400) * 1;
    var lift = recoil * 7;
    var cx = W / 2, baseY = H - 4 + bob + lift;

    /* barrel */
    ctx.fillStyle = '#31405f';
    ctx.fillRect(cx - 10, baseY - 96, 20, 46);
    ctx.fillStyle = '#4a5b82';
    ctx.fillRect(cx - 6, baseY - 100, 12, 8);

    /* body */
    ctx.fillStyle = '#232e46';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - 34, baseY - 54, 68, 58, 9);
    else ctx.rect(cx - 34, baseY - 54, 68, 58);
    ctx.fill();
    ctx.fillStyle = '#a3e635';
    ctx.fillRect(cx - 26, baseY - 44, 52, 4);
    ctx.fillStyle = 'rgba(34,211,238,.9)';
    ctx.fillRect(cx - 26, baseY - 32, 8 + (ammo / MAG) * 44, 5);
    ctx.fillStyle = 'rgba(5,8,15,.7)';
    ctx.fillRect(cx - 26, baseY - 32, 52, 5);
    ctx.fillStyle = '#22d3ee';
    ctx.fillRect(cx - 26, baseY - 32, (ammo / MAG) * 52, 5);

    /* muzzle flash */
    if (muzzleT > 0) {
      var f = muzzleT / 0.055;
      var g = ctx.createRadialGradient(cx, baseY - 104, 2, cx, baseY - 104, 34 * f);
      g.addColorStop(0, 'rgba(255,244,214,.95)');
      g.addColorStop(0.4, 'rgba(253,214,110,.75)');
      g.addColorStop(1, 'rgba(253,214,110,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, baseY - 104, 34 * f, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCrosshair() {
    var cx = W / 2, cy = H / 2;
    ctx.strokeStyle = 'rgba(163,230,53,.92)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 13, cy); ctx.lineTo(cx - 5, cy);
    ctx.moveTo(cx + 5, cy);  ctx.lineTo(cx + 13, cy);
    ctx.moveTo(cx, cy - 13); ctx.lineTo(cx, cy - 5);
    ctx.moveTo(cx, cy + 5);  ctx.lineTo(cx, cy + 13);
    ctx.stroke();
    ctx.fillStyle = 'rgba(163,230,53,.92)';
    ctx.fillRect(cx - 1, cy - 1, 2, 2);

    if (hitT > 0) {
      var a = Math.min(1, hitT / 0.2);
      ctx.strokeStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      ctx.lineWidth = 2.5;
      var d = 6, l = 7;
      ctx.beginPath();
      ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx - d - l, cy - d - l);
      ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx + d + l, cy - d - l);
      ctx.moveTo(cx - d, cy + d); ctx.lineTo(cx - d - l, cy + d + l);
      ctx.moveTo(cx + d, cy + d); ctx.lineTo(cx + d + l, cy + d + l);
      ctx.stroke();
    }
  }

  function drawMinimap() {
    var cell = 7, pad = 7;
    var mw = mapW * cell, mh = mapH * cell;
    var ox = 10, oy = 10;
    ctx.fillStyle = 'rgba(5,8,15,.74)';
    ctx.fillRect(ox, oy, mw + pad, mh + pad);
    ctx.strokeStyle = 'rgba(34,211,238,.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, mw + pad - 1, mh + pad - 1);

    var x, y;
    for (y = 0; y < mapH; y++) {
      for (x = 0; x < mapW; x++) {
        var t = grid[y][x];
        if (!t) continue;
        ctx.fillStyle = t === 3 ? 'rgba(163,230,53,.5)'
                      : t === 2 ? 'rgba(74,91,130,.7)'
                      : 'rgba(49,64,95,.85)';
        ctx.fillRect(ox + pad / 2 + x * cell, oy + pad / 2 + y * cell, cell - 1, cell - 1);
      }
    }

    for (var i = 0; i < bots.length; i++) {
      var b = bots[i];
      if (!b.alive) continue;
      ctx.fillStyle = b.alert ? '#ff5c7a' : '#f59e0b';
      ctx.beginPath();
      ctx.arc(ox + pad / 2 + b.x * cell, oy + pad / 2 + b.y * cell, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    var pxx = ox + pad / 2 + player.x * cell;
    var pyy = oy + pad / 2 + player.y * cell;
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pxx, pyy);
    ctx.lineTo(pxx + Math.cos(player.a) * 7, pyy + Math.sin(player.a) * 7);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(pxx, pyy, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBanner() {
    if (bannerT <= 0) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(232,238,252,.95)';
    ctx.font = '800 32px ' + FONT;
    ctx.fillText(banner1, W / 2, H * 0.4);
    ctx.fillStyle = 'rgba(163,230,53,.95)';
    ctx.font = '600 17px ' + FONT;
    ctx.fillText(banner2, W / 2, H * 0.4 + 34);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawScene();
    drawGun(t);
    drawCrosshair();
    drawMinimap();
    drawBanner();

    if (reloading > 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(253,214,110,.95)';
      ctx.font = '700 15px ' + FONT;
      ctx.fillText('⟳ RELOADING', W / 2, H - 128);
      ctx.textAlign = 'left';
    }

    if (dmgFlash > 0) {
      ctx.fillStyle = 'rgba(255,60,60,' + (dmgFlash * 0.4).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    if (state === 'paused') {
      ctx.fillStyle = 'rgba(232,238,252,.8)';
      ctx.font = 'bold 22px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, 30);
      ctx.textAlign = 'left';
    }
  }

  var ceilsGrad = null, floorsGrad = null;

  function buildGradients() {
    ceilsGrad = ctx.createLinearGradient(0, 0, 0, H / 2);
    ceilsGrad.addColorStop(0, '#0a0c1a');
    ceilsGrad.addColorStop(1, '#141b30');
    floorsGrad = ctx.createLinearGradient(0, H / 2, 0, H);
    floorsGrad.addColorStop(0, '#0e1526');
    floorsGrad.addColorStop(1, '#05070e');
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
    if (k === undefined || k === null) return;

    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' ||
        k === 'ArrowDown' || k === ' ' || k === 'Enter') {
      if (e.preventDefault) e.preventDefault();
    }

    if (k === 'w' || k === 'W' || k === 'ArrowUp') keys.fwd = true;
    else if (k === 's' || k === 'S' || k === 'ArrowDown') keys.back = true;
    else if (k === 'a' || k === 'A') keys.left = true;
    else if (k === 'd' || k === 'D') keys.right = true;
    else if (k === 'ArrowLeft') keys.turnL = true;
    else if (k === 'ArrowRight') keys.turnR = true;
    else if (k === 'f' || k === 'F') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
      else keys.fire = true;
    } else if (k === ' ') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
      else keys.space = true;
    } else if (k === 'Enter') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (k === 'r' || k === 'R') {
      start();
    }
  });

  document.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === 'w' || k === 'W' || k === 'ArrowUp') keys.fwd = false;
    else if (k === 's' || k === 'S' || k === 'ArrowDown') keys.back = false;
    else if (k === 'a' || k === 'A') keys.left = false;
    else if (k === 'd' || k === 'D') keys.right = false;
    else if (k === 'ArrowLeft') keys.turnL = false;
    else if (k === 'ArrowRight') keys.turnR = false;
    else if (k === 'f' || k === 'F') keys.fire = false;
    else if (k === ' ') keys.space = false;
  });

  canvas.addEventListener('pointerdown', function (ev) {
    if (ev && ev.button !== undefined && ev.button !== 0) return;
    if (state === 'ready' || state === 'over') { start(); return; }
    if (state === 'paused') { resume(); return; }
    if (state !== 'running') return;
    /* first click locks the mouse (like a classic PC shooter); locked clicks fire */
    if (ev.pointerType !== 'touch' && document.pointerLockElement !== canvas &&
        canvas.requestPointerLock) {
      lockMouse();
      return;
    }
    keys.mouse = true;
  });

  window.addEventListener('pointerup', function () { keys.mouse = false; });

  function lockMouse() {
    try {
      var pr = canvas.requestPointerLock();
      if (pr && pr.catch) pr.catch(function () { /* lock refused */ });
    } catch (e) { /* pointer lock unavailable */ }
  }

  document.addEventListener('mousemove', function (e) {
    if (state !== 'running') return;
    if (document.pointerLockElement !== canvas) return;
    player.a += (e.movementX || 0) * MOUSE_SENS;
  });

  document.addEventListener('pointerlockchange', function () {
    if (document.pointerLockElement === canvas) updateHud();
    else if (state === 'running') pause();
  });

  window.addEventListener('blur', releaseKeys);

  /* on-screen touch buttons */
  var padBtns = document.querySelectorAll('[data-act]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      var act = btn.getAttribute('data-act');
      var MAP = { turnL: 'turnL', turnR: 'turnR', fwd: 'fwd', back: 'back', fire: 'fire', jump: 'jump' };
      function on() {
        if (state === 'ready' || state === 'over') { start(); return; }
        if (state === 'paused') { resume(); return; }
        if (MAP[act]) keys[MAP[act]] = true;
      }
      function off() {
        if (MAP[act]) keys[MAP[act]] = false;
      }
      btn.addEventListener('pointerdown', function (ev) { ev.preventDefault(); on(); });
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointerleave', off);
      btn.addEventListener('pointercancel', off);
    })(padBtns[b]);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- test snapshot (read-only) ---------------- */

  try {
    Object.defineProperty(window, '__strikeZone', {
      value: Object.freeze({
        snapshot: function () {
          var alive = [];
          for (var i = 0; i < bots.length; i++) {
            if (bots[i].alive) {
              alive.push({
                x: Math.round(bots[i].x * 100) / 100,
                y: Math.round(bots[i].y * 100) / 100,
                hp: bots[i].hp,
                alert: bots[i].alert
              });
            }
          }
          return {
            state: state,
            score: score,
            best: Math.max(best, score),
            hp: Math.ceil(hp),
            level: level,
            ammo: ammo,
            reloading: reloading > 0,
            botsAlive: botsAlive,
            player: {
              x: Math.round(player.x * 100) / 100,
              y: Math.round(player.y * 100) / 100,
              z: Math.round(player.z * 1000) / 1000,
              onGround: player.onGround,
              a: player.a
            },
            bots: alive
          };
        }
      }),
      writable: false,
      configurable: false
    });
  } catch (e) { /* snapshot hook unavailable — ignore */ }

  /* ---------------- boot ---------------- */

  try { TEX = [null, makeTexture(1), makeTexture(2), makeTexture(3)]; }
  catch (e) { TEX = null; }
  try { scratch = document.createElement('canvas'); scratch.width = 64; scratch.height = 96; }
  catch (e) { scratch = null; }
  buildGradients();
  loadLevel(1);
  state = 'ready';
  updateHud();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Strike Zone',
    msg: 'Walk with WASD, turn with the arrow keys or the mouse, fire with F or a click, and press Space to jump. Click the view once to lock the mouse for smooth aiming — Esc releases it. Clear all three zones of hostile training bots.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });
})();
