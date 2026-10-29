/* ============================================================
   Neon Squadron — original game for PixelPlay
   Vertical scrolling shoot-'em-up: formation waves, three boss
   archetypes every fourth wave, eight power-up types and a
   three-choice upgrade panel after each boss.
   Keyboard + on-screen pad.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 560, H = 680;
  var BEST_KEY = 'neon-squadron';

  var state = 'ready';               /* ready | running | paused | over */
  var best = GameShell.best.get(BEST_KEY, 0);
  var rafId = 0, lastT = 0, newBest = false;

  var score = 0, lives = 3, wave = 1, score2 = 0;
  var duo = false;
  var ship = { x: W / 2, y: H - 96, inv: 0, fireCd: 0 };
  var ship2 = { x: W / 2, y: H - 96, inv: 0, fireCd: 0 };
  var keys = { left: false, right: false, up: false, down: false };
  var keys2 = { left: false, right: false, up: false, down: false };
  var firing = false, autoFire = true;

  var bullets = [], eBullets = [], enemies = [], powers = [], sparks = [], stars = [];

  var shield = 0;
  var rapidMs = 0, spreadMs = 0, homingMs = 0, laserMs = 0;
  var magnetMs = 0, doubleMs = 0, bombCharges = 0;
  var between = false, waveGap = 0;

  var choosing = false, pendingUpgrade = false, choices = [];
  var upg = { dmg: 0, rate: 0, shield: 0, bomb: 0, life: 0 };
  var flashT = 0, phaseFlash = 0, phaseFlashText = '', shotSeq = 0;

  var SHIP_SPEED = 5.4;              /* px per 60fps frame */
  var BULLET_SPEED = 11;
  var EBULLET = 4.0;
  var FIRE_MS = 190, RAPID_FIRE_MS = 85;
  var POWER_MS = 10000;
  var POWER_TIMES = {
    rapid: 10000, spread: 10000, homing: 11000,
    laser: 8000, magnet: 11000, double: 12000
  };
  var MAX_BOMBS = 3;
  var BOSS_EVERY = 4;

  var bombRect = { x: 10, y: H - 38, w: 118, h: 26 };

  var POWER_DEFS = {
    rapid:  { color: '#ec4899', icon: 'R', label: 'Rapid fire' },
    spread: { color: '#22d3ee', icon: 'S', label: 'Spread shot' },
    shield: { color: '#a3e635', icon: 'D', label: 'Shield' },
    homing: { color: '#f59e0b', icon: 'H', label: 'Homing' },
    laser:  { color: '#a78bfa', icon: 'L', label: 'Laser' },
    bomb:   { color: '#facc15', icon: 'B', label: 'Bomb charge' },
    magnet: { color: '#2dd4bf', icon: 'M', label: 'Magnet' },
    double: { color: '#fb7185', icon: '2x', label: 'Double score' }
  };

  var DROP_TABLE = [
    ['rapid', 16], ['spread', 16], ['shield', 12], ['homing', 12],
    ['laser', 10], ['bomb', 9], ['magnet', 10], ['double', 9]
  ];

  var BOSS_NAMES = ['Bulwark Cruiser', 'Ring Warden', 'Lance Serpent'];
  var BOSS_COLORS = ['#f472b6', '#2dd4bf', '#f59e0b'];

  var UPG_DEFS = [
    { id: 'dmg',    name: 'Plasma Rounds',  desc: '+1 bullet damage',     max: 5 },
    { id: 'rate',   name: 'Cooling Coils',  desc: '14% faster fire',      max: 5 },
    { id: 'shield', name: 'Aegis Plating',  desc: '+1 shield charge',     max: 3 },
    { id: 'bomb',   name: 'Bomb Bay',       desc: '+1 screen bomb',       max: 3 },
    { id: 'life',   name: 'Spare Hull',     desc: '+1 life',              max: 3 }
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
      var s = rnd(0.5, 3.4) * (power || 1);
      sparks.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rnd(260, 620), max: 620, r: rnd(1.4, 3.4), color: color
      });
    }
  }

  function initStars() {
    stars = [];
    for (var i = 0; i < 90; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * H,
                   s: rnd(0.5, 1.7), v: rnd(0.4, 2.2) });
    }
  }

  function shieldMax() { return 1 + upg.shield; }

  function addScore(n, who) {
    var v = Math.round(n * (doubleMs > 0 ? 2 : 1));
    if (who === 'p2') score2 += v;
    else if (who === 'both') { score += v; score2 += v; }
    else score += v;
  }

  /* Bosses aim at whoever is closest, so both players share the threat. */
  function nearestShip(x, y) {
    if (!duo) return ship;
    var d1 = (ship.x - x) * (ship.x - x) + (ship.y - y) * (ship.y - y);
    var d2 = (ship2.x - x) * (ship2.x - x) + (ship2.y - y) * (ship2.y - y);
    return d2 < d1 ? ship2 : ship;
  }

  function findBoss() {
    for (var i = 0; i < enemies.length; i++) {
      if (enemies[i].boss) return enemies[i];
    }
    return null;
  }

  function updateHud() {
    var right = state === 'paused' ? '⏸ Paused'
      : (choosing ? '★ Upgrade ready' : 'Wave ' + wave);
    if (duo) {
      GameShell.hud({ P1: score, P2: score2, Lives: lives, Bombs: bombCharges }, right);
    } else {
      GameShell.hud(
        { Score: score, Best: Math.max(best, score), Lives: lives, Bombs: bombCharges },
        right
      );
    }
  }

  /* ---------------- waves ---------------- */

  function spawnBoss() {
    var n = Math.floor(wave / BOSS_EVERY);
    var arch = (n - 1) % 3;
    if (arch < 0) arch = 0;
    var hp = Math.round((70 + wave * 10) * (1 + (n - 1) * 0.03));
    enemies.push({
      x: W / 2, y: -150, baseX: W / 2, dir: 1,
      w: arch === 0 ? 152 : 122,
      h: arch === 0 ? 78 : 108,
      r: 72,
      hp: hp, maxHp: hp, vy: 1.4,
      boss: true, arch: arch, name: BOSS_NAMES[arch], color: BOSS_COLORS[arch],
      hitFlash: 0, phase: 1, phase2: false, t: 0,
      fireCd: 1200, heavyCd: 4600, heavyTele: 0, heavyKind: 0, aimAngle: Math.PI / 2
    });
  }

  function spawnWave() {
    enemies = [];
    eBullets = [];
    if (wave % BOSS_EVERY === 0) { spawnBoss(); return; }

    var cols = 6;
    var rows = Math.min(4, 1 + Math.floor((wave + 1) / 2));
    var hp = 1 + Math.floor(wave / 4);
    var gapX = W / (cols + 1);

    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var bx = gapX * (c + 1);
        enemies.push({
          x: bx, y: -70 - r * 58, baseX: bx,
          w: 30, h: 26, r: 16,
          hp: hp, maxHp: hp,
          vy: Math.min(1.35, 0.42 + wave * 0.035),
          amp: 14 + (r % 2) * 16,
          phase: c * 0.8 + r * 0.5,
          fireCd: rnd(900, 2600), boss: false, hitFlash: 0
        });
      }
    }
  }

  /* ---------------- bullets ---------------- */

  function shoot(s, owner) {
    var y = s.y - 22;
    var dmg = 1 + upg.dmg;
    shotSeq++;

    if (laserMs > 0) {
      bullets.push({
        x: s.x, y: y, vx: 0, vy: -BULLET_SPEED * 1.45,
        r: 4, dmg: dmg + 1, pierce: 5, hits: [], laser: true, owner: owner
      });
    } else {
      bullets.push({ x: s.x, y: y, vx: 0, vy: -BULLET_SPEED, r: 4.5, dmg: dmg, owner: owner });
      if (spreadMs > 0) {
        bullets.push({ x: s.x - 11, y: y + 8, vx: -2.6, vy: -BULLET_SPEED * 0.94, r: 4, dmg: dmg, owner: owner });
        bullets.push({ x: s.x + 11, y: y + 8, vx: 2.6, vy: -BULLET_SPEED * 0.94, r: 4, dmg: dmg, owner: owner });
      }
    }

    if (homingMs > 0 && shotSeq % 2 === 0) {
      var side = Math.floor(shotSeq / 2) % 2 ? -1 : 1;
      bullets.push({
        x: s.x + side * 15, y: y + 6,
        vx: side * 2.4, vy: -6.4, r: 4,
        dmg: Math.max(1, 1 + Math.floor(upg.dmg / 2)),
        homing: true, speed: 7.6, owner: owner
      });
    }
  }

  function bossFan(e, count, speed, spread) {
    var tgt = nearestShip(e.x, e.y);
    var base = Math.atan2(tgt.y - e.y, tgt.x - e.x);
    for (var i = 0; i < count; i++) {
      var a = base + (-spread + (i / (count - 1)) * spread * 2) * 0.5;
      eBullets.push({
        x: e.x, y: e.y + e.h / 2 - 10, r: 6,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed
      });
    }
  }

  function bossRing(e, count, speed, offset, gaps) {
    for (var i = 0; i < count; i++) {
      if (gaps && i % gaps === 0) continue;
      var a = offset + (i / count) * Math.PI * 2;
      eBullets.push({
        x: e.x, y: e.y, r: 6,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed
      });
    }
  }

  function bossAimed(e, count, speed, spread) {
    var tgt = nearestShip(e.x, e.y);
    var base = Math.atan2(tgt.y - e.y, tgt.x - e.x);
    for (var i = 0; i < count; i++) {
      var a = base + (-spread + (i / (count - 1)) * spread * 2);
      eBullets.push({
        x: e.x, y: e.y + 20, r: 5,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed
      });
    }
  }

  function bossNormalFire(e) {
    var p2 = e.phase === 2;
    if (e.arch === 0) {
      bossFan(e, p2 ? 7 : 5, 3.7, p2 ? 1.15 : 0.9);
      e.fireCd = p2 ? 1050 : 1450;
    } else if (e.arch === 1) {
      bossRing(e, p2 ? 14 : 10, 3.3, e.t * 0.0016, 0);
      e.fireCd = p2 ? 1150 : 1600;
    } else {
      bossAimed(e, p2 ? 5 : 3, p2 ? 4.9 : 4.3, 0.20);
      e.fireCd = p2 ? 880 : 1250;
    }
  }

  function bossHeavyFire(e) {
    if (e.arch === 0) {
      /* three telegraphed lanes — stand between them */
      var lanes = [W * 0.24, W * 0.5, W * 0.76];
      for (var l = 0; l < lanes.length; l++) {
        for (var i = 0; i < 5; i++) {
          eBullets.push({
            x: lanes[l], y: e.y + 40 + i * 34, r: 7,
            vx: 0, vy: 5.2
          });
        }
      }
      spark(W / 2, e.y + 40, 26, e.color, 1.2);
    } else if (e.arch === 1) {
      /* dense ring with three safe gaps */
      bossRing(e, 24, 3.6, e.t * 0.0008, 8);
      spark(e.x, e.y, 36, e.color, 1.4);
    } else {
      /* fast lance along the telegraphed line — step aside */
      var a = e.aimAngle;
      for (var k = 0; k < 8; k++) {
        eBullets.push({
          x: e.x + Math.cos(a) * (50 + k * 32),
          y: e.y + Math.sin(a) * (50 + k * 32),
          r: 8, vx: Math.cos(a) * 8.4, vy: Math.sin(a) * 8.4
        });
      }
      spark(e.x + Math.cos(a) * 50, e.y + Math.sin(a) * 50, 28, e.color, 1.4);
    }
    e.fireCd = 900;
  }

  function updateBoss(e, dt, k) {
    e.t += dt;
    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (e.y < 132) {
      e.y += e.vy * k;
      return;
    }

    var n = Math.floor(wave / BOSS_EVERY);
    if (e.arch === 0) {
      e.x += (1.2 + n * 0.12) * k * e.dir;
      if (e.x < 104) { e.x = 104; e.dir = 1; }
      if (e.x > W - 104) { e.x = W - 104; e.dir = -1; }
    } else if (e.arch === 1) {
      e.x = W / 2 + Math.sin(e.t * 0.0009) * 150;
      e.y = 132 + Math.sin(e.t * 0.0013) * 14;
    } else {
      var tgt = nearestShip(e.x, e.y);
      e.x += (tgt.x - e.x) * 0.012 * k;
      e.x = clamp(e.x, 92, W - 92);
      e.y = 128 + Math.sin(e.t * 0.0015) * 18;
    }

    if (e.hp <= e.maxHp * 0.5 && !e.phase2) {
      e.phase2 = true;
      e.phase = 2;
      e.heavyCd = Math.min(e.heavyCd, 2200);
      phaseFlash = 1600;
      phaseFlashText = e.name.toUpperCase() + ' — PHASE 2';
      spark(e.x, e.y, 44, e.color, 1.7);
    }

    if (e.heavyTele > 0) {
      e.heavyTele -= dt;
      if (e.heavyTele <= 0) {
        e.heavyTele = 0;
        bossHeavyFire(e);
      }
      return;
    }

    e.fireCd -= dt;
    e.heavyCd -= dt;

    if (e.heavyCd <= 0) {
      e.heavyCd = e.phase === 2 ? 5400 : 7000;
      e.heavyTele = 1100;
      e.heavyKind = e.arch;
      var aim = nearestShip(e.x, e.y);
      e.aimAngle = Math.atan2(aim.y - e.y, aim.x - e.x);
      e.fireCd = 500;
      return;
    }

    if (e.fireCd <= 0) bossNormalFire(e);
  }

  function dropPower(x, y) {
    var roll = Math.random() * 100;
    var kind = DROP_TABLE[0][0];
    for (var i = 0; i < DROP_TABLE.length; i++) {
      roll -= DROP_TABLE[i][1];
      if (roll <= 0) { kind = DROP_TABLE[i][0]; break; }
    }
    powers.push({ x: x, y: y, vy: 1.5, r: 13, kind: kind, ttl: 11000, spin: 0 });
  }

  function applyPower(kind) {
    var def = POWER_DEFS[kind];
    if (kind === 'rapid') rapidMs = POWER_MS;
    else if (kind === 'spread') spreadMs = POWER_MS;
    else if (kind === 'shield') shield = shieldMax();
    else if (kind === 'homing') homingMs = 11000;
    else if (kind === 'laser') laserMs = 8000;
    else if (kind === 'bomb') bombCharges = Math.min(MAX_BOMBS, bombCharges + 1);
    else if (kind === 'magnet') magnetMs = 11000;
    else if (kind === 'double') doubleMs = 12000;
    spark(ship.x, ship.y - 10, 18, def ? def.color : '#22d3ee', 0.9);
    if (duo) spark(ship2.x, ship2.y - 10, 18, def ? def.color : '#22d3ee', 0.9);
    updateHud();
  }

  function detonate() {
    if (state !== 'running' || choosing || bombCharges <= 0) return;
    bombCharges--;
    flashT = 420;
    eBullets = [];
    for (var i = enemies.length - 1; i >= 0; i--) {
      damageEnemy(i, 6 + upg.dmg, duo ? 'both' : 'p1');
    }
    spark(ship.x, ship.y - 30, 48, '#facc15', 2);
    updateHud();
  }

  /* ---------------- upgrades ---------------- */

  function openUpgrade() {
    if (choosing) return;
    pendingUpgrade = false;
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
      addScore(1500, duo ? 'both' : 'p1');
    } else {
      upg[def.id] = (upg[def.id] || 0) + 1;
      if (def.id === 'life') lives = Math.min(9, lives + 1);
      if (def.id === 'bomb') bombCharges = Math.min(MAX_BOMBS, bombCharges + 1);
      if (def.id === 'shield') shield = shieldMax();
    }
    spark(ship.x, ship.y - 12, 22, '#facc15', 1.1);
    choices = [];
    choosing = false;
    waveGap = 1200;
    updateHud();
  }

  function cardRect(i) {
    var cw = 156, gap = 14;
    var total = cw * 3 + gap * 2;
    var x0 = (W - total) / 2;
    return { x: x0 + i * (cw + gap), y: H * 0.34, w: cw, h: 186 };
  }

  /* ---------------- state changes ---------------- */

  function reset() {
    score = 0; score2 = 0; lives = 3; wave = 1; newBest = false;
    ship.x = duo ? W / 2 - 70 : W / 2; ship.y = H - 96;
    ship2.x = W / 2 + 70; ship2.y = H - 96;
    bullets = []; eBullets = []; enemies = []; powers = []; sparks = [];
    keys.left = keys.right = keys.up = keys.down = false;
    keys2.left = keys2.right = keys2.up = keys2.down = false;
    firing = false;
    ship.fireCd = 0; ship.inv = 1800;
    ship2.fireCd = 0; ship2.inv = 1800;
    shield = 0;
    rapidMs = 0; spreadMs = 0; homingMs = 0; laserMs = 0;
    magnetMs = 0; doubleMs = 0; bombCharges = 0;
    between = false; waveGap = 0;
    choosing = false; pendingUpgrade = false; choices = [];
    upg = { dmg: 0, rate: 0, shield: 0, bomb: 0, life: 0 };
    flashT = 0; phaseFlash = 0; phaseFlashText = ''; shotSeq = 0;
    spawnWave();
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
    keys2.left = keys2.right = keys2.up = keys2.down = false;
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The squadron is holding formation. Jump back in when you are ready.',
      stats: duo
        ? [{ label: 'P1', value: score }, { label: 'P2', value: score2 }, { label: 'Lives', value: lives }]
        : [{ label: 'Score', value: score }, { label: 'Wave', value: wave }, { label: 'Lives', value: lives }],
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
    if (duo) {
      updateHud();
      GameShell.overlay.show({
        title: score > score2 ? 'Player 1 wins!' :
               score2 > score ? 'Player 2 wins!' : "It's a draw!",
        msg: 'Both ships went down on wave ' + wave + '. Player 1: ' + score +
             ' points, Player 2: ' + score2 + ' points. Press Duo to fly solo again.',
        stats: [
          { label: 'Player 1', value: score },
          { label: 'Player 2', value: score2 },
          { label: 'Wave', value: wave }
        ],
        btn: '▶ Play again',
        action: start
      });
      return;
    }
    if (score > best) { best = score; newBest = true; GameShell.best.set(BEST_KEY, best); }
    updateHud();
    GameShell.overlay.show({
      title: newBest ? 'New high score!' : 'Squadron down',
      msg: 'You reached wave ' + wave + ' with ' + score + ' points. Ready for another run?',
      stats: [
        { label: 'Score', value: score },
        { label: 'Wave', value: wave },
        { label: 'Best', value: best }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  /* Returns the ship that overlaps the hitbox, or null. */
  function hitsShip(x, y, hw, hh) {
    if (Math.abs(x - ship.x) < hw + 12 && Math.abs(y - ship.y) < hh + 13) return ship;
    if (duo && Math.abs(x - ship2.x) < hw + 12 && Math.abs(y - ship2.y) < hh + 13) return ship2;
    return null;
  }

  /* returns true when the hit actually cost something */
  function damagePlayer(s) {
    if (state !== 'running' || s.inv > 0) return false;
    if (shield > 0) {
      shield--;
      s.inv = 700;
      spark(s.x, s.y, 20, '#a3e635', 1.1);
      updateHud();
      return true;
    }
    lives--;
    s.inv = 1700;
    spark(s.x, s.y, 32, '#ec4899', 1.4);
    updateHud();
    if (lives <= 0) gameOver();
    return true;
  }

  function damageEnemy(idx, dmg, who) {
    var e = enemies[idx];
    if (!e) return 0;
    e.hp -= dmg;
    e.hitFlash = 90;
    if (e.hp > 0) return 0;

    var worth = e.boss ? (1200 + wave * 120) : 100;
    addScore(worth, who);
    spark(e.x, e.y, e.boss ? 60 : 14, e.boss ? e.color : '#67e8f9', e.boss ? 1.7 : 1);
    if (e.boss) {
      pendingUpgrade = true;
      dropPower(e.x - 40, e.y);
      dropPower(e.x, e.y + 10);
      dropPower(e.x + 40, e.y);
    } else if (Math.random() < 0.16) {
      dropPower(e.x, e.y);
    }
    enemies.splice(idx, 1);
    updateHud();
    return 1;
  }

  /* ---------------- update ---------------- */

  function steerHoming(b, k) {
    var bestD = 1e9, tx = 0, ty = 0, found = false;
    for (var i = 0; i < enemies.length; i++) {
      var dx = enemies[i].x - b.x, dy = enemies[i].y - b.y;
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; tx = enemies[i].x; ty = enemies[i].y; found = true; }
    }
    if (!found) return;
    var want = Math.atan2(ty - b.y, tx - b.x);
    var cur = Math.atan2(b.vy, b.vx);
    var diff = want - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    var turn = 0.15 * k;
    if (diff > turn) diff = turn;
    else if (diff < -turn) diff = -turn;
    var ang = cur + diff;
    var sp = b.speed || 7.4;
    b.vx = Math.cos(ang) * sp;
    b.vy = Math.sin(ang) * sp;
  }

  function moveShip(s, kk, k) {
    var dx = 0, dy = 0;
    if (kk.left) dx -= 1;
    if (kk.right) dx += 1;
    if (kk.up) dy -= 1;
    if (kk.down) dy += 1;
    if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
    s.x = clamp(s.x + dx * SHIP_SPEED * k, 22, W - 22);
    s.y = clamp(s.y + dy * SHIP_SPEED * k, H * 0.42, H - 30);
  }

  function update(dt, k) {
    if (choosing) return;

    if (ship.inv > 0) ship.inv -= dt;
    if (duo && ship2.inv > 0) ship2.inv -= dt;
    if (rapidMs > 0) rapidMs = Math.max(0, rapidMs - dt);
    if (spreadMs > 0) spreadMs = Math.max(0, spreadMs - dt);
    if (homingMs > 0) homingMs = Math.max(0, homingMs - dt);
    if (laserMs > 0) laserMs = Math.max(0, laserMs - dt);
    if (magnetMs > 0) magnetMs = Math.max(0, magnetMs - dt);
    if (doubleMs > 0) doubleMs = Math.max(0, doubleMs - dt);
    if (flashT > 0) flashT -= dt;
    if (phaseFlash > 0) phaseFlash -= dt;

    /* drift the starfield */
    for (var s = 0; s < stars.length; s++) {
      var st = stars[s];
      st.y += st.v * (0.7 + st.s * 0.5) * k;
      if (st.y > H + 2) { st.y = -2; st.x = Math.random() * W; }
    }

    /* ship movement */
    moveShip(ship, keys, k);
    if (duo) moveShip(ship2, keys2, k);

    /* auto / held fire */
    var baseCd = rapidMs > 0 ? RAPID_FIRE_MS : FIRE_MS;
    var cd = baseCd * Math.pow(0.86, upg.rate);
    ship.fireCd -= dt;
    if (ship.fireCd <= 0 && (firing || autoFire)) {
      ship.fireCd = cd;
      shoot(ship, 'p1');
    }
    if (duo) {
      ship2.fireCd -= dt;
      if (ship2.fireCd <= 0 && (firing || autoFire)) {
        ship2.fireCd = cd;
        shoot(ship2, 'p2');
      }
    }

    /* player bullets */
    for (var i = bullets.length - 1; i >= 0; i--) {
      var b = bullets[i];
      if (b.homing) steerHoming(b, k);
      b.x += b.vx * k;
      b.y += b.vy * k;
      if (b.y < -24 || b.x < -24 || b.x > W + 24) { bullets.splice(i, 1); continue; }

      var remove = false;
      for (var j = enemies.length - 1; j >= 0; j--) {
        var tgt = enemies[j];
        if (Math.abs(b.x - tgt.x) < tgt.w / 2 + b.r &&
            Math.abs(b.y - tgt.y) < tgt.h / 2 + b.r) {
          if (b.pierce > 0) {
            if (!b.hits) b.hits = [];
            if (b.hits.indexOf(tgt) >= 0) continue;
            b.hits.push(tgt);
            b.pierce--;
            damageEnemy(j, b.dmg, b.owner);
          } else {
            remove = true;
            damageEnemy(j, b.dmg, b.owner);
            break;
          }
        }
      }
      if (remove) bullets.splice(i, 1);
    }

    /* enemies */
    for (var e = enemies.length - 1; e >= 0; e--) {
      var en = enemies[e];
      if (en.hitFlash > 0 && !en.boss) en.hitFlash -= dt;

      if (en.boss) {
        updateBoss(en, dt, k);
      } else {
        en.y += en.vy * k;
        en.phase += 0.022 * k;
        en.x = en.baseX + Math.sin(en.phase) * en.amp;
        en.fireCd -= dt;
        if (en.fireCd <= 0 && en.y > 10 && en.y < H * 0.78) {
          en.fireCd = rnd(1500, 3400);
          eBullets.push({ x: en.x, y: en.y + en.h / 2, vx: 0, vy: EBULLET, r: 5 });
        }
      }

      if (!en.boss && en.y > H + 74) { enemies.splice(e, 1); continue; }

      var hit = hitsShip(en.x, en.y, en.w / 2, en.h / 2);
      if (hit && damagePlayer(hit)) {
        spark(en.x, en.y, 14, '#f9a8d4', 1);
        if (!en.boss) enemies.splice(e, 1);
        if (state !== 'running') return;
      }
    }

    /* enemy bullets */
    for (var m = eBullets.length - 1; m >= 0; m--) {
      var eb = eBullets[m];
      eb.x += eb.vx * k;
      eb.y += eb.vy * k;
      if (eb.y > H + 24 || eb.y < -24 || eb.x < -24 || eb.x > W + 24) {
        eBullets.splice(m, 1);
        continue;
      }
      var hit = hitsShip(eb.x, eb.y, eb.r, eb.r);
      if (hit) {
        eBullets.splice(m, 1);
        damagePlayer(hit);
        if (state !== 'running') return;
      }
    }

    /* power-ups */
    for (var p = powers.length - 1; p >= 0; p--) {
      var pw = powers[p];
      pw.y += pw.vy * k;
      pw.spin += 0.05 * k;
      pw.ttl -= dt;
      if (magnetMs > 0) {
        var pull = nearestShip(pw.x, pw.y);
        var mx = pull.x - pw.x, my = pull.y - pw.y;
        var md = Math.sqrt(mx * mx + my * my) || 1;
        if (md < 280) {
          pw.x += (mx / md) * 4.2 * k;
          pw.y += (my / md) * 4.2 * k;
        }
      }
      if (pw.y > H + 30 || pw.ttl <= 0) { powers.splice(p, 1); continue; }
      if (Math.abs(pw.x - ship.x) < 24 && Math.abs(pw.y - ship.y) < 26 ||
          (duo && Math.abs(pw.x - ship2.x) < 24 && Math.abs(pw.y - ship2.y) < 26)) {
        powers.splice(p, 1);
        applyPower(pw.kind);
      }
    }

    /* sparks */
    for (var q = sparks.length - 1; q >= 0; q--) {
      var sk = sparks[q];
      sk.x += sk.vx * k;
      sk.y += sk.vy * k;
      sk.vx *= 0.97;
      sk.vy *= 0.97;
      sk.life -= dt;
      if (sk.life <= 0) sparks.splice(q, 1);
    }

    /* wave progression */
    if (enemies.length === 0) {
      if (!between) {
        between = true;
        waveGap = 1500;
        addScore(200 + wave * 60, duo ? 'both' : 'p1');
        updateHud();
      }
      if (pendingUpgrade) {
        openUpgrade();
      } else if (!choosing) {
        waveGap -= dt;
        if (waveGap <= 0) {
          between = false;
          wave++;
          spawnWave();
          updateHud();
        }
      }
    }
  }

  /* ---------------- draw ---------------- */

  function drawStars() {
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      ctx.fillStyle = 'rgba(200,222,255,' + (0.18 + s.s * 0.28).toFixed(2) + ')';
      ctx.fillRect(s.x, s.y, s.s, s.s * 2.4);
    }
  }

  function drawShip(t, s, glow, body) {
    if (s.inv > 0 && Math.floor(t / 90) % 2 === 0 && state === 'running') return;
    var x = s.x, y = s.y;

    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 18;
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(x, y - 20);
    ctx.lineTo(x + 15, y + 12);
    ctx.lineTo(x, y + 5);
    ctx.lineTo(x - 15, y + 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#06b6d4';
    ctx.beginPath();
    ctx.arc(x, y - 4, 4, 0, Math.PI * 2);
    ctx.fill();

    /* engine flare */
    var fl = 8 + Math.sin(t / 70) * 3;
    ctx.fillStyle = 'rgba(34,211,238,.85)';
    ctx.beginPath();
    ctx.moveTo(x - 5, y + 11);
    ctx.lineTo(x + 5, y + 11);
    ctx.lineTo(x, y + 11 + fl);
    ctx.closePath();
    ctx.fill();

    if (laserMs > 0) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#a78bfa';
      ctx.fillRect(x - 1.5, y - 34, 3, 16);
      ctx.restore();
    }

    if (shield > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(163,230,53,.85)';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#a3e635';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(x, y, 24 + Math.sin(t / 240) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#d9f99d';
      for (var s = 0; s < shield; s++) {
        var a = t / 500 + (s / shield) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * 27, y + Math.sin(a) * 27, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawBossTelegraph(e) {
    if (e.heavyTele <= 0) return;
    var pulse = 0.35 + 0.25 * Math.sin(e.t / 70);
    ctx.save();
    ctx.globalAlpha = pulse;
    if (e.arch === 0) {
      var lanes = [W * 0.24, W * 0.5, W * 0.76];
      ctx.fillStyle = '#fbbf24';
      for (var l = 0; l < lanes.length; l++) {
        ctx.fillRect(lanes[l] - 9, e.y + 30, 18, H - e.y);
      }
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 2;
      for (var l2 = 0; l2 < lanes.length; l2++) {
        ctx.strokeRect(lanes[l2] - 11, e.y + 30, 22, H - e.y);
      }
    } else if (e.arch === 1) {
      ctx.strokeStyle = '#5eead4';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(e.x, e.y, 70 + (1 - e.heavyTele / 1100) * 110, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(45,212,191,.12)';
      ctx.beginPath();
      ctx.arc(e.x, e.y, 180, 0, Math.PI * 2);
      ctx.fill();
    } else {
      var a = e.aimAngle;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 4;
      ctx.setLineDash([16, 10]);
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x + Math.cos(a) * 900, e.y + Math.sin(a) * 900);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 10;
      ctx.globalAlpha = pulse * 0.35;
      ctx.strokeStyle = '#f59e0b';
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x + Math.cos(a) * 900, e.y + Math.sin(a) * 900);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = '#fef3c7';
    ctx.font = '800 16px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', e.x, e.y - e.h / 2 - 34);
    ctx.restore();
  }

  function drawBoss(e) {
    var hurt = e.hitFlash > 0;
    var col = e.color;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.shadowColor = hurt ? '#ffffff' : col;
    ctx.shadowBlur = 24;
    ctx.fillStyle = hurt ? '#ffffff' : (e.phase2 ? '#7f1d1d' : '#3b1230');

    if (e.arch === 0) {
      roundRect(-e.w / 2, -e.h / 2, e.w, e.h, 16);
      ctx.fill();
      ctx.fillStyle = hurt ? '#ffffff' : col;
      ctx.fillRect(-e.w / 2 - 14, -12, 20, 24);
      ctx.fillRect(e.w / 2 - 6, -12, 20, 24);
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0b1224';
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.arch === 1) {
      ctx.beginPath();
      ctx.arc(0, 0, 52, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(e.t * 0.0012);
      ctx.fillStyle = hurt ? '#ffffff' : col;
      for (var i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate((i / 4) * Math.PI * 2);
        ctx.beginPath();
        ctx.moveTo(38, -11);
        ctx.lineTo(78, 0);
        ctx.lineTo(38, 11);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(80, 0, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.rotate(-e.t * 0.0012);
      ctx.fillStyle = '#0b1224';
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, -66);
      ctx.lineTo(58, -16);
      ctx.lineTo(42, 52);
      ctx.lineTo(0, 72);
      ctx.lineTo(-42, 52);
      ctx.lineTo(-58, -16);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = hurt ? '#ffffff' : col;
      ctx.beginPath();
      ctx.moveTo(0, -46);
      ctx.lineTo(24, 0);
      ctx.lineTo(0, 38);
      ctx.lineTo(-24, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0b1224';
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    /* health bar above the boss */
    var frac = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    roundRect(e.x - 76, e.y - e.h / 2 - 18, 152, 9, 4);
    ctx.fill();
    ctx.fillStyle = frac > 0.4 ? e.color : '#fbbf24';
    roundRect(e.x - 76, e.y - e.h / 2 - 18, 152 * frac, 9, 4);
    ctx.fill();
  }

  function drawEnemy(e) {
    if (e.boss) { drawBossTelegraph(e); drawBoss(e); return; }
    var hurt = e.hitFlash > 0;

    ctx.save();
    ctx.shadowColor = hurt ? '#ffffff' : '#22d3ee';
    ctx.shadowBlur = 14;
    ctx.fillStyle = hurt ? '#ffffff' : (e.hp > 1 ? '#155e75' : '#0e7490');
    ctx.beginPath();
    ctx.moveTo(e.x, e.y - e.h / 2);
    ctx.lineTo(e.x + e.w / 2, e.y);
    ctx.lineTo(e.x, e.y + e.h / 2);
    ctx.lineTo(e.x - e.w / 2, e.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = hurt ? '#0b1224' : '#a5f3fc';
    ctx.beginPath();
    ctx.arc(e.x, e.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPower(pw) {
    var def = POWER_DEFS[pw.kind] || POWER_DEFS.rapid;
    var col = def.color;
    var letter = def.icon;
    var blink = pw.ttl < 2400 && Math.floor(pw.ttl / 180) % 2 === 0;

    ctx.save();
    ctx.translate(pw.x, pw.y);
    ctx.rotate(pw.spin);
    ctx.globalAlpha = blink ? 0.35 : 1;
    ctx.shadowColor = col;
    ctx.shadowBlur = 16;
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.strokeRect(-pw.r * 0.8, -pw.r * 0.8, pw.r * 1.6, pw.r * 1.6);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = blink ? 0.35 : 1;
    ctx.fillStyle = col;
    ctx.font = '700 ' + (letter.length > 1 ? '12px' : '14px') + ' "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, pw.x, pw.y + 1);
    ctx.restore();
  }

  function drawBullets() {
    for (var i = 0; i < bullets.length; i++) {
      var b = bullets[i];
      if (b.laser) {
        ctx.save();
        ctx.shadowColor = '#a78bfa';
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#ddd6fe';
        ctx.fillRect(b.x - 2.5, b.y - 26, 5, 34);
        ctx.fillStyle = 'rgba(167,139,250,.45)';
        ctx.fillRect(b.x - 6, b.y - 22, 12, 28);
        ctx.restore();
      } else if (b.homing) {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.atan2(b.vy, b.vx) + Math.PI / 2);
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();
        ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = '#a5f3fc';
        ctx.fillRect(b.x - 2, b.y - 9, 4, 14);
      }
    }
  }

  function drawPowerChips() {
    var chips = [];
    if (rapidMs > 0) chips.push({ id: 'rapid', ms: rapidMs });
    if (spreadMs > 0) chips.push({ id: 'spread', ms: spreadMs });
    if (homingMs > 0) chips.push({ id: 'homing', ms: homingMs });
    if (laserMs > 0) chips.push({ id: 'laser', ms: laserMs });
    if (magnetMs > 0) chips.push({ id: 'magnet', ms: magnetMs });
    if (doubleMs > 0) chips.push({ id: 'double', ms: doubleMs });
    if (shield > 0) chips.push({ id: 'shield', ms: 0 });

    for (var i = 0; i < chips.length; i++) {
      var def = POWER_DEFS[chips[i].id];
      var x = 12, y = 62 + i * 26;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(8,13,26,.72)';
      roundRect(x, y, 92, 21, 6);
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
        var pct = clamp(chips[i].ms / (POWER_TIMES[chips[i].id] || POWER_MS), 0, 1);
        ctx.fillStyle = 'rgba(255,255,255,.18)';
        ctx.fillRect(x + 23, y + 17, 62, 2);
        ctx.fillStyle = def.color;
        ctx.fillRect(x + 23, y + 17, 62 * pct, 2);
      }
      ctx.restore();
    }
  }

  function drawBossBar() {
    var boss = findBoss();
    if (!boss) return;
    var bw = 368, bx = (W - bw) / 2, by = 14;
    var frac = Math.max(0, boss.hp / boss.maxHp);
    ctx.save();
    ctx.fillStyle = 'rgba(5,7,14,.75)';
    roundRect(bx - 6, by - 4, bw + 12, 30, 8);
    ctx.fill();
    ctx.fillStyle = boss.color;
    ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(boss.name + '  ·  PHASE ' + boss.phase, W / 2, by + 3);
    ctx.fillStyle = 'rgba(255,255,255,.15)';
    roundRect(bx, by + 11, bw, 9, 4);
    ctx.fill();
    ctx.fillStyle = frac > 0.4 ? boss.color : '#fbbf24';
    roundRect(bx, by + 11, Math.max(0, bw * frac), 9, 4);
    ctx.fill();
    ctx.restore();
  }

  function drawBombButton() {
    ctx.save();
    ctx.globalAlpha = bombCharges > 0 ? 0.95 : 0.4;
    ctx.fillStyle = 'rgba(8,13,26,.78)';
    roundRect(bombRect.x, bombRect.y, bombRect.w, bombRect.h, 7);
    ctx.fill();
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#facc15';
    ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('X  BOMB ×' + bombCharges, bombRect.x + 8, bombRect.y + 13);
    ctx.restore();
  }

  function drawUpgradeSummary() {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(147,163,194,.9)';
    ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('DMG ' + (1 + upg.dmg) + '  ·  RATE ' + upg.rate +
                 '  ·  SHIELD ' + shieldMax() + '  ·  BOMB ' + bombCharges,
                 W - 10, H - 22);
    ctx.restore();
  }

  function drawUpgradePanel() {
    if (!choosing) return;
    ctx.save();
    ctx.fillStyle = 'rgba(3,6,13,.82)';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#e8eefc';
    ctx.font = '800 30px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Boss destroyed — upgrade!', W / 2, H * 0.22);
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#93a3c2';
    ctx.fillText('Press 1, 2 or 3 — or click a card. Upgrades last for this run.', W / 2, H * 0.22 + 30);

    for (var i = 0; i < 3; i++) {
      var def = choices[i];
      if (!def) continue;
      var r = cardRect(i);
      var lvl = (upg[def.id] || 0);
      ctx.fillStyle = 'rgba(13,21,38,.96)';
      roundRect(r.x, r.y, r.w, r.h, 12);
      ctx.fill();
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = 'rgba(34,211,238,.16)';
      roundRect(r.x + 12, r.y + 12, 26, 26, 6);
      ctx.fill();
      ctx.fillStyle = '#22d3ee';
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
    ctx.fillText('Shield charges: ' + shieldMax() + '   ·   Bombs: ' + bombCharges +
                 '   ·   Lives: ' + lives, W / 2, H * 0.34 + 214);
    ctx.restore();
  }

  function drawBanner() {
    if (!between || choosing) return;
    var next = wave + 1;
    ctx.save();
    ctx.font = '800 40px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(232,238,252,.9)';
    ctx.fillText('Wave ' + next, W / 2, H * 0.42);
    ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(147,163,194,.95)';
    ctx.fillText(next % BOSS_EVERY === 0 ? 'Boss incoming…' : 'Get ready…', W / 2, H * 0.42 + 34);
    ctx.restore();
  }

  function draw(t) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0f22');
    g.addColorStop(0.55, '#080d1a');
    g.addColorStop(1, '#05070e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    drawStars();

    for (var p = 0; p < powers.length; p++) drawPower(powers[p]);

    for (var e = 0; e < enemies.length; e++) drawEnemy(enemies[e]);

    /* player bullets */
    ctx.save();
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 10;
    drawBullets();
    ctx.restore();

    /* enemy bullets */
    ctx.save();
    ctx.shadowColor = '#fb7185';
    ctx.shadowBlur = 10;
    for (var m = 0; m < eBullets.length; m++) {
      var eb = eBullets[m];
      ctx.fillStyle = eb.r > 6 ? '#fed7aa' : '#fecdd3';
      ctx.beginPath();
      ctx.arc(eb.x, eb.y, eb.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (state !== 'over') {
      drawShip(t, ship, '#ec4899', '#f9a8d4');
      if (duo) drawShip(t, ship2, '#22d3ee', '#a5f3fc');
    }

    /* sparks */
    for (var q = 0; q < sparks.length; q++) {
      var sk = sparks[q];
      ctx.globalAlpha = Math.max(0, Math.min(1, sk.life / sk.max));
      ctx.fillStyle = sk.color;
      ctx.beginPath();
      ctx.arc(sk.x, sk.y, sk.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawPowerChips();
    drawBossBar();
    drawBombButton();
    drawUpgradeSummary();
    drawBanner();

    if (phaseFlash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, phaseFlash / 500);
      ctx.fillStyle = '#fef3c7';
      ctx.font = '800 24px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(phaseFlashText, W / 2, H * 0.30);
      ctx.restore();
    }

    if (flashT > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.55, flashT / 700);
      ctx.fillStyle = '#fef9c3';
      ctx.fillRect(0, 0, W, H);
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

    var pad = (duo && key.indexOf('Arrow') === 0) ? keys2 : keys;
    if (key === 'ArrowLeft' || key === 'a' || key === 'A') pad.left = true;
    else if (key === 'ArrowRight' || key === 'd' || key === 'D') pad.right = true;
    else if (key === 'ArrowUp' || key === 'w' || key === 'W') pad.up = true;
    else if (key === 'ArrowDown' || key === 's' || key === 'S') pad.down = true;
    else if (key === 'x' || key === 'X' || key === 'b' || key === 'B') {
      detonate();
    } else if (key === ' ') {
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
    var pad = (duo && key.indexOf('Arrow') === 0) ? keys2 : keys;
    if (key === 'ArrowLeft' || key === 'a' || key === 'A') pad.left = false;
    else if (key === 'ArrowRight' || key === 'd' || key === 'D') pad.right = false;
    else if (key === 'ArrowUp' || key === 'w' || key === 'W') pad.up = false;
    else if (key === 'ArrowDown' || key === 's' || key === 'S') pad.down = false;
    else if (key === ' ') firing = false;
  });

  window.addEventListener('blur', function () {
    keys.left = keys.right = keys.up = keys.down = false;
    keys2.left = keys2.right = keys2.up = keys2.down = false;
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

  canvas.addEventListener('pointerdown', function (e) {
    if (choosing) {
      var p = pointerToArena(e);
      for (var i = 0; i < 3; i++) {
        if (choices[i] && inRect(p.x, p.y, cardRect(i))) {
          selectUpgrade(i);
          return;
        }
      }
      return;
    }
    if (state === 'ready' || state === 'over') { start(); return; }
    if (state === 'running' && bombCharges > 0) {
      var q = pointerToArena(e);
      if (inRect(q.x, q.y, bombRect)) detonate();
    }
  });

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
    keys2.left = keys2.right = keys2.up = keys2.down = false;
    firing = false;
    if (state === 'running') pause();
  });

  /* ---------------- read-only test hook ---------------- */

  window.__neonSquadron = {
    state: function () { return state; },
    duo: function () { return duo; },
    wave: function () { return wave; },
    score: function () { return score; },
    scores: function () { return { p1: score, p2: score2 }; },
    lives: function () { return lives; },
    ship: function () { return { x: ship.x, y: ship.y }; },
    ship2: function () { return duo ? { x: ship2.x, y: ship2.y } : null; },
    boss: function () {
      var b = findBoss();
      if (!b) return null;
      return {
        archetype: b.arch, name: b.name,
        hp: b.hp, maxHp: b.maxHp, phase: b.phase,
        x: b.x, y: b.y,
        telegraph: b.heavyTele > 0
      };
    },
    powerups: function () {
      var active = [];
      if (rapidMs > 0) active.push({ kind: 'rapid', remaining: rapidMs });
      if (spreadMs > 0) active.push({ kind: 'spread', remaining: spreadMs });
      if (homingMs > 0) active.push({ kind: 'homing', remaining: homingMs });
      if (laserMs > 0) active.push({ kind: 'laser', remaining: laserMs });
      if (magnetMs > 0) active.push({ kind: 'magnet', remaining: magnetMs });
      if (doubleMs > 0) active.push({ kind: 'double', remaining: doubleMs });
      var drops = [];
      for (var i = 0; i < powers.length; i++) {
        drops.push({ kind: powers[i].kind, x: powers[i].x, y: powers[i].y });
      }
      return { active: active, shield: shield, bombs: bombCharges, drops: drops };
    },
    upgrades: function () {
      var picked = [];
      for (var i = 0; i < choices.length; i++) picked.push(choices[i].id);
      return {
        dmg: upg.dmg, rate: upg.rate, shield: upg.shield,
        bomb: upg.bomb, life: upg.life,
        choosing: choosing, choices: picked
      };
    }
  };

  /* ---------------- boot ---------------- */

  function startDuo() {
    duo = true;
    start();
  }

  function stopDuo() {
    duo = false;
    start();
  }

  if (typeof GameShell.onDuo === 'function') GameShell.onDuo(startDuo, stopDuo);

  initStars();
  reset();
  state = 'ready';
  ensureLoop();
  GameShell.overlay.show({
    title: 'Neon Squadron',
    msg: 'Fly with the arrow keys or WASD and shoot with Space — auto-fire is already on. Bosses arrive every fourth wave: dodge their telegraphed heavy attack, then pick an upgrade with 1, 2 or 3. Grab power-ups, and press X (or tap the bomb chip) to clear the screen. For two players at once, press Duo in the HUD: P1 flies with WASD, P2 with the arrow keys, sharing lives and upgrades.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* shared HUD reset button */
  if (typeof GameShell.onReset === 'function') GameShell.onReset(start);
})();
