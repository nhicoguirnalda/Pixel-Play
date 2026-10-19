/* ============================================================
   Breach Point — original game for PixelPlay
   Canvas raycasting FPS: sweep a compound room by room, destroy
   the guard bots and reach the extraction pad before the clock
   hits zero. Pure vanilla JS, no libraries.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  canvas.style.touchAction = 'none';

  var W = 640, H = 400;
  var STRIP = 2;                       /* ray / wall-strip width */
  var RAYS = W / STRIP;
  var PLANE = 0.72;                    /* camera plane length (~FOV) */
  var MAG = 8;                         /* rounds per magazine */
  var RELOAD_TIME = 1.1;
  var RUN_TIME = 150;                  /* global clock, seconds */
  var TURN_SPEED = 2.5;                /* keyboard turn, rad/s */
  var MOVE_SPEED = 3.1;                /* cells/s */
  var STRAFE_SPEED = 2.6;
  var PLAYER_R = 0.27;
  var BEST_KEY = 'breach-point';
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

  /* ---------------- map ----------------
     '#' = wall, '.' = floor.  22 x 20 cells, eight rooms joined
     by two-cell corridors.                                  */

  var MAP = [
    '######################',
    '#......##......##....#',
    '#......##......##....#',
    '#....................#',
    '#....................#',
    '#......##......##....#',
    '#......##......##....#',
    '###..######..#####..##',
    '###..######..#####..##',
    '#......##......##....#',
    '#......##......##....#',
    '#....................#',
    '#....................#',
    '#......##......##....#',
    '###..#############..##',
    '###..#############..##',
    '#......##########....#',
    '#......##########....#',
    '#......##########....#',
    '######################'
  ];
  var MAP_H = MAP.length, MAP_W = MAP[0].length;

  var START = { x: 3.5, y: 3.5, a: 0 };
  var EXTRACT = { x: 18.5, y: 17.5 };
  var MEDKITS = [{ x: 3.5, y: 17.5 }, { x: 18.5, y: 11.5 }];

  /* rect = floor cells the room owns (x..x+w-1, y..y+h-1) */
  var ROOMS = [
    { name: 'Lobby',     x: 1,  y: 1,  w: 6, h: 6, guards: 0, start: true },
    { name: 'Armory',    x: 9,  y: 1,  w: 6, h: 6, guards: 2 },
    { name: 'Depot',     x: 17, y: 1,  w: 4, h: 6, guards: 2 },
    { name: 'Storage',   x: 1,  y: 9,  w: 6, h: 5, guards: 2 },
    { name: 'Reactor',   x: 9,  y: 9,  w: 6, h: 5, guards: 3 },
    { name: 'Server Hub', x: 17, y: 9, w: 4, h: 5, guards: 2 },
    { name: 'Bay Three', x: 1,  y: 16, w: 6, h: 3, guards: 2 },
    { name: 'Extraction', x: 17, y: 16, w: 4, h: 3, guards: 0, exit: true }
  ];

  /* route order the waypoint marker follows */
  var ROUTE = [1, 2, 4, 5, 3, 6];
  var GUARD_ROOMS = ROUTE.length;

  var TYPES = {
    scout: { hp: 2, speed: 2.1, dmg: [4, 7],  cool: [0.8, 1.3], pts: 120 },
    guard: { hp: 3, speed: 1.5, dmg: [6, 10], cool: [1.0, 1.6], pts: 150 },
    heavy: { hp: 5, speed: 1.0, dmg: [9, 14], cool: [1.4, 2.0], pts: 220 }
  };
  var TYPE_LIST = ['scout', 'guard', 'heavy'];

  /* ---------------- state ---------------- */

  var state = 'ready';            /* ready | running | paused | over */
  var score = 0, best = GameShell.best.get(BEST_KEY, 0);
  var hp = 100;
  var timeLeft = RUN_TIME;
  var ammo = MAG, reloadT = 0, fireCool = 0;
  var shots = 0, hits = 0, kills = 0, roomsCleared = 0;
  var player = { x: START.x, y: START.y, a: START.a, z: 0, vz: 0, onGround: true };
  var enemies = [];
  var kits = [];
  var zbuf = new Array(RAYS);
  var sprites = null;             /* pre-rendered billboard canvases */
  var muzzle = 0, kick = 0, hitT = 0, hurtT = 0, shake = 0;
  var toastText = '', toastT = 0, toastCool = 0;
  var hudTick = 0;
  var keys = {
    up: false, down: false, left: false, right: false,
    lturn: false, rturn: false, fire: false, jump: false
  };
  var rafId = 0, last = 0;
  var lastPointerX = null, dragging = false;

  /* ---------------- helpers ---------------- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
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

  function accuracy() {
    return shots ? Math.round((hits / shots) * 100) : 0;
  }

  function shownBest() { return Math.max(best, score || 0); }

  function wrapAngle(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }

  function isWall(mx, my) {
    if (mx < 0 || my < 0 || mx >= MAP_W || my >= MAP_H) return true;
    return MAP[my].charAt(mx) === '#';
  }

  function isFree(x, y, r) {
    return !isWall(Math.floor(x - r), Math.floor(y - r)) &&
           !isWall(Math.floor(x + r), Math.floor(y - r)) &&
           !isWall(Math.floor(x - r), Math.floor(y + r)) &&
           !isWall(Math.floor(x + r), Math.floor(y + r));
  }

  function hasLOS(x0, y0, x1, y1) {
    var dx = x1 - x0, dy = y1 - y0;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var steps = Math.ceil(dist / 0.22);
    if (steps < 1) return true;
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      if (isWall(Math.floor(x0 + dx * t), Math.floor(y0 + dy * t))) return false;
    }
    return true;
  }

  function roomAt(x, y) {
    var cx = Math.floor(x), cy = Math.floor(y);
    for (var i = 0; i < ROOMS.length; i++) {
      var r = ROOMS[i];
      if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) return r;
    }
    return null;
  }

  function roomLeft(r) {
    var n = 0;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!e.dead && e.room === r) n++;
    }
    return n;
  }

  /* ---------------- sprites ---------------- */

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    if (!c || !c.getContext) return null;
    c.width = w; c.height = h;
    return c;
  }

  /* one chunky pixel-art guard bot, 36x52 */
  function makeBot(body, accent, allWhite) {
    var c = makeCanvas(36, 52);
    if (!c) return null;
    var g = c.getContext('2d');
    if (!g) return null;
    var b = allWhite ? '#ffffff' : body;
    var ac = allWhite ? '#ffffff' : accent;
    var dk = allWhite ? '#ffffff' : 'rgba(0,0,0,.35)';

    g.fillStyle = b;
    g.fillRect(12, 38, 5, 14);        /* legs */
    g.fillRect(19, 38, 5, 14);
    g.fillRect(8, 18, 20, 22);        /* body */
    g.fillRect(3, 20, 5, 14);         /* arms */
    g.fillRect(28, 20, 5, 14);
    g.fillRect(10, 5, 16, 12);        /* head */
    g.fillStyle = dk;
    g.fillRect(12, 18, 12, 3);        /* chest seam */
    g.fillRect(14, 40, 3, 10);        /* leg seams */
    g.fillRect(21, 40, 3, 10);
    g.fillStyle = ac;
    g.fillRect(13, 9, 10, 4);         /* visor eye */
    g.fillRect(17, 0, 2, 5);          /* antenna */
    g.fillRect(15, 0, 6, 2);          /* antenna tip */
    return c;
  }

  function makeMedkit() {
    var c = makeCanvas(18, 14);
    if (!c) return null;
    var g = c.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#e8eefc';
    g.fillRect(0, 0, 18, 14);
    g.fillStyle = '#94a3b8';
    g.fillRect(0, 12, 18, 2);
    g.fillStyle = '#ef4444';
    g.fillRect(7, 2, 4, 10);
    g.fillRect(4, 5, 10, 4);
    return c;
  }

  function makeBeacon() {
    var c = makeCanvas(22, 44);
    if (!c) return null;
    var g = c.getContext('2d');
    if (!g) return null;
    g.fillStyle = 'rgba(46,230,166,.85)';
    g.fillRect(9, 0, 4, 44);
    g.fillStyle = 'rgba(46,230,166,.4)';
    g.fillRect(5, 0, 12, 44);
    g.fillStyle = 'rgba(232,238,252,.9)';
    g.fillRect(2, 40, 18, 4);
    return c;
  }

  function seedSprites() {
    sprites = {
      scout: makeBot('#ec4899', '#22d3ee', false),
      guard: makeBot('#ef4444', '#fbbf24', false),
      heavy: makeBot('#f97316', '#fde68a', false),
      white: makeBot('#ffffff', '#ffffff', true),
      kit: makeMedkit(),
      beacon: makeBeacon()
    };
  }

  /* ---------------- HUD + states ---------------- */

  function updateHud() {
    var hint = 'Rooms ' + roomsCleared + '/' + GUARD_ROOMS + ' · ' + accuracy() + '% acc · Space = Jump';
    if (state !== 'paused' && document.pointerLockElement !== canvas) hint = '🖱 Click the view to aim · Space jump · F fire';
    GameShell.hud(
      {
        Score: score || 0,
        Best: shownBest(),
        Time: Math.max(0, Math.ceil(timeLeft)) + 's',
        HP: Math.max(0, Math.round(hp)),
        Ammo: reloadT > 0 ? '…' : ammo + '/' + MAG
      },
      state === 'paused' ? '⏸ Paused' : hint
    );
  }

  function toast(msg) {
    toastText = msg;
    toastT = 1.9;
  }

  function pickPatrol(e) {
    var r = ROOMS[e.roomIdx];
    for (var i = 0; i < 12; i++) {
      var x = r.x + 0.5 + Math.random() * (r.w - 1);
      var y = r.y + 0.5 + Math.random() * (r.h - 1);
      if (isFree(x, y, 0.3)) { e.tx = x; e.ty = y; return; }
    }
  }

  function spawnGuards() {
    enemies = [];
    for (var i = 0; i < ROOMS.length; i++) {
      var r = ROOMS[i];
      for (var g = 0; g < r.guards; g++) {
        var type = TYPE_LIST[Math.floor(Math.random() * TYPE_LIST.length)];
        if (r.guards === 3 && g === 0) type = 'heavy';
        var x = 0, y = 0, ok = false;
        for (var tries = 0; tries < 30 && !ok; tries++) {
          x = r.x + 0.5 + Math.random() * (r.w - 1);
          y = r.y + 0.5 + Math.random() * (r.h - 1);
          ok = isFree(x, y, 0.3);
        }
        var e = {
          type: type, x: x, y: y, roomIdx: i, room: r,
          hp: TYPES[type].hp, dead: false,
          tx: x, ty: y, faceA: 0,
          cool: 0.6 + Math.random() * 1.2,
          alert: 0, hitFlash: 0, fireFlash: 0
        };
        pickPatrol(e);
        enemies.push(e);
      }
    }
  }

  function reset() {
    score = 0; hp = 100; timeLeft = RUN_TIME;
    ammo = MAG; reloadT = 0; fireCool = 0;
    shots = 0; hits = 0; kills = 0; roomsCleared = 0;
    player = { x: START.x, y: START.y, a: START.a, z: 0, vz: 0, onGround: true };
    muzzle = 0; kick = 0; hitT = 0; hurtT = 0; shake = 0;
    toastText = ''; toastT = 0; toastCool = 0;
    keys.up = keys.down = keys.left = keys.right = false;
    keys.lturn = keys.rturn = keys.fire = keys.jump = false;
    for (var i = 0; i < ROOMS.length; i++) {
      ROOMS[i].cleared = ROOMS[i].guards === 0;
    }
    kits = [];
    for (i = 0; i < MEDKITS.length; i++) {
      kits.push({ x: MEDKITS[i].x, y: MEDKITS[i].y, taken: false });
    }
    spawnGuards();
    updateHud();
  }

  function start() {
    reset();
    state = 'running';
    last = now();
    GameShell.overlay.hide();
    blurActive();
    updateHud();
    ensureLoop();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    keys.fire = false;
    releaseLock();
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'Hold your position. The compound will still be there.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Time', value: Math.max(0, Math.ceil(timeLeft)) + 's' },
        { label: 'Rooms', value: roomsCleared + '/' + GUARD_ROOMS },
        { label: 'HP', value: Math.round(hp) }
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

  function finish(win, reason) {
    if (state === 'over') return;
    state = 'over';
    keys.fire = false;
    releaseLock();
    var isBest = score > best;
    if (isBest) {
      best = score;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: win ? 'Extraction complete!' : (isBest ? 'New high score!' : reason),
      msg: win
        ? 'Every room swept and the pad reached with ' + Math.ceil(timeLeft) +
          ' seconds to spare. Score: ' + score + '.'
        : reason === 'Time up'
          ? 'The clock hit zero with ' + (GUARD_ROOMS - roomsCleared) +
            ' room' + (GUARD_ROOMS - roomsCleared === 1 ? '' : 's') + ' still hot. Score: ' + score + '.'
          : 'The guard bots dropped you in ' + (roomAt(player.x, player.y) ?
             roomAt(player.x, player.y).name : 'the compound') + '. Score: ' + score + '.',
      stats: win
        ? [
            { label: 'Score', value: score },
            { label: 'Best', value: best },
            { label: 'Time', value: Math.max(0, Math.ceil(timeLeft)) + 's' },
            { label: 'Accuracy', value: accuracy() + '%' }
          ]
        : [
            { label: 'Score', value: score },
            { label: 'Best', value: best },
            { label: 'Time', value: Math.max(0, Math.ceil(timeLeft)) + 's' },
            { label: 'Rooms', value: roomsCleared + '/' + GUARD_ROOMS }
          ],
      btn: '▶ Play again',
      action: start
    });
  }

  function blurActive() {
    var el = document.activeElement;
    if (el && el.blur) { try { el.blur(); } catch (e) { /* ignore */ } }
  }

  function releaseLock() {
    try {
      if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    } catch (e) { /* pointer lock unavailable */ }
  }

  /* ---------------- combat ---------------- */

  function damagePlayer(d) {
    if (state !== 'running') return;
    hp -= d;
    hurtT = 1;
    shake = Math.max(shake, 7);
    if (hp <= 0) {
      hp = 0;
      updateHud();
      finish(false, 'Bot down');
      return;
    }
    updateHud();
  }

  function killEnemy(e) {
    e.dead = true;
    var pts = TYPES[e.type].pts;
    score += pts;
    kills++;
    toast('+' + pts + '  ' + e.type.toUpperCase() + ' DOWN');
    if (roomLeft(e.room) === 0 && !e.room.cleared) {
      e.room.cleared = true;
      roomsCleared++;
      score += 250;
      toast(e.room.name.toUpperCase() + ' CLEAR  +250');
    }
    updateHud();
  }

  function shoot() {
    if (state !== 'running' || reloadT > 0 || ammo <= 0 || fireCool > 0) return;
    ammo--;
    shots++;
    fireCool = 0.22;
    muzzle = 0.08;
    kick = 1;
    shake = Math.max(shake, 2.5);
    if (ammo <= 0) reloadT = RELOAD_TIME;

    var target = null, bestD = 1e9;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.dead) continue;
      var dx = e.x - player.x, dy = e.y - player.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > 22 || d < 0.05) continue;
      var diff = wrapAngle(Math.atan2(dy, dx) - player.a);
      if (Math.abs(diff) > Math.atan2(0.42, d)) continue;
      if (!hasLOS(player.x, player.y, e.x, e.y)) continue;
      if (d < bestD) { bestD = d; target = e; }
    }

    if (target) {
      hits++;
      hitT = 0.25;
      target.hp--;
      target.hitFlash = 0.14;
      target.alert = 2.5;
      if (target.hp <= 0) killEnemy(target);
      updateHud();
    }
  }

  function objectiveRoom() {
    for (var i = 0; i < ROUTE.length; i++) {
      var r = ROOMS[ROUTE[i]];
      if (roomLeft(r) > 0) return r;
    }
    return null;
  }

  function objectivePoint() {
    var r = objectiveRoom();
    if (r) return { x: r.x + r.w / 2, y: r.y + r.h / 2, done: false };
    return { x: EXTRACT.x, y: EXTRACT.y, done: true };
  }

  /* ---------------- update ---------------- */

  function moveEntity(ent, dx, dy, r) {
    if (!isFinite(dx) || !isFinite(dy) || !isFinite(ent.x) || !isFinite(ent.y)) return;
    if (isFree(ent.x + dx, ent.y, r)) ent.x += dx;
    if (isFree(ent.x, ent.y + dy, r)) ent.y += dy;
  }

  function updateEnemy(e, dt) {
    if (e.dead) return;
    var T = TYPES[e.type];
    var dx = player.x - e.x, dy = player.y - e.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.01) dist = 0.01;   /* never divide by zero */
    var los = dist < 15 && hasLOS(e.x, e.y, player.x, player.y);

    if (los && dist < 12) e.alert = 2.5;
    else if (e.alert > 0) e.alert -= dt;
    if (e.cool > 0) e.cool -= dt;

    if (e.alert > 0 && los && state === 'running') {
      if (dist > 3.0) {
        var ux = dx / dist, uy = dy / dist;
        moveEntity(e, ux * T.speed * dt, uy * T.speed * dt, 0.3);
      } else if (dist < 1.6) {
        var ux2 = -dx / dist, uy2 = -dy / dist;
        moveEntity(e, ux2 * T.speed * 0.6 * dt, uy2 * T.speed * 0.6 * dt, 0.3);
      }
      e.faceA = Math.atan2(dy, dx);
      if (e.cool <= 0 && dist < 10) {
        e.cool = T.cool[0] + Math.random() * (T.cool[1] - T.cool[0]);
        e.fireFlash = 0.09;
        var chance = clamp(0.72 - dist * 0.05, 0.15, 0.62);
        if (Math.random() < chance) {
          damagePlayer(T.dmg[0] + Math.random() * (T.dmg[1] - T.dmg[0]));
          if (state !== 'running') return;
        }
      }
    } else {
      var tdx = e.tx - e.x, tdy = e.ty - e.y;
      var td = Math.sqrt(tdx * tdx + tdy * tdy);
      if (td < 0.25) pickPatrol(e);
      else {
        var ox = e.x, oy = e.y;
        moveEntity(e, (tdx / td) * T.speed * 0.5 * dt, (tdy / td) * T.speed * 0.5 * dt, 0.3);
        if (Math.abs(e.x - ox) + Math.abs(e.y - oy) < T.speed * 0.2 * dt) pickPatrol(e);
      }
      e.faceA = Math.atan2(e.ty - e.y, e.tx - e.x);
    }

    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (e.fireFlash > 0) e.fireFlash -= dt;
  }

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

    if (fireCool > 0) fireCool -= dt;
    if (reloadT > 0) {
      reloadT -= dt;
      if (reloadT <= 0) { reloadT = 0; ammo = MAG; updateHud(); }
    }

    timeLeft -= dt;
    if (timeLeft <= 0) {
      timeLeft = 0;
      updateHud();
      finish(false, 'Time up');
      return;
    }

    /* keyboard turning */
    var turn = 0;
    if (keys.lturn) turn -= 1;
    if (keys.rturn) turn += 1;
    player.a = wrapAngle(player.a + turn * TURN_SPEED * dt);

    /* movement */
    var fwd = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    var strafe = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    var ca = Math.cos(player.a), sa = Math.sin(player.a);
    /* strafe direction is perpendicular: (-sa, ca) */
    var mvx = ca * fwd * MOVE_SPEED - sa * strafe * STRAFE_SPEED;
    var mvy = sa * fwd * MOVE_SPEED + ca * strafe * STRAFE_SPEED;
    moveEntity(player, mvx * dt, mvy * dt, PLAYER_R);

    if (keys.fire) shoot();

    for (i = 0; i < enemies.length; i++) updateEnemy(enemies[i], dt);
    if (state !== 'running') return;

    /* medkits */
    for (i = 0; i < kits.length; i++) {
      var k = kits[i];
      if (k.taken) continue;
      var kdx = k.x - player.x, kdy = k.y - player.y;
      if (kdx * kdx + kdy * kdy < 0.42 && hp < 100) {
        k.taken = true;
        hp = Math.min(100, hp + 40);
        score += 25;
        toast('MEDKIT +40');
        updateHud();
      }
    }

    /* extraction pad */
    var edx = EXTRACT.x - player.x, edy = EXTRACT.y - player.y;
    if (edx * edx + edy * edy < 0.6) {
      if (roomsCleared >= GUARD_ROOMS) {
        var speed = 300 + Math.floor(Math.max(0, timeLeft)) * 5;
        score += speed;
        updateHud();
        finish(true, 'win');
        return;
      } else if (toastCool <= 0) {
        toast('CLEAR EVERY ROOM FIRST!');
        toastCool = 2.5;
      }
    }

    if (muzzle > 0) muzzle -= dt;
    if (kick > 0) kick = Math.max(0, kick - dt * 5);
    if (hitT > 0) hitT -= dt;
    if (hurtT > 0) hurtT -= dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 30);
    if (toastT > 0) toastT -= dt;
    if (toastCool > 0) toastCool -= dt;

    hudTick += dt;
    if (hudTick > 0.4) { hudTick = 0; updateHud(); }
  }

  /* ---------------- render ---------------- */

  function castAndDrawWalls(dirX, dirY, planeX, planeY) {
    var i, x;
    /* ceiling */
    var cg = ctx.createLinearGradient(0, 0, 0, H / 2);
    cg.addColorStop(0, '#070b14');
    cg.addColorStop(1, '#1c2942');
    ctx.fillStyle = cg;
    ctx.fillRect(0, 0, W, H / 2);

    /* floor */
    var fg = ctx.createLinearGradient(0, H / 2, 0, H);
    fg.addColorStop(0, '#333c50');
    fg.addColorStop(1, '#12141d');
    ctx.fillStyle = fg;
    ctx.fillRect(0, H / 2, W, H / 2);

    /* perspective floor seams */
    ctx.strokeStyle = 'rgba(255,255,255,.04)';
    ctx.lineWidth = 1;
    for (i = 1; i <= 6; i++) {
      var fy = H / 2 + (H / 2) * (i / 7) * (i / 7);
      ctx.beginPath();
      ctx.moveTo(0, fy);
      ctx.lineTo(W, fy);
      ctx.stroke();
    }

    for (x = 0; x < W; x += STRIP) {
      var cameraX = 2 * (x + STRIP / 2) / W - 1;
      var rayX = dirX + planeX * cameraX;
      var rayY = dirY + planeY * cameraX;
      if (Math.abs(rayX) < 1e-9) rayX = 1e-9;
      if (Math.abs(rayY) < 1e-9) rayY = 1e-9;

      var mapX = Math.floor(player.x), mapY = Math.floor(player.y);
      var ddx = Math.abs(1 / rayX), ddy = Math.abs(1 / rayY);
      var stepX, stepY, sdx, sdy;
      if (rayX < 0) { stepX = -1; sdx = (player.x - mapX) * ddx; }
      else { stepX = 1; sdx = (mapX + 1 - player.x) * ddx; }
      if (rayY < 0) { stepY = -1; sdy = (player.y - mapY) * ddy; }
      else { stepY = 1; sdy = (mapY + 1 - player.y) * ddy; }

      var side = 0, hit = false, guard = 0;
      while (!hit && guard++ < 128) {
        if (sdx < sdy) { sdx += ddx; mapX += stepX; side = 0; }
        else { sdy += ddy; mapY += stepY; side = 1; }
        if (mapX < 0 || mapY < 0 || mapX >= MAP_W || mapY >= MAP_H) { hit = true; break; }
        if (MAP[mapY].charAt(mapX) === '#') hit = true;
      }

      var perp = side === 0 ? (sdx - ddx) : (sdy - ddy);
      if (!(perp > 0.02)) perp = 0.02;
      zbuf[x / STRIP] = perp;

      var lineH = H / perp;
      if (lineH > 6000) lineH = 6000;
      var y0 = Math.floor(H / 2 - lineH / 2 + player.z * lineH);
      var h = Math.ceil(lineH);

      /* distance + side shading */
      var shade = 1 / (1 + perp * perp * 0.055);
      if (side === 1) shade *= 0.72;
      var wallX = side === 0 ? player.y + perp * rayY : player.x + perp * rayX;
      wallX -= Math.floor(wallX);
      var panel = 0.88 + 0.12 * Math.abs(Math.sin(wallX * 12.5));
      var r0 = Math.floor(96 * shade * panel);
      var g0 = Math.floor(110 * shade * panel);
      var b0 = Math.floor(142 * shade * panel);
      ctx.fillStyle = 'rgb(' + r0 + ',' + g0 + ',' + b0 + ')';
      ctx.fillRect(x, y0, STRIP, h);
      /* darker cap at the top of each strip */
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fillRect(x, y0, STRIP, Math.max(1, lineH * 0.02));
      /* baseboard */
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.fillRect(x, y0 + h - Math.max(1, lineH * 0.03), STRIP, Math.max(1, lineH * 0.03));
    }
  }

  function drawBillboard(tex, wx, wy, hFactor, vOff, flash, glow) {
    if (!tex) return;
    var sx = wx - player.x, sy = wy - player.y;
    var dirX = Math.cos(player.a), dirY = Math.sin(player.a);
    var planeX = -dirY * PLANE, planeY = dirX * PLANE;
    var invDet = 1.0 / (planeX * dirY - dirX * planeY);
    var tX = invDet * (dirY * sx - dirX * sy);
    var tY = invDet * (-planeY * sx + planeX * sy);
    if (tY <= 0.15) return;

    var screenX = Math.floor((W / 2) * (1 + tX / tY));
    var sh = Math.abs(Math.floor(H / tY)) * hFactor;
    var sw = sh * (tex.width / tex.height);
    var x0 = Math.floor(screenX - sw / 2);
    var y0 = Math.floor(H / 2 - sh / 2 + vOff * sh + player.z * (H / tY));

    if (glow) {
      var ga = clamp(1.5 / (1 + tY * 0.6), 0, 0.8);
      var gg = ctx.createRadialGradient(screenX, y0 + sh / 2, 2, screenX, y0 + sh / 2, sh * 0.7);
      gg.addColorStop(0, 'rgba(46,230,166,' + ga * 0.5 + ')');
      gg.addColorStop(1, 'rgba(46,230,166,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(screenX - sh, y0 - sh * 0.4, sh * 2, sh * 1.6);
    }

    var white = sprites && sprites.white;
    for (var stripe = Math.max(0, x0); stripe < Math.min(W, x0 + sw); stripe += STRIP) {
      var zi = Math.floor(stripe / STRIP);
      if (zi < 0 || zi >= RAYS || tY >= zbuf[zi]) continue;
      var texX = Math.floor((stripe - x0) * tex.width / sw);
      if (texX < 0 || texX >= tex.width) continue;
      ctx.drawImage(tex, texX, 0, 1, tex.height, stripe, y0, STRIP, sh);
      if (flash > 0 && white) {
        ctx.globalAlpha = clamp(flash * 5, 0, 0.9);
        ctx.drawImage(white, texX, 0, 1, white.height, stripe, y0, STRIP, sh);
        ctx.globalAlpha = 1;
      }
    }
  }

  function renderSprites() {
    var list = [], i;
    for (i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.dead) continue;
      list.push({ e: e, tex: sprites ? sprites[e.type] : null,
                  d: (e.x - player.x) * (e.x - player.x) + (e.y - player.y) * (e.y - player.y) });
    }
    for (i = 0; i < kits.length; i++) {
      if (kits[i].taken) continue;
      list.push({ kit: kits[i], tex: sprites ? sprites.kit : null,
                  d: (kits[i].x - player.x) * (kits[i].x - player.x) +
                     (kits[i].y - player.y) * (kits[i].y - player.y) });
    }
    list.push({ beacon: EXTRACT, tex: sprites ? sprites.beacon : null,
                d: (EXTRACT.x - player.x) * (EXTRACT.x - player.x) +
                   (EXTRACT.y - player.y) * (EXTRACT.y - player.y) });

    list.sort(function (a, b) { return b.d - a.d; });

    for (i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.tex && it.tex.getContext) {
        if (it.e) drawBillboard(it.tex, it.e.x, it.e.y, 0.86, 0.14, it.e.hitFlash, false);
        else if (it.kit) drawBillboard(it.tex, it.kit.x, it.kit.y, 0.3, 0.36, 0, false);
        else if (it.beacon) drawBillboard(it.tex, it.beacon.x, it.beacon.y, 0.62, 0.2, 0, true);
      }
      if (it.e && it.e.fireFlash > 0) {
        var fx = it.e.x - player.x, fy = it.e.y - player.y;
        var dirX = Math.cos(player.a), dirY = Math.sin(player.a);
        var planeX = -dirY * PLANE, planeY = dirX * PLANE;
        var invDet = 1.0 / (planeX * dirY - dirX * planeY);
        var tX2 = invDet * (dirY * fx - dirX * fy);
        var tY2 = invDet * (-planeY * fx + planeX * fy);
        if (tY2 > 0.15) {
          var sX2 = (W / 2) * (1 + tX2 / tY2);
          var sh2 = Math.abs(Math.floor(H / tY2)) * 0.86;
          var zi2 = clamp(Math.floor(sX2 / STRIP), 0, RAYS - 1);
          if (tY2 < zbuf[zi2]) {
            ctx.fillStyle = 'rgba(253,224,138,.9)';
            ctx.beginPath();
            ctx.arc(sX2, H / 2 - sh2 * 0.12 + player.z * (H / tY2), Math.max(2, sh2 * 0.07), 0, TAU);
            ctx.fill();
          }
        }
      }
    }
  }

  function drawMinimap() {
    var s = 4, pad = 6;
    var mw = MAP_W * s, mh = MAP_H * s;
    var x0 = W - mw - 10, y0 = 10;
    ctx.fillStyle = 'rgba(5,8,15,.72)';
    rr(x0 - pad, y0 - pad, mw + pad * 2, mh + pad * 2, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148,163,184,.35)';
    ctx.lineWidth = 1;
    rr(x0 - pad, y0 - pad, mw + pad * 2, mh + pad * 2, 8);
    ctx.stroke();

    var my, mx;
    for (my = 0; my < MAP_H; my++) {
      for (mx = 0; mx < MAP_W; mx++) {
        if (MAP[my].charAt(mx) === '#') ctx.fillStyle = '#31405f';
        else ctx.fillStyle = '#131c2e';
        ctx.fillRect(x0 + mx * s, y0 + my * s, s, s);
      }
    }

    /* objective marker */
    var obj = objectivePoint();
    var pulse = 0.5 + 0.5 * Math.sin(now() / 220);
    ctx.fillStyle = obj.done ? 'rgba(46,230,166,' + (0.5 + pulse * 0.5) + ')'
                             : 'rgba(245,158,11,' + (0.5 + pulse * 0.5) + ')';
    ctx.beginPath();
    ctx.arc(x0 + obj.x * s, y0 + obj.y * s, 3.4, 0, TAU);
    ctx.fill();

    /* player */
    ctx.save();
    ctx.translate(x0 + player.x * s, y0 + player.y * s);
    ctx.rotate(player.a);
    ctx.fillStyle = '#e8eefc';
    ctx.beginPath();
    ctx.moveTo(4.4, 0);
    ctx.lineTo(-3, 3);
    ctx.lineTo(-3, -3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawWaypoint() {
    var obj = objectivePoint();
    var ang = Math.atan2(obj.y - player.y, obj.x - player.x) - player.a;
    var dist = Math.sqrt((obj.x - player.x) * (obj.x - player.x) +
                         (obj.y - player.y) * (obj.y - player.y));
    var cx = W / 2, cy = 40;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = obj.done ? '#2ee6a6' : '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-6, 7);
    ctx.lineTo(-6, -7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(226,232,240,.8)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText((obj.done ? 'EXTRACT ' : objName() + ' ') + Math.round(dist) + 'm', cx, cy + 22);
  }

  function objName() {
    var r = objectiveRoom();
    return r ? r.name.toUpperCase() : 'EXTRACT';
  }

  function drawGun() {
    var gx = W / 2, gy = H + kick * 9;
    ctx.fillStyle = '#101725';
    rr(gx - 26, gy - 34, 52, 40, 8);
    ctx.fill();
    ctx.fillStyle = '#1d2a44';
    rr(gx - 12, gy - 58, 24, 30, 6);
    ctx.fill();
    ctx.fillStyle = '#33456b';
    rr(gx - 8, gy - 54, 16, 6, 3);
    ctx.fill();
    ctx.fillStyle = '#22d3ee';
    ctx.fillRect(gx - 2, gy - 62, 4, 5);
    if (muzzle > 0) {
      var mg = ctx.createRadialGradient(gx, gy - 64, 2, gx, gy - 64, 34);
      mg.addColorStop(0, 'rgba(253,224,138,.9)');
      mg.addColorStop(1, 'rgba(253,224,138,0)');
      ctx.fillStyle = mg;
      ctx.fillRect(gx - 36, gy - 100, 72, 66);
    }
  }

  function drawCrosshair() {
    var cx = W / 2, cy = H / 2;
    ctx.strokeStyle = 'rgba(232,238,252,.9)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy); ctx.lineTo(cx - 5, cy);
    ctx.moveTo(cx + 5, cy); ctx.lineTo(cx + 14, cy);
    ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy - 5);
    ctx.moveTo(cx, cy + 5); ctx.lineTo(cx, cy + 14);
    ctx.stroke();
    ctx.fillStyle = 'rgba(232,238,252,.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, 1.6, 0, TAU);
    ctx.fill();

    if (hitT > 0) {
      var g = clamp(hitT / 0.25, 0, 1);
      ctx.strokeStyle = 'rgba(253,224,138,' + g + ')';
      ctx.lineWidth = 2;
      var o = 5 + (1 - g) * 6;
      ctx.beginPath();
      ctx.moveTo(cx - o - 4, cy - o - 4); ctx.lineTo(cx - o, cy - o);
      ctx.moveTo(cx + o, cy - o); ctx.lineTo(cx + o + 4, cy - o - 4);
      ctx.moveTo(cx - o - 4, cy + o + 4); ctx.lineTo(cx - o, cy + o);
      ctx.moveTo(cx + o, cy + o); ctx.lineTo(cx + o + 4, cy + o + 4);
      ctx.stroke();
    }
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070e';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    if (shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    var dirX = Math.cos(player.a), dirY = Math.sin(player.a);
    var planeX = -dirY * PLANE, planeY = dirX * PLANE;

    castAndDrawWalls(dirX, dirY, planeX, planeY);
    renderSprites();
    drawGun();
    drawCrosshair();

    ctx.restore();

    drawWaypoint();
    drawMinimap();

    /* room + enemy counter, top-left */
    var here = roomAt(player.x, player.y);
    ctx.fillStyle = 'rgba(5,8,15,.6)';
    rr(10, 10, 170, 40, 8);
    ctx.fill();
    ctx.fillStyle = '#e8eefc';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    if (here) {
      ctx.fillText(here.name, 20, 28);
      var left = here.guards > 0 ? roomLeft(here) : 0;
      ctx.fillStyle = left > 0 ? '#f87171' : '#34d399';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText(here.exit ? 'Extraction pad' :
                   (left > 0 ? left + ' bot' + (left === 1 ? '' : 's') + ' left' : 'cleared'),
                   20, 44);
    }

    /* health bar, bottom-left */
    var bw = 150;
    ctx.fillStyle = 'rgba(5,8,15,.6)';
    rr(10, H - 34, bw + 20, 24, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(226,232,240,.16)';
    rr(20, H - 26, bw, 8, 4);
    ctx.fill();
    ctx.fillStyle = hp > 35 ? '#34d399' : '#f87171';
    rr(20, H - 26, bw * clamp(hp / 100, 0, 1), 8, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(226,232,240,.85)';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillText('HP ' + Math.max(0, Math.round(hp)), 22, H - 29 - 6);

    /* reloading */
    if (reloadT > 0 && state === 'running') {
      ctx.fillStyle = 'rgba(253,224,138,.95)';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('RELOADING…', W / 2, H - 44);
    }

    /* toast */
    if (toastT > 0 && state === 'running') {
      ctx.globalAlpha = clamp(toastT / 0.6, 0, 1);
      ctx.fillStyle = '#fde68a';
      ctx.font = '800 17px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(toastText, W / 2, 84);
      ctx.globalAlpha = 1;
    }

    /* damage flash */
    if (hurtT > 0) {
      ctx.fillStyle = 'rgba(248,113,113,' + (clamp(hurtT, 0, 1) * 0.3) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    /* muzzle light spill */
    if (muzzle > 0) {
      ctx.fillStyle = 'rgba(253,224,138,' + (muzzle * 1.6) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    if (state === 'paused') {
      ctx.fillStyle = 'rgba(232,238,252,.75)';
      ctx.font = 'bold 24px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, H - 24);
    }
  }

  /* ---------------- loop ---------------- */

  function tick(ts) {
    rafId = requestAnimationFrame(tick);
    var dt = last ? (ts - last) / 1000 : 0;
    last = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    if (state === 'running') update(dt);
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

  document.addEventListener('keydown', function (e) {
    if (isForm(e.target)) return;
    var k = e.key;

    if (k === ' ' || k === 'Enter' || k === 'ArrowLeft' ||
        k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault();
    }

    if (k === 'w' || k === 'W' || k === 'ArrowUp') keys.up = true;
    else if (k === 's' || k === 'S' || k === 'ArrowDown') keys.down = true;
    else if (k === 'a' || k === 'A') keys.left = true;
    else if (k === 'd' || k === 'D') keys.right = true;
    else if (k === 'ArrowLeft') keys.lturn = true;
    else if (k === 'ArrowRight') keys.rturn = true;
    else if (k === ' ') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
      else keys.jump = true;
    } else if (k === 'f' || k === 'F') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
      else keys.fire = true;
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
    if (k === 'w' || k === 'W' || k === 'ArrowUp') keys.up = false;
    else if (k === 's' || k === 'S' || k === 'ArrowDown') keys.down = false;
    else if (k === 'a' || k === 'A') keys.left = false;
    else if (k === 'd' || k === 'D') keys.right = false;
    else if (k === 'ArrowLeft') keys.lturn = false;
    else if (k === 'ArrowRight') keys.rturn = false;
    else if (k === ' ') keys.jump = false;
    else if (k === 'f' || k === 'F') keys.fire = false;
  });

  canvas.addEventListener('click', function () {
    if (state === 'running' && !document.pointerLockElement &&
        canvas.requestPointerLock) {
      try {
        var pr = canvas.requestPointerLock();
        if (pr && pr.catch) pr.catch(function () { /* lock refused */ });
      } catch (e) { /* ignore */ }
    }
  });

  canvas.addEventListener('mousedown', function (ev) {
    if (ev.button !== 0) return;
    if (state === 'ready' || state === 'over') { start(); return; }
    if (document.pointerLockElement === canvas) shoot();
  });

  document.addEventListener('mousemove', function (ev) {
    if (state !== 'running') return;
    if (document.pointerLockElement === canvas && ev.movementX) {
      player.a = wrapAngle(player.a + ev.movementX * 0.0026);
    }
  });

  document.addEventListener('pointerlockchange', function () {
    if (document.pointerLockElement === canvas) updateHud();
    else if (state === 'running') pause();
  });

  canvas.addEventListener('pointerdown', function (ev) {
    if (ev.pointerType === 'touch') {
      dragging = true;
      lastPointerX = ev.clientX;
    }
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (ev.pointerType !== 'touch') return;
    if (!dragging || state !== 'running') return;
    if (lastPointerX !== null) {
      player.a = wrapAngle(player.a + (ev.clientX - lastPointerX) * 0.006);
    }
    lastPointerX = ev.clientX;
  });

  window.addEventListener('pointerup', function () {
    dragging = false;
    lastPointerX = null;
  });

  /* on-screen touch buttons */
  var padBtns = document.querySelectorAll('[data-act]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      var act = btn.getAttribute('data-act');
      function on() {
        if (state === 'ready' || state === 'over') { start(); return; }
        if (state === 'paused') { resume(); return; }
        if (act === 'fire') keys.fire = true;
        else if (act === 'jump') keys.jump = true;
        else if (act === 'left') keys.lturn = true;
        else if (act === 'right') keys.rturn = true;
        else if (act === 'fwd') keys.up = true;
      }
      function off() {
        if (act === 'fire') keys.fire = false;
        else if (act === 'jump') keys.jump = false;
        else if (act === 'left') keys.lturn = false;
        else if (act === 'right') keys.rturn = false;
        else if (act === 'fwd') keys.up = false;
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

  /* ---------------- boot ---------------- */

  seedSprites();
  reset();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Breach Point',
    msg: 'Sweep the compound room by room: WASD moves, the mouse turns, click to lock ' +
         'the pointer and F or left click fires — press Space to jump past guard fire. ' +
         'Destroy every guard bot, then reach the green extraction pad before the ' +
         '150-second clock hits zero.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* read-only snapshot for automated smoke tests */
  window.__breachPoint = {
    state: function () { return state; },
    score: function () { return score; },
    hp: function () { return hp; },
    timeLeft: function () { return timeLeft; },
    ammo: function () { return ammo; },
    reloading: function () { return reloadT > 0; },
    shots: function () { return shots; },
    hits: function () { return hits; },
    kills: function () { return kills; },
    accuracy: function () { return accuracy(); },
    roomsCleared: function () { return roomsCleared; },
    roomsTotal: function () { return GUARD_ROOMS; },
    pos: function () { return { x: player.x, y: player.y, a: player.a, z: player.z, onGround: player.onGround }; },
    objective: function () { return objectivePoint(); },
    enemies: function () {
      return enemies.map(function (e) {
        return { x: e.x, y: e.y, hp: e.hp, type: e.type, dead: !!e.dead,
                 room: e.room.name, alert: e.alert };
      });
    }
  };
})();
