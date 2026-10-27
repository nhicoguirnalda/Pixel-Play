/* ============================================================
   Word Fall — original game for PixelPlay
   Canvas typing defence: words rain down, type them to shatter them.
   Physical keyboard, hidden mobile input and on-screen buttons.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 600, H = 600;
  var TAU = Math.PI * 2;
  var BEST_KEY = 'word-fall';

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

  /* ---------------- word data (embedded, 3–8 letters) ---------------- */

  var WORDS = [
    'cat','dog','sun','run','fun','bat','hat','mat','cup','bus',
    'bug','rug','jet','net','pet','win','tin','pin','van','can',
    'jam','arm','ant','ace','age','air','and','are','ask','ate',
    'bad','bag','bar','bed','bee','bet','big','bit','box','boy',
    'bud','bun','cab','cap','car','cob','cod','con','cop','cow',
    'cry','cub','cue','cut','dam','day','den','dew','dig','dim',
    'dip','dot','dry','due','dug','dye','ear','eat','eel','egg',
    'elf','elm','end','era','eve','eye','fan','far','fat','fed',
    'fee','few','fig','fin','fir','fit','fix','flu','fly','foe',
    'fox','fur','gap','gas','gel','gem','gin','gnu','gum','gut',
    'guy','gym','had','hag','has','hay','hem','her','hid','hip',
    'hit','hoe','hog','hop','hot','how','hub','hue','hug','hum',
    'ice','ilk','imp','ink','inn','ion','irk','ivy','jab','jar',
    'jaw','jay','jig','job','jog','jot','joy','jug','jut','keg',
    'kid','kin','kit','lab','lag','lap','law','lay','led','leg',
    'lid','lie','lit','lob','log','lot','low','lug','lye','mad',
    'map','mar','maw','may','met','mid','mix','mob','mod','mop',
    'mow','mud','nab','nag','nap','nay','new','nil','nip','nod',
    'nor','not','now','nun','oak','oar','oat','odd','ode','oil',
    'old','one','opt','orb','ore','our','owe','owl','own','pad',
    'pal','paw','pea','peg','pep','per','pew','pie','pig','ply',
    'pod','pop','pot','pro','pry','pub','pug','pun','pup','put',
    'rag','ram','ran','rap','raw','ray','red','rib','rid','rig',
    'rim','rip','rob','rod','roe','rot','row','rub','rue','rum',
    'rut','rye','sad','sag','sap','sat','saw','say','sea','see',
    'sew','she','shy','sip','sir','six','ski','sky','sly','sob',
    'sod','sop','sow','soy','spa','spy','sty','sub','sue','sum',
    'sup','tab','tag','tan','tap','tax','the','thy','tie','toe',
    'ton','too','tot','tow','toy','try','tub','tug','use','vat',
    'vet','vex','via','vow','wad','wag','wan','war','wax','way',
    'web','wed','wee','who','why','wig','wit','woe','wok','won',
    'woo','wry','yak','yaw','yap','yawn','yes','yet','yew','zap',
    'zen','zip','able','acid','aged','also','area','army','away',
    'baby','back','bake','ball','band','bank','base','bath','bear',
    'beat','been','bell','belt','bend','best','bike','bill','bird',
    'blow','blue','boat','body','bolt','bomb','bond','bone','book',
    'boom','boot','born','boss','both','bowl','bulb','bulk','burn',
    'bush','busy','call','calm','came','camp','card','care','case',
    'cash','cast','cell','chat','chip','city','club','coal','coat',
    'code','cold','come','cook','cool','cope','copy','core','cost',
    'crab','crew','crop','dark','data','date','dawn','dead','deal',
    'dear','deck','deep','desk','dial','diet','dirt','dish','does',
    'done','door','dose','down','draw','drew','drop','drum','dual',
    'duck','dust','duty','each','earn','ease','east','easy','edge',
    'else','even','ever','evil','exit','face','fact','fail','fair',
    'fall','farm','fast','fate','fear','feed','feel','feet','fell',
    'felt','file','fill','film','find','fine','fire','fish','five',
    'flat','flow','food','foot','ford','form','fort','four','free',
    'frog','from','fuel','full','fund','gain','game','gate','gave',
    'gear','gene','gift','girl','give','glad','goal','goes','gold',
    'golf','gone','good','gray','grew','grow','gulf','hair','half',
    'hall','hand','hang','hard','harm','hate','have','head','hear',
    'heat','held','hell','help','here','hero','high','hill','hire',
    'hold','hole','holy','home','hope','host','hour','huge','hung',
    'hunt','hurt','idea','inch','into','iron','item','jazz','join',
    'jump','jury','just','keep','kept','kick','kill','kind','king',
    'knee','knew','know','lack','lady','laid','lake','land','lane',
    'last','late','lead','leaf','lean','left','lend','less','life',
    'lift','like','line','link','list','live','load','loan','lock',
    'logo','long','look','lord','lose','loss','lost','love','luck',
    'made','mail','main','make','male','many','mark','mars','mask',
    'mate','math','meal','mean','meat','meet','melt','menu','mere',
    'milk','mill','mind','mine','miss','mode','mood','moon','more',
    'most','move','much','must','name','navy','near','neck','need',
    'nest','news','next','nice','nine','node','none','noon','norm',
    'nose','note','okay','once','only','onto','open','oral','over',
    'pace','pack','page','pain','pair','pale','palm','park','part',
    'pass','past','path','peak','pick','pink','pipe','plan','play',
    'plot','plus','poem','pole','poll','pond','pool','poor','port',
    'pose','pull','pure','push','race','rain','rank','rare','rate',
    'read','real','rear','rely','rent','rest','rice','rich','ride',
    'ring','rise','risk','road','rock','role','roll','roof','room',
    'root','rope','rose','rule','rush','safe','said','sail','sale',
    'salt','same','sand','save','seat','seed','seek','seem','seen',
    'self','sell','send','shark','ship','shop','shot','show','shut',
    'sick','side','sign','site','size','slow','snow','soft','soil',
    'sold','sole','some','song','soon','sort','soul','spot','star',
    'stay','step','stop','such','suit','sure','take','tale','talk',
    'tall','tank','task','team','tell','tend','term','test','text',
    'than','that','them','then','they','thin','this','thus','tide',
    'time','tiny','told','toll','tone','took','tool','town','tree',
    'trip','true','turn','type','unit','upon','user','vary','vast',
    'video','virus','visit','vital','voice','wage','wait','wake',
    'walk','wall','want','ward','warm','wash','wave','wear','week',
    'well','went','were','what','when','wide','wife','wild','will',
    'wind','wine','wing','wire','wise','wish','wood','word','wore',
    'work','yard','yeah','year','your','zero','zone','apple','beach',
    'brain','bread','chair','charm','chess','cloud','dance','dream',
    'earth','flame','ghost','grape','heart','house','juice','light',
    'magic','music','ocean','paint','peace','plane','plant','power',
    'queen','quick','quiet','river','robot','round','sheep','shirt',
    'smile','snake','sound','space','spoon','storm','sugar','table',
    'tiger','toast','train','truck','uncle','water','whale','wheat',
    'garden','market','planet','rocket','silver','purple','orange','monkey','flower','father',
    'mother','sister','kitten','forest','island','jungle','castle','temple','letter','dinner',
    'summer','winter','spring','autumn','yellow','window','candle','guitar','pencil','bottle',
    'circle','little','people','rabbit','simple','muffin','donkey','golden','hidden','poetry',
    'brother','station','morning','evening','picture','machine','kitchen','holiday','library','science',
    'monster','dolphin','penguin','cheetah','volcano','thunder','rainbow','doorway','hallway','diamond',
    'blanket','cupcake','pancake','airplane','football','sandwich','umbrella','giraffe','starfish','morale',
    'elephant','kangaroo','seahorse','birthday','baseball','computer','dinosaur','mountain','sunshine','blizzard'
  ];

  var PALETTE = ['#7c5cff', '#22d3ee', '#2ee6a6', '#f59e0b', '#ff5c7a'];

  var state = 'ready';            /* ready | running | paused | over */
  var score = 0, wave = 1, lives = 3;
  var best = GameShell.best.get(BEST_KEY, 0);
  var words = [];
  var buffer = '';
  var spawnT = 0, spawnedInWave = 0, landedInWave = 0;
  var particles = [], floaters = [];
  var badT = 0, shake = 0, freeze = 0, rescue = 0;
  var banner = '', bannerCol = '#f59e0b', bannerT = 0;
  var rafId = 0, last = 0;

  var LANES = 6;
  var FLOOR_Y = 512;              /* the defence line */
  var WAVE_SIZE = 8;

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

  function rand(n) { return Math.floor(Math.random() * n); }

  function wordPoints(n) {
    if (n <= 3) return 30;
    if (n === 4) return 60;
    if (n === 5) return 100;
    if (n === 6) return 160;
    return 250;
  }

  function fallSpeed() { return 26 + (wave - 1) * 7; }

  function spawnDelay() { return Math.max(0.65, 2.4 - (wave - 1) * 0.15); }

  function burst(x, y, col, n, spread) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var s = (spread || 60) + Math.random() * (spread || 60) * 2.6;
      var life = 0.3 + Math.random() * 0.5;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life, life0: life,
        size: 1.6 + Math.random() * 2.6,
        col: col
      });
    }
    if (particles.length > 320) particles.splice(0, particles.length - 320);
  }

  function say(msg, col) {
    banner = msg;
    bannerCol = col || '#f59e0b';
    bannerT = 1.6;
  }

  function updateHud() {
    var hearts = '';
    for (var i = 0; i < 3; i++) hearts += i < lives ? '♥' : '♡';
    GameShell.hud(
      {
        Score: score,
        Best: best,
        Wave: wave,
        Lives: hearts
      },
      state === 'paused' ? '⏸ Paused · press P to resume'
                         : 'Type the falling words · Enter = send'
    );
  }

  /* ---------------- gameplay ---------------- */

  function spawnWord() {
    /* never repeat a word that is already falling */
    var text = WORDS[rand(WORDS.length)];
    var guard = 0;
    while (guard++ < 60) {
      var clash = false;
      for (var i = 0; i < words.length; i++) {
        if (words[i].text === text) { clash = true; break; }
      }
      if (!clash) break;
      text = WORDS[rand(WORDS.length)];
    }
    var lane = rand(LANES);
    var x = W * (lane + 0.5) / LANES + (Math.random() - 0.5) * 26;
    words.push({
      text: text,
      x: clamp(x, 60, W - 60),
      y: -18,
      col: PALETTE[rand(PALETTE.length)]
    });
    spawnedInWave++;
  }

  function shatter(index) {
    var w = words[index];
    var pts = wordPoints(w.text.length) * wave;
    score += pts;
    words.splice(index, 1);
    burst(w.x, w.y, w.col, 26, 120);
    floaters.push({ x: w.x, y: w.y, txt: '+' + pts, t: 1.1, col: '#2ee6a6' });
    shake = Math.max(shake, 9);
    if (w.y > FLOOR_Y - 130) rescue = 0.45;   /* close call — the line surges up */
    buffer = '';
    badT = 0;
    updateHud();
  }

  function submit() {
    if (!buffer) return;                       /* empty send is free */
    for (var i = 0; i < words.length; i++) {
      if (words[i].text === buffer) {
        freeze = 0.14;                          /* small time freeze on a hit */
        shatter(i);
        return;
      }
    }
    score = Math.max(0, score - 25);
    buffer = '';
    badT = 0.4;
    shake = Math.max(shake, 5);
    say('No match — 25 points lost', '#ff5c7a');
    updateHud();
  }

  function typeChar(ch) {
    if (state !== 'running') return;
    buffer += ch.toLowerCase();
    var ok = false;
    for (var i = 0; i < words.length; i++) {
      if (words[i].text.indexOf(buffer) === 0) { ok = true; break; }
    }
    if (!ok) badT = 0.35;
  }

  function backspace() {
    if (state !== 'running' || !buffer) return;
    buffer = buffer.slice(0, -1);
    badT = 0;
  }

  function wordLost(index) {
    var w = words[index];
    words.splice(index, 1);
    lives--;
    landedInWave++;
    burst(w.x, FLOOR_Y, '#ff5c7a', 24, 130);
    shake = Math.max(shake, 16);
    buffer = '';
    say(w.text.toUpperCase() + ' landed!  −1 ♥', '#ff5c7a');
    if (lives <= 0) {
      lives = 0;
      updateHud();
      gameOver();
    } else {
      updateHud();
    }
  }

  /* ---------------- states ---------------- */

  function reset() {
    score = 0; wave = 1; lives = 3;
    words = [];
    buffer = '';
    spawnT = 0.5; spawnedInWave = 0; landedInWave = 0;
    particles = []; floaters = [];
    badT = 0; shake = 0; freeze = 0; rescue = 0;
    banner = ''; bannerT = 0;
  }

  function start() {
    reset();
    state = 'running';
    last = now();
    GameShell.overlay.hide();
    focusKeyboard();
    updateHud();
    ensureLoop();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The words are frozen mid-air. Press P or Esc to keep defending.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Wave', value: wave },
        { label: 'Lives', value: lives }
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
    focusKeyboard();
    updateHud();
    ensureLoop();
  }

  function gameOver() {
    if (state === 'over') return;
    state = 'over';
    buffer = '';
    var isBest = score > best;
    if (isBest) {
      best = score;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: isBest ? 'New high score!' : 'Game over',
      msg: 'The line fell on wave ' + wave + ' with ' + score +
           ' point' + (score === 1 ? '' : 's') + ' banked.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Wave', value: wave }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    var i;

    if (badT > 0) badT -= dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 55);
    if (rescue > 0) rescue = Math.max(0, rescue - dt);
    if (bannerT > 0) bannerT -= dt;

    for (i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy = p.vy * 0.96 + 80 * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (i = floaters.length - 1; i >= 0; i--) {
      var f = floaters[i];
      f.y -= 34 * dt;
      f.t -= dt;
      if (f.t <= 0) floaters.splice(i, 1);
    }

    /* spawning */
    if (spawnedInWave < WAVE_SIZE) {
      spawnT -= dt;
      if (spawnT <= 0 && words.length < 10) {
        spawnWord();
        spawnT = spawnDelay();
      }
    } else if (words.length === 0) {
      /* wave complete */
      if (landedInWave === 0) {
        score += 150;
        say('PERFECT WAVE!  +150', '#f59e0b');
      } else {
        say('Wave ' + wave + ' cleared', '#22d3ee');
      }
      wave++;
      spawnedInWave = 0;
      landedInWave = 0;
      spawnT = 0.7;
      updateHud();
    }

    /* falling */
    var speed = fallSpeed();
    for (i = words.length - 1; i >= 0; i--) {
      words[i].y += speed * dt;
      if (words[i].y >= FLOOR_Y - 12) {
        wordLost(i);
        if (state !== 'running') return;
      }
    }
  }

  /* ---------------- draw ---------------- */

  function drawWord(w) {
    var size = 24;
    ctx.font = 'bold ' + size + 'px "Segoe UI", system-ui, sans-serif';
    var matched = buffer && w.text.indexOf(buffer) === 0;

    /* prefix already typed */
    ctx.textAlign = 'left';
    if (matched) {
      var pre = ctx.measureText(buffer).width;
      ctx.save();
      ctx.shadowColor = '#2ee6a6';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#c9ffe9';
      ctx.fillText(buffer, w.x - ctx.measureText(w.text).width / 2, w.y);
      ctx.restore();
      ctx.fillStyle = '#e8eefc';
      ctx.fillText(w.text.slice(buffer.length), w.x - ctx.measureText(w.text).width / 2 + pre, w.y);
      /* thin underline marks a targetable word */
      var total = ctx.measureText(w.text).width;
      ctx.strokeStyle = 'rgba(46,230,166,.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w.x - total / 2, w.y + 7);
      ctx.lineTo(w.x - total / 2 + total, w.y + 7);
      ctx.stroke();
    } else {
      ctx.save();
      ctx.shadowColor = w.col;
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#e8eefc';
      ctx.textAlign = 'center';
      ctx.fillText(w.text.toUpperCase(), w.x, w.y);
      ctx.restore();
    }
    ctx.textAlign = 'center';
  }

  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070e';
    ctx.fillRect(0, 0, W, H);

    var g = ctx.createRadialGradient(W * 0.5, 20, 30, W * 0.5, 20, W);
    g.addColorStop(0, 'rgba(34,211,238,.12)');
    g.addColorStop(0.6, 'rgba(124,92,255,.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* faint lane guides */
    ctx.strokeStyle = 'rgba(232,238,252,.05)';
    ctx.lineWidth = 1;
    for (var l = 1; l < LANES; l++) {
      ctx.beginPath();
      ctx.moveTo(W * l / LANES, 0);
      ctx.lineTo(W * l / LANES, FLOOR_Y);
      ctx.stroke();
    }

    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    for (var i = 0; i < words.length; i++) drawWord(words[i]);

    for (i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = clamp(p.life / p.life0, 0, 1);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    for (i = 0; i < floaters.length; i++) {
      var f = floaters[i];
      ctx.globalAlpha = clamp(f.t, 0, 1);
      ctx.fillStyle = f.col;
      ctx.font = 'bold 18px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.txt, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    /* defence line — surges upward when a close word is shattered */
    var lift = rescue > 0 ? Math.sin((0.45 - rescue) / 0.45 * Math.PI) * 26 : 0;
    var lineY = FLOOR_Y - lift;
    ctx.save();
    ctx.shadowColor = lives <= 1 ? '#ff5c7a' : '#22d3ee';
    ctx.shadowBlur = 14;
    ctx.strokeStyle = lives <= 1 ? 'rgba(255,92,122,.85)' : 'rgba(34,211,238,.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(10, lineY);
    ctx.lineTo(W - 10, lineY);
    ctx.stroke();
    ctx.restore();

    /* lives beside the line */
    ctx.font = '20px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = lives <= 1 ? '#ff5c7a' : '#ff9db4';
    var hearts = '';
    for (i = 0; i < 3; i++) hearts += i < lives ? '♥' : '♡';
    ctx.fillText(hearts, W - 18, lineY - 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(232,238,252,.45)';
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('DEFENCE LINE', 18, lineY - 12);

    /* typed buffer bar */
    var bw = 400, bh = 56, bx = (W - bw) / 2, by = 528;
    var sx = badT > 0 ? Math.sin(now() / 20) * 6 * (badT / 0.4) : 0;
    ctx.save();
    ctx.translate(sx, 0);
    ctx.fillStyle = badT > 0 ? 'rgba(255,92,122,.14)' : 'rgba(232,238,252,.07)';
    rr(bx, by, bw, bh, 14);
    ctx.fill();
    ctx.strokeStyle = badT > 0 ? 'rgba(255,92,122,.8)' : 'rgba(34,211,238,.5)';
    ctx.lineWidth = 2;
    rr(bx, by, bw, bh, 14);
    ctx.stroke();

    if (buffer) {
      ctx.fillStyle = badT > 0 ? '#ffb3c2' : '#dffbff';
      ctx.font = 'bold 32px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(buffer.toUpperCase(), W / 2, by + bh / 2 + 1);
      /* caret */
      var bwid = ctx.measureText(buffer.toUpperCase()).width;
      var cx = W / 2 + bwid / 2 + 5;
      if (Math.floor(t / 400) % 2 === 0) {
        ctx.fillStyle = '#22d3ee';
        ctx.fillRect(cx, by + 14, 3, bh - 28);
      }
    } else {
      ctx.fillStyle = 'rgba(232,238,252,.45)';
      ctx.font = '18px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Start typing a falling word…', W / 2, by + bh / 2 + 1);
    }
    ctx.restore();
    ctx.textBaseline = 'alphabetic';

    /* banner */
    if (bannerT > 0 && banner) {
      ctx.globalAlpha = clamp(bannerT / 0.4, 0, 1);
      ctx.fillStyle = bannerCol;
      ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(banner, W / 2, 300);
      ctx.globalAlpha = 1;
    }

    if (state === 'paused') {
      ctx.fillStyle = 'rgba(232,238,252,.75)';
      ctx.font = 'bold 24px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, 340);
    }
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    var dt = last ? (t - last) / 1000 : 0;
    last = t;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    if (state === 'running' && freeze > 0) {
      freeze -= dt;                              /* short time freeze */
    } else if (state === 'running') {
      update(dt);
    }
    draw(t);
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- hidden input for mobile keyboards ----------------
     A tiny off-screen input keeps the soft keyboard open on touch
     devices. Its keydown events bubble to our document listener, and
     the form-field guard below excludes it by id so they are never
     swallowed. */

  var kbdInput = null;
  try {
    kbdInput = document.createElement('input');
    kbdInput.type = 'text';
    kbdInput.id = 'wf-keyboard-input';
    kbdInput.setAttribute('autocomplete', 'off');
    kbdInput.setAttribute('autocapitalize', 'off');
    kbdInput.setAttribute('aria-hidden', 'true');
    kbdInput.style.position = 'absolute';
    kbdInput.style.left = '-9999px';
    kbdInput.style.opacity = '0';
    if (canvas.parentNode) canvas.parentNode.appendChild(kbdInput);
    kbdInput.addEventListener('blur', function () {
      /* keep stealing focus back while the game is live */
      if (state === 'running') {
        try { kbdInput.focus(); } catch (e) {}
      }
    });
  } catch (e) { kbdInput = null; }

  function focusKeyboard() {
    if (kbdInput && kbdInput.focus) {
      try { kbdInput.focus(); } catch (e) {}
    }
  }

  /* ---------------- input ---------------- */

  function isForm(el) {
    var tag = el && el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  document.addEventListener('keydown', function (e) {
    var tgt = e.target;
    if (isForm(tgt) && tgt.id !== 'wf-keyboard-input') return;
    var k = e.key;

    if (k === ' ' || k === 'Enter' || k === 'Backspace') {
      if (e.preventDefault) e.preventDefault();
    }

    if (k === ' ') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
    } else if (k === 'Enter') {
      /* Enter SENDS the buffer — it must never pause this game */
      if (state === 'ready' || state === 'over') start();
      else submit();
    } else if (k === 'Backspace') {
      backspace();
    } else if (k === 'Escape') {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (k === 'p' || k === 'P') {
      /* P pauses — but never steals the letter from a targetable word */
      var pUsable = false;
      var pb = buffer + k.toLowerCase();
      for (var wi = 0; wi < words.length; wi++) {
        if (words[wi].text.indexOf(pb) === 0) { pUsable = true; break; }
      }
      if (state === 'paused') resume();
      else if (state === 'running' && pUsable) typeChar(k);
      else if (state === 'running') pause();
    } else if (k && k.length === 1 && /[a-zA-Z]/.test(k)) {
      typeChar(k);
    }

    if (tgt && tgt.id === 'wf-keyboard-input') tgt.value = '';
  });

  canvas.addEventListener('pointerdown', function () {
    if (state === 'ready' || state === 'over') { start(); return; }
    focusKeyboard();
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
    title: 'Word Fall',
    msg: 'Words rain toward the defence line. Type each word on your keyboard and press Enter to shatter it before it lands. You have three lives.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* read-only debug hook for automated tests */
  window.__wordFall = {
    get state() { return state; },
    get score() { return score; },
    get wave() { return wave; },
    get lives() { return lives; },
    get buffer() { return buffer; },
    get falling() { return words.map(function (w) { return { text: w.text, x: w.x, y: w.y }; }); },
    get spawnedInWave() { return spawnedInWave; },
    get best() { return best; },
    get wordCount() { return words.length; },
    get totalWords() { return WORDS.length; },
    get wordList() { return WORDS.slice(); }
  };

  /* shared HUD reset button */
  if (typeof GameShell.onReset === 'function') GameShell.onReset(start);
})();
