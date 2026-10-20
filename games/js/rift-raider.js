/* ============================================================
   Rift Raider — original game for PixelPlay
   Horizontal scrolling shoot-'em-up: fly the scout ship with
   the arrow keys / WASD, dodge drifting rocks, blast raiders
   and collect rapid-fire, spread and shield capsules.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 720, H = 420;
  var BEST_KEY = 'rift-raider';

  var SHIP_MIN_X = 74;
  var SHIP_MAX_X = 300;
  var SHIP_SPEED_X = 215;
  var SHIP_SPEED_Y = 290;
  var SHIP_R = 12;

  var BASE_SCROLL = 232, MAX_SCROLL = 428;

  var state = 'ready';               /* ready | running | paused | over */
  var best = GameShell.best.get(BEST_KEY, 0);

  var ship = { x: 150, y: H / 2, vx: 0, vy: 0 };
  var keys = { up: false, down: false, left: false, right: false };

  var bullets, ebullets, rocks, enemies, powerups, bits, texts;
  var dist, bonus, lives, invuln, scroll, shake, muzzle, clock;
  var fireMs, rockMs, enemyMs, powMs, rapidMs, spreadMs, shield;
  var homingMs, pierceMs, bombFlash, upgradeChoices, upgradeRects, upgradeSel;
  var upDamage, upRate, upPierce, shieldUp, lifeUp, powerupSpawns, powerupCount;
  var boss, bossNum, bossAt, bossesSpawned, bossesDefeated, upgradeCount, bombsUsed;
  var newBest = false, rafId = 0, lastT = 0;

  /* Boss milestones: the first arrives at 1250 m, then roughly every 1400 m. */
  var FIRST_BOSS = 1250, BOSS_GAP = 1400;

  var UPGRADES = {
    damage: { title: 'Heavy Rounds', desc: '+1 cannon damage', col: '#fb7185' },
    rate:   { title: 'Overclock',   desc: 'Fire 12% faster',    col: '#fbbf24' },
    pierce: { title: 'Piercing Beam', desc: 'Shots pass through', col: '#a3e635' },
    shield: { title: 'Deflector',   desc: '+1 shield charge',   col: '#a78bfa' },
    life:   { title: 'Spare Hull',  desc: '+1 life',            col: '#4ade80' }
  };

  var stars = [];
  (function seedStars() {
    for (var i = 0; i < 96; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: 0.25 + Math.random() * 0.75
      });
    }
  })();

  /* ---------------- helpers ---------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function toast(x, y, txt, colour) {
    texts.push({ x: x, y: y, txt: txt, colour: colour || '#e8eefc', life: 900, max: 900 });
    if (texts.length > 20) texts.shift();
  }

  function burst(x, y, n, colour, power) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = (0.35 + Math.random()) * power;
      bits.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 300 + Math.random() * 340, max: 640,
        size: 1.5 + Math.random() * 2.5, colour: colour
      });
    }
    if (bits.length > 260) bits.splice(0, bits.length - 260);
  }

  function metres() { return Math.floor(dist); }
  function scoreNow() { return Math.floor(dist) + bonus; }

  /* ---------------- HUD (updates in place, never rebuilt) ---------------- */

  var hudCells = null;

  function paintHud() {
    var hud = document.getElementById('gameHud');
    if (!hud) return;
    if (!hudCells || hudCells.length < 3 || hudCells[0].parentNode !== hud) {
      GameShell.hud({ Score: 0, Best: 0, Lives: 0 }, '');
      hudCells = hud.querySelectorAll('.hud-item b');
    }
    if (hudCells.length >= 3) {
      hudCells[0].textContent = scoreNow();
      hudCells[1].textContent = Math.max(best, scoreNow());
      hudCells[2].textContent = lives;
    }
    var spacer = hud.querySelector('.hud-spacer');
    if (spacer) {
      if (state === 'paused') spacer.textContent = '⏸ Paused';
      else if (state === 'upgrade') spacer.textContent = 'Boss defeated — choose an upgrade';
      else if (boss) spacer.textContent = '⚠ ' + boss.name + ' · ' + metres() + ' m';
      else spacer.textContent = 'Distance ' + metres() + ' m';
    }
  }

  /* ---------------- spawning ---------------- */

  function spawnRock() {
    var r = 12 + Math.random() * 14;
    var n = 6 + ((Math.random() * 3) | 0);
    var verts = [], i;
    for (i = 0; i < n; i++) verts.push(0.72 + Math.random() * 0.42);
    var hp = r < 16 ? 1 : (r < 23 ? 2 : 3);
    rocks.push({
      x: W + 30 + Math.random() * 70,
      y: 34 + Math.random() * (H - 68),
      r: r, verts: verts,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 1.4,
      vx: -(scroll + 20 + Math.random() * 70),
      vy: (Math.random() - 0.5) * 42,
      hp: hp, maxHp: hp, hurt: 0
    });
  }

  function spawnEnemy() {
    var y = 46 + Math.random() * (H - 92);
    enemies.push({
      x: W + 50, y: y, y0: y,
      r: 16, hp: 3, maxHp: 3,
      vx: -(scroll * 0.72 + 26),
      phase: Math.random() * Math.PI * 2,
      fire: 800 + Math.random() * 1000,
      hurt: 0
    });
  }

  function pickPowerType() {
    /* weighted: familiar capsules stay common, bombs and spare lives are rare */
    var table = [
      ['rapid', 19], ['spread', 17], ['shield', 17],
      ['homing', 16], ['pierce', 15], ['bomb', 8], ['life', 5]
    ];
    var total = 0, i, r;
    for (i = 0; i < table.length; i++) total += table[i][1];
    r = Math.random() * total;
    for (i = 0; i < table.length; i++) {
      r -= table[i][1];
      if (r <= 0) return table[i][0];
    }
    return 'rapid';
  }

  function makePowerup(x, y, type) {
    return {
      x: x, y: y, r: 13,
      type: type || pickPowerType(),
      vx: -(scroll * 0.68),
      hurt: 0
    };
  }

  function spawnPowerup() {
    powerups.push(makePowerup(W + 30, 46 + Math.random() * (H - 92)));
    powerupSpawns++;
  }

  function enemyShot(e) {
    var d = e.x - ship.x;
    var vy = d > 1 ? clamp((ship.y - e.y) / d * 320, -190, 190) : 0;
    ebullets.push({ x: e.x - 16, y: e.y, vx: -320, vy: vy, life: 3.2 });
    if (ebullets.length > 90) ebullets.shift();
  }

  /* ---------------- combat ---------------- */

  function shoot() {
    var lanes = spreadMs > 0 ? [-165, 0, 165] : [0];
    var dmg = 1 + upDamage;
    var piercing = pierceMs > 0 || upPierce > 0;
    var homing = homingMs > 0;
    for (var i = 0; i < lanes.length; i++) {
      var vy = lanes[i];
      bullets.push({
        x: ship.x + 22,
        y: ship.y + vy * 0.02,
        vx: 650, vy: vy, life: 1.3, r: 4,
        dmg: dmg, pierce: piercing, homing: homing, cool: 0
      });
    }
    if (bullets.length > 140) bullets.splice(0, bullets.length - 140);
    muzzle = 60;
  }

  function nearestTarget(x, y) {
    var bestT = null, bestD = 1e9, i, t, dx, dy, d;
    if (boss) {
      dx = boss.x - x; dy = boss.y - y;
      bestD = dx * dx + dy * dy;
      bestT = boss;
    }
    for (i = 0; i < enemies.length; i++) {
      t = enemies[i];
      dx = t.x - x; dy = t.y - y; d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; bestT = t; }
    }
    for (i = 0; i < rocks.length; i++) {
      t = rocks[i];
      dx = t.x - x; dy = t.y - y; d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; bestT = t; }
    }
    return bestT;
  }

  function hurt() {
    if (invuln > 0 || state !== 'running') return;
    if (shield) {
      shield = false;
      invuln = 900;
      shake = Math.max(shake, 7);
      burst(ship.x, ship.y, 18, '#a78bfa', 170);
      toast(ship.x + 30, ship.y - 26, 'Shield absorbed it!', '#c4b5fd');
      paintHud();
      return;
    }
    lives--;
    invuln = 1600;
    shake = Math.max(shake, 14);
    burst(ship.x, ship.y, 24, '#f87171', 210);
    rapidMs = 0;
    spreadMs = 0;
    homingMs = 0;
    pierceMs = 0;
    if (lives <= 0) {
      lives = 0;
      gameOver();
    } else {
      paintHud();
    }
  }

  function destroyRock(r, i) {
    rocks.splice(i, 1);
    bonus += 8;
    burst(r.x, r.y, 12, '#94a3b8', 140);
    toast(r.x, r.y - 12, '+8', '#cbd5e1');
  }

  function destroyEnemy(e, i) {
    enemies.splice(i, 1);
    bonus += 25;
    burst(e.x, e.y, 20, '#fb7185', 200);
    toast(e.x, e.y - 14, '+25', '#fda4af');
    if (Math.random() < 0.26) {
      powerups.push(makePowerup(e.x, e.y));
    }
    paintHud();
  }

  /* ---------------- screen bomb ---------------- */

  function screenBomb() {
    bombsUsed++;
    bombFlash = 280;
    shake = Math.max(shake, 12);
    var i, k;

    for (i = 0; i < ebullets.length; i++) {
      burst(ebullets[i].x, ebullets[i].y, 2, '#fdba74', 90);
    }
    ebullets.length = 0;

    for (i = enemies.length - 1; i >= 0; i--) {
      var en = enemies[i];
      en.hp -= 4;
      en.hurt = 120;
      if (en.hp <= 0) destroyEnemy(en, i);
      else burst(en.x, en.y, 6, '#fbbf24', 150);
    }
    for (i = rocks.length - 1; i >= 0; i--) {
      var rk = rocks[i];
      rk.hp -= 3;
      rk.hurt = 120;
      if (rk.hp <= 0) destroyRock(rk, i);
      else burst(rk.x, rk.y, 5, '#fbbf24', 140);
    }
    if (boss) {
      boss.hp -= 16;
      boss.hurt = 160;
      burst(boss.x, boss.y, 30, '#fdba74', 250);
      if (boss.hp <= 0) defeatBoss();
    }
    toast(ship.x + 54, ship.y - 34, 'BOMB!', '#fdba74');
    paintHud();
  }

  /* ---------------- bosses ---------------- */

  function spawnBoss() {
    bossNum++;
    var variant = bossNum % 2 === 1 ? 0 : 1;
    var baseHp = variant === 0 ? 80 : 108;
    var hp = Math.round(baseHp + (bossNum - 1) * 46);
    boss = {
      variant: variant,
      name: variant === 0 ? 'Crimson Warden' : 'Violet Hydra',
      x: W + 100, y: H / 2, y0: H / 2,
      r: variant === 0 ? 46 : 42,
      hp: hp, maxHp: hp,
      hurt: 0,
      entering: true,
      fireT: 1.4,
      cycle: 0,
      spiral: 0,
      phase: Math.random() * Math.PI * 2,
      targetX: W - 118
    };
    bossesSpawned++;
    ebullets.length = 0;
    toast(W / 2 - 40, H / 2 - 90, 'WARNING — ' + boss.name, '#fca5a5');
    shake = Math.max(shake, 8);
    paintHud();
  }

  function bossShot(x, y, vx, vy, col) {
    ebullets.push({ x: x, y: y, vx: vx, vy: vy, life: 4.2, col: col || '#fdba74' });
    if (ebullets.length > 130) ebullets.shift();
  }

  function bossFire() {
    if (!boss) return;
    var i, a, sp;
    boss.cycle++;

    if (boss.variant === 0) {
      /* Crimson Warden: aimed triple burst, then a wide fan. */
      if (boss.cycle % 2 === 1) {
        var base = Math.atan2(ship.y - boss.y, ship.x - boss.x);
        for (i = -1; i <= 1; i++) {
          a = base + i * 0.15;
          sp = 330;
          bossShot(boss.x - boss.r * 0.7, boss.y,
                   Math.cos(a) * sp, Math.sin(a) * sp, '#fdba74');
        }
      } else {
        for (i = 0; i < 9; i++) {
          a = Math.PI + (i - 4) * 0.15;
          bossShot(boss.x - boss.r * 0.6, boss.y, Math.cos(a) * 235, Math.sin(a) * 235, '#fb7185');
        }
      }
    } else {
      /* Violet Hydra: rotating triple spiral, alternating with a wall that leaves a gap. */
      if (boss.cycle % 3 !== 0) {
        boss.spiral += 0.55;
        for (i = 0; i < 3; i++) {
          a = boss.spiral + i * (Math.PI * 2 / 3);
          bossShot(boss.x, boss.y, Math.cos(a) * 205, Math.sin(a) * 205, '#c4b5fd');
        }
      } else {
        var gap = 1 + ((Math.random() * 6) | 0);
        for (i = 0; i < 8; i++) {
          if (i === gap) continue;
          bossShot(boss.x - boss.r * 0.6, 54 + i * 44, -205, 0, '#a78bfa');
        }
      }
      if (boss.cycle % 4 === 0) {
        bossShot(boss.x - boss.r * 0.7, boss.y,
                 -360, clamp((ship.y - boss.y) * 0.9, -210, 210), '#f0abfc');
      }
    }
  }

  function updateBoss(s, dt) {
    if (!boss) return;
    if (boss.hurt > 0) boss.hurt -= dt;

    if (boss.entering) {
      boss.x -= 92 * s;
      if (boss.x <= boss.targetX) {
        boss.x = boss.targetX;
        boss.entering = false;
        boss.fireT = 1.1;
      }
    } else {
      boss.y = clamp(H / 2 + Math.sin(clock / 720 + boss.phase) * 92, 82, H - 82);
      boss.fireT -= s;
      if (boss.fireT <= 0) {
        bossFire();
        var speedUp = Math.min(0.4, bossNum * 0.05);
        boss.fireT = (boss.variant === 0 ? 1.35 : 1.15) - speedUp;
      }
    }

    if (state === 'running') {
      var bdx = boss.x - ship.x, bdy = boss.y - ship.y;
      var bt = boss.r * 0.72 + SHIP_R;
      if (bdx * bdx + bdy * bdy < bt * bt) {
        hurt();
      }
    }
  }

  function defeatBoss() {
    if (!boss) return;
    var bx = boss.x, by = boss.y;
    var payout = 250 + bossNum * 100;
    bonus += payout;
    bossesDefeated++;
    boss = null;
    ebullets.length = 0;
    shake = Math.max(shake, 18);
    burst(bx, by, 60, '#fde68a', 320);
    burst(bx, by, 40, '#fb7185', 240);
    burst(bx, by, 30, '#ffffff', 180);
    toast(bx - 40, by, 'BOSS DOWN +' + payout, '#fde68a');
    powerups.push(makePowerup(bx, by));
    openUpgrade();
    paintHud();
  }

  /* ---------------- between-boss upgrades ---------------- */

  function openUpgrade() {
    var pool = ['damage', 'rate', 'pierce', 'shield', 'life'];
    var picks = [], i, j, tmp;
    for (i = 0; i < pool.length; i++) picks.push(pool[i]);
    for (i = picks.length - 1; i > 0; i--) {
      j = (Math.random() * (i + 1)) | 0;
      tmp = picks[i]; picks[i] = picks[j]; picks[j] = tmp;
    }
    upgradeChoices = picks.slice(0, 3);
    upgradeSel = 0;
    upgradeRects = [];
    state = 'upgrade';
    keys.up = keys.down = keys.left = keys.right = false;
    paintHud();
  }

  function applyUpgrade(id) {
    if (state !== 'upgrade' || !UPGRADES[id]) return;
    if (id === 'damage') upDamage++;
    else if (id === 'rate') upRate++;
    else if (id === 'pierce') upPierce++;
    else if (id === 'shield') { shield = true; shieldUp++; }
    else if (id === 'life') { lives++; lifeUp++; }

    upgradeCount++;
    bonus += 30;
    bossAt = Math.max(bossAt, metres() + BOSS_GAP);
    state = 'running';
    upgradeChoices = [];
    upgradeRects = [];
    toast(ship.x + 70, ship.y - 44, UPGRADES[id].title + '!', UPGRADES[id].col);
    paintHud();
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

  /* ---------------- state changes ---------------- */

  function start() {
    ship.x = 150;
    ship.y = H / 2;
    ship.vx = 0;
    ship.vy = 0;
    keys.up = keys.down = keys.left = keys.right = false;

    bullets = [];
    ebullets = [];
    rocks = [];
    enemies = [];
    powerups = [];
    bits = [];
    texts = [];

    dist = 0;
    bonus = 0;
    lives = 3;
    invuln = 1200;
    scroll = BASE_SCROLL;
    shake = 0;
    muzzle = 0;
    fireMs = 200;
    rockMs = 700;
    enemyMs = 4200;
    powMs = 7000;
    rapidMs = 0;
    spreadMs = 0;
    shield = false;
    homingMs = 0;
    pierceMs = 0;
    bombFlash = 0;
    upDamage = 0;
    upRate = 0;
    upPierce = 0;
    shieldUp = 0;
    lifeUp = 0;
    powerupSpawns = 0;
    powerupCount = 0;
    boss = null;
    bossNum = 0;
    bossAt = FIRST_BOSS;
    bossesSpawned = 0;
    bossesDefeated = 0;
    upgradeCount = 0;
    bombsUsed = 0;
    upgradeChoices = [];
    upgradeRects = [];
    upgradeSel = 0;
    newBest = false;

    state = 'running';
    GameShell.overlay.hide();
    paintHud();
    ensureLoop();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    keys.up = keys.down = keys.left = keys.right = false;
    paintHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'Engines idling in the rift. Resume when you are ready to fly on.',
      stats: [
        { label: 'Score', value: scoreNow() },
        { label: 'Distance', value: metres() + ' m' },
        { label: 'Lives', value: lives }
      ],
      btn: '▶ Resume',
      action: resume
    });
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'running';
    GameShell.overlay.hide();
    paintHud();
  }

  function gameOver() {
    state = 'over';
    if (scoreNow() > best) {
      best = scoreNow();
      newBest = true;
      GameShell.best.set(BEST_KEY, best);
    }
    paintHud();
    GameShell.overlay.show({
      title: newBest ? 'New high score!' : 'Ship destroyed',
      msg: 'You flew ' + metres() + ' metres through the rift and scored ' +
           scoreNow() + ' points. The raiders own this stretch — for now.',
      stats: [
        { label: 'Score', value: scoreNow() },
        { label: 'Distance', value: metres() + ' m' },
        { label: 'Best', value: best }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  /* ---------------- update ---------------- */

  function driftStars(dt, speed) {
    var s = dt / 1000;
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      st.x -= speed * st.z * s;
      if (st.x < -4) {
        st.x = W + 4;
        st.y = Math.random() * H;
      }
    }
  }

  function update(dt) {
    var s = dt / 1000;
    var i, j, b;

    /* difficulty rises with distance */
    var level = 1 + Math.floor(dist / 340);
    scroll = Math.min(MAX_SCROLL, BASE_SCROLL + (level - 1) * 16);

    dist += scroll * s / 10;                 /* 10 px = 1 metre */

    if (shake > 0) shake -= dt;
    if (invuln > 0) invuln -= dt;
    if (muzzle > 0) muzzle -= dt;
    if (rapidMs > 0) rapidMs = Math.max(0, rapidMs - dt);
    if (spreadMs > 0) spreadMs = Math.max(0, spreadMs - dt);
    if (homingMs > 0) homingMs = Math.max(0, homingMs - dt);
    if (pierceMs > 0) pierceMs = Math.max(0, pierceMs - dt);
    if (bombFlash > 0) bombFlash = Math.max(0, bombFlash - dt);

    /* boss arrivals are distance milestones, not random spawns */
    if (!boss && dist >= bossAt) spawnBoss();

    /* --- ship --- */
    var tx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    var ty = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    ship.vx = tx * SHIP_SPEED_X;
    ship.vy = ty * SHIP_SPEED_Y;
    ship.x = clamp(ship.x + ship.vx * s, SHIP_MIN_X, SHIP_MAX_X);
    ship.y = clamp(ship.y + ship.vy * s, 24, H - 24);

    /* --- firing (automatic) --- */
    fireMs -= dt;
    if (fireMs <= 0) {
      shoot();
      var baseFire = rapidMs > 0 ? 104 : 184;
      fireMs = Math.max(58, baseFire * Math.pow(0.88, upRate));
    }

    /* --- spawning (the boss clears the lane for its duel) --- */
    if (!boss) {
      rockMs -= dt;
      if (rockMs <= 0) {
        spawnRock();
        rockMs = Math.max(300, 950 - level * 45) * (0.7 + Math.random() * 0.6);
      }
      enemyMs -= dt;
      if (enemyMs <= 0) {
        spawnEnemy();
        enemyMs = Math.max(900, 2700 - level * 140) * (0.7 + Math.random() * 0.6);
      }
      powMs -= dt;
      if (powMs <= 0) {
        spawnPowerup();
        powMs = 8000 + Math.random() * 7000;
      }
    } else {
      rockMs = Math.max(rockMs, 700);
      enemyMs = Math.max(enemyMs, 2200);
      powMs = Math.max(powMs, 5000);
    }

    /* --- rocks --- */
    for (i = rocks.length - 1; i >= 0; i--) {
      var r = rocks[i];
      r.x += r.vx * s;
      r.y += r.vy * s;
      r.rot += r.spin * s;
      if (r.hurt > 0) r.hurt -= dt;
      if (r.x < -70 || r.y < -70 || r.y > H + 70) { rocks.splice(i, 1); continue; }
      if (state === 'running') {
        var ddx = r.x - ship.x, ddy = r.y - ship.y;
        var touch = r.r * 0.82 + SHIP_R;
        if (ddx * ddx + ddy * ddy < touch * touch) {
          burst(r.x, r.y, 14, '#94a3b8', 150);
          rocks.splice(i, 1);
          hurt();
        }
      }
    }

    /* --- enemies --- */
    for (i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      e.x += e.vx * s;
      e.y = clamp(e.y0 + Math.sin(clock / 640 + e.phase) * 32, 26, H - 26);
      if (e.hurt > 0) e.hurt -= dt;
      if (e.x < -60) { enemies.splice(i, 1); continue; }
      e.fire -= dt;
      if (e.fire <= 0 && e.x < W - 40) {
        enemyShot(e);
        e.fire = Math.max(700, 1500 + Math.random() * 900 - level * 60);
      }
      if (state === 'running') {
        var edx = e.x - ship.x, edy = e.y - ship.y;
        var et = e.r * 0.8 + SHIP_R;
        if (edx * edx + edy * edy < et * et) {
          burst(e.x, e.y, 20, '#fb7185', 200);
          enemies.splice(i, 1);
          hurt();
        }
      }
    }

    /* --- boss --- */
    updateBoss(s, dt);

    /* --- player bullets --- */
    for (i = bullets.length - 1; i >= 0; i--) {
      b = bullets[i];
      if (b.cool > 0) b.cool -= s;

      /* homing missiles curve toward the closest target */
      if (b.homing && b.cool <= 0) {
        var tgt = nearestTarget(b.x, b.y);
        if (tgt) {
          var want = Math.atan2(tgt.y - b.y, tgt.x - b.x);
          var cur = Math.atan2(b.vy, b.vx);
          var diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
          var turn = clamp(diff, -4.6 * s, 4.6 * s);
          var mag = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 620;
          b.vx = Math.cos(cur + turn) * mag;
          b.vy = Math.sin(cur + turn) * mag;
        }
      }

      b.x += b.vx * s;
      b.y += b.vy * s;
      b.life -= s;
      if (b.life <= 0 || b.x > W + 24 || b.y < -24 || b.y > H + 24) { bullets.splice(i, 1); continue; }
      if (b.cool > 0) continue;

      var hit = false;
      for (j = rocks.length - 1; j >= 0; j--) {
        var rk = rocks[j];
        var rx = rk.x - b.x, ry = rk.y - b.y;
        var rl = rk.r * 0.9 + b.r;
        if (rx * rx + ry * ry < rl * rl) {
          rk.hp -= b.dmg;
          rk.hurt = 80;
          burst(b.x, b.y, 3, '#e2e8f0', 60);
          if (rk.hp <= 0) destroyRock(rk, j);
          hit = true;
          break;
        }
      }
      if (!hit) {
        for (j = enemies.length - 1; j >= 0; j--) {
          var en = enemies[j];
          var ex = en.x - b.x, ey = en.y - b.y;
          var el = en.r * 0.8 + b.r;
          if (ex * ex + ey * ey < el * el) {
            en.hp -= b.dmg;
            en.hurt = 80;
            burst(b.x, b.y, 3, '#fecdd3', 60);
            if (en.hp <= 0) destroyEnemy(en, j);
            hit = true;
            break;
          }
        }
      }
      if (!hit && boss) {
        var obx = boss.x - b.x, oby = boss.y - b.y;
        var obl = boss.r * 0.78 + b.r;
        if (obx * obx + oby * oby < obl * obl) {
          boss.hp -= b.dmg;
          boss.hurt = 80;
          burst(b.x, b.y, 4, boss.variant === 0 ? '#fecaca' : '#ddd6fe', 90);
          if (boss.hp <= 0) defeatBoss();
          hit = true;
        }
      }
      if (hit) {
        if (b.pierce) {
          b.cool = 0.09;                 /* punch through, then re-arm briefly */
          b.life = Math.min(b.life, 0.9);
        } else {
          bullets.splice(i, 1);
        }
      }
    }

    /* --- enemy bullets --- */
    for (i = ebullets.length - 1; i >= 0; i--) {
      b = ebullets[i];
      b.x += b.vx * s;
      b.y += b.vy * s;
      b.life -= s;
      if (b.life <= 0 || b.x < -20 || b.y < -20 || b.y > H + 20) { ebullets.splice(i, 1); continue; }
      var bx = b.x - ship.x, by = b.y - ship.y;
      var bl = SHIP_R + 5;
      if (state === 'running' && bx * bx + by * by < bl * bl) {
        ebullets.splice(i, 1);
        hurt();
      }
    }

    /* --- power-ups --- */
    for (i = powerups.length - 1; i >= 0; i--) {
      var p = powerups[i];
      p.x += p.vx * s;
      if (p.x < -40) { powerups.splice(i, 1); continue; }
      if (state === 'running') {
        var px = p.x - ship.x, py = p.y - ship.y;
        var pl = p.r + SHIP_R + 4;
        if (px * px + py * py < pl * pl) {
          powerups.splice(i, 1);
          powerupCount++;
          burst(p.x, p.y, 12, '#a5f3fc', 130);
          if (p.type === 'rapid') {
            rapidMs = 9000;
            toast(ship.x + 46, ship.y - 30, 'Rapid fire!', '#fcd34d');
          } else if (p.type === 'spread') {
            spreadMs = 10000;
            toast(ship.x + 46, ship.y - 30, 'Spread cannon!', '#67e8f9');
          } else if (p.type === 'homing') {
            homingMs = 10000;
            toast(ship.x + 46, ship.y - 30, 'Homing missiles!', '#f9a8d4');
          } else if (p.type === 'pierce') {
            pierceMs = 10000;
            toast(ship.x + 46, ship.y - 30, 'Piercing beam!', '#bef264');
          } else if (p.type === 'bomb') {
            screenBomb();
          } else if (p.type === 'life') {
            lives++;
            toast(ship.x + 46, ship.y - 30, 'Extra life!', '#86efac');
          } else {
            shield = true;
            toast(ship.x + 46, ship.y - 30, 'Shield up!', '#c4b5fd');
          }
          paintHud();
        }
      }
    }

    /* --- particles & text --- */
    for (i = bits.length - 1; i >= 0; i--) {
      var bit = bits[i];
      bit.x += bit.vx * s;
      bit.y += bit.vy * s;
      bit.vx *= 0.97;
      bit.vy *= 0.97;
      bit.life -= dt;
      if (bit.life <= 0) bits.splice(i, 1);
    }
    for (i = texts.length - 1; i >= 0; i--) {
      texts[i].y -= 20 * s;
      texts[i].life -= dt;
      if (texts[i].life <= 0) texts.splice(i, 1);
    }

    paintHud();
  }

  /* gentle particle drift while the upgrade cards are on screen */
  function updateUpgradeAmbient(dt) {
    var s = dt / 1000, i;
    if (shake > 0) shake = Math.max(0, shake - dt);
    if (bombFlash > 0) bombFlash = Math.max(0, bombFlash - dt);
    for (i = bits.length - 1; i >= 0; i--) {
      var bit = bits[i];
      bit.x += bit.vx * s;
      bit.y += bit.vy * s;
      bit.vx *= 0.97;
      bit.vy *= 0.97;
      bit.life -= dt;
      if (bit.life <= 0) bits.splice(i, 1);
    }
    for (i = texts.length - 1; i >= 0; i--) {
      texts[i].y -= 20 * s;
      texts[i].life -= dt;
      if (texts[i].life <= 0) texts.splice(i, 1);
    }
  }

  /* ---------------- draw ---------------- */

  function nebula(x, y, rad, colour) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, colour);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  function drawSpace() {
    var g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#070d1a');
    g.addColorStop(0.55, '#04060d');
    g.addColorStop(1, '#0a0714');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var drift = -(clock / 45) % (W + 360);
    nebula(drift + 120, 110, 190, 'rgba(6,182,212,.10)');
    nebula(drift + 520, 320, 230, 'rgba(168,85,247,.10)');

    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      ctx.globalAlpha = 0.25 + st.z * 0.6;
      ctx.fillStyle = st.z > 0.75 ? '#bae6fd' : '#e2e8f0';
      var sz = 1 + st.z * 1.6;
      ctx.fillRect(st.x, st.y, sz, sz);
    }
    ctx.globalAlpha = 1;

    /* launch corridor the ship may not leave */
    var lg = ctx.createLinearGradient(SHIP_MIN_X - 46, 0, SHIP_MIN_X + 4, 0);
    lg.addColorStop(0, 'rgba(6,182,212,.16)');
    lg.addColorStop(1, 'rgba(6,182,212,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(SHIP_MIN_X - 46, 0, 50, H);
    ctx.strokeStyle = 'rgba(34,211,238,.30)';
    ctx.setLineDash([8, 12]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(SHIP_MIN_X - 44, 0);
    ctx.lineTo(SHIP_MIN_X - 44, H);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawRock(r) {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.rot);
    var n = r.verts.length, i, a, rad;
    ctx.fillStyle = r.hurt > 0 ? '#f1f5f9' : '#46536b';
    ctx.strokeStyle = 'rgba(148,163,184,.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      a = (i / n) * Math.PI * 2;
      rad = r.r * r.verts[i];
      if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
      else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(13,19,33,.55)';
    ctx.beginPath();
    ctx.arc(r.r * 0.26, -r.r * 0.18, r.r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-r.r * 0.3, r.r * 0.26, r.r * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.shadowColor = '#f472b6';
    ctx.shadowBlur = 12;
    ctx.fillStyle = e.hurt > 0 ? '#ffffff' : '#be185d';
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(6, -14);
    ctx.lineTo(15, 0);
    ctx.lineTo(6, 14);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fda4af';
    ctx.beginPath();
    ctx.arc(-6, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    if (e.hp < e.maxHp) {
      var w = 30, f = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(-w / 2, -e.r - 12, w, 4);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(-w / 2, -e.r - 12, w * f, 4);
    }
    ctx.restore();
  }

  function powerColour(type) {
    if (type === 'rapid') return '#fbbf24';
    if (type === 'spread') return '#22d3ee';
    if (type === 'shield') return '#a78bfa';
    if (type === 'homing') return '#f472b6';
    if (type === 'pierce') return '#a3e635';
    if (type === 'bomb') return '#fb923c';
    return '#4ade80';
  }

  function drawPowerup(p) {
    var col = powerColour(p.type);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.shadowColor = col;
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(8,12,22,.85)';
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    if (p.type === 'rapid') {
      ctx.beginPath();
      ctx.moveTo(3, -8);
      ctx.lineTo(-4, 1);
      ctx.lineTo(0, 1);
      ctx.lineTo(-3, 8);
      ctx.lineTo(5, -1);
      ctx.lineTo(1, -1);
      ctx.closePath();
      ctx.fill();
    } else if (p.type === 'spread') {
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-5, 0); ctx.lineTo(5, -6);
      ctx.moveTo(-5, 0); ctx.lineTo(5, 0);
      ctx.moveTo(-5, 0); ctx.lineTo(5, 6);
      ctx.stroke();
    } else if (p.type === 'homing') {
      /* little missile with fins */
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-2, -5);
      ctx.lineTo(-2, 5);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-2, -5); ctx.lineTo(-7, -8);
      ctx.moveTo(-2, 5); ctx.lineTo(-7, 8);
      ctx.stroke();
    } else if (p.type === 'pierce') {
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-6, -7); ctx.lineTo(-6, 7);
      ctx.stroke();
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(5, -5); ctx.lineTo(5, 5);
      ctx.stroke();
    } else if (p.type === 'bomb') {
      for (var k = 0; k < 8; k++) {
        var a = k / 8 * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 3, Math.sin(a) * 3);
        ctx.lineTo(Math.cos(a) * 8, Math.sin(a) * 8);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === 'life') {
      ctx.beginPath();
      ctx.moveTo(0, 7);
      ctx.bezierCurveTo(-12, -1, -6, -9, 0, -4);
      ctx.bezierCurveTo(6, -9, 12, -1, 0, 7);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
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

  function drawBoss() {
    if (!boss) return;
    var hit = boss.hurt > 0;
    ctx.save();
    ctx.translate(boss.x, boss.y);

    if (boss.variant === 0) {
      /* Crimson Warden: a wide armoured gunship with two pods. */
      var glow = hit ? '#ffffff' : '#fb7185';
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 22;
      ctx.fillStyle = hit ? '#ffffff' : '#7f1d1d';
      ctx.beginPath();
      ctx.moveTo(-boss.r, 0);
      ctx.lineTo(-boss.r * 0.3, -boss.r * 0.7);
      ctx.lineTo(boss.r * 0.55, -boss.r * 0.5);
      ctx.lineTo(boss.r, 0);
      ctx.lineTo(boss.r * 0.55, boss.r * 0.5);
      ctx.lineTo(-boss.r * 0.3, boss.r * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = glow;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = hit ? '#ffffff' : '#b91c1c';
      ctx.beginPath();
      ctx.ellipse(-boss.r * 0.45, -boss.r * 0.55, 15, 11, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-boss.r * 0.45, boss.r * 0.55, 15, 11, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fecaca';
      ctx.beginPath();
      ctx.arc(-boss.r * 0.72, -boss.r * 0.55, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-boss.r * 0.72, boss.r * 0.55, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fef2f2';
      ctx.beginPath();
      ctx.arc(-boss.r * 0.15, 0, 9 + Math.sin(clock / 200) * 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      /* Violet Hydra: a round core with three orbiting stingers. */
      ctx.shadowColor = '#a855f7';
      ctx.shadowBlur = 24;
      ctx.fillStyle = hit ? '#ffffff' : '#4c1d95';
      ctx.beginPath();
      ctx.arc(0, 0, boss.r * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = hit ? '#ffffff' : '#d8b4fe';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      for (var k = 0; k < 3; k++) {
        var a = clock / 620 + k * (Math.PI * 2 / 3);
        var ox = Math.cos(a) * boss.r * 0.95;
        var oy = Math.sin(a) * boss.r * 0.95;
        ctx.fillStyle = hit ? '#ffffff' : '#a855f7';
        ctx.beginPath();
        ctx.arc(ox, oy, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(216,180,254,.75)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(ox, oy);
        ctx.stroke();
      }
      ctx.fillStyle = '#f5d0fe';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    /* visible boss health bar across the top of the playfield */
    var bw = 420, bx = (W - bw) / 2, by = 22;
    var frac = clamp(boss.hp / boss.maxHp, 0, 1);
    ctx.save();
    ctx.fillStyle = 'rgba(5,7,14,.78)';
    ctx.fillRect(bx - 4, by - 4, bw + 8, 22);
    ctx.fillStyle = '#1c2740';
    ctx.fillRect(bx, by, bw, 14);
    ctx.fillStyle = boss.variant === 0 ? '#ef4444' : '#a855f7';
    ctx.fillRect(bx, by, bw * frac, 14);
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.fillRect(bx, by, bw * frac, 4);
    ctx.strokeStyle = 'rgba(232,238,252,.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx - 0.5, by - 0.5, bw + 1, 15);
    ctx.fillStyle = '#e8eefc';
    ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(boss.name.toUpperCase(), bx, by - 11);
    ctx.textAlign = 'right';
    ctx.fillText(Math.max(0, Math.ceil(boss.hp)) + ' / ' + boss.maxHp, bx + bw, by - 11);
    ctx.restore();
  }

  function drawUpgradePanel() {
    ctx.save();
    ctx.fillStyle = 'rgba(4,6,13,.82)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fde68a';
    ctx.font = '800 26px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('BOSS DOWN — CHOOSE AN UPGRADE', W / 2, 82);
    ctx.fillStyle = 'rgba(232,238,252,.75)';
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Press 1, 2 or 3 — or click a card. Your choice lasts the whole run.', W / 2, 112);

    var cw = 190, ch = 172, gap = 20;
    var total = cw * 3 + gap * 2;
    var x0 = (W - total) / 2, y0 = 152;
    upgradeRects = [];

    for (var i = 0; i < upgradeChoices.length; i++) {
      var id = upgradeChoices[i], def = UPGRADES[id];
      var x = x0 + i * (cw + gap);
      var r = { x: x, y: y0, w: cw, h: ch };
      upgradeRects.push(r);
      var hover = i === upgradeSel;

      ctx.fillStyle = hover ? 'rgba(30,41,59,.96)' : 'rgba(15,23,42,.92)';
      roundRect(x, y0, cw, ch, 14);
      ctx.fill();
      ctx.strokeStyle = def.col;
      ctx.lineWidth = hover ? 3 : 1.5;
      ctx.stroke();

      ctx.fillStyle = def.col;
      ctx.font = '800 15px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(def.title, x + cw / 2, y0 + 38);
      ctx.fillStyle = 'rgba(232,238,252,.85)';
      ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(def.desc, x + cw / 2, y0 + 72);

      /* simple icon glyphs, drawn with strokes like the rest of the game */
      ctx.strokeStyle = def.col;
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (id === 'damage') {
        ctx.moveTo(-12, 8); ctx.lineTo(12, -8);
        ctx.moveTo(4, -12); ctx.lineTo(12, -8); ctx.lineTo(10, 0);
      } else if (id === 'rate') {
        ctx.moveTo(2, -12); ctx.lineTo(-7, 2); ctx.lineTo(0, 2); ctx.lineTo(-2, 12); ctx.lineTo(8, -2); ctx.lineTo(1, -2);
      } else if (id === 'pierce') {
        ctx.moveTo(-14, 0); ctx.lineTo(14, 0);
        ctx.moveTo(8, -6); ctx.lineTo(14, 0); ctx.lineTo(8, 6);
      } else if (id === 'shield') {
        ctx.arc(0, 0, 11, 0, Math.PI * 2);
      } else {
        ctx.moveTo(0, 12); ctx.lineTo(0, -10);
        ctx.moveTo(-9, -1); ctx.lineTo(0, -10); ctx.lineTo(9, -1);
      }
      ctx.stroke();
      ctx.fillStyle = def.col;
      ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('[' + (i + 1) + ']', x + cw / 2, y0 + ch - 20);
    }

    ctx.fillStyle = 'rgba(232,238,252,.55)';
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('The rift pushes on. Bosses return every ' + BOSS_GAP + ' m.', W / 2, 356);
    ctx.restore();
  }

  function drawShip() {
    if (state === 'over') return;
    if (invuln > 0 && (Math.floor(clock / 90) % 2 === 0)) return;

    var tilt = clamp(ship.vy / SHIP_SPEED_Y, -1, 1) * 0.24;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(tilt);

    var flame = 7 + Math.sin(clock / 38) * 3;
    ctx.fillStyle = 'rgba(168,85,247,.85)';
    ctx.beginPath();
    ctx.moveTo(-10, -4);
    ctx.lineTo(-10 - flame, 0);
    ctx.lineTo(-10, 4);
    ctx.closePath();
    ctx.fill();

    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#e0f2fe';
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(-11, -11);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-11, 11);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#06b6d4';
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-7, -7);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();

    if (muzzle > 0) {
      ctx.globalAlpha = Math.min(1, muzzle / 60);
      ctx.fillStyle = '#cffafe';
      ctx.beginPath();
      ctx.arc(23, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (shield) {
      ctx.strokeStyle = 'rgba(167,139,250,.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(167,139,250,.35)';
      ctx.beginPath();
      ctx.arc(0, 0, 29, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawStatus() {
    var x = 14, y = 14, i;
    var rows = [];
    if (rapidMs > 0) rows.push({ t: 'RAPID', f: rapidMs / 9000, c: '#fbbf24', ms: rapidMs });
    if (spreadMs > 0) rows.push({ t: 'SPREAD', f: spreadMs / 10000, c: '#22d3ee', ms: spreadMs });
    if (homingMs > 0) rows.push({ t: 'HOMING', f: homingMs / 10000, c: '#f472b6', ms: homingMs });
    if (pierceMs > 0) rows.push({ t: 'PIERCE', f: pierceMs / 10000, c: '#a3e635', ms: pierceMs });
    if (shield) rows.push({ t: 'SHIELD', f: 1, c: '#a78bfa' });

    ctx.save();
    ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var yy = y + i * 20;
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      ctx.fillRect(x, yy, 92, 8);
      ctx.fillStyle = r.c;
      ctx.fillRect(x, yy, 92 * clamp(r.f, 0, 1), 8);
      ctx.fillStyle = 'rgba(232,238,252,.85)';
      ctx.fillText(r.t, x, yy + 18);
      if (r.ms) {
        ctx.fillStyle = r.c;
        ctx.fillText(Math.ceil(r.ms / 1000) + 's', x + 62, yy + 18);
      }
    }
    /* permanent boss upgrades are shown as tiny pips, bottom-left */
    var pips = [];
    for (i = 0; i < upDamage; i++) pips.push('#fb7185');
    for (i = 0; i < upRate; i++) pips.push('#fbbf24');
    for (i = 0; i < upPierce; i++) pips.push('#a3e635');
    for (i = 0; i < shieldUp; i++) pips.push('#a78bfa');
    for (i = 0; i < lifeUp; i++) pips.push('#4ade80');
    for (i = 0; i < pips.length && i < 12; i++) {
      ctx.fillStyle = pips[i];
      ctx.fillRect(x + i * 12, H - 18, 8, 8);
    }
    ctx.restore();
  }

  function draw() {
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    drawSpace();

    var i;
    for (i = 0; i < rocks.length; i++) drawRock(rocks[i]);
    for (i = 0; i < powerups.length; i++) drawPowerup(powerups[i]);
    for (i = 0; i < enemies.length; i++) drawEnemy(enemies[i]);
    drawBoss();

    /* enemy plasma */
    ctx.save();
    for (i = 0; i < ebullets.length; i++) {
      var eb = ebullets[i];
      ctx.shadowColor = eb.col || '#fb923c';
      ctx.shadowBlur = 10;
      ctx.fillStyle = eb.col || '#fdba74';
      ctx.beginPath();
      ctx.arc(eb.x, eb.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    /* player cannon bolts: pink homing missiles, lime piercing beams, cyan bolts */
    ctx.save();
    ctx.lineCap = 'round';
    for (i = 0; i < bullets.length; i++) {
      var b = bullets[i];
      if (b.homing) {
        ctx.shadowColor = '#f472b6';
        ctx.shadowBlur = 12;
        ctx.strokeStyle = '#fbcfe8';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - 13, b.y - b.vy * 0.014);
        ctx.stroke();
      } else if (b.pierce) {
        ctx.shadowColor = '#a3e635';
        ctx.shadowBlur = 12;
        ctx.strokeStyle = '#ecfccb';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - 24, b.y - b.vy * 0.024);
        ctx.stroke();
      } else {
        ctx.shadowColor = '#a5f3fc';
        ctx.shadowBlur = 10;
        ctx.strokeStyle = '#ecfeff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - 12, b.y - b.vy * 0.012);
        ctx.stroke();
      }
    }
    ctx.restore();

    drawShip();

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

    drawStatus();
    ctx.restore();

    /* re-entry flash after a hit */
    if (invuln > 0 && state === 'running') {
      ctx.save();
      ctx.globalAlpha = Math.min(0.22, invuln / 7000);
      ctx.fillStyle = '#f87171';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    /* screen-bomb whiteout */
    if (bombFlash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.55, bombFlash / 450);
      ctx.fillStyle = '#fed7aa';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    if (state === 'upgrade') drawUpgradePanel();
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    if (!lastT) lastT = t;
    var dt = Math.min(50, t - lastT);
    lastT = t;
    clock += dt;
    if (state === 'running') update(dt);
    else if (state === 'upgrade') updateUpgradeAmbient(dt);
    driftStars(dt, state === 'running' ? scroll : 90);
    draw();
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    var k = e.key;
    if (k === ' ' || k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
    }

    /* upgrade cards: 1 / 2 / 3 (or click) */
    if (state === 'upgrade') {
      if (k === '1' || k === '2' || k === '3') {
        var pick = parseInt(k, 10) - 1;
        if (pick >= 0 && pick < upgradeChoices.length) applyUpgrade(upgradeChoices[pick]);
      }
      return;
    }

    if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = true;
    else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = true;
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = true;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = true;
    else if (k === ' ' || k === 'Enter') {
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
    if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = false;
    else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = false;
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
  });

  window.addEventListener('blur', function () {
    keys.up = keys.down = keys.left = keys.right = false;
  });

  var padBtns = document.querySelectorAll('[data-dir]');
  for (var pb = 0; pb < padBtns.length; pb++) {
    (function (btn) {
      var dir = btn.getAttribute('data-dir');
      btn.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        if (state === 'ready' || state === 'over' || state === 'upgrade') return;
        keys[dir] = true;
      });
      btn.addEventListener('pointerup', function () { keys[dir] = false; });
      btn.addEventListener('pointerleave', function () { keys[dir] = false; });
      btn.addEventListener('pointercancel', function () { keys[dir] = false; });
    })(padBtns[pb]);
  }

  var actionBtns = document.querySelectorAll('[data-action]');
  for (var ab = 0; ab < actionBtns.length; ab++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        if (state === 'running') pause();
        else if (state === 'paused') resume();
      });
    })(actionBtns[ab]);
  }

  /* click a card to claim a boss upgrade */
  canvas.addEventListener('pointerdown', function (ev) {
    if (state === 'upgrade') {
      var rect = canvas.getBoundingClientRect
        ? canvas.getBoundingClientRect()
        : { left: 0, top: 0, width: W, height: H };
      var cx = (ev.clientX - rect.left) * (W / rect.width);
      var cy = (ev.clientY - rect.top) * (H / rect.height);
      upgradeAt(cx, cy);
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      keys.up = keys.down = keys.left = keys.right = false;
      if (state === 'running') pause();
    }
  });

  /* ---------------- boot ---------------- */

  dist = 0;
  bonus = 0;
  lives = 3;
  invuln = 0;
  scroll = BASE_SCROLL;
  shake = 0;
  muzzle = 0;
  clock = 0;
  fireMs = 200;
  rockMs = 700;
  enemyMs = 4200;
  powMs = 7000;
  rapidMs = 0;
  spreadMs = 0;
  shield = false;
  homingMs = 0;
  pierceMs = 0;
  bombFlash = 0;
  upDamage = 0;
  upRate = 0;
  upPierce = 0;
  shieldUp = 0;
  lifeUp = 0;
  powerupSpawns = 0;
  powerupCount = 0;
  boss = null;
  bossNum = 0;
  bossAt = FIRST_BOSS;
  bossesSpawned = 0;
  bossesDefeated = 0;
  upgradeCount = 0;
  bombsUsed = 0;
  upgradeChoices = [];
  upgradeRects = [];
  upgradeSel = 0;
  bullets = [];
  ebullets = [];
  rocks = [];
  enemies = [];
  powerups = [];
  bits = [];
  texts = [];
  paintHud();
  ensureLoop();

  GameShell.overlay.show({
    title: 'Rift Raider',
    msg: 'Fly with the arrow keys or WASD — your cannon fires on its own. Dodge the rocks, blast the raiders and grab every power-up you can.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* ---------------- read-only test hook ---------------- */

  try {
    Object.defineProperty(window, '__riftRaider', {
      value: Object.freeze({
        snapshot: function () {
          var i, ps = [], bs = [];
          for (i = 0; i < powerups.length; i++) {
            ps.push({
              type: powerups[i].type,
              x: Math.round(powerups[i].x),
              y: Math.round(powerups[i].y)
            });
          }
          for (i = 0; i < ebullets.length; i++) {
            bs.push({ x: Math.round(ebullets[i].x), y: Math.round(ebullets[i].y) });
          }
          return {
            state: state,
            score: scoreNow(),
            distance: metres(),
            lives: lives,
            shipX: Math.round(ship.x),
            shipY: Math.round(ship.y),
            boss: boss ? {
              name: boss.name,
              variant: boss.variant,
              hp: Math.max(0, Math.round(boss.hp)),
              maxHp: boss.maxHp,
              x: Math.round(boss.x),
              y: Math.round(boss.y),
              entering: boss.entering,
              cycle: boss.cycle
            } : null,
            bossAt: Math.round(bossAt),
            powerups: ps,
            enemyBullets: bs,
            active: {
              rapidMs: Math.round(rapidMs),
              spreadMs: Math.round(spreadMs),
              homingMs: Math.round(homingMs),
              pierceMs: Math.round(pierceMs),
              shield: shield
            },
            upgrades: {
              damage: upDamage,
              rate: upRate,
              pierce: upPierce,
              shield: shieldUp,
              life: lifeUp
            },
            upgradeChoices: upgradeChoices.slice(),
            counters: {
              powerupSpawns: powerupSpawns,
              powerupPickups: powerupCount,
              bossesSpawned: bossesSpawned,
              bossesDefeated: bossesDefeated,
              upgradeChoicesTaken: upgradeCount,
              bombsUsed: bombsUsed
            }
          };
        }
      }),
      writable: false,
      configurable: false
    });
  } catch (e) { /* snapshot hook unavailable — ignore */ }
})();
