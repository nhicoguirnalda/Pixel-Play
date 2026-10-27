/* ============================================================
   Word Link — original game for PixelPlay
   Canvas word puzzle: build every target word from a letter ring.
   Keyboard, pointer and on-screen touch buttons.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 600, H = 600;
  var TAU = Math.PI * 2;
  var BEST_KEY = 'word-link';

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

  /* ---------------- level data ----------------
     Each level is a ring of letters plus every word (3+ letters) that can
     be spelled from them. The word list is stored explicitly so the design
     of each board stays fully under control. */

  var LEVELS = [
    { letters: 'cats',  words: ['cat', 'cats', 'act', 'acts', 'sat'] },
    { letters: 'dogs',  words: ['dog', 'dogs', 'god', 'gods'] },
    { letters: 'pans',  words: ['pan', 'pans', 'nap', 'naps', 'sap', 'span'] },
    { letters: 'seat',  words: ['seat', 'east', 'eats', 'teas', 'set', 'sea', 'ate', 'tea'] },
    { letters: 'stars', words: ['star', 'stars', 'art', 'arts', 'rat', 'rats', 'tar', 'tars', 'sat'] },
    { letters: 'birds', words: ['bird', 'birds', 'rib', 'ribs'] },
    { letters: 'lights',words: ['light', 'lights', 'hit', 'hits', 'gilt'] },
    { letters: 'flakes',words: ['flake', 'flakes', 'fake', 'fakes', 'lake', 'lakes', 'flea', 'fleas'] },
    { letters: 'stones',words: ['stone', 'stones', 'note', 'notes', 'tone', 'tones', 'nest', 'nets'] },
    { letters: 'chains',words: ['chain', 'chains', 'chin', 'chins', 'china'] },
    { letters: 'planes',words: ['plane', 'planes', 'plan', 'plans', 'lean', 'lane'] },
    { letters: 'frogs', words: ['frog', 'frogs', 'fog', 'fogs'] },
    { letters: 'moons', words: ['moon', 'moons', 'soon', 'son'] },
    { letters: 'beach', words: ['beach', 'each', 'ache'] },
    { letters: 'swings',words: ['swing', 'swings', 'wig', 'wigs', 'win', 'wins', 'sing', 'sin'] },
    { letters: 'trees', words: ['trees', 'tree', 'tee', 'tees', 'rest', 'set'] },
    { letters: 'clouds',words: ['cloud', 'clouds', 'cold', 'loud', 'could'] },
    { letters: 'fires', words: ['fires', 'fire', 'fir', 'ire', 'rise', 'sir'] },
    { letters: 'stared',words: ['stared', 'stare', 'read', 'reads', 'dare', 'dares', 'dears'] },
    { letters: 'plays', words: ['play', 'plays', 'lay', 'lays', 'slap'] },
    { letters: 'steam', words: ['steam', 'teams', 'meats', 'mate', 'mates', 'tame', 'tames', 'teas'] },
    { letters: 'about', words: ['about', 'boat', 'bout', 'bat', 'tab'] },
    { letters: 'house', words: ['house', 'hose', 'hoes', 'sue', 'use'] },
    { letters: 'cakes', words: ['cake', 'cakes', 'ace', 'aces', 'cask'] },
    { letters: 'garden',words: ['garden', 'danger', 'range', 'gear', 'near', 'earn'] },
    { letters: 'shared',words: ['shared', 'share', 'head', 'heads', 'hear', 'hears', 'read', 'reads', 'dare', 'dares'] },
    { letters: 'candle',words: ['candle', 'land', 'clean', 'deal', 'lane', 'lean', 'lace', 'dale'] },
    { letters: 'space', words: ['space', 'pace', 'paces', 'cape', 'capes', 'ace', 'aces'] },
    { letters: 'plants',words: ['plants', 'plant', 'pants', 'plans', 'snap', 'slap', 'ant', 'ants'] },
    { letters: 'tigers',words: ['tiger', 'tigers', 'grit', 'stir'] },
    { letters: 'waters',words: ['waters', 'water', 'swear', 'wears', 'wart', 'warts', 'star'] },
    { letters: 'bright',words: ['bright', 'bight', 'grit'] },
    { letters: 'storms',words: ['storms', 'storm', 'sort', 'sorts', 'rots'] },
    { letters: 'crowns',words: ['crowns', 'crown', 'rows', 'worn'] },
    { letters: 'points',words: ['points', 'point', 'pint', 'pints', 'pin', 'pins', 'spin'] },
    { letters: 'friend',words: ['friend', 'finder', 'fired', 'find'] },
    { letters: 'stormy',words: ['stormy', 'storm', 'sort'] },
    { letters: 'oceans',words: ['oceans', 'ocean', 'canoe', 'canoes', 'cone', 'cones'] },
    { letters: 'breaks',words: ['breaks', 'break', 'baker', 'bakers', 'brake', 'brakes'] },
    { letters: 'silver',words: ['silver', 'livers', 'sliver'] }
  ];

  var PALETTE = ['#7c5cff', '#22d3ee', '#2ee6a6', '#f59e0b', '#ff5c7a'];

  var state = 'ready';            /* ready | running | paused | clearing | over */
  var levelIndex = 0, score = 0;
  var best = GameShell.best.get(BEST_KEY, 1);   /* highest level reached */
  if (best < 1) best = 1;

  var letters = [], slots = [], sel = [];
  var particles = [], confetti = [];
  var toast = '', toastCol = '#22d3ee', toastT = 0;
  var shakeT = 0, clearT = 0, ringPulse = 0;
  var rafId = 0, last = 0;

  var RING_CX = 300, RING_CY = 452;
  var TILE_R = 30;

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

  function wordPoints(n) {
    if (n <= 3) return 30;
    if (n === 4) return 60;
    if (n === 5) return 100;
    return 160;
  }

  function burst(x, y, col, n, spread) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var s = (spread || 60) + Math.random() * (spread || 60) * 2.6;
      var life = 0.35 + Math.random() * 0.5;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life, life0: life,
        size: 1.6 + Math.random() * 2.6,
        col: col
      });
    }
    if (particles.length > 300) particles.splice(0, particles.length - 300);
  }

  function confettiBurst() {
    confetti = [];
    for (var i = 0; i < 120; i++) {
      confetti.push({
        x: Math.random() * W,
        y: -20 - Math.random() * 160,
        vy: 130 + Math.random() * 180,
        vx: (Math.random() - 0.5) * 60,
        w: 4 + Math.random() * 6,
        h: 6 + Math.random() * 8,
        rot: Math.random() * TAU,
        vr: (Math.random() - 0.5) * 9,
        col: PALETTE[i % PALETTE.length]
      });
    }
  }

  function say(msg, col) {
    toast = msg;
    toastCol = col || '#22d3ee';
    toastT = 1.4;
  }

  function slotsLeft() {
    var n = 0;
    for (var i = 0; i < slots.length; i++) if (!slots[i].found) n++;
    return n;
  }

  function updateHud() {
    GameShell.hud(
      {
        Score: score,
        Best: 'Lv ' + best,
        Level: (levelIndex + 1) + '/' + LEVELS.length,
        Left: slotsLeft()
      },
      state === 'paused' ? '⏸ Paused · press P to resume'
                         : 'Tap letters to build words'
    );
  }

  /* ---------------- level setup ---------------- */

  function ringRadius(n) {
    return 96 + n * 15;
  }

  function layoutRing() {
    var n = letters.length;
    var r = ringRadius(n);
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + (i / n) * TAU;
      letters[i].x = RING_CX + Math.cos(a) * r;
      letters[i].y = RING_CY + Math.sin(a) * r;
    }
  }

  function loadLevel(idx) {
    var data = LEVELS[idx];
    var chars = data.letters.split('');
    letters = [];
    /* shuffle a copy of the letters so the ring is not the answer order */
    var pool = chars.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    for (i = 0; i < pool.length; i++) {
      letters.push({ ch: pool[i], x: 0, y: 0, pop: 0, hue: PALETTE[i % PALETTE.length] });
    }
    layoutRing();

    slots = [];
    var sorted = data.words.slice().sort(function (a, b) {
      return a.length - b.length || (a < b ? -1 : 1);
    });
    for (i = 0; i < sorted.length; i++) {
      slots.push({ word: sorted[i], found: false, reveal: [] });
    }
    sel = [];
    ringPulse = 0;
  }

  function reset() {
    score = 0;
    levelIndex = 0;
    particles = [];
    confetti = [];
    toast = ''; toastT = 0; shakeT = 0; clearT = 0;
    loadLevel(0);
  }

  /* ---------------- selection + submission ---------------- */

  function currentWord() {
    var s = '';
    for (var i = 0; i < sel.length; i++) s += letters[sel[i]].ch;
    return s;
  }

  function pickTile(idx) {
    if (state !== 'running') return;
    for (var i = 0; i < sel.length; i++) {
      if (sel[i] === idx) {           /* clicking a placed letter trims the chain */
        sel.length = i;
        ringPulse = 0.25;
        return;
      }
    }
    sel.push(idx);
    letters[idx].pop = 0.3;
    ringPulse = 0.25;
  }

  function pickChar(ch) {
    ch = ch.toLowerCase();
    for (var i = 0; i < letters.length; i++) {
      if (letters[i].ch === ch && sel.indexOf(i) === -1) { pickTile(i); return true; }
    }
    return false;
  }

  function backspace() {
    if (state !== 'running' || !sel.length) return;
    sel.length = sel.length - 1;
    ringPulse = 0.25;
  }

  function submit() {
    if (state !== 'running') return;
    var word = currentWord();
    if (word.length < 3) {
      say('Too short — link at least 3 letters', '#f59e0b');
      shakeT = 0.3;
      return;
    }
    var target = null;
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].word === word) { target = slots[i]; break; }
    }
    if (!target) {
      say('"' + word.toUpperCase() + '" is not on this board', '#ff5c7a');
      shakeT = 0.35;
      return;
    }
    if (target.found) {
      say('Already found — try another word', '#f59e0b');
      shakeT = 0.3;
      return;
    }

    /* success */
    target.found = true;
    var pts = wordPoints(word.length);
    score += pts;
    sel = [];
    say('+' + pts + '  ' + word.toUpperCase(), '#2ee6a6');
    flashSlot(target);
    burst(W / 2, 120, '#2ee6a6', 18, 50);
    updateHud();

    if (slotsLeft() === 0) levelClear();
  }

  function slotCenter(slot) {
    /* find the on-screen centre of a slot's first letter box */
    var layout = computeSlotLayout();
    for (var i = 0; i < layout.boxes.length; i++) {
      if (layout.boxes[i].slot === slot) return { x: layout.boxes[i].x, y: layout.boxes[i].y };
    }
    return { x: W / 2, y: 200 };
  }

  function flashSlot(slot) {
    var c = slotCenter(slot);
    burst(c.x, c.y, '#2ee6a6', 22, 90);
  }

  function levelClear() {
    state = 'clearing';
    clearT = 1.7;
    var bonus = 200 + 50 * levelIndex;
    score += bonus;
    confettiBurst();
    say('BOARD CLEARED!  +' + bonus, '#f59e0b');
    updateHud();
  }

  function nextLevel() {
    if (levelIndex + 1 >= LEVELS.length) {
      winGame();
      return;
    }
    levelIndex++;
    if (levelIndex + 1 > best) {
      best = levelIndex + 1;
      GameShell.best.set(BEST_KEY, best);
    }
    loadLevel(levelIndex);
    state = 'running';
    updateHud();
  }

  function useHint() {
    if (state !== 'running') return;
    var open = [];
    for (var i = 0; i < slots.length; i++) if (!slots[i].found) open.push(slots[i]);
    if (!open.length) return;
    var slot = open[Math.floor(Math.random() * open.length)];
    var hidden = [];
    for (i = 0; i < slot.word.length; i++) if (slot.reveal.indexOf(i) === -1) hidden.push(i);
    if (!hidden.length) {
      /* every letter of that word is already revealed — reveal in another one */
      for (var j = 0; j < open.length; j++) {
        slot = open[j];
        hidden = [];
        for (i = 0; i < slot.word.length; i++) if (slot.reveal.indexOf(i) === -1) hidden.push(i);
        if (hidden.length) break;
      }
    }
    if (!hidden.length) return;
    var pos = hidden[Math.floor(Math.random() * hidden.length)];
    slot.reveal.push(pos);
    score = Math.max(0, score - 100);
    var c = slotCenter(slot);
    burst(c.x, c.y, '#f59e0b', 14, 60);
    say('💡 Free letter revealed (−100)', '#f59e0b');
    updateHud();
  }

  /* ---------------- states ---------------- */

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
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The words will wait. Press P or Esc to jump back in.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Level', value: (levelIndex + 1) + '/' + LEVELS.length },
        { label: 'Slots left', value: slotsLeft() }
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

  function restartLevel() {
    if (state !== 'running' && state !== 'paused') return;
    loadLevel(levelIndex);
    state = 'running';
    last = now();
    GameShell.overlay.hide();
    say('Level restarted', '#22d3ee');
    updateHud();
    ensureLoop();
  }

  function winGame() {
    state = 'over';
    var isBest = score > GameShell.best.get(BEST_KEY + '.score', 0);
    if (isBest) GameShell.best.set(BEST_KEY + '.score', score);
    updateHud();
    GameShell.overlay.show({
      title: 'All levels cleared! 🎉',
      msg: 'You linked your way through every one of the ' + LEVELS.length +
           ' boards and finished with ' + score + ' points.',
      stats: [
        { label: 'Final score', value: score },
        { label: 'Best run', value: Math.max(isBest ? score : 0, GameShell.best.get(BEST_KEY + '.score', 0)) },
        { label: 'Boards', value: LEVELS.length }
      ],
      btn: '▶ Play again from level 1',
      action: start
    });
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    var i;

    if (toastT > 0) toastT -= dt;
    if (shakeT > 0) shakeT -= dt;
    if (ringPulse > 0) ringPulse -= dt;

    for (i = 0; i < letters.length; i++) {
      if (letters[i].pop > 0) letters[i].pop -= dt;
    }

    for (i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy = p.vy * 0.96 + 60 * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    for (i = confetti.length - 1; i >= 0; i--) {
      var c = confetti[i];
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
      if (c.y > H + 20) confetti.splice(i, 1);
    }

    if (state === 'clearing') {
      clearT -= dt;
      if (clearT <= 0) nextLevel();
    }
  }

  /* ---------------- slot layout ---------------- */

  function computeSlotLayout() {
    var boxes = [];
    var rowY = 150;
    var maxW = 540;
    var byLen = {};
    var lens = [];
    for (var i = 0; i < slots.length; i++) {
      var L = slots[i].word.length;
      if (!byLen[L]) { byLen[L] = []; lens.push(L); }
      byLen[L].push(slots[i]);
    }
    lens.sort(function (a, b) { return a - b; });
    var fs = slots.length > 8 ? 26 : 30;
    var bw = fs + 8, bh = fs + 12, gap = 6, wgap = 22;

    for (var li = 0; li < lens.length; li++) {
      var group = byLen[lens[li]];
      /* pack the group into rows that fit maxW */
      var row = [], rowW = 0;
      var flushRow = function () {
        if (!row.length) return;
        var x = (W - rowW) / 2;
        for (var k = 0; k < row.length; k++) {
          var slot = row[k];
          for (var c = 0; c < slot.word.length; c++) {
            boxes.push({ slot: slot, ci: c, x: x + c * (bw + 2) + bw / 2, y: rowY + bh / 2, w: bw, h: bh, fs: fs });
          }
          x += slot.word.length * (bw + 2) + wgap;
        }
        rowY += bh + 10;
        row = []; rowW = 0;
      };
      for (var gi = 0; gi < group.length; gi++) {
        var need = group[gi].word.length * (bw + 2) + wgap;
        if (rowW + need > maxW) flushRow();
        row.push(group[gi]);
        rowW += need;
      }
      flushRow();
      rowY += 6;
    }
    return { boxes: boxes, rowY: rowY };
  }

  /* ---------------- draw ---------------- */

  function drawSlots() {
    var layout = computeSlotLayout();
    var t = now() / 1000;

    for (var i = 0; i < layout.boxes.length; i++) {
      var b = layout.boxes[i];
      var slot = b.slot;
      var x = b.x - b.w / 2, y = b.y - b.h / 2;
      var known = slot.found || slot.reveal.indexOf(b.ci) !== -1;
      var fs = b.fs;

      if (known) {
        ctx.save();
        ctx.shadowColor = slot.found ? '#2ee6a6' : '#f59e0b';
        ctx.shadowBlur = slot.found ? 12 : 8;
        ctx.fillStyle = slot.found ? 'rgba(46,230,166,.16)' : 'rgba(245,158,11,.16)';
        rr(x, y, b.w, b.h, 7);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = slot.found ? '#c9ffe9' : '#ffe2ad';
        ctx.font = 'bold ' + fs + 'px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(slot.word[b.ci].toUpperCase(), b.x, b.y + 1);
      } else {
        ctx.fillStyle = 'rgba(232,238,252,.10)';
        rr(x, y, b.w, b.h, 7);
        ctx.fill();
        /* gentle shimmer so empty slots feel alive */
        ctx.globalAlpha = 0.12 + 0.08 * Math.sin(t * 2 + i * 0.7);
        ctx.strokeStyle = 'rgba(124,92,255,.8)';
        ctx.lineWidth = 1.5;
        rr(x, y, b.w, b.h, 7);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.textBaseline = 'alphabetic';
  }

  function drawRing() {
    var n = letters.length;
    var r = ringRadius(n);
    var t = now() / 1000;
    var selWord = currentWord();

    /* guide circle */
    ctx.strokeStyle = 'rgba(124,92,255,' + (0.22 + ringPulse * 0.6) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(RING_CX, RING_CY, r, 0, TAU);
    ctx.stroke();

    /* links between consecutive selected tiles */
    ctx.strokeStyle = 'rgba(46,230,166,.7)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (var i = 0; i < sel.length; i++) {
      var tile = letters[sel[i]];
      if (i === 0) ctx.moveTo(tile.x, tile.y); else ctx.lineTo(tile.x, tile.y);
    }
    ctx.stroke();

    for (i = 0; i < n; i++) {
      var L = letters[i];
      var order = sel.indexOf(i);
      var used = order !== -1;
      var scale = 1 + (L.pop > 0 ? L.pop * 0.5 : 0);
      var rad = TILE_R * scale;

      ctx.save();
      ctx.shadowColor = used ? '#2ee6a6' : L.hue;
      ctx.shadowBlur = used ? 22 : 10 + 4 * Math.sin(t * 2 + i);
      ctx.fillStyle = used ? 'rgba(46,230,166,.22)' : 'rgba(232,238,252,.08)';
      ctx.beginPath();
      ctx.arc(L.x, L.y, rad, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = used ? '#2ee6a6' : 'rgba(232,238,252,.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = used ? '#c9ffe9' : '#e8eefc';
      ctx.font = 'bold ' + Math.round(rad * 1.05) + 'px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(L.ch.toUpperCase(), L.x, L.y + 2);

      if (used) {
        ctx.fillStyle = '#2ee6a6';
        ctx.beginPath();
        ctx.arc(L.x + rad * 0.72, L.y - rad * 0.72, 9, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#04120c';
        ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(String(order + 1), L.x + rad * 0.72, L.y - rad * 0.72 + 1);
      }
    }
    ctx.textBaseline = 'alphabetic';

    /* answer bar */
    var bw = 400, bh = 52, bx = (W - bw) / 2, by = 84;
    var shx = shakeT > 0 ? Math.sin(now() / 22) * 6 * (shakeT / 0.35) : 0;
    ctx.save();
    ctx.translate(shx, 0);
    ctx.fillStyle = 'rgba(232,238,252,.07)';
    rr(bx, by, bw, bh, 14);
    ctx.fill();
    ctx.strokeStyle = selWord ? 'rgba(46,230,166,.6)' : 'rgba(232,238,252,.25)';
    ctx.lineWidth = 2;
    rr(bx, by, bw, bh, 14);
    ctx.stroke();

    if (selWord) {
      ctx.fillStyle = '#eafff6';
      ctx.font = 'bold 32px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(selWord.toUpperCase(), W / 2, by + bh / 2 + 1);
    } else {
      ctx.fillStyle = 'rgba(232,238,252,.45)';
      ctx.font = '18px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Link letters to spell a word', W / 2, by + bh / 2 + 1);
    }
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }

  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070e';
    ctx.fillRect(0, 0, W, H);

    var g = ctx.createRadialGradient(W * 0.5, 60, 20, W * 0.5, 60, W * 0.95);
    g.addColorStop(0, 'rgba(124,92,255,.16)');
    g.addColorStop(0.55, 'rgba(34,211,238,.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(232,238,252,.85)';
    ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Level ' + (levelIndex + 1), W / 2, 34);
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(232,238,252,.5)';
    ctx.fillText(slotsLeft() + ' slot' + (slotsLeft() === 1 ? '' : 's') + ' left', W / 2, 54);

    drawSlots();
    drawRing();

    /* particles */
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = clamp(p.life / p.life0, 0, 1);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    /* confetti */
    for (i = 0; i < confetti.length; i++) {
      var c = confetti[i];
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.col;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    }

    /* toast */
    if (toastT > 0 && toast) {
      var a = clamp(toastT / 0.4, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = toastCol;
      ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      var ty = 566 - (1.4 - toastT) * 10;
      ctx.fillText(toast, W / 2, ty);
      ctx.globalAlpha = 1;
    }

    if (state === 'paused') {
      ctx.fillStyle = 'rgba(232,238,252,.75)';
      ctx.font = 'bold 24px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, 640 - 120);
    }
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    var dt = last ? (t - last) / 1000 : 0;
    last = t;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    if (state === 'running' || state === 'clearing') update(dt);
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

    if (k === ' ' || k === 'Enter' || k === 'Backspace') {
      if (e.preventDefault) e.preventDefault();
    }

    if (k === ' ') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
    } else if (k === 'Enter') {
      /* Enter SUBMITS a word — it must never pause this game */
      if (state === 'ready' || state === 'over') start();
      else submit();
    } else if (k === 'Backspace') {
      backspace();
    } else if (k === 'Escape') {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (k === 'p' || k === 'P') {
      /* P pauses — but never steals the letter from an unused ring tile */
      var pTile = false;
      for (var pi = 0; pi < letters.length; pi++) {
        if (letters[pi].ch === 'p' && sel.indexOf(pi) === -1) { pTile = true; break; }
      }
      if (state === 'paused') resume();
      else if (state === 'running' && !pTile) pause();
      else if (state === 'running') pickChar(k);
    } else if (k && k.length === 1 && /[a-zA-Z]/.test(k)) {
      pickChar(k);
    }
  });

  canvas.addEventListener('pointerdown', function (ev) {
    if (state === 'ready' || state === 'over') { start(); return; }
    if (state !== 'running') return;
    var rect = canvas.getBoundingClientRect();
    if (!rect || !rect.width) return;
    var x = (ev.clientX - rect.left) * (W / rect.width);
    var y = (ev.clientY - rect.top) * (H / rect.height);
    var bestIdx = -1, bestD = TILE_R * 1.35;
    for (var i = 0; i < letters.length; i++) {
      var dx = letters[i].x - x, dy = letters[i].y - y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; bestIdx = i; }
    }
    if (bestIdx >= 0) pickTile(bestIdx);
  });

  var padBtns = document.querySelectorAll('[data-act]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      var act = btn.getAttribute('data-act');
      btn.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        if (state === 'ready' || state === 'over') { start(); return; }
        if (act === 'ok') submit();
        else if (act === 'del') backspace();
        else if (act === 'hint') useHint();
      });
    })(padBtns[b]);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- boot ---------------- */

  reset();
  updateHud();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Word Link',
    msg: 'Spell every hidden word from the glowing ring of letters. Tap tiles or type on your keyboard, then press Enter to submit. Fill all the slots to clear the board.',
    stats: [{ label: 'Best level', value: 'Lv ' + best }, { label: 'Levels', value: LEVELS.length }],
    btn: '▶ Play',
    action: start
  });

  /* read-only debug hook for automated tests */
  window.__wordLink = {
    get state() { return state; },
    get score() { return score; },
    get level() { return levelIndex + 1; },
    get levels() { return LEVELS.length; },
    get best() { return best; },
    get slotsLeft() { return slotsLeft(); },
    get buffer() { return currentWord(); },
    get foundWords() {
      var out = [];
      for (var i = 0; i < slots.length; i++) if (slots[i].found) out.push(slots[i].word);
      return out;
    },
    get targets() { return slots.map(function (s) { return s.word; }); },
    get levelData() {
      return LEVELS.map(function (L) { return { letters: L.letters, words: L.words.slice() }; });
    },
    get ring() {
      return letters.map(function (l) { return { ch: l.ch, x: l.x, y: l.y }; });
    }
  };

  /* shared HUD reset button */
  if (typeof GameShell.onReset === 'function') GameShell.onReset(start);
})();
