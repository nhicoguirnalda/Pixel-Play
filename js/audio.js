/* ============================================================
   PixelPlay — shared audio engine
   Original chiptune music and sound effects generated with the
   Web Audio API. No audio files, no network requests.
   Loads after game-page.js and before each game script.
   ============================================================ */

(function () {
  'use strict';

  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null, master = null, musicGain = null, sfxGain = null;
  var noiseBuf = null;
  var muted = false;
  var musicTimer = 0, musicStep = 0, musicNext = 0, musicKind = '';
  var started = false, hookTries = 0;
  var lastPlay = {};
  var lastStats = null;
  var MUTE_KEY = 'pixelplay.muted';

  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { muted = false; }

  /* ---------------- tiny synth helpers ---------------- */

  function now() { return ctx ? ctx.currentTime : 0; }

  function gainValue(node, v) {
    node.gain.setValueAtTime(v, now());
  }

  function tone(freq, when, dur, type, vol, dest, slideTo) {
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(Math.max(20, freq), when);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), when + dur);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g);
    g.connect(dest || sfxGain);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  function noise(when, dur, vol, cut, dest) {
    if (!ctx || !noiseBuf) return;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cut || 2400, when);
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f); f.connect(g); g.connect(dest || sfxGain);
    src.start(when);
    src.stop(when + dur + 0.02);
  }

  function ensureNoise() {
    if (noiseBuf || !ctx) return;
    var len = Math.floor(ctx.sampleRate * 0.6);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  /* ---------------- initialise on first gesture ---------------- */

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      return true;
    }
    if (!AC) return false;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.85;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.12;
      musicGain.connect(master);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.55;
      sfxGain.connect(master);
      ensureNoise();
      return true;
    } catch (e) {
      ctx = null;
      return false;
    }
  }

  /* ---------------- themes ---------------- */

  var THEMES = {
    arcade: {
      bpm: 124, root: 220,
      bass: [0, 0, 7, 0, 5, 5, 3, 3],
      lead: [12, 15, 19, 22, 19, 15, 12, 10, 7, 10, 12, 15, 12, 10, 7, 5,
             12, 15, 19, 24, 22, 19, 15, 12, 10, 12, 15, 19, 15, 12, 10, 7]
    },
    action: {
      bpm: 140, root: 196,
      bass: [0, 0, 0, 6, 5, 5, 3, 3],
      lead: [12, 12, 15, 18, 15, 12, 10, 12, 18, 17, 15, 12, 10, 7, 5, 7,
             12, 15, 18, 21, 18, 15, 12, 10, 15, 17, 18, 17, 15, 12, 10, 7]
    },
    calm: {
      bpm: 88, root: 220,
      bass: [0, 0, 5, 5, 3, 3, 7, 7],
      lead: [12, 15, 19, 15, 12, 10, 7, 10, 12, 17, 19, 17, 12, 10, 7, 5,
             12, 15, 19, 22, 19, 15, 12, 10, 7, 10, 12, 15, 12, 10, 7, 0]
    }
  };

  function hz(root, semis) { return root * Math.pow(2, semis / 12); }

  function scheduleMusic() {
    if (!ctx || !started) return;
    var th = THEMES[musicKind] || THEMES.arcade;
    var stepDur = 60 / th.bpm / 2;             /* eighth notes */
    while (musicNext < ctx.currentTime + 0.15) {
      var t = Math.max(musicNext, ctx.currentTime + 0.01);
      var s = musicStep % 32;
      var lead = th.lead[s];
      if (lead > 0) {
        tone(hz(th.root, lead), t, stepDur * 0.82, 'square', 0.075, musicGain);
      }
      if (s % 2 === 0) {
        var b = th.bass[Math.floor(s / 4) % 8];
        tone(hz(th.root / 2, b), t, stepDur * 1.5, 'triangle', 0.12, musicGain);
      }
      if (s % 4 === 0) noise(t, 0.10, 0.10, 320, musicGain);
      else if (s % 2 === 1) noise(t, 0.035, 0.035, 5200, musicGain);
      musicNext += stepDur;
      musicStep++;
    }
  }

  function startMusic(kind) {
    if (!init()) return;
    if (!kind) kind = detectTheme();
    if (started && musicKind === kind) return;
    stopMusic();
    musicKind = kind;
    started = true;
    musicStep = 0;
    musicNext = ctx.currentTime + 0.08;
    scheduleMusic();
    musicTimer = setInterval(scheduleMusic, 45);
  }

  function stopMusic() {
    started = false;
    if (musicTimer) {
      clearInterval(musicTimer);
      musicTimer = 0;
    }
  }

  function detectTheme() {
    var cat = '';
    try {
      var id = document.body.getAttribute('data-game');
      if (window.GAMES) {
        for (var i = 0; i < GAMES.length; i++) {
          if (GAMES[i].id === id) { cat = GAMES[i].cat; break; }
        }
      }
    } catch (e) { cat = ''; }
    if (cat === 'word' || cat === 'puzzle' || cat === 'board') return 'calm';
    if (cat === 'shooter' || cat === 'fps' || cat === 'action') return 'action';
    return 'arcade';
  }

  /* ---------------- sound effects ---------------- */

  function play(name) {
    if (!name) return;
    init();
    if (!ctx || muted) return;
    var stamp = now();
    if (lastPlay[name] && stamp - lastPlay[name] < 0.035) return;
    lastPlay[name] = stamp;
    var t = stamp + 0.005;

    if (name === 'shoot') {
      tone(760, t, 0.06, 'square', 0.20, sfxGain, 180);
      noise(t, 0.045, 0.07, 4200, sfxGain);
    } else if (name === 'laser') {
      tone(1500, t, 0.12, 'sawtooth', 0.15, sfxGain, 240);
    } else if (name === 'hit') {
      tone(180, t, 0.09, 'square', 0.20, sfxGain, 90);
      noise(t, 0.06, 0.14, 1800, sfxGain);
    } else if (name === 'explode') {
      noise(t, 0.42, 0.30, 650, sfxGain);
      tone(110, t, 0.34, 'sawtooth', 0.16, sfxGain, 42);
    } else if (name === 'coin' || name === 'powerup') {
      tone(880, t, 0.07, 'square', 0.13, sfxGain);
      tone(1320, t + 0.075, 0.10, 'square', 0.13, sfxGain);
      if (name === 'powerup') {
        tone(1760, t + 0.17, 0.14, 'triangle', 0.14, sfxGain);
        tone(2093, t + 0.27, 0.18, 'triangle', 0.12, sfxGain);
      }
    } else if (name === 'point') {
      tone(1244, t, 0.035, 'sine', 0.045, sfxGain);
    } else if (name === 'jump') {
      tone(260, t, 0.11, 'square', 0.13, sfxGain, 620);
    } else if (name === 'select') {
      tone(660, t, 0.04, 'square', 0.10, sfxGain, 880);
    } else if (name === 'reload') {
      noise(t, 0.05, 0.10, 2400, sfxGain);
      tone(240, t + 0.03, 0.05, 'square', 0.08, sfxGain, 160);
    } else if (name === 'win') {
      tone(523, t, 0.12, 'square', 0.15, sfxGain);
      tone(659, t + 0.11, 0.12, 'square', 0.15, sfxGain);
      tone(784, t + 0.22, 0.14, 'square', 0.15, sfxGain);
      tone(1046, t + 0.35, 0.30, 'triangle', 0.18, sfxGain);
    } else if (name === 'lose') {
      tone(300, t, 0.22, 'sawtooth', 0.15, sfxGain, 220);
      tone(220, t + 0.18, 0.30, 'sawtooth', 0.14, sfxGain, 110);
      tone(110, t + 0.40, 0.42, 'triangle', 0.12, sfxGain, 70);
    } else if (name === 'thud') {
      tone(90, t, 0.14, 'square', 0.16, sfxGain, 50);
      noise(t, 0.10, 0.12, 500, sfxGain);
    } else if (name === 'splash') {
      noise(t, 0.16, 0.10, 1200, sfxGain);
      tone(420, t, 0.08, 'sine', 0.07, sfxGain, 180);
    } else if (name === 'wrong') {
      tone(200, t, 0.10, 'square', 0.12, sfxGain, 150);
      tone(150, t + 0.12, 0.14, 'square', 0.12, sfxGain, 110);
    } else if (name === 'dash') {
      noise(t, 0.12, 0.08, 3000, sfxGain);
      tone(300, t, 0.10, 'sawtooth', 0.08, sfxGain, 900);
    }
  }

  function setMuted(v) {
    muted = !!v;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
    if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.02);
    syncButton();
    if (!muted) {
      init();
      if (!started) startMusic();
    }
  }

  function toggleMuted() { setMuted(!muted); }

  /* ---------------- HUD button ---------------- */

  function syncButton() {
    var hud = document.getElementById('gameHud');
    if (!hud) return;
    var btn = document.getElementById('audioToggle');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'audioToggle';
      btn.type = 'button';
      btn.className = 'hud-btn';
      btn.style.minWidth = '42px';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        toggleMuted();
        play('select');
      });
      hud.appendChild(btn);
    }
    btn.textContent = muted ? '\uD83D\uDD07 Sound off' : '\uD83D\uDD0A Sound on';
    btn.setAttribute('aria-label', muted ? 'Turn game sound on' : 'Turn game sound off');
    btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    btn.style.opacity = muted ? '0.65' : '1';
  }

  /* ---------------- shared shell hooks ---------------- */

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function classifyOverlay(opts) {
    var text = ((opts && opts.title) || '') + ' ' + ((opts && opts.msg) || '');
    text = text.toLowerCase();
    if (/game over|defeat|crash|wreck|failed|caught|busted|out of|no lives|you fell/.test(text)) {
      play('lose');
    } else if (/win|clear|complete|victory|summit|conquered|boss down|boss defeated|new best|stage/.test(text)) {
      play('win');
    } else {
      play('select');
    }
  }

  function hookShell() {
    var sh = window.GameShell;
    if (!sh) {
      if (hookTries++ < 40) setTimeout(hookShell, 60);
      return;
    }
    if (sh.__pixelplayAudio) return;
    sh.__pixelplayAudio = true;

    var origHud = sh.hud;
    sh.hud = function (map, rightText) {
      var prev = lastStats;
      origHud.call(sh, map, rightText);
      syncButton();
      if (map && prev) {
        var score = num(map.Score);
        var lives = num(map.Lives);
        var hp = num(map.HP);
        if ((map.Lives !== undefined && lives < prev.lives) ||
            (map.HP !== undefined && hp < prev.hp)) {
          play('hit');
        } else if (score > prev.score && !lastPlay['gamefx']) {
          play('point');
        }
        lastStats = { score: score, lives: lives, hp: hp };
      } else if (map) {
        lastStats = { score: num(map.Score), lives: num(map.Lives), hp: num(map.HP) };
      }
    };

    var origShow = sh.overlay && sh.overlay.show;
    if (origShow) {
      sh.overlay.show = function (opts) {
        origShow.call(sh.overlay, opts);
        classifyOverlay(opts);
      };
    }
  }

  /* ---------------- gestures, clicks, visibility ---------------- */

  function firstGesture() {
    init();
    if (!muted) startMusic();
  }

  function onFirst(ev) {
    firstGesture();
    document.removeEventListener('pointerdown', onFirst, true);
    document.removeEventListener('touchstart', onFirst, true);
    document.removeEventListener('keydown', onFirst, true);
  }

  document.addEventListener('pointerdown', onFirst, true);
  document.addEventListener('touchstart', onFirst, true);
  document.addEventListener('keydown', onFirst, true);

  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document) {
      if (el.tagName === 'BUTTON' || (el.className && /(^|\s)(btn|hud-btn|tbtn)(\s|$)/.test(el.className))) {
        play('select');
        return;
      }
      el = el.parentNode;
    }
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'm' || e.key === 'M') {
      var tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      toggleMuted();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) {
      if (master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    } else if (!muted && master) {
      master.gain.setTargetAtTime(0.85, ctx.currentTime, 0.08);
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    }
  });

  /* ---------------- public API ---------------- */

  var api = {
    init: init,
    sfx: play,
    play: play,
    music: startMusic,
    stopMusic: stopMusic,
    setMuted: setMuted,
    toggleMuted: toggleMuted,
    isMuted: function () { return muted; },
    isReady: function () { return !!ctx; },
    theme: detectTheme
  };

  window.PixelPlayAudio = api;
  window.PixelPlaySFX = play;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookShell);
  } else {
    hookShell();
  }
})();
