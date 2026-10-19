/* ============================================================
   Pin Escape — original game for PixelPlay
   Canvas pull-the-pin puzzle: 16 hand-designed levels, physics-
   lite sequencing (falling items, flowing liquids, rolling
   boulders), animated stickman, stars per level.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 600, H = 600;
  var TAU = Math.PI * 2;
  var COLS = 12, ROWS = 12, CELL = 50;
  var BEST_KEY = 'pin-escape';
  var FONT = '"Segoe UI", system-ui, sans-serif';

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

  /* ---------------- levels ----------------
     Grid legend:  # solid   = horizontal pin (blocks falling + walking)
                   | vertical pin (blocks walking)      M man   C chest
                   G gold    L lava    W water    B boulder   S shield
                   D ladder    (space) empty
     Rows are 12 characters; row 0 is the top.                        */

  var LEVELS = [
    { name: 'First Steps', hint: 0, manPin: 1, rolls: {}, grid: [
      '############',
      '#          #',
      '#          #',
      '#     G    #',
      '#     =    #',
      '#          #',
      '#          #',
      '#          #',
      '#          #',
      '#          #',
      '# M  |    C#',
      '############'
    ]},
    { name: 'Mind the Lava', hint: 0, manPin: 2, rolls: {}, grid: [
      '############',
      '#          #',
      '#          #',
      '#     D    #',
      '#     L L  #',
      '#     = =  #',
      '#          #',
      '#          #',
      '#          #',
      '#          #',
      '# M |     C#',
      '##### ######'
    ]},
    { name: 'Shield Sense', hint: 0, manPin: 2, rolls: { '6,4': -1 }, grid: [
      '############',
      '#          #',
      '#          #',
      '#          #',
      '# S   B    #',
      '# =   =    #',
      '#          #',
      '#          #',
      '#          #',
      '#          #',
      '#M |      C#',
      '############'
    ]},
    { name: 'Two Pits', hint: 0, manPin: 3, rolls: {}, grid: [
      '############',
      '#          #',
      '#          #',
      '#    D     #',
      '#    W W D #',
      '#    = = = #',
      '#          #',
      '#          #',
      '#          #',
      '#          #',
      '#M |      C#',
      '#### ### ###'
    ]},
    { name: 'Pebble Dash', hint: 1, manPin: 3, rolls: { '9,4': -1 }, grid: [
      '############',
      '#          #',
      '#          #',
      '#     D    #',
      '#    B S B #',
      '#    = = = #',
      '#          #',
      '#          #',
      '#          #',
      '#          #',
      '#M |      C#',
      '##### ######'
    ]},
    { name: 'Water Crossing', hint: 2, manPin: 3, rolls: { '5,4': -1 }, grid: [
      '############',
      '#          #',
      '#          #',
      '#      D   #',
      '# L  B W   #',
      '# =  = =   #',
      '#          #',
      '#          #',
      '#          #',
      '#          #',
      '#  |M     C#',
      '####### ####'
    ]},
    { name: 'Shield Wall', hint: 0, manPin: 3, rolls: {}, grid: [
      '############',
      '#          #',
      '#          #',
      '#          #',
      '# S  L  D  #',
      '# =  =  =  #',
      '#          #',
      '#          #',
      '#          #',
      '#          #',
      '#M |      C#',
      '######## ###'
    ]},
    { name: 'Double Trouble', hint: 0, manPin: 3, rolls: {}, grid: [
      '############',
      '#          #',
      '#          #',
      '#   D   D  #',
      '#   W L W  #',
      '#   = = =  #',
      '#          #',
      '#          #',
      '#          #',
      '#          #',
      '#M|       C#',
      '#### ### ###'
    ]},
    { name: 'Rockfall Alley', hint: -1, manPin: 3, rolls: {}, grid: [
      '############',
      '#          #',
      '#          #',
      '#          #',
      '# S B B    #',
      '# = = =    #',
      '#          #',
      '#          #',
      '#          #',
      '#          #',
      '# M |     C#',
      '# #### #####'
    ]},
    { name: 'Flood Gates', hint: -1, manPin: 3, rolls: {}, grid: [
      '############',
      '#          #',
      '#          #',
      '#          #',
      '# S  W  D  #',
      '# =  =   = #',
      '#          #',
      '#          #',
      '#          #',
      '#          #',
      '#M |  |   C#',
      '##### ######'
    ]},
    { name: 'Tight Squeeze', hint: -1, manPin: 3, rolls: {}, grid: [
      '############',
      '#          #',
      '#          #',
      '#          #',
      '# S  L  D  #',
      '# =  =  =  #',
      '#          #',
      '#          #',
      '#          #',
      '#          #',
      '#M |   |  C#',
      '######## ###'
    ]},
    { name: 'The Vault', hint: -1, manPin: 4, rolls: {}, grid: [
      '############',
      '#          #',
      '#          #',
      '#          #',
      '# SG  G  L #',
      '# ==  =  = #',
      '#          #',
      '#          #',
      '#          #',
      '#          #',
      '#M  |     C#',
      '############'
    ]},
    { name: 'High Road', hint: -1, manPin: 3, rolls: {}, grid: [
      '############',
      '#          #',
      '#          #',
      '#    D     #',
      '#   W W  D #',
      '#   = =  = #',
      '#          #',
      '#          #',
      '#          #',
      '#          #',
      '#M|       C#',
      '#### #### ##'
    ]},
    { name: 'Boulder Rain', hint: -1, manPin: 4, rolls: { '6,4': -1 }, grid: [
      '############',
      '#          #',
      '#          #',
      '#    D     #',
      '# S B B D  #',
      '# = = = =  #',
      '#          #',
      '#          #',
      '#          #',
      '#          #',
      '#M |      C#',
      '#### ### ###'
    ]},
    { name: 'Deep Waters', hint: -1, manPin: 3, rolls: { '6,4': -1 }, grid: [
      '############',
      '#          #',
      '#          #',
      '#     D    #',
      '# S  WB    #',
      '# =  ==    #',
      '#          #',
      '#          #',
      '#          #',
      '#        L #',
      '#M |    = C#',
      '##### ######'
    ]},
    { name: 'Master Plan', hint: -1, manPin: 4, rolls: {}, grid: [
      '############',
      '#          #',
      '#          #',
      '#    D     #',
      '# S W L D  #',
      '# = = = =  #',
      '#          #',
      '#          #',
      '#          #',
      '#          #',
      '#M |      C#',
      '#### ### ###'
    ]}
  ];

  var NLEV = LEVELS.length;

  /* ---------------- state ---------------- */

  var state = 'ready';           /* ready | running | paused | fail | win | complete */
  var levelIdx = 0;
  var retries = 0;
  var totalStars = 0;
  var levelStars = 0;
  var sel = 0;                   /* selected pin index for keyboard play */

  var solids, pins, items, pools, man, chest;
  var itemFallT = 0, poolT = 0, rollT = 0;
  var animT = 0, hudT = 0;
  var rafId = 0, last = 0;

  /* stars persistence (per level) */
  function lvlKey(n) { return BEST_KEY + '.lvl.' + n; }
  function loadStars(n) { return GameShell.best.get(lvlKey(n), 0); }
  function saveStars(n, v) { GameShell.best.set(lvlKey(n), v); }
  function sumStars() {
    var s = 0;
    for (var i = 0; i < NLEV; i++) s += loadStars(i);
    return s;
  }

  /* ---------------- helpers ---------------- */

  function key(c, r) { return c + ',' + r; }

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function cellCenter(c, r) { return { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 }; }

  function solidAt(c, r) { return solids[key(c, r)] === 1; }

  function pinAtH(c, r) {
    for (var i = 0; i < pins.length; i++) {
      var p = pins[i];
      if (!p.pulled && p.dir === 'h' && p.c === c && p.r === r) return p;
    }
    return null;
  }

  function pinAtAny(c, r) {
    for (var i = 0; i < pins.length; i++) {
      var p = pins[i];
      if (!p.pulled && p.c === c && p.r === r) return p;
    }
    return null;
  }

  function itemAt(c, r) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.dead && it.c === c && it.r === r) return it;
    }
    return null;
  }

  function poolAt(c, r) {
    for (var i = 0; i < pools.length; i++) {
      var pl = pools[i];
      for (var j = 0; j < pl.cells.length; j++) {
        if (pl.cells[j].c === c && pl.cells[j].r === r) return pl;
      }
    }
    return null;
  }

  function removePoolCell(pl, c, r) {
    for (var j = 0; j < pl.cells.length; j++) {
      if (pl.cells[j].c === c && pl.cells[j].r === r) {
        pl.cells.splice(j, 1);
        return;
      }
    }
    if (!pl.cells.length) pools.splice(pools.indexOf(pl), 1);
  }

  /* an item is supported by solid, any unpulled pin, another item or a pool */
  function supported(it) {
    var b = it.r + 1;
    if (b > ROWS - 1) return true;
    if (solidAt(it.c, b)) return true;
    if (pinAtAny(it.c, b)) return true;
    if (itemAt(it.c, b)) return true;
    if (poolAt(it.c, b)) return true;
    return false;
  }

  /* ---------------- level loading ---------------- */

  function loadLevel(n) {
    /* a retry of the SAME level keeps its retry count so that stars stay
       3 / 2 / 1 by retries; moving to a NEW level starts clean. */
    if (n !== levelIdx) retries = 0;
    levelIdx = n;
    var def = LEVELS[n];
    solids = {};
    pins = [];
    items = [];
    pools = [];
    man = null;
    chest = null;

    var boulderOrder = [];
    for (var r = 0; r < ROWS; r++) {
      var row = def.grid[r] || '';
      for (var c = 0; c < COLS; c++) {
        var ch = row.charAt(c);
        if (ch === '#') solids[key(c, r)] = 1;
        else if (ch === '=') pins.push({ c: c, r: r, dir: 'h', pulled: false, slide: 0 });
        else if (ch === '|') pins.push({ c: c, r: r, dir: 'v', pulled: false, slide: 0 });
        else if (ch === 'M') man = { x: c * CELL + CELL / 2, fy: (r + 1) * CELL, dir: 1, free: false, shield: false, wadeT: 0, stuckT: 0, phase: 0, falling: false };
        else if (ch === 'C') chest = { c: c, r: r, x: c * CELL + CELL / 2, y: (r + 1) * CELL, open: 0 };
        else if (ch === 'G') items.push({ type: 'gold', c: c, r: r, dead: false });
        else if (ch === 'L') items.push({ type: 'lava', c: c, r: r, dead: false });
        else if (ch === 'W') items.push({ type: 'water', c: c, r: r, dead: false });
        else if (ch === 'S') items.push({ type: 'shield', c: c, r: r, dead: false });
        else if (ch === 'D') items.push({ type: 'ladder', c: c, r: r, dead: false });
        else if (ch === 'B') { items.push({ type: 'boulder', c: c, r: r, dead: false, rolling: false, rollDir: 0 }); boulderOrder.push(key(c, r)); }
      }
    }
    /* apply boulder roll directions (declared per spawn cell) */
    for (var b = 0; b < boulderOrder.length; b++) {
      var dir = def.rolls[boulderOrder[b]];
      if (dir) {
        for (var i = 0; i < items.length; i++) {
          if (items[i].type === 'boulder' && key(items[i].c, items[i].r) === boulderOrder[b]) {
            items[i].rollDir = dir;
          }
        }
      }
    }
    /* pin list is scanned top-to-bottom, left-to-right (already in that order) */
    sel = 0;
    itemFallT = 0; poolT = 0; rollT = 0;
    if (man) man.free = false;
    levelStars = loadStars(levelIdx);
    updateHud();
  }

  function manSr() { return Math.round(man.fy / CELL); }   /* surface row he is on */

  /* ---------------- pins ---------------- */

  function pullPin(i) {
    if (state !== 'running') return false;
    var p = pins[i];
    if (!p || p.pulled) return false;
    p.pulled = true;
    p.slide = 1;                 /* visual slide-out animation */
    if (i === LEVELS[levelIdx].manPin && man) man.free = true;
    sel = i;
    return true;
  }

  /* ---------------- simulation ---------------- */

  function makePool(it) {
    var pl = { type: it.type, cells: [{ c: it.c, r: it.r }] };
    pools.push(pl);
    it.dead = true;
  }

  function simItems(dt) {
    itemFallT += dt;
    if (itemFallT < 0.055) return;
    itemFallT = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.dead) continue;
      if (!supported(it)) {
        it.r += 1;
        it.rolling = false;
        /* fell out of the world bottom? keep at last row via support rule */
        if (it.r > ROWS - 1) it.r = ROWS - 1;
        if (supported(it)) {
          if (it.type === 'lava' || it.type === 'water') makePool(it);
          else if (it.type === 'boulder' && it.rollDir) { it.rolling = true; }
        }
      }
      /* note: an item that is supported without having fallen (e.g. held by
         a pin or resting from the start) stays an item, never a pool. Only a
         liquid that lands after a fall turns into a pool (branch above). */
    }
  }

  function simPools(dt) {
    poolT += dt;
    if (poolT < 0.17) return;
    poolT = 0;
    for (var i = pools.length - 1; i >= 0; i--) {
      var pl = pools[i];
      if (pl.cells.length >= 8) continue;
      var grow = [];
      for (var j = 0; j < pl.cells.length; j++) {
        var cell = pl.cells[j];
        for (var d = -1; d <= 1; d += 2) {
          var tc = cell.c + d, tr = cell.r;
          if (tc < 0 || tc > COLS - 1) continue;
          if (solidAt(tc, tr) || pinAtAny(tc, tr) || itemAt(tc, tr) || poolAt(tc, tr)) continue;
          var below = tr + 1;
          var supportedBelow = below > ROWS - 1 || solidAt(tc, below) || poolAt(tc, below) || itemAt(tc, below);
          if (supportedBelow) grow.push({ c: tc, r: tr });
          else grow.push({ pour: true, c: tc, r: tr, type: pl.type });
        }
      }
      for (var g = 0; g < grow.length && pl.cells.length < 8; g++) {
        if (grow[g].pour) {
          items.push({ type: grow[g].type, c: grow[g].c, r: grow[g].r, dead: false });
        } else if (!poolAt(grow[g].c, grow[g].r)) {
          pl.cells.push({ c: grow[g].c, r: grow[g].r });
        }
      }
    }
  }

  function simBoulders(dt) {
    rollT += dt;
    if (rollT < 0.13) return;
    rollT = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.dead || it.type !== 'boulder' || !it.rolling) continue;
      var nc = it.c + it.rollDir;
      if (nc < 0 || nc > COLS - 1) { it.rolling = false; continue; }
      if (solidAt(nc, it.r) || pinAtAny(nc, it.r) || itemAt(nc, it.r) || poolAt(nc, it.r)) { it.rolling = false; continue; }
      if (!solidAt(nc, it.r + 1)) { it.rolling = false; continue; }  /* let it fall instead */
      it.c = nc;
    }
  }

  function surfaceAt(c, r) {
    if (c < 0 || c > COLS - 1 || r < 0 || r > ROWS - 1) return false;
    if (solidAt(c, r)) return true;
    if (pinAtH(c, r)) return true;
    var it = itemAt(c, r);
    if (it && it.type === 'ladder') return true;
    return false;
  }

  function failLevel(msg) {
    if (state !== 'running') return;
    state = 'fail';
    retries++;
    updateHud();
    GameShell.overlay.show({
      title: 'Try again',
      msg: msg || 'A hazard reached your stickman. Think about the order of the pins.',
      stats: [
        { label: 'Level', value: (levelIdx + 1) + '/' + NLEV },
        { label: 'Stars left', value: retries <= 2 ? 2 : 1 }
      ],
      btn: '▶ Try again',
      action: function () { loadLevel(levelIdx); state = 'running'; last = now(); GameShell.overlay.hide(); updateHud(); }
    });
  }

  function winLevel() {
    if (state !== 'running') return;
    state = 'win';
    var earned = retries === 0 ? 3 : (retries <= 2 ? 2 : 1);
    levelStars = Math.max(loadStars(levelIdx), earned);
    saveStars(levelIdx, levelStars);
    totalStars = sumStars();
    if (man) man.won = true;
    updateHud();
    var isLast = levelIdx >= NLEV - 1;
    GameShell.overlay.show({
      title: isLast ? 'All ' + NLEV + ' levels cleared!' : 'Level cleared!',
      msg: isLast
        ? 'A perfect escape artist — every pin pulled, every treasure found.'
        : 'Your stickman reached the treasure with ' + earned + ' star' + (earned === 1 ? '' : 's') + '.',
      stats: [
        { label: 'Level', value: (levelIdx + 1) + '/' + NLEV },
        { label: 'Stars', value: earned + (levelStars > earned ? ' (best ' + levelStars + ')' : '') },
        { label: 'Total', value: totalStars + '/' + (NLEV * 3) }
      ],
      btn: isLast ? '▶ Play again' : '▶ Next level',
      action: function () {
        if (isLast) { totalStars = sumStars(); loadLevel(0); }
        else loadLevel(levelIdx + 1);
        state = 'running';
        last = now();
        GameShell.overlay.hide();
        updateHud();
      }
    });
  }

  function updateHud() {
    var starsNow = retries === 0 ? 3 : (retries <= 2 ? 2 : 1);
    GameShell.hud(
      {
        Level: (levelIdx + 1) + '/' + NLEV,
        Best: totalStars,
        Stars: state === 'win' ? levelStars : starsNow
      },
      state === 'paused' ? '⏸ Paused' : 'Pull the pins in the right order'
    );
  }

  function simMan(dt) {
    if (!man || !chest) return;
    if (man.won) {
      chest.open = Math.min(1, chest.open + dt * 3);
      return;
    }
    if (!man.free) return;
    if (man.wadeT > 0) man.wadeT -= dt;

    var sr = manSr();
    var col = Math.floor(man.x / CELL);

    /* hazard checks: pools or hostile items at feet/body level in his column */
    function hazardAt(c) {
      var pl = poolAt(c, sr) || poolAt(c, sr - 1);
      if (pl) return pl.type;
      var it = itemAt(c, sr) || itemAt(c, sr - 1);
      if (it && (it.type === 'lava' || it.type === 'water')) return it.type;
      if (it && it.type === 'boulder') return 'boulder';
      return null;
    }

    var hz = hazardAt(col);
    if (hz) {
      if (man.shield) {
        man.shield = false;
        man.wadeT = 2.8;
        var plHit = poolAt(col, sr) || poolAt(col, sr - 1);
        if (plHit) removePoolCell(plHit, col, poolAt(col, sr) ? sr : sr - 1);
        var itHit = itemAt(col, sr) || itemAt(col, sr - 1);
        if (itHit && itHit.type === 'boulder') { itHit.dead = true; itHit.rolling = false; }
        else if (itHit && (itHit.type === 'lava' || itHit.type === 'water')) itHit.dead = true;
      } else if (man.wadeT <= 0) {
        failLevel(hz === 'boulder'
          ? 'A rolling boulder knocked your stickman over. Grab the shield next time.'
          : 'Ouch — your stickman touched the ' + hz + '. Order matters!');
        return;
      }    }
    /* wading: harmless, but clears the liquid cells he walks through */
    if (man.wadeT > 0) {
      var plW = poolAt(col, sr) || poolAt(col, sr - 1);
      if (plW) removePoolCell(plW, col, poolAt(col, sr) ? sr : sr - 1);
    }

    /* collectibles at body level */
    var pick = itemAt(col, sr) || itemAt(col, sr - 1);
    if (pick && !pick.dead) {
      if (pick.type === 'gold') { pick.dead = true; }
      else if (pick.type === 'shield') { pick.dead = true; man.shield = true; }
    }

    /* win check */
    if (Math.abs(man.x - chest.x) < 24) { winLevel(); return; }

    /* walking — sr is the row of the surface he stands on; his body
       occupies rows sr-1 (and sr-2 for the head). */
    var dir = chest.x > man.x ? 1 : -1;
    man.dir = dir;
    var speed = 70;
    var stepX = man.x + dir * speed * dt;
    var ac = Math.floor((stepX + dir * 16) / CELL);

    function hard(c, row) {
      if (c < 0 || c > COLS - 1) return true;
      if (row < 0) return true;
      if (row > ROWS - 1) return false;
      if (solidAt(c, row)) return true;
      if (pinAtAny(c, row)) return true;
      return false;
    }

    var moved = false;
    if (hard(ac, sr - 1) || hard(ac, sr - 2)) {
      /* step up onto a one-cell block? */
      if (solidAt(ac, sr - 1) && !hard(ac, sr - 2) && !hard(ac, sr - 3) &&
          !poolAt(ac, sr - 2) && !itemAt(ac, sr - 2)) {
        man.fy -= CELL;
        man.x = stepX;
        moved = true;
      }
      /* otherwise boxed in by a wall, door or gate — wait */
    } else if (!surfaceAt(ac, sr)) {
      /* gap ahead — a ladder bridges it at foot level, one above or one below */
      var ladHere = itemAt(ac, sr);
      var ladUp = itemAt(ac, sr - 1);
      var ladDown = itemAt(ac, sr + 1);
      if (ladHere && ladHere.type === 'ladder') {
        man.x = stepX;
        moved = true;
      } else if (ladUp && ladUp.type === 'ladder' && !hard(ac, sr - 2) && !hard(ac, sr - 3)) {
        man.fy -= CELL;
        man.x = stepX;
        moved = true;
      } else if (ladDown && ladDown.type === 'ladder' && !poolAt(ac, sr) && !hard(ac, sr - 1)) {
        man.fy += CELL;
        man.x = stepX;
        moved = true;
      } else if (surfaceAt(ac, sr + 1) && !poolAt(ac, sr) && !itemAt(ac, sr)) {
        /* gentle step down one cell */
        man.fy += CELL;
        man.x = stepX;
        moved = true;
      } else if (surfaceAt(ac + dir, sr) && !surfaceAt(ac, sr + 1) &&
                 !hard(ac + dir, sr - 1) && !hard(ac + dir, sr - 2)) {
        /* one-cell void (a pit in the bottom floor): carefully hop over it.
           The hazard check above still applies, so a pit filled with lava
           or water is deadly — only an empty pit can be crossed. */
        man.x = stepX;
        moved = true;
      } else {
        /* stop at the edge */
        man.x = stepX - dir * speed * dt;
      }
    } else {
      /* pool on the walkway ahead? (already handled by hazard check on entry) */
      man.x = stepX;
      moved = true;
    }

    if (moved) man.phase += dt * 9;
    else man.stuckT += dt;

    /* stuck guard: every pin pulled and the man can make no progress */
    var allPulled = true;
    for (var i = 0; i < pins.length; i++) if (!pins[i].pulled) { allPulled = false; break; }
    if (!moved && allPulled) {
      if (man.stuckT > 3) { failLevel('Your stickman got stuck with no pins left. Try a different order.'); }
    } else if (moved) {
      man.stuckT = 0;
    }

    /* fell off the world */
    if (man.fy > H + 60) failLevel('Your stickman fell into the depths.');
  }

  function update(dt) {
    animT += dt;
    hudT += dt;
    if (hudT > 0.3) { hudT = 0; if (state === 'running') updateHud(); }
    var i;
    for (i = 0; i < pins.length; i++) {
      if (pins[i].slide > 0) pins[i].slide = Math.max(0, pins[i].slide - dt * 3);
    }
    simItems(dt);
    simPools(dt);
    simBoulders(dt);
    simMan(dt);
  }

  /* ---------------- drawing ---------------- */

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawSolids() {
    var c, r;
    ctx.fillStyle = '#131b30';
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        if (solidAt(c, r)) ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
      }
    }
    ctx.strokeStyle = 'rgba(124,92,255,.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        if (!solidAt(c, r)) continue;
        var x = c * CELL, y = r * CELL;
        if (!solidAt(c, r - 1)) { ctx.moveTo(x, y); ctx.lineTo(x + CELL, y); }
        if (!solidAt(c, r + 1)) { ctx.moveTo(x, y + CELL); ctx.lineTo(x + CELL, y + CELL); }
        if (!solidAt(c - 1, r)) { ctx.moveTo(x, y); ctx.lineTo(x, y + CELL); }
        if (!solidAt(c + 1, r)) { ctx.moveTo(x + CELL, y); ctx.lineTo(x + CELL, y + CELL); }
      }
    }
    ctx.stroke();
  }

  function drawPins() {
    for (var i = 0; i < pins.length; i++) {
      var p = pins[i];
      if (p.pulled && p.slide <= 0) continue;
      var x = p.c * CELL, y = p.r * CELL;
      var off = (1 - p.slide) * 62;
      ctx.save();
      if (p.pulled) ctx.globalAlpha = p.slide;
      var barGrad = ctx.createLinearGradient(x, y, x, y + CELL);
      barGrad.addColorStop(0, '#dbe4f0');
      barGrad.addColorStop(0.5, '#8ea0bd');
      barGrad.addColorStop(1, '#dbe4f0');
      ctx.strokeStyle = barGrad;
      ctx.fillStyle = '#9fb0c8';
      if (p.dir === 'h') {
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x + 3, y + CELL / 2);
        ctx.lineTo(x + CELL - 3 + off, y + CELL / 2);
        ctx.stroke();
        /* ring handle */
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x + CELL + 8 + off, y + CELL / 2, 8, 0, TAU);
        ctx.stroke();
      } else {
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x + CELL / 2, y + CELL - 3);
        ctx.lineTo(x + CELL / 2, y + 3 - off);
        ctx.stroke();
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x + CELL / 2, y - 8 - off, 8, 0, TAU);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';

      /* selected ring (keyboard play) */
      if (!p.pulled && i === sel) {
        ctx.strokeStyle = 'rgba(34,211,238,.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.dir === 'h' ? x + CELL + 8 : x + CELL / 2,
                p.dir === 'h' ? y + CELL / 2 : y - 8, 13, 0, TAU);
        ctx.stroke();
      }
      /* pulsing hint on early levels */
      var def = LEVELS[levelIdx];
      if (!p.pulled && def.hint === i) {
        var pulse = 0.5 + 0.5 * Math.sin(animT * 5);
        ctx.strokeStyle = 'rgba(46,230,166,' + (0.25 + 0.55 * pulse) + ')';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.dir === 'h' ? x + CELL + 8 : x + CELL / 2,
                p.dir === 'h' ? y + CELL / 2 : y - 8, 14 + pulse * 4, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawLiquid(cell, type, alpha) {
    var x = cell.c * CELL, y = cell.r * CELL;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.fillStyle = type === 'lava' ? '#f97316' : '#0ea5e9';
    ctx.shadowColor = type === 'lava' ? '#f97316' : '#38bdf8';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + CELL - 2);
    ctx.lineTo(x + 2, y + 16 + Math.sin(animT * 4 + cell.c) * 2);
    for (var i = 0; i <= CELL - 4; i += 8) {
      ctx.lineTo(x + 2 + i, y + 14 + Math.sin(animT * 5 + cell.c + i * 0.2) * 3);
    }
    ctx.lineTo(x + CELL - 2, y + CELL - 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawItems() {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.dead) continue;
      var cx = it.c * CELL + CELL / 2;
      var cy = it.r * CELL + CELL / 2;
      if (it.type === 'gold') {
        ctx.fillStyle = '#facc15';
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 8;
        for (var g = 0; g < 3; g++) {
          ctx.beginPath();
          ctx.ellipse(cx - 10 + g * 10, cy + 6, 6, 4, 0, 0, TAU);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      } else if (it.type === 'lava' || it.type === 'water') {
        drawLiquid({ c: it.c, r: it.r }, it.type, 0.92);
      } else if (it.type === 'boulder') {
        ctx.fillStyle = '#64748b';
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 18, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.25)';
        ctx.beginPath();
        ctx.arc(cx - 5, cy - 6, 4, 0, TAU);
        ctx.fill();
      } else if (it.type === 'shield') {
        ctx.strokeStyle = '#22d3ee';
        ctx.fillStyle = 'rgba(34,211,238,.25)';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(cx, cy + 4, 13, Math.PI, TAU);
        ctx.lineTo(cx + 13, cy + 8);
        ctx.lineTo(cx - 13, cy + 8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (it.type === 'ladder') {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 8, cy - 18); ctx.lineTo(cx - 8, cy + 18);
        ctx.moveTo(cx + 8, cy - 18); ctx.lineTo(cx + 8, cy + 18);
        for (var r2 = -12; r2 <= 12; r2 += 8) {
          ctx.moveTo(cx - 8, cy + r2); ctx.lineTo(cx + 8, cy + r2);
        }
        ctx.stroke();
      }
    }
  }

  function drawPools() {
    for (var i = 0; i < pools.length; i++) {
      var pl = pools[i];
      for (var j = 0; j < pl.cells.length; j++) {
        drawLiquid(pl.cells[j], pl.type, 1);
      }
    }
  }

  function drawChest() {
    if (!chest) return;
    var x = chest.x, y = chest.y;
    ctx.save();
    ctx.translate(x, y);
    /* body */
    ctx.fillStyle = '#7c4a1e';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2.5;
    rr(-18, -22, 36, 22, 4);
    ctx.fill();
    ctx.stroke();
    /* lid */
    ctx.save();
    ctx.translate(0, -22);
    ctx.rotate(-chest.open * 1.6);
    ctx.fillStyle = '#8b5a28';
    rr(-18, -12, 36, 12, 4);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    /* shine */
    ctx.fillStyle = '#facc15';
    ctx.fillRect(-3, -16, 6, 10);
    if (chest.open > 0.2) {
      ctx.globalAlpha = chest.open;
      ctx.fillStyle = '#fde68a';
      ctx.beginPath();
      ctx.moveTo(-10, -34); ctx.lineTo(0, -44); ctx.lineTo(10, -34);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawMan() {
    if (!man) return;
    var x = man.x;
    var fy = man.fy;                       /* feet y (top of the surface row) */
    var hipY = fy - 26;
    var walk = man.free && !man.won;
    var ph = walk ? Math.sin(man.phase) : Math.sin(animT * 2) * 0.2;
    var lean = walk ? man.dir * 2 : 0;

    ctx.save();
    ctx.translate(x, 0);
    ctx.strokeStyle = '#e8eefc';
    ctx.fillStyle = '#e8eefc';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    /* shield bubble */
    if (man.shield) {
      ctx.strokeStyle = 'rgba(34,211,238,.9)';
      ctx.fillStyle = 'rgba(34,211,238,.12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(lean, hipY - 16, 30 + Math.sin(animT * 4) * 1.5, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#e8eefc';
    }

    /* legs */
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(-8 + ph * 8, hipY + 24);
    ctx.moveTo(0, hipY);
    ctx.lineTo(8 - ph * 8, hipY + 24);
    ctx.stroke();
    /* torso */
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(lean, hipY - 22);
    ctx.stroke();
    /* arms */
    ctx.beginPath();
    ctx.moveTo(lean, hipY - 18);
    ctx.lineTo(lean - 10 - ph * 6, hipY - 6);
    ctx.moveTo(lean, hipY - 18);
    ctx.lineTo(lean + 10 + ph * 6, hipY - 6);
    ctx.stroke();
    /* head */
    ctx.beginPath();
    ctx.arc(lean, hipY - 30, 8, 0, TAU);
    ctx.stroke();
    /* face dot toward direction */
    ctx.fillStyle = '#e8eefc';
    ctx.beginPath();
    ctx.arc(lean + man.dir * 3, hipY - 31, 1.6, 0, TAU);
    ctx.fill();
    ctx.lineCap = 'butt';
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#070b16');
    g.addColorStop(1, '#0d1526');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* soft glow top */
    var rg = ctx.createRadialGradient(W / 2, 40, 10, W / 2, 40, W * 0.7);
    rg.addColorStop(0, 'rgba(124,92,255,.10)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);

    /* level name */
    ctx.fillStyle = 'rgba(148,163,184,.8)';
    ctx.font = 'bold 13px ' + FONT;
    ctx.textAlign = 'left';
    ctx.fillText('Level ' + (levelIdx + 1) + ' — ' + LEVELS[levelIdx].name, 12, 20);

    if (!solids) return;
    drawSolids();
    drawPools();
    drawItems();
    drawPins();
    drawChest();
    drawMan();

    if (state === 'paused') {
      ctx.fillStyle = 'rgba(232,238,252,.75)';
      ctx.font = 'bold 24px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, 40);
    }
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    var dt = last ? (t - last) / 1000 : 0;
    last = t;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    if (state === 'running') {
      try { update(dt); } catch (e) { /* never break the loop */ }
    } else {
      animT += dt;
      for (var i = 0; i < pins.length; i++) {
        if (pins[i].slide > 0) pins[i].slide = Math.max(0, pins[i].slide - dt * 3);
      }
    }
    try { draw(); } catch (e) { /* never break the loop */ }
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- states ---------------- */

  function start() {
    totalStars = sumStars();
    loadLevel(0);
    state = 'running';
    last = now();
    GameShell.overlay.hide();
    updateHud();
    ensureLoop();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The pins will wait. Plan your order.',
      stats: [
        { label: 'Level', value: (levelIdx + 1) + '/' + NLEV },
        { label: 'Total stars', value: totalStars }
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

  /* ---------------- input ---------------- */

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var k = e.key;

    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === ' ') e.preventDefault();

    if (k === ' ') {
      if (state === 'ready' || state === 'win' || state === 'complete' || state === 'fail') {
        var ovBtn = document.getElementById('overlayBtn');
        if (state !== 'ready' && ovBtn && ovBtn.onclick) { ovBtn.onclick(); return; }
        if (state === 'ready') { start(); return; }
      } else if (state === 'paused') { resume(); return; }
      else if (state === 'running') pullPin(sel);
      return;
    }
    if (k === 'Enter') {
      if (state === 'ready') start();
      else if (state === 'running') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (k === 'p' || k === 'P' || k === 'Escape') {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (k === 'r' || k === 'R') {
      if (state !== 'ready') {
        if (state === 'running') retries++;   /* manual restart counts as a retry */
        loadLevel(levelIdx);
        state = 'running';
        last = now();
        GameShell.overlay.hide();
        updateHud();
      }
      return;
    }
    if (state !== 'running') return;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
      for (var i = 1; i <= pins.length; i++) {
        var idx = (sel - i + pins.length * 2) % pins.length;
        if (!pins[idx].pulled) { sel = idx; break; }
      }
    } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
      for (var j = 1; j <= pins.length; j++) {
        var idx2 = (sel + j) % pins.length;
        if (!pins[idx2].pulled) { sel = idx2; break; }
      }
    } else if (k >= '1' && k <= '9') {
      pullPin(parseInt(k, 10) - 1);
    }
  });

  canvas.addEventListener('pointerdown', function (ev) {
    if (state !== 'running') return;
    var rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    var mx = (ev.clientX - rect.left) * (W / rect.width);
    var my = (ev.clientY - rect.top) * (H / rect.height);
    /* nearest unpulled pin handle */
    var bestI = -1, bestD = 30 * 30;
    for (var i = 0; i < pins.length; i++) {
      var p = pins[i];
      if (p.pulled) continue;
      var hx = p.dir === 'h' ? p.c * CELL + CELL + 8 : p.c * CELL + CELL / 2;
      var hy = p.dir === 'h' ? p.r * CELL + CELL / 2 : p.r * CELL - 8;
      var dx = mx - hx, dy = my - hy;
      var d2 = dx * dx + dy * dy;
      /* also allow tapping anywhere on the bar */
      if (d2 > bestD) {
        var bx = p.c * CELL, by = p.r * CELL;
        if (mx > bx - 8 && mx < bx + CELL + 24 && my > by - 24 && my < by + CELL + 24) d2 = 0;
      }
      if (d2 < bestD) { bestD = d2; bestI = i; }
    }
    if (bestI >= 0) pullPin(bestI);
  });

  var padBtns = document.querySelectorAll('[data-act]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      var act = btn.getAttribute('data-act');
      btn.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        if (state === 'ready') { start(); return; }
        if (state === 'paused') { resume(); return; }
        if (state !== 'running') return;
        if (act === 'pull') pullPin(sel);
        else if (act === 'prev' || act === 'next') {
          var delta = act === 'next' ? 1 : -1;
          for (var i = 1; i <= pins.length; i++) {
            var idx = (sel + delta * i + pins.length * 2) % pins.length;
            if (!pins[idx].pulled) { sel = idx; break; }
          }
        }
      });
    })(padBtns[b]);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- boot ---------------- */

  totalStars = sumStars();
  loadLevel(0);
  state = 'ready';
  updateHud();
  ensureLoop();

  /* read-only test/debug hook */
  window.__pin_escape = {
    getState: function () { return state; },
    getLevel: function () { return levelIdx; },
    getRetries: function () { return retries; },
    pull: function (i) { return pullPin(i); },
    pinCount: function () { return pins.length; },
    pinsInfo: function () {
      return pins.map(function (p) { return { c: p.c, r: p.r, dir: p.dir, pulled: p.pulled }; });
    },
    manInfo: function () {
      return man ? { x: man.x, fy: man.fy, free: man.free, shield: man.shield, dir: man.dir } : null;
    },
    worldInfo: function () {
      var s = [], i, p, q, it, pl;
      for (i = 0; i < pins.length; i++) s.push('pin' + i + (pins[i].pulled ? '+' : '-'));
      for (i = 0; i < items.length; i++) {
        it = items[i];
        if (!it.dead) s.push(it.type + ':' + it.c + ',' + it.r);
      }
      for (p = 0; p < pools.length; p++) {
        pl = pools[p];
        for (q = 0; q < pl.cells.length; q++) s.push('pool' + pl.type + ':' + pl.cells[q].c + ',' + pl.cells[q].r);
      }
      if (man) s.push('man:' + Math.round(man.x) + ',' + Math.round(man.fy) + ',' + (man.free ? 1 : 0));
      if (chest) s.push('chest:' + (chest.open >= 1 ? 1 : 0));
      return s.join('|');
    },
    start: start
  };

  GameShell.overlay.show({
    title: 'Pin Escape',
    msg: 'Pull the pins in the right order so your stickman reaches the treasure. Gold is safe, lava, water and boulders are not.',
    stats: [{ label: 'Best', value: totalStars + '/' + (NLEV * 3) }],
    btn: '▶ Play',
    action: start
  });
})();
