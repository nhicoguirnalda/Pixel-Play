/* ============================================================
   PixelPlay — game catalogue + shared card helpers
   Loaded on every page (index + game pages) as a classic script.
   ============================================================ */

var CATEGORIES = [
  { id: 'all',      label: 'All Games', icon: '🎮' },
  { id: 'action',   label: 'Action',    icon: '⚡' },
  { id: 'shooter',  label: 'Shooting',  icon: '🎯' },
  { id: 'fps',      label: 'FPS',       icon: '🔫' },
  { id: 'puzzle',   label: 'Puzzle',    icon: '🧠' },
  { id: 'arcade',   label: 'Arcade',    icon: '🕹️' },
  { id: 'sports',   label: 'Sports',    icon: '⚽' },
  { id: 'stickman', label: 'Stickman',  icon: '🧍' },
  { id: 'word',     label: 'Word Games', icon: '🔤' },
  { id: 'casual',   label: 'Casual',    icon: '🎲' },
  { id: 'board',    label: 'Board',     icon: '♟️' }
];

/* plays  = short display string, playsN = numeric for sorting */
var GAMES = [
  {
    id: 'snake', title: 'Neon Snake', cat: 'arcade',
    icon: '🐍', c1: '#22c55e', c2: '#0ea5e9',
    plays: '1.4M', playsN: 1400000, rating: 4.8, added: 3,
    controls: 'Arrows / WASD',
    desc: 'Slither through the grid, grab glowing orbs and grow — but never bite your own tail.',
    url: 'games/snake.html'
  },
  {
    id: 'brick-blitz', title: 'Brick Blitz', cat: 'action',
    icon: '🧱', c1: '#f97316', c2: '#ef4444',
    plays: '980K', playsN: 980000, rating: 4.6, added: 5,
    controls: 'Mouse / Touch',
    desc: 'Smash through colourful walls with a paddle and a very bouncy ball.',
    url: 'games/brick-blitz.html'
  },
  {
    id: 'memory-flip', title: 'Memory Flip', cat: 'puzzle',
    icon: '🃏', c1: '#a855f7', c2: '#ec4899',
    plays: '1.1M', playsN: 1100000, rating: 4.7, added: 7,
    controls: 'Click / Tap',
    desc: 'Flip the cards and match every pair in as few moves as you can.',
    url: 'games/memory-flip.html'
  },
  {
    id: 'merge-2048', title: 'Merge 2048', cat: 'casual',
    icon: '🔢', c1: '#f59e0b', c2: '#f43f5e',
    plays: '2.3M', playsN: 2300000, rating: 4.9, added: 4, /* unchanged */
    controls: 'Arrows / Swipe',
    desc: 'Slide tiles, merge matching numbers and chase the legendary 2048 tile.',
    url: 'games/merge-2048.html'
  },
  {
    id: 'mine-field', title: 'Mine Field', cat: 'puzzle',
    icon: '💣', c1: '#64748b', c2: '#0ea5e9',
    plays: '760K', playsN: 760000, rating: 4.5, added: 6,
    controls: 'Click / Right-click',
    desc: 'Clear the grid without touching a mine. Numbers tell you where danger hides.',
    url: 'games/mine-field.html'
  },
  {
    id: 'pong-arena', title: 'Pong Arena', cat: 'sports',
    icon: '🏓', c1: '#06b6d4', c2: '#3b82f6',
    plays: '1.6M', playsN: 1600000, rating: 4.7, added: 2, /* unchanged */
    controls: 'Mouse / Touch',
    desc: 'Classic paddle duel against a speedy AI. First to 7 wins the match.',
    url: 'games/pong-arena.html'
  },
  {
    id: 'tic-tac-toe', title: 'Tic Tac Toe', cat: 'board',
    icon: '❌', c1: '#8b5cf6', c2: '#22d3ee',
    plays: '640K', playsN: 640000, rating: 4.4, added: 1,
    controls: 'Click / Tap',
    desc: 'Climb seven levels of AI - from easy blunders to an unbeatable minimax bot - or share the screen with a friend.',
    url: 'games/tic-tac-toe.html'
  },
  {
    id: 'bubble-burst', title: 'Bubble Burst', cat: 'shooter',
    icon: '🫧', c1: '#38bdf8', c2: '#a855f7',
    plays: '1.5M', playsN: 1500000, rating: 4.8, added: 10,
    controls: 'Mouse / Touch',
    desc: 'Bounce the aim guide off the walls, pop groups of three or more bubbles and fill the level meter for deeper, faster walls.',
    url: 'games/bubble-burst.html'
  },
  {
    id: 'sky-defense', title: 'Sky Defense', cat: 'shooter',
    icon: '🎯', c1: '#4ade80', c2: '#0ea5e9',
    plays: '690K', playsN: 690000, rating: 4.5, added: 11,
    controls: 'Mouse / Touch',
    desc: 'Track the crosshair, shoot down aircraft before they slip past the sky and keep the city standing with quick reloads.',
    url: 'games/sky-defense.html'
  },
  {
    id: 'neon-squadron', title: 'Neon Squadron', cat: 'shooter',
    icon: '🛸', c1: '#ec4899', c2: '#06b6d4',
    plays: '1.0M', playsN: 1000000, rating: 4.7, added: 12,
    controls: 'Arrows / WASD',
    desc: 'Pilot a neon starfighter through endless alien waves, blast the bosses and grab power-ups.',
    url: 'games/neon-squadron.html'
  },
  {
    id: 'drone-defense', title: 'Drone Defense', cat: 'shooter',
    icon: '🤖', c1: '#a3e635', c2: '#22d3ee',
    plays: '760K', playsN: 760000, rating: 4.6, added: 13,
    controls: 'WASD + Mouse',
    desc: 'Drive a robot around a neon arena, blast escalating drone waves and topple wardens that return as Titans, Apexes and Overlords.',
    url: 'games/drone-defense.html'
  },
  {
    id: 'bullet-ballet', title: 'Bullet Ballet', cat: 'shooter',
    icon: '💫', c1: '#f472b6', c2: '#8b5cf6',
    plays: '920K', playsN: 920000, rating: 4.7, added: 14,
    controls: 'Arrows / WASD',
    desc: 'Dodge swirling patterns with three lives, grab health power-ups for extra lives, and grind down bosses that hit harder each cycle until upgrades stop after the fifth.',
    url: 'games/bullet-ballet.html'
  },
  {
    id: 'skeet-shot', title: 'Skeet Shot', cat: 'shooter',
    icon: '🥏', c1: '#fbbf24', c2: '#f97316',
    plays: '580K', playsN: 580000, rating: 4.4, added: 15,
    controls: 'Mouse / Touch',
    desc: 'Launch clay targets, aim with mouse or finger and build combos across three rounds of skeet with three lives on the line.',
    url: 'games/skeet-shot.html'
  },
  {
    id: 'turret-guard', title: 'Turret Guard', cat: 'shooter',
    icon: '🛡️', c1: '#22c55e', c2: '#6366f1',
    plays: '810K', playsN: 810000, rating: 4.5, added: 16,
    controls: 'Mouse / Touch',
    desc: 'Aim your turret, hold the line against faster, tougher robots and armoured walkers every fifth wave, and spend credits on upgrades.',
    url: 'games/turret-guard.html'
  },
  {
    id: 'rift-raider', title: 'Rift Raider', cat: 'shooter',
    icon: '🛰️', c1: '#06b6d4', c2: '#a855f7',
    plays: '730K', playsN: 730000, rating: 4.6, added: 17,
    controls: 'Arrows / WASD',
    desc: 'Thread the asteroid rift, blast raiders and survive escalating boss duels that arrive faster and hit harder each cycle.',
    url: 'games/rift-raider.html'
  },
  {
    id: 'neon-blocks', title: 'Neon Blocks', cat: 'puzzle',
    icon: '🔷', c1: '#a855f7', c2: '#22d3ee',
    plays: '1.9M', playsN: 1900000, rating: 4.9, added: 18,
    controls: 'Arrows / WASD',
    desc: 'Rotate and slide glowing blocks, clear complete lines and chain combos as gravity and lock speed climb every eight lines — the timeless stacker reborn in neon.',
    url: 'games/neon-blocks.html'
  },
  {
    id: 'wavebreak', title: 'Wavebreak', cat: 'fps',
    icon: '🤖', c1: '#8b5cf6', c2: '#22d3ee',
    plays: '1.1M', playsN: 1100000, rating: 4.5, added: 21,
    controls: 'WASD + Mouse',
    desc: 'Hold the arena against escalating drone waves with a Blaster, Rifle or SMG, press R to reload early and topple a boss every fifth wave.',
    url: 'games/wavebreak.html'
  },
  {
    id: 'stickman-sprint', title: 'Stickman Sprint', cat: 'stickman',
    icon: '🏃', c1: '#22d3ee', c2: '#a3e635',
    plays: '740K', playsN: 740000, rating: 4.8, added: 24,
    controls: 'Space / Arrows',
    desc: 'Sprint a neon skyline runner: jump barriers, slide under beams and clear wide gaps with a mid-air double jump.',
    url: 'games/stickman-sprint.html'
  },
  {
    id: 'hook-hero', title: 'Hook Hero', cat: 'stickman',
    icon: '🪝', c1: '#f59e0b', c2: '#22d3ee',
    plays: '610K', playsN: 610000, rating: 4.7, added: 25,
    controls: 'Hold Space',
    desc: 'Fire your hook across eighteen windy chasm stages with three lives, dodge pulse beams and energy orbs, and clear one stage to unlock the next.',
    url: 'games/hook-hero.html'
  },
  {
    id: 'stickman-fighter', title: 'Stickman Fighter', cat: 'stickman',
    icon: '🥊', c1: '#ef4444', c2: '#8b5cf6',
    plays: '540K', playsN: 540000, rating: 4.6, added: 26,
    controls: 'Z / X / Arrows',
    desc: 'Punch, kick, block and dodge rival stick fighters, elite brutes and bosses through escalating cartoon arena waves.',
    url: 'games/stickman-fighter.html'
  },
  {
    id: 'stickman-climb', title: 'Stickman Climb', cat: 'stickman',
    icon: '🧗', c1: '#a855f7', c2: '#f59e0b',
    plays: '310K', playsN: 310000, rating: 4.6, added: 28,
    controls: 'Arrows / A D',
    desc: 'Hammer two pickaxes up an endless neon cliff with one life, where spikes are lethal and every 100 metres adds faster debris, wider icicles and stronger gusts.',
    url: 'games/stickman-climb.html'
  },
  {
    id: 'stickman-rider', title: 'Stickman Rider', cat: 'stickman',
    icon: '🏍️', c1: '#38bdf8', c2: '#f43f5e',
    plays: '620K', playsN: 620000, rating: 4.7, added: 30,
    controls: 'Arrows / WASD',
    desc: 'Race nine increasingly brutal trials trails with three lives, time the faster swinging logs, pull big flips and beat a tighter clock each level.',
    url: 'games/stickman-rider.html'
  },
  {
    id: 'daily-word', title: 'Daily Word', cat: 'word',
    icon: '📅', c1: '#22c55e', c2: '#0ea5e9',
    plays: '540K', playsN: 540000, rating: 4.8, added: 31,
    controls: 'Type / Enter',
    desc: 'Crack the hidden five-letter word in six tries using colour-coded tile hints, with streaks and a fresh daily puzzle.',
    url: 'games/daily-word.html'
  },
  {
    id: 'word-hunt', title: 'Word Hunt', cat: 'word',
    icon: '🔎', c1: '#a3e635', c2: '#8b5cf6',
    plays: '640K', playsN: 640000, rating: 4.8, added: 32,
    controls: 'Mouse / Touch',
    desc: 'Drag across a glowing letter grid and uncover all ten hidden words before the countdown clock reaches zero.',
    url: 'games/word-hunt.html'
  },
  {
    id: 'anagram-ace', title: 'Anagram Ace', cat: 'word',
    icon: '🔤', c1: '#f472b6', c2: '#22d3ee',
    plays: '520K', playsN: 520000, rating: 4.7, added: 33,
    controls: 'Keyboard / Tap',
    desc: 'Unscramble the seven glowing letter tiles, chain streak bonuses and beat the clock in fast 90-second rounds.',
    url: 'games/anagram-ace.html'
  },
  {
    id: 'word-link', title: 'Word Link', cat: 'word',
    icon: '🔗', c1: '#f59e0b', c2: '#6366f1',
    plays: '512K', playsN: 512000, rating: 4.8, added: 34,
    controls: 'Keyboard / Tap',
    desc: 'Link glowing letter tiles into hidden words, fill every empty slot and clear forty handmade levels one ring at a time.',
    url: 'games/word-link.html'
  },
  {
    id: 'word-fall', title: 'Word Fall', cat: 'word',
    icon: '⌨️', c1: '#ef4444', c2: '#22d3ee',
    plays: '468K', playsN: 468000, rating: 4.7, added: 35,
    controls: 'Typing / Keyboard',
    desc: 'Type the words falling down your screen, send them with Enter before they land and hold the defence line.',
    url: 'games/word-fall.html'
  }
];

function getGame(id) {
  for (var i = 0; i < GAMES.length; i++) {
    if (GAMES[i].id === id) return GAMES[i];
  }
  return null;
}

function categoryLabel(id) {
  for (var i = 0; i < CATEGORIES.length; i++) {
    if (CATEGORIES[i].id === id) return CATEGORIES[i].label;
  }
  return 'Games';
}

function siteRoot() {
  return document.body.getAttribute('data-root') || '';
}

function gameUrl(game, root) {
  return (root || siteRoot()) + game.url;
}

function gameCardHTML(game, root) {
  return '' +
    '<a class="game-card" href="' + gameUrl(game, root) + '" data-cat="' + game.cat + '" data-id="' + game.id + '">' +
      '<div class="card-thumb" style="--g1:' + game.c1 + ';--g2:' + game.c2 + '">' +
        '<span class="card-icon" aria-hidden="true">' + game.icon + '</span>' +
        '<span class="card-plays">▶ ' + game.plays + '</span>' +
      '</div>' +
      '<div class="card-body">' +
        '<h3>' + game.title + '</h3>' +
        '<span class="card-cat">' + categoryLabel(game.cat) + '</span>' +
      '</div>' +
    '</a>';
}

/* Recently played (localStorage, degrades gracefully if storage is blocked) */
var RecentStore = {
  key: 'pixelplay.recent',
  list: function () {
    try {
      var raw = localStorage.getItem(this.key);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  },
  add: function (id) {
    try {
      var arr = this.list().filter(function (x) { return x !== id; });
      arr.unshift(id);
      arr = arr.slice(0, 8);
      localStorage.setItem(this.key, JSON.stringify(arr));
    } catch (e) { /* storage unavailable — ignore */ }
  },
  clear: function () {
    try { localStorage.removeItem(this.key); } catch (e) {}
  }
};
