/* ============================================================
   Bullet Ballet — original game for PixelPlay
   Single-arena boss bullet-hell. You move a glowing orb with the
   arrow keys / WASD / d-pad while it auto-fires at a boss in the
   centre. Three boss archetypes cycle with distinct silhouettes,
   colours and patterns, dropping pickups between phases. Clearing
   a boss offers a three-card upgrade choice (1 / 2 / 3 or click).
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 600, H = 600;
  var CX = W / 2, CY = H / 2;
  var BEST_KEY = 'bullet-ballet';

  var PAD = 16;                 /* arena wall padding */
  var PLAYER_R = 9;
  var PLAYER_SPEED = 268;       /* px per second */
  var START_LIVES = 3;          /* one hit = one life unless a shield absorbs it */
  var BASE_HIT_DAMAGE = 14;
  var HIT_DAMAGE_PER_CYCLE = 2;
  var INVULN_MS = 1000;         /* tighter than the old 1300ms window */
  var KNOCKBACK = 195;          /* px per second of push */
  var BASE_FIRE_MS = 170;       /* starting auto-fire interval */
  var SHOT_SPEED = 620;
  var BASE_DMG = 8;
  var SHOT_R = 5;
  var SHOT_SCORE = 10;
  var BOSS_HP_PER_CYCLE = 0.45;
  var BOSS_HP_PER_INDEX = 0.06;
  var BOSS_SPEED_PER_CYCLE = 0.18;

  var MAX_BULLETS = 520;
  var MAX_SPARKS = 200;
  var MAX_STREAMS = 4;
  var MAX_SHIELD = 3;
  var PATTERN_MS = 6200;

  /* ---------------- boss archetypes ---------------- */

  var BOSSES = [
    {
      name: 'Petal Weaver', shape: 'petals',
      col: '#f472b6', glow: '#8b5cf6', dark: '#6d28d9',
      phaseHp: 500, phases: 4, r: 46,
      seq: [0, 2, 1, 2], rageAlt: 4, bSpeed: 1.0, spinRate: 0.65
    },
    {
      name: 'Prism Warden', shape: 'diamond',
      col: '#38bdf8', glow: '#0ea5e9', dark: '#1d4ed8',
      phaseHp: 560, phases: 4, r: 44,
      seq: [3, 1, 2, 4], rageAlt: 0, bSpeed: 1.08, spinRate: 0.82
    },
    {
      name: 'Ember Crown', shape: 'crown',
      col: '#fbbf24', glow: '#f97316', dark: '#b45309',
      phaseHp: 640, phases: 5, r: 50,
      seq: [4, 2, 3, 1, 2], rageAlt: 3, bSpeed: 1.16, spinRate: 0.98
    }
  ];

  /* ---------------- mutable game state ---------------- */

  var state = 'ready';          /* ready | running | paused | choosing | over */
  var best = GameShell.best.get(BEST_KEY, 0);
  var newBest = false;

  var player = {
    x: CX, y: H - 120, lives: START_LIVES, inv: 0, kx: 0, ky: 0, fireT: 0,
    dmg: BASE_DMG, fireMs: BASE_FIRE_MS, streams: 1, shield: 0, slowMs: 0
  };
  var boss = { hp: 0, phaseHp: 0, phase: 1, spin: 0, hurt: 0, rage: false, def: BOSSES[0] };
  var bossIndex = 0, cycle = 0, bossNumber = 1;
  var bullets = [];             /* enemy bullets */
  var shots = [];               /* our auto-fire bullets */
  var sparks = [];              /* cosmetic debris */
  var pickups = [];             /* dropped power-ups */
  var floaters = [];            /* short floating pickup labels */

  var pattern = 0;              /* 0 ring | 1 spiral | 2 aimed | 3 gates | 4 crossfire */
  var patStep = 0;
  var patternT = PATTERN_MS;
  var emitT = 500;
  var spiralA = 0;
  var emitCount = 0;
  var calmMs = 0;               /* breather after a phase is cleared */
  var score = 0;
  var banner = '', bannerSub = '', bannerMs = 0;
  var shake = 0, hudT = 0;

  var pendingChoices = [];

  var keys = { up: false, down: false, left: false, right: false };
  var rafId = 0, lastT = 0;
  var sfxShotMs = 0, sfxHitMs = 0;

  /* ---------------- upgrade pool ---------------- */

  var UPGRADES = [
    {
      id: 'damage', name: 'Focused Beam', icon: '✦', desc: '+3 shot damage',
      apply: function () { player.dmg += 3; }
    },
    {
      id: 'rate', name: 'Quick Trigger', icon: '⚡', desc: '-14% fire interval',
      apply: function () { player.fireMs = Math.max(72, Math.round(player.fireMs * 0.86)); }
    },
    {
      id: 'shot', name: 'Split Shot', icon: '⋔', desc: '+1 auto-fire stream',
      apply: function () { player.streams = Math.min(MAX_STREAMS, player.streams + 1); }
    },
    {
      id: 'shield', name: 'Aegis Shield', icon: '⛨', desc: '+2 shield charges',
      apply: function () { player.shield = Math.min(MAX_SHIELD, player.shield + 2); }
    },
    {
      id: 'heal', name: 'Field Repair', icon: '✚', desc: '+1 life',
      apply: function () { player.lives += 1; }
    }
  ];

  /* ---------------- small helpers ---------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function sfx(name) {
    if (window.PixelPlayAudio) window.PixelPlayAudio.sfx(name);
  }

  function hitDamage() {
    return BASE_HIT_DAMAGE + cycle * HIT_DAMAGE_PER_CYCLE;
  }

  function bossHpScale(index) {
    return (1 + cycle * BOSS_HP_PER_CYCLE) * (1 + index * BOSS_HP_PER_INDEX);
  }

  function shownBest() { return Math.max(best, score); }

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function updateHud() {
    var right;
    if (state === 'paused') right = '⏸ Paused';
    else if (state === 'choosing') right = 'Choose an upgrade';
    else right = 'Boss ' + bossNumber + ' · ' + boss.def.name +
      (cycle > 0 ? ' · Cycle ' + (cycle + 1) : '') +
      (player.slowMs > 0 ? ' · ◷ slow' : '') + (boss.rage ? ' · RAGE' : '');

    GameShell.hud(
      {
        Score: score,
        Best: shownBest(),
        Lives: player.lives,
        Shield: player.shield,
        Threat: '-' + hitDamage()
      },
      right
    );
  }

  function say(msg, sub, ms) {
    banner = msg;
    bannerSub = sub || '';
    bannerMs = ms || 1500;
  }

  function floater(x, y, txt, col) {
    floaters.push({ x: x, y: y, txt: txt, col: col || '#e8eefc', life: 900, max: 900 });
    if (floaters.length > 18) floaters.shift();
  }

  /* ---------------- setup ---------------- */

  function reset() {
    player.x = CX;
    player.y = H - 120;
    player.lives = START_LIVES;
    player.inv = 0;
    player.kx = 0;
    player.ky = 0;
    player.fireT = 0;
    player.dmg = BASE_DMG;
    player.fireMs = BASE_FIRE_MS;
    player.streams = 1;
    player.shield = 0;
    player.slowMs = 0;

    bossIndex = 0;
    cycle = 0;
    bossNumber = 1;
    sfxShotMs = 0;
    sfxHitMs = 0;
    bullets.length = 0;
    shots.length = 0;
    sparks.length = 0;
    pickups.length = 0;
    floaters.length = 0;
    pendingChoices = [];
    patStep = 0;
    emitCount = 0;
    calmMs = 0;
    score = 0;
    banner = '';
    bannerSub = '';
    bannerMs = 0;
    shake = 0;
    hudT = 0;
    newBest = false;
    keys.up = keys.down = keys.left = keys.right = false;
    spawnBoss(0);
  }

  function spawnBoss(idx) {
    var def = BOSSES[idx];
    boss.def = def;
    var scale = bossHpScale(idx);
    boss.phaseHp = Math.round(def.phaseHp * scale);
    boss.hp = boss.phaseHp;
    boss.phase = 1;
    boss.spin = 0;
    boss.hurt = 0;
    boss.rage = false;
    bullets.length = 0;
    shots.length = 0;
    emitCount = 0;
    patStep = 0;
    pattern = def.seq[0];
    setPattern(pattern);
  }

  function setPattern(p) {
    pattern = p;
    patternT = PATTERN_MS;
    emitT = Math.min(emitT, 420);
    if (p === 1 || p === 4) spiralA = Math.random() * Math.PI * 2;
  }

  /* ---------------- bullets ---------------- */

  function addBullet(x, y, ang, speed, r, col) {
    if (bullets.length >= MAX_BULLETS) return;
    bullets.push({
      x: x, y: y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      r: r, c: col
    });
  }

  /* Each pattern returns how long to wait before the next volley. */
  function emitPattern(p, rageMode) {
    var def = boss.def;
    var ph = boss.phase;
    var spdMul = def.bSpeed * (1 + cycle * BOSS_SPEED_PER_CYCLE) * (rageMode ? 1.12 : 1);
    var col = rageMode ? '#fb7185' : def.col;
    var n, i, cd, base, off, sp, arms;

    if (p === 0) {
      /* expanding ring of evenly spaced bullets */
      n = 9 + ph * 3;
      off = Math.random() * Math.PI * 2;
      sp = (145 + ph * 15) * spdMul;
      for (i = 0; i < n; i++) {
        addBullet(CX, CY, off + (i / n) * Math.PI * 2, sp, 6, col);
      }
      cd = Math.max(720, 1480 - ph * 130);

    } else if (p === 1) {
      /* rotating spiral, extra arms as phases climb */
      arms = ph >= 4 ? 3 : (ph >= 2 ? 2 : 1);
      sp = (155 + ph * 14) * spdMul;
      for (i = 0; i < arms; i++) {
        addBullet(CX, CY, spiralA + (i / arms) * Math.PI * 2, sp, 5.5, col);
      }
      spiralA += 0.30 + ph * 0.035;
      cd = Math.max(48, 95 - ph * 8);

    } else if (p === 2) {
      /* aim-assisted spread, tighter than before */
      base = Math.atan2(player.y - CY, player.x - CX);
      n = Math.min(7, 2 + ph);
      sp = (200 + ph * 20) * spdMul;
      for (i = 0; i < n; i++) {
        var t = n === 1 ? 0.5 : i / (n - 1);
        addBullet(CX, CY, base + (t - 0.5) * 0.30, sp, 6, rageMode ? '#fb7185' : def.glow);
      }
      cd = Math.max(650, 1150 - ph * 80);

    } else if (p === 3) {
      /* gate ring — a dense ring with two deliberate safe gaps */
      n = 18 + ph * 3;
      off = Math.random() * Math.PI * 2;
      sp = (120 + ph * 10) * spdMul;
      var gapA = Math.floor(Math.random() * n);
      var gapB = (gapA + Math.floor(n / 2)) % n;
      for (i = 0; i < n; i++) {
        if ((i - gapA + n) % n < 3 || (i - gapB + n) % n < 3) continue;
        addBullet(CX, CY, off + (i / n) * Math.PI * 2, sp, 5.5, col);
      }
      cd = Math.max(880, 1680 - ph * 140);

    } else {
      /* rotating four-spoke crossfire */
      sp = (175 + ph * 16) * spdMul;
      for (i = 0; i < 4; i++) {
        addBullet(CX, CY, spiralA + (i / 4) * Math.PI * 2, sp, 5, col);
      }
      spiralA += 0.19;
      cd = Math.max(105, 165 - ph * 10);
    }

    return cd;
  }

  function spark(x, y, col, n) {
    if (sparks.length > MAX_SPARKS) return;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var s = rnd(40, 190);
      sparks.push({
        x: x, y: y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rnd(240, 520), max: 520, c: col
      });
    }
  }

  function hurtPlayer() {
    if (state !== 'running') return;
    if (player.shield > 0) {
      player.shield--;
      player.inv = Math.round(INVULN_MS * 0.7);
      spark(player.x, player.y, '#38bdf8', 16);
      floater(player.x, player.y - 20, 'SHIELD', '#7dd3fc');
      sfx('select');
      updateHud();
      return;
    }
    /* one clean hit always costs a life — the threat value still scales */
    player.lives -= 1;
    player.inv = INVULN_MS;
    shake = 12;
    spark(player.x, player.y, '#f472b6', 14);
    floater(player.x, player.y - 20, '-1 LIFE', '#fca5a5');
    sfx('thud');
    updateHud();
    if (player.lives <= 0) {
      player.lives = 0;
      gameOver(false);
    }
  }

  function damageBoss(amount) {
    if (state !== 'running') return;
    boss.hp -= amount;
    boss.hurt = 90;
    if (sfxHitMs <= 0) {
      sfx('hit');
      sfxHitMs = 110;
    }
    if (boss.hp > 0) {
      /* rage: below 30% of the phase, patterns mix and shots speed up */
      if (!boss.rage && boss.hp <= boss.phaseHp * 0.3) {
        boss.rage = true;
        emitT = Math.min(emitT, 160);
        shake = Math.max(shake, 10);
        say('RAGE', boss.def.name + ' is cornered', 1200);
        updateHud();
      }
      return;
    }

    if (boss.phase < boss.def.phases) {
      boss.phase++;
      boss.hp = boss.phaseHp;
      boss.rage = false;
      bullets.length = 0;          /* clear the floor for the next phase */
      calmMs = 900;
      score += 250 + boss.phase * 50;
      shake = 16;
      dropPickup();
      say('Phase ' + boss.phase, boss.def.name + ' · ' + boss.phase + ' of ' + boss.def.phases);
      patStep = 0;
      setPattern(boss.def.seq[0]);
      sfx('powerup');
      updateHud();
    } else {
      boss.hp = 0;
      defeatBoss();
    }
  }

  /* ---------------- power-ups & upgrades ---------------- */

  function dropPickup() {
    var types = ['heal', 'shield', 'spread', 'slow', 'power'];
    if (player.lives <= START_LIVES) types.push('heal');
    var type = types[Math.floor(Math.random() * types.length)];
    var a = Math.random() * Math.PI * 2;
    var rad = rnd(110, 205);
    pickups.push({
      x: clamp(CX + Math.cos(a) * rad, PAD + 20, W - PAD - 20),
      y: clamp(CY + Math.sin(a) * rad, PAD + 20, H - PAD - 20),
      type: type, life: 16000, max: 16000, bob: Math.random() * 6
    });
  }

  function collectPickup(p) {
    if (p.type === 'heal') {
      player.lives += 1;
      floater(p.x, p.y, '+1 LIFE', '#6ee7b7');
    } else if (p.type === 'shield') {
      player.shield = Math.min(MAX_SHIELD, player.shield + 1);
      floater(p.x, p.y, '+1 SHIELD', '#7dd3fc');
    } else if (p.type === 'spread') {
      if (player.streams < MAX_STREAMS) {
        player.streams++;
        floater(p.x, p.y, '+1 STREAM', '#f9a8d4');
      } else {
        player.dmg += 1;
        floater(p.x, p.y, '+1 DMG', '#f9a8d4');
      }
    } else if (p.type === 'slow') {
      player.slowMs = 3800;
      floater(p.x, p.y, 'SLOW-MO', '#c4b5fd');
    } else {
      player.dmg += 2;
      floater(p.x, p.y, '+2 DMG', '#fcd34d');
    }
    score += 40;
    spark(p.x, p.y, '#fde68a', 12);
    sfx('coin');
    updateHud();
  }

  function rollChoices() {
    var pool = [], i;
    for (i = 0; i < UPGRADES.length; i++) {
      var u = UPGRADES[i];
      if (u.id === 'shot' && player.streams >= MAX_STREAMS) continue;
      if (u.id === 'shield' && player.shield >= MAX_SHIELD) continue;
      pool.push(u);
    }
    var out = [];
    while (out.length < 3 && pool.length) {
      out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    /* safety net so the panel always offers three distinct cards */
    while (out.length < 3) out.push(UPGRADES[0]);
    return out;
  }

  function defeatBoss() {
    score += 900 + bossNumber * 150;
    bullets.length = 0;
    shots.length = 0;
    dropPickup();
    sfx('explode');
    if (bossNumber >= 5) {
      /* The fifth boss is the last one that rewards an upgrade. */
      pendingChoices = [];
      say('BOSS DOWN', 'No more upgrades after boss 5 — keep fighting!', 2200);
      advanceBoss();
      return;
    }
    pendingChoices = rollChoices();
    state = 'choosing';
    say('BOSS DOWN', 'Choose an upgrade — 1 / 2 / 3 or click', 2000);
    updateHud();
  }

  function advanceBoss() {
    bossIndex++;
    bossNumber++;
    if (bossIndex >= BOSSES.length) {
      bossIndex = 0;
      cycle++;
      score += 1200 + cycle * 400;
      player.lives += 1;
      floater(player.x, player.y - 24, '+1 LIFE', '#6ee7b7');
      say('Full cycle clear', '+1 life · cycle ' + (cycle + 1), 2200);
    }

    spawnBoss(bossIndex);
    state = 'running';
    lastT = 0;
    calmMs = 1500;
    updateHud();
  }

  function applyChoice(i) {
    if (state !== 'choosing') return;
    var chosen = pendingChoices[i];
    if (!chosen) return;
    chosen.apply();
    pendingChoices = [];

    bossIndex++;
    bossNumber++;
    if (bossIndex >= BOSSES.length) {
      bossIndex = 0;
      cycle++;
      score += 1200 + cycle * 400;
      player.lives += 1;
      floater(player.x, player.y - 24, '+1 LIFE', '#6ee7b7');
      say(chosen.name + ' installed', 'Full cycle clear · +1 life · cycle ' + (cycle + 1), 2200);
    } else {
      say(chosen.name + ' installed', 'Next: ' + BOSSES[bossIndex].name, 2200);
    }

    sfx('powerup');
    spawnBoss(bossIndex);
    state = 'running';
    lastT = 0;
    calmMs = 1500;
    updateHud();
  }

  function choiceIndexAt(p) {
    for (var i = 0; i < 3; i++) {
      var x = cardX(i);
      if (p.x >= x && p.x <= x + CARD.w && p.y >= CARD.y && p.y <= CARD.y + CARD.h) return i;
    }
    return -1;
  }

  /* ---------------- state changes ---------------- */

  function start() {
    reset();
    state = 'running';
    lastT = 0;
    GameShell.overlay.hide();
    say(boss.def.name, 'Boss ' + bossNumber + ' · dodge and auto-fire', 1800);
    updateHud();
    ensureLoop();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The ballet is frozen mid-step. Resume when you are ready to dance again.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Lives', value: player.lives },
        { label: 'Boss', value: bossNumber + ' · ' + boss.def.name }
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

  function gameOver(won) {
    if (state === 'over') return;
    state = 'over';
    sfx('lose');

    if (won) {
      var bonus = 2000 + player.lives * 150;
      score += bonus;
      say('Victory!');
    }
    if (score > best) {
      best = score;
      newBest = true;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: won ? (newBest ? 'Boss defeated — new best!' : 'Boss defeated!')
                 : (newBest ? 'New high score!' : 'Out of lives'),
      msg: won
        ? 'You cleared the arena with ' + player.lives + ' lives left. Score: ' + score + '.'
        : 'You lost your last life to the ' + boss.def.name + ' in phase ' + boss.phase +
          ' of boss ' + bossNumber + '. Score: ' + score +
          '. Try again — shields absorb one hit, lives do not come back on their own.',
      stats: [
        { label: 'Lives', value: player.lives },
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Boss reached', value: bossNumber }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  /* ---------------- update ---------------- */

  function fireShots() {
    var a = Math.atan2(CY - player.y, CX - player.x);
    var n = player.streams;
    for (var i = 0; i < n; i++) {
      var off = (i - (n - 1) / 2) * 0.055;
      var ang = a + off;
      shots.push({
        x: player.x + Math.cos(ang) * (PLAYER_R + 4),
        y: player.y + Math.sin(ang) * (PLAYER_R + 4),
        vx: Math.cos(ang) * SHOT_SPEED,
        vy: Math.sin(ang) * SHOT_SPEED,
        r: SHOT_R
      });
    }
    if (sfxShotMs <= 0) {
      sfx('shoot');
      sfxShotMs = 120;
    }
  }

  function update(dt) {
    var s = dt / 1000;

    if (shake > 0) shake = Math.max(0, shake - dt * 0.05);
    if (boss.hurt > 0) boss.hurt -= dt;
    if (bannerMs > 0) bannerMs -= dt;
    if (sfxShotMs > 0) sfxShotMs -= dt;
    if (sfxHitMs > 0) sfxHitMs -= dt;
    if (player.slowMs > 0) player.slowMs = Math.max(0, player.slowMs - dt);
    boss.spin += s * (boss.def.spinRate + boss.phase * 0.16);

    /* keep the DOM HUD cheap even at maximum fire rate */
    hudT -= dt;
    if (hudT <= 0) { hudT = 200; updateHud(); }

    /* ---- player movement ---- */
    var dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    var dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (dx && dy) { var norm = 0.7071; dx *= norm; dy *= norm; }

    player.x += dx * PLAYER_SPEED * s + player.kx * s;
    player.y += dy * PLAYER_SPEED * s + player.ky * s;

    /* knockback bleeds off quickly */
    var decay = Math.exp(-s * 6);
    player.kx *= decay;
    player.ky *= decay;

    var lo = PAD + PLAYER_R, hiX = W - PAD - PLAYER_R, hiY = H - PAD - PLAYER_R;
    if (player.x < lo) { player.x = lo; player.kx = 0; }
    if (player.x > hiX) { player.x = hiX; player.kx = 0; }
    if (player.y < lo) { player.y = lo; player.ky = 0; }
    if (player.y > hiY) { player.y = hiY; player.ky = 0; }

    /* keep the orb out of the boss body */
    var bdx = player.x - CX, bdy = player.y - CY;
    var bd = Math.sqrt(bdx * bdx + bdy * bdy);
    var minD = boss.def.r + PLAYER_R + 8;
    if (bd < minD) {
      var ba = bd > 0.001 ? Math.atan2(bdy, bdx) : Math.random() * Math.PI * 2;
      player.x = CX + Math.cos(ba) * minD;
      player.y = CY + Math.sin(ba) * minD;
    }

    if (player.inv > 0) player.inv -= dt;

    /* ---- auto-fire ---- */
    player.fireT -= dt;
    if (player.fireT <= 0) {
      player.fireT = player.fireMs;
      fireShots();
    }

    /* ---- boss patterns ---- */
    if (calmMs > 0) {
      calmMs -= dt;
    } else {
      patternT -= dt;
      if (patternT <= 0) {
        patStep = (patStep + 1) % boss.def.seq.length;
        setPattern(boss.def.seq[patStep]);
        emitT = Math.min(emitT, 260);
      }
      emitT -= dt;
      if (emitT <= 0) {
        var use = pattern;
        /* rage mixes a second pattern into the beat */
        if (boss.rage && emitCount % 3 === 2) use = boss.def.rageAlt;
        var tempo = Math.max(0.82, 1 - cycle * 0.045);
        emitT = emitPattern(use, boss.rage) * (boss.rage ? 0.72 : 1) * tempo;
        emitCount++;
      }
    }

    /* ---- our shots ---- */
    for (var i = shots.length - 1; i >= 0; i--) {
      var sh = shots[i];
      sh.x += sh.vx * s;
      sh.y += sh.vy * s;
      var bx = sh.x - CX, by = sh.y - CY;
      if (bx * bx + by * by <= (boss.def.r + sh.r) * (boss.def.r + sh.r)) {
        shots.splice(i, 1);
        spark(sh.x, sh.y, '#fde68a', 5);
        score += SHOT_SCORE;
        damageBoss(player.dmg);
        if (state !== 'running') return;
        continue;
      }
      if (sh.x < -20 || sh.x > W + 20 || sh.y < -20 || sh.y > H + 20) shots.splice(i, 1);
    }

    /* ---- enemy bullets (slow-motion pickup halves their speed) ---- */
    var bs = player.slowMs > 0 ? s * 0.55 : s;
    for (var j = bullets.length - 1; j >= 0; j--) {
      var b = bullets[j];
      b.x += b.vx * bs;
      b.y += b.vy * bs;

      if (player.inv <= 0) {
        var px = b.x - player.x, py = b.y - player.y;
        var rr2 = PLAYER_R + b.r;
        if (px * px + py * py <= rr2 * rr2) {
          bullets.splice(j, 1);
          /* knock the player away along the bullet's own path */
          var len = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1;
          player.kx = (b.vx / len) * KNOCKBACK;
          player.ky = (b.vy / len) * KNOCKBACK;
          hurtPlayer();
          if (state !== 'running') return;
          continue;
        }
      }
      if (b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30) bullets.splice(j, 1);
    }

    /* ---- pickups ---- */
    for (var k = pickups.length - 1; k >= 0; k--) {
      var p = pickups[k];
      p.life -= dt;
      if (p.life <= 0) { pickups.splice(k, 1); continue; }
      var pdx = player.x - p.x, pdy = player.y - p.y;
      var pd = Math.sqrt(pdx * pdx + pdy * pdy);
      if (pd < 95 && pd > 0.01) {
        /* gentle magnet so pickups are not fiddly on a phone */
        p.x += (pdx / pd) * 150 * s;
        p.y += (pdy / pd) * 150 * s;
        pdx = player.x - p.x;
        pdy = player.y - p.y;
        pd = Math.sqrt(pdx * pdx + pdy * pdy);
      }
      if (pd <= PLAYER_R + 16) {
        collectPickup(p);
        pickups.splice(k, 1);
      }
    }

    /* ---- sparks ---- */
    for (var m = sparks.length - 1; m >= 0; m--) {
      var sp = sparks[m];
      sp.life -= dt;
      if (sp.life <= 0) { sparks.splice(m, 1); continue; }
      sp.x += sp.vx * s;
      sp.y += sp.vy * s;
      sp.vx *= 0.97;
      sp.vy *= 0.97;
    }

    /* ---- floating labels ---- */
    for (var f = floaters.length - 1; f >= 0; f--) {
      floaters[f].y -= 26 * s;
      floaters[f].life -= dt;
      if (floaters[f].life <= 0) floaters.splice(f, 1);
    }
  }

  /* ---------------- draw ---------------- */

  function drawArena(t) {
    var def = boss.def;
    var g = ctx.createRadialGradient(CX, CY, 40, CX, CY, W * 0.72);
    g.addColorStop(0, '#141031');
    g.addColorStop(0.55, '#0a0e21');
    g.addColorStop(1, '#05070e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* concentric guide rings */
    ctx.strokeStyle = 'rgba(139, 92, 246, .10)';
    ctx.lineWidth = 1;
    for (var r = 90; r < W * 0.72; r += 62) {
      ctx.beginPath();
      ctx.arc(CX, CY, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* slow drifting starfield */
    ctx.fillStyle = 'rgba(232, 238, 252, .16)';
    for (var i = 0; i < 46; i++) {
      var a = i * 2.399963;
      var rad = ((i * 37) % 280) + 30;
      var x = CX + Math.cos(a + t / 9000) * rad;
      var y = CY + Math.sin(a + t / 9000) * rad;
      var sz = (i % 3) * 0.5 + 0.7;
      ctx.fillRect(x, y, sz, sz);
    }

    /* arena frame picks up the current boss colour */
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = def.col;
    ctx.lineWidth = 2;
    ctx.strokeRect(PAD - 4.5, PAD - 4.5, W - (PAD - 4.5) * 2, H - (PAD - 4.5) * 2);
    ctx.restore();
  }

  function drawPetals(def) {
    ctx.strokeStyle = boss.hurt > 0 ? 'rgba(255,255,255,.9)' : def.col;
    ctx.lineWidth = 3;
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 34, Math.sin(a) * 34, 20, 9, a, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawDiamond(def) {
    ctx.strokeStyle = boss.hurt > 0 ? 'rgba(255,255,255,.95)' : def.col;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -54); ctx.lineTo(45, 0); ctx.lineTo(0, 54); ctx.lineTo(-45, 0);
    ctx.closePath();
    ctx.stroke();

    ctx.save();
    ctx.rotate(-boss.spin * 1.9);
    ctx.lineWidth = 2;
    ctx.strokeStyle = boss.hurt > 0 ? 'rgba(255,255,255,.8)' : def.glow;
    ctx.strokeRect(-26, -26, 52, 52);
    ctx.restore();

    ctx.strokeStyle = def.glow;
    ctx.lineWidth = 1.5;
    for (var i = 0; i < 4; i++) {
      var a = boss.spin * 1.4 + (i / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 30, Math.sin(a) * 30);
      ctx.lineTo(Math.cos(a) * 58, Math.sin(a) * 58);
      ctx.stroke();
    }
  }

  function drawCrown(def) {
    ctx.strokeStyle = boss.hurt > 0 ? 'rgba(255,255,255,.95)' : def.col;
    ctx.lineWidth = 3;
    /* six-sided crown with three long spikes */
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * Math.PI * 2;
      var rad = i % 2 === 0 ? 50 : 34;
      var x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = def.glow;
    ctx.lineWidth = 2;
    for (var k = 0; k < 3; k++) {
      var ang = boss.spin + (k / 3) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * 42, Math.sin(ang) * 42);
      ctx.lineTo(Math.cos(ang) * 68, Math.sin(ang) * 68);
      ctx.stroke();
    }
  }

  function drawBoss(t) {
    var def = boss.def;
    var pulse = 1 + Math.sin(t / 260) * 0.03;

    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(boss.spin);
    if (def.shape === 'petals') drawPetals(def);
    else if (def.shape === 'diamond') drawDiamond(def);
    else drawCrown(def);
    ctx.restore();

    ctx.save();
    ctx.translate(CX, CY);
    ctx.shadowColor = boss.hurt > 0 ? '#ffffff' : def.glow;
    ctx.shadowBlur = 30;
    var bg = ctx.createRadialGradient(-12, -14, 4, 0, 0, def.r * pulse);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.4, boss.hurt > 0 ? '#ffffff' : def.col);
    bg.addColorStop(1, def.dark);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(0, 0, def.r * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* rage halo */
    if (boss.rage) {
      ctx.save();
      ctx.strokeStyle = 'rgba(248, 113, 113, ' + (0.45 + Math.sin(t / 110) * 0.2) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(CX, CY, def.r + 14 + Math.sin(t / 150) * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    /* health bar */
    var bw = W - 96, bx = 48, by = 16, bh = 12;
    var frac = clamp(boss.hp / boss.phaseHp, 0, 1);
    ctx.fillStyle = 'rgba(232,238,252,.10)';
    ctx.fillRect(bx, by, bw, bh);
    var hg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    hg.addColorStop(0, boss.rage ? '#f87171' : def.col);
    hg.addColorStop(1, def.glow);
    ctx.fillStyle = hg;
    ctx.fillRect(bx, by, bw * frac, bh);
    ctx.strokeStyle = 'rgba(232,238,252,.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    ctx.save();
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(232,238,252,.72)';
    ctx.fillText(
      def.name.toUpperCase() + ' · PHASE ' + boss.phase + ' OF ' + def.phases +
      (boss.rage ? ' · RAGE' : ''),
      CX, by + bh + 6
    );
    ctx.restore();
  }

  function drawPickups(t) {
    for (var i = 0; i < pickups.length; i++) {
      var p = pickups[i];
      var col, glyph;
      if (p.type === 'heal') { col = '#34d399'; glyph = '✚'; }
      else if (p.type === 'shield') { col = '#38bdf8'; glyph = '⛨'; }
      else if (p.type === 'spread') { col = '#f472b6'; glyph = '⋔'; }
      else if (p.type === 'slow') { col = '#c4b5fd'; glyph = '◷'; }
      else { col = '#fbbf24'; glyph = '✦'; }

      var bob = Math.sin(t / 320 + p.bob) * 3;
      var fade = p.life < 2500 ? (0.35 + 0.65 * Math.abs(Math.sin(t / 120))) : 1;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y + bob);
      ctx.shadowColor = col;
      ctx.shadowBlur = 16;
      ctx.fillStyle = 'rgba(5,7,14,.9)';
      rr(-13, -13, 26, 26, 8);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      rr(-13, -13, 26, 26, 8);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = col;
      ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, 0, 1);
      ctx.restore();
    }
  }

  function drawPlayer(t) {
    if (state === 'over' && player.lives <= 0) return;
    var blink = player.inv > 0 && Math.floor(t / 90) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = blink ? 0.4 : 1;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 30;
    var pg = ctx.createRadialGradient(player.x - 3, player.y - 3, 1, player.x, player.y, PLAYER_R + 3);
    pg.addColorStop(0, '#ffffff');
    pg.addColorStop(0.5, '#67e8f9');
    pg.addColorStop(1, '#0891b2');
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(player.x, player.y, PLAYER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* invulnerability halo */
    if (player.inv > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(103, 232, 249, .5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, PLAYER_R + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    /* shield rings */
    for (var s = 0; s < player.shield; s++) {
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, ' + (0.5 - s * 0.1) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, PLAYER_R + 5 + s * 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    /* life pips along the bottom — no health bar, one hit costs one pip */
    var bx = 48, by = H - 28, i;
    ctx.save();
    ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(232,238,252,.55)';
    ctx.fillText('LIVES', bx, by + 5);
    for (i = 0; i < player.lives; i++) {
      var hx = bx + 48 + i * 15;
      ctx.fillStyle = i < player.lives ? '#22d3ee' : 'rgba(232,238,252,.15)';
      ctx.beginPath();
      ctx.moveTo(hx, by + 9);
      ctx.lineTo(hx - 5, by + 3);
      ctx.lineTo(hx - 2.5, by);
      ctx.lineTo(hx, by + 2);
      ctx.lineTo(hx + 2.5, by);
      ctx.lineTo(hx + 5, by + 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    /* slow-motion timer tick */
    if (player.slowMs > 0) {
      ctx.fillStyle = 'rgba(196, 181, 253, .8)';
      ctx.fillRect(bx, by - 9, (W - 96) * (player.slowMs / 3800), 3);
    }
  }

  function drawShots() {
    ctx.fillStyle = '#fef3c7';
    for (var i = 0; i < shots.length; i++) {
      var s2 = shots[i];
      ctx.beginPath();
      ctx.arc(s2.x, s2.y, s2.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(253, 230, 138, .28)';
    for (var j = 0; j < shots.length; j++) {
      var s3 = shots[j];
      ctx.beginPath();
      ctx.arc(s3.x, s3.y, s3.r * 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBullets() {
    /* two cheap circles per bullet — no per-bullet shadow blur, so dense
       patterns stay 60fps friendly */
    var i, b;
    ctx.fillStyle = 'rgba(244, 114, 182, .16)';
    for (i = 0; i < bullets.length; i++) {
      b = bullets[i];
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = b.c;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (i = 0; i < bullets.length; i++) {
      b = bullets[i];
      ctx.fillStyle = b.c;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.82)';
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSparks() {
    for (var i = 0; i < sparks.length; i++) {
      var s2 = sparks[i];
      ctx.globalAlpha = Math.max(0, s2.life / s2.max);
      ctx.fillStyle = s2.c;
      ctx.fillRect(s2.x - 1.5, s2.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
  }

  function drawFloaters() {
    ctx.save();
    ctx.font = '700 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < floaters.length; i++) {
      var f = floaters[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life / f.max));
      ctx.fillStyle = f.col;
      ctx.fillText(f.txt, f.x, f.y);
    }
    ctx.restore();
  }

  function drawBanner() {
    if (bannerMs <= 0 || !banner) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, bannerMs / 400);
    ctx.font = '700 34px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fde68a';
    ctx.shadowColor = '#f472b6';
    ctx.shadowBlur = 22;
    ctx.fillText(banner, CX, CY - 118);
    if (bannerSub) {
      ctx.shadowBlur = 0;
      ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(232,238,252,.75)';
      ctx.fillText(bannerSub, CX, CY - 86);
    }
    ctx.restore();
  }

  /* ---------------- upgrade choice cards ---------------- */

  var CARD = { w: 164, h: 136, gap: 14, y: 252 };

  function cardX(i) { return (W - (CARD.w * 3 + CARD.gap * 2)) / 2 + i * (CARD.w + CARD.gap); }

  function drawChoices(t) {
    ctx.save();
    ctx.fillStyle = 'rgba(5, 7, 14, .82)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 28px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#fde68a';
    ctx.shadowColor = boss.def.col;
    ctx.shadowBlur = 18;
    ctx.fillText('BOSS DOWN', CX, 176);
    ctx.shadowBlur = 0;
    ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(232,238,252,.82)';
    ctx.fillText('Choose an upgrade — press 1, 2, 3 or click a card', CX, 210);

    for (var i = 0; i < 3; i++) {
      var u = pendingChoices[i];
      if (!u) continue;
      var x = cardX(i);
      var lift = Math.sin(t / 420 + i) * 2;
      ctx.save();
      ctx.translate(0, lift);
      ctx.fillStyle = 'rgba(255,255,255,.055)';
      rr(x, CARD.y, CARD.w, CARD.h, 14);
      ctx.fill();
      ctx.strokeStyle = boss.def.col;
      ctx.lineWidth = 2;
      rr(x, CARD.y, CARD.w, CARD.h, 14);
      ctx.stroke();

      ctx.fillStyle = boss.def.glow;
      ctx.font = '700 26px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(u.icon, x + CARD.w / 2, CARD.y + 34);

      ctx.fillStyle = '#e8eefc';
      ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(u.name, x + CARD.w / 2, CARD.y + 70);

      ctx.fillStyle = 'rgba(232,238,252,.72)';
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(u.desc, x + CARD.w / 2, CARD.y + 94);

      ctx.fillStyle = 'rgba(253, 230, 138, .9)';
      ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('[' + (i + 1) + ']', x + CARD.w / 2, CARD.y + 118);
      ctx.restore();
    }
    ctx.restore();
  }

  function draw(t) {
    ctx.save();
    if (shake > 0.5) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawArena(t);
    drawBoss(t);
    drawPickups(t);
    drawShots();
    drawBullets();
    drawSparks();
    drawPlayer(t);
    drawFloaters();
    drawBanner();
    ctx.restore();

    if (state === 'choosing') drawChoices(t);
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    if (!lastT) lastT = t;
    var dt = t - lastT;
    lastT = t;
    if (dt < 0) dt = 0;
    if (dt > 50) dt = 50;              /* cap so tab jumps never teleport */
    if (state === 'running') update(dt);
    draw(t);
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  function setDir(name, on) {
    if (name === 'up') keys.up = on;
    else if (name === 'down') keys.down = on;
    else if (name === 'left') keys.left = on;
    else if (name === 'right') keys.right = on;
  }

  function steer(name) {
    if (state === 'ready' || state === 'over') start();
    setDir(name, true);
  }

  function toCanvas(e) {
    if (typeof e.clientX !== 'number' || typeof e.clientY !== 'number') {
      return { x: 0, y: 0 };
    }
    var rect = canvas.getBoundingClientRect();
    var sx = rect.width ? W / rect.width : 1;
    var sy = rect.height ? H / rect.height : 1;
    return {
      x: clamp((e.clientX - rect.left) * sx, 0, W),
      y: clamp((e.clientY - rect.top) * sy, 0, H)
    };
  }

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;

    var k = e.key;
    if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' || k === ' ') {
      e.preventDefault();
    }

    if (state === 'choosing') {
      if (k === '1' || k === '2' || k === '3') {
        applyChoice(parseInt(k, 10) - 1);
        return;
      }
      return;
    }

    if (k === 'ArrowUp' || k === 'w' || k === 'W') steer('up');
    else if (k === 'ArrowDown' || k === 's' || k === 'S') steer('down');
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') steer('left');
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') steer('right');
    else if (k === ' ' || k === 'Enter') {
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
    if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = false;
    else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = false;
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
  });

  var padBtns = document.querySelectorAll('[data-dir]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      var dir = btn.getAttribute('data-dir');
      btn.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        if (state === 'ready' || state === 'over') { start(); return; }
        setDir(dir, true);
      });
      btn.addEventListener('pointerup', function () { setDir(dir, false); });
      btn.addEventListener('pointercancel', function () { setDir(dir, false); });
      btn.addEventListener('pointerleave', function () { setDir(dir, false); });
    })(padBtns[b]);
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (state === 'choosing') {
      var idx = choiceIndexAt(toCanvas(e));
      if (idx >= 0) applyChoice(idx);
      return;
    }
    if (state === 'ready' || state === 'over') start();
    else if (state === 'running') pause();
    else if (state === 'paused') resume();
  });

  var actionBtns = document.querySelectorAll('[data-action]');
  for (var c = 0; c < actionBtns.length; c++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-action') !== 'pause') return;
        if (state === 'running') pause();
        else if (state === 'paused') resume();
      });
    })(actionBtns[c]);
  }

  window.addEventListener('blur', function () {
    keys.up = keys.down = keys.left = keys.right = false;
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) return;
    keys.up = keys.down = keys.left = keys.right = false;
    if (state === 'running') pause();
  });

  /* ---------------- read-only test hook ---------------- */

  window.__bulletBallet = {
    state: function () {
      return {
        state: state,
        score: score,
        lives: player.lives,
        maxLives: START_LIVES,
        startingLives: START_LIVES,
        shield: player.shield,
        slowMs: Math.round(player.slowMs),
        boss: bossNumber,
        bossName: boss.def.name,
        bossIndex: bossIndex,
        phase: boss.phase,
        phases: boss.def.phases,
        rage: boss.rage,
        bossHp: boss.hp,
        phaseHp: boss.phaseHp,
        bossMaxHp: boss.phaseHp,
        hitDamage: hitDamage(),
        cycle: cycle,
        cycleHpScale: bossHpScale(bossIndex),
        bullets: bullets.length,
        shots: shots.length,
        pickups: pickups.length,
        x: player.x,
        y: player.y
      };
    },
    wave: function () { return bossNumber; },
    bossHp: function () { return boss.hp; },
    balance: function () {
      return {
        baseHitDamage: BASE_HIT_DAMAGE,
        hitDamagePerCycle: HIT_DAMAGE_PER_CYCLE,
        hitDamage: hitDamage(),
        startLives: START_LIVES,
        maxLives: START_LIVES,
        livesPerHit: 1,
        bossHpPerCycle: BOSS_HP_PER_CYCLE,
        bossHpPerIndex: BOSS_HP_PER_INDEX,
        bossSpeedPerCycle: BOSS_SPEED_PER_CYCLE,
        cycleHpScale: bossHpScale(bossIndex),
        bossMaxHp: boss.phaseHp,
        baseDamage: BASE_DMG,
        damagePerUpgrade: 3,
        baseFireMs: BASE_FIRE_MS,
        phaseHp: [BOSSES[0].phaseHp, BOSSES[1].phaseHp, BOSSES[2].phaseHp],
        phases: [BOSSES[0].phases, BOSSES[1].phases, BOSSES[2].phases]
      };
    },
    powerups: function () {
      var out = [], i;
      for (i = 0; i < pickups.length; i++) {
        out.push({
          type: pickups[i].type,
          x: Math.round(pickups[i].x),
          y: Math.round(pickups[i].y),
          life: Math.round(pickups[i].life)
        });
      }
      return out;
    },
    upgrades: function () {
      return {
        damage: player.dmg,
        fireMs: player.fireMs,
        streams: player.streams,
        shieldMax: MAX_SHIELD,
        shield: player.shield,
        lives: player.lives
      };
    },
    choices: function () {
      var out = [], i;
      for (i = 0; i < pendingChoices.length; i++) out.push(pendingChoices[i].id);
      return out;
    },
    threats: function () {
      var out = [], i;
      for (i = 0; i < bullets.length; i++) {
        out.push({
          x: bullets[i].x, y: bullets[i].y,
          vx: bullets[i].vx, vy: bullets[i].vy,
          r: bullets[i].r
        });
      }
      return out;
    },
    /* deterministic harness helpers — read/write only through the game's own rules */
    debug: {
      hurt: function () {
        if (state !== 'running') return false;
        hurtPlayer();
        return true;
      },
      pickup: function (type) {
        if (state !== 'running') return false;
        collectPickup({ x: player.x, y: player.y, type: type });
        return true;
      },
      upgrade: function (id) {
        for (var i = 0; i < UPGRADES.length; i++) {
          if (UPGRADES[i].id !== id) continue;
          UPGRADES[i].apply();
          updateHud();
          return true;
        }
        return false;
      },
      setLives: function (n) {
        player.lives = Math.max(0, Math.floor(n) || 0);
        if (player.lives <= 0) gameOver(false);
        else updateHud();
        return player.lives;
      }
    }
  };

  /* ---------------- boot ---------------- */

  reset();
  updateHud();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Bullet Ballet',
    msg: 'Move with the arrow keys, WASD or the pad below — your orb fires by itself. You have 3 lives: shields absorb a hit, everything else costs one. Clear bosses to pick upgrades and grab +1 LIFE pickups between phases.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* shared HUD reset button */
  if (typeof GameShell.onReset === 'function') GameShell.onReset(start);
})();
