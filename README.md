# PixelPlay — free browser games portal (ad-ready)

A complete, self-contained browser-game website in the style of Y8 / Poki / CrazyGames:
a homepage with search + category filters, a catalogue of **35 original HTML5 games**
(10 shooting, 5 first-person shooters, 7 stickman, 5 word games, a block-stacking
classic and more), game pages with ads, and all the content/legal pages you need to
get approved by an ad network.

Everything is plain HTML + CSS + vanilla JavaScript. No build step, no npm, no
frameworks, no external requests (games work offline once loaded).

---

## 1. What's in the box

```
index.html                 Homepage: hero + search, category chips, game grid,
                           in-feed ad, recently-played, SEO intro text
about.html                 About us (AdSense requires this)
contact.html               Contact page with a working client-side form
privacy.html               Privacy policy (cookie/AdSense disclosures)
terms.html                 Terms of use

css/style.css              Full design system: dark neon theme, responsive,
                           cards, game stage, ad slot styling

js/games.js                Game catalogue (titles, categories, icons, stats)
js/layout.js               Shared header + footer (injected into every page)
js/main.js                 Homepage: filtering, sorting, search, recently played
js/game-page.js            Shared game shell: HUD, overlay, best scores,
                           related games, popular sidebar, category sidebar
js/ads.js                  ⭐ The advertising layer — put your ad IDs here
js/games (pages)           games/*.html + games/js/*.js = the games themselves

games/snake.html           Neon Snake            (arcade)
games/brick-blitz.html     Brick Blitz           (action / breakout)
games/memory-flip.html     Memory Flip           (puzzle)
games/merge-2048.html      Merge 2048            (casual)
games/mine-field.html      Mine Field            (puzzle / minesweeper)
games/pong-arena.html      Pong Arena            (sports)
games/tic-tac-toe.html     Tic Tac Toe           (board)

games/space-blaster.html    Space Blaster         (shooting / space)
games/asteroid-storm.html   Asteroid Storm        (shooting / space)
games/bubble-burst.html     Bubble Burst          (shooting / aim)
games/sky-defense.html      Sky Defense           (shooting / aim)
games/neon-squadron.html    Neon Squadron         (shooting / space)
games/drone-defense.html    Drone Defense         (shooting / twin-stick)
games/bullet-ballet.html    Bullet Ballet         (shooting / boss rush)
games/skeet-shot.html       Skeet Shot            (shooting / aim)
games/turret-guard.html     Turret Guard          (shooting / defense)
games/rift-raider.html      Rift Raider           (shooting / space)

games/neon-blocks.html      Neon Blocks           (puzzle / block stacker)
games/strike-zone.html      Strike Zone           (fps / raycast shooter)
games/defuse-squad.html     Defuse Squad          (fps / objective)
games/wavebreak.html        Wavebreak             (fps / wave survival)
games/scope-elite.html      Scope Elite           (fps / precision)
games/breach-point.html     Breach Point          (fps / timed breach)

games/stickman-sprint.html  Stickman Sprint       (stickman / endless runner)
games/hook-hero.html        Hook Hero             (stickman / rope swing)
games/stickman-fighter.html Stickman Fighter      (stickman / arena brawler)
games/sky-archer.html       Sky Archer            (stickman / archery)
games/stickman-climb.html   Stickman Climb        (stickman / pickaxe climber)
games/pin-escape.html       Pin Escape            (stickman / pull-the-pin)
games/stickman-rider.html   Stickman Rider        (stickman / trials bike)

games/daily-word.html       Daily Word            (word / 6-guess deduction)
games/word-hunt.html        Word Hunt             (word / letter-grid search)
games/anagram-ace.html      Anagram Ace           (word / anagram sprint)
games/word-link.html        Word Link             (word / link-the-tiles)
games/word-fall.html        Word Fall             (word / typing defence)

robots.txt                 Search-engine rules
sitemap.xml                Sitemap (replace the domain!)
ads.txt                    Ad-network verification file (replace the line!)
```

Every game is an original work written for this site — there is no copied or
scraped content, which is exactly what ad networks want to see.

---

## 2. Run it locally

Double-click `index.html`. Everything works from `file://` (all scripts are classic
scripts and no data is fetched over the network), including search and category
filters, which use normal URL query strings.

For the most accurate test (and to avoid browser restrictions on `file://`), serve
the folder over HTTP instead. Any static server works, for example:

```powershell
# Windows PowerShell, no install needed
powershell -c "$l=New-Object Net.HttpListener; $l.Prefixes.Add('http://localhost:8080/'); $l.Start(); while($l.IsListening){$c=$l.GetContext(); $p=$c.Request.Url.LocalPath; if($p -eq '/'){$p='/index.html'}; $f=Join-Path (Get-Location) ($p.TrimStart('/')); if(Test-Path $f){$b=[IO.File]::ReadAllBytes($f); $c.Response.ContentLength64=$b.Length; $c.Response.OutputStream.Write($b,0,$b.Length)} else {$c.Response.StatusCode=404}; $c.Response.Close()}"
```

Then open <http://localhost:8080/>. (Or use `npx serve`, `python -m http.server`, VS Code Live Server, etc.)

---

## 3. Deploy it (you need a real domain to earn ad money)

Ads will never be approved on a local file — you need a public site. All of these
have free tiers and work with a plain static folder:

| Host | Notes |
|---|---|
| **Cloudflare Pages** | Free, fast, custom domain, free SSL. Good default. |
| **Netlify** / **Vercel** | Drag-and-drop the folder, instant SSL. |
| **GitHub Pages** | Free; enable Pages on the repo. |
| **Any shared host / cPanel** | Upload via FTP to `public_html`. |

Steps:
1. Buy a domain (`.com` is ~$10/yr; `.xyz`/`.site` are cheaper).
2. Upload this folder so `index.html` is at the web root.
3. Turn on HTTPS (all the hosts above do it automatically).
4. Replace the placeholder domain in `robots.txt`, `sitemap.xml` and the contact
   emails (`hello@yourdomain.com`) with your real ones.

---

## 4. Turn the ads on (this is the money part)

### 4.1 Ad slots already built into the pages

| Slot key | Where it appears | Recommended size |
|---|---|---|
| `home_top` | Homepage, under the hero; also About/Contact | 728×90 leaderboard (responsive) |
| `game_top` | Game pages, above the game | 728×90 leaderboard (responsive) |
| `in_feed` | Inside the homepage game grid | responsive in-feed |
| `sidebar` | Game pages, right column | 300×250 rectangle |
| `footer_banner` | Above the footer on most pages | responsive banner |

Until you add IDs, each slot renders a neat labelled placeholder, so the layout
already looks finished.

### 4.2 Get approved by Google AdSense

1. Deploy the site on your domain (section 3).
2. Sign up at <https://adsense.google.com> with that domain.
3. Add the AdSense **verification snippet** — the easiest way here is to fill in
   your publisher ID in `js/ads.js` (below); the site then loads the AdSense script
   for you. Alternatively paste the snippet into the `<head>` of `index.html`.
4. Wait for review (usually a few days to a couple of weeks).
5. Create ad units in AdSense (**Ads → By ad unit → Display ads**) and copy each
   unit's numeric slot ID.

### 4.3 Paste your IDs into `js/ads.js`

```js
window.AD_CONFIG = {
  enabled: true,                        // ← turn ads on
  client: 'ca-pub-1234567890123456',    // ← your publisher ID
  slots: {
    home_top:      '1111111111',        // ← one ad-unit ID per slot
    game_top:      '2222222222',
    in_feed:       '3333333333',
    sidebar:       '4444444444',
    footer_banner: '5555555555'
  },
  paused: false
};
```

That is the whole integration — the script injects the `<ins class="adsbygoogle">`
blocks, pushes `adsbygoogle.push({})` for each one, and automatically falls back to
a placeholder if a network script is blocked or never fills the slot. Leave a slot
ID empty and only that slot shows a placeholder.

### 4.4 ads.txt

AdSense gives you a line to publish at `https://yourdomain.com/ads.txt`, looking like:

```
google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0
```

Open `ads.txt` in this project, uncomment that line and put in your own publisher
ID and verification code. (Serving ads.txt with real ad traffic but a wrong or
missing line can reduce your revenue.)

### 4.5 Rules you must not break (accounts get banned for these)

- **Never click your own ads.** Not once, not on any device, not on a friend's
  phone. Ad networks detect it and terminate accounts permanently.
- **Never ask or reward visitors to click ads** ("click an ad to unlock the next
  level" = instant ban). The games here are unlocked from the start; keep it that way.
- **Never place ads inside the game canvas** or anywhere a click was meant for
  gameplay. The built-in slots are all outside the play area — keep new slots that way.
- **Don't artificially inflate traffic** (bots, traffic exchanges, paid "click"
  sites). They pay little and get accounts closed.
- **Keep the legal pages accurate.** update `privacy.html` to match whatever
  analytics/tools you actually add.
- Traffic quality matters more than volume — a real, engaged audience from search
  or social is what gets paid.

### 4.6 Alternatives / additions to AdSense

- **Ezoic** — easier approval, good for low-traffic sites, adds its own ad inserts.
- **Media.net** — Yahoo/Bing network, similar to AdSense; historically needs more traffic.
- **Adsterra / PropellerAds** — accept almost any site and pay per impression, but
  rates are low and some ad creatives are aggressive/pop-up-like, which can hurt
  user trust. Use only if you understand the trade-off.
- You can also mix in **affiliate links** (mobile-game gift cards, gaming gear) in
  the About/blog content — just keep them clearly separated from the games.

### 4.7 Reality check on the money

Ad revenue ≈ visits × page views per visit × ad impressions per page × CPM ÷ 1000.
With gaming traffic a realistic CPM is often $0.5–$3 (US/EU/UK traffic pays more;
low-tier traffic much less). So:

| Monthly page views | Rough monthly revenue (at ~$1.5 CPM, 3 impressions/page) |
|---|---|
| 10,000 | ~$45 |
| 100,000 | ~$450 |
| 1,000,000 | ~$4,500 |

Nothing here is guaranteed — the number that actually matters is how many real
people come back. SEO (section 5) and social sharing are what drive that.

---

## 5. Growing traffic (what actually moves the needle)

1. **Search**: every game page already has a unique title, meta description, and
   150–380 words of real "how to play" text — that is what ranks. Add more games
   with the same depth of content rather than many thin pages.
2. **Interlinking**: the home grid, related-games row, popular sidebar and category
   sidebars all link internally on every page. Keep it that way when adding games.
3. **Speed**: no frameworks, no external fonts/CDNs — keep any new assets local.
4. **Social/Reddit/Discord**: post individual game links (not just the homepage).
5. **Keep the sitemap current** and submit it in Google Search Console.

---

## 6. Adding a new game (the pattern is consistent)

1. Add an entry to `GAMES` in `js/games.js`:
   ```js
   { id: 'my-game', title: 'My Game', cat: 'puzzle', icon: '🎲',
     c1: '#22c55e', c2: '#0ea5e9', plays: '0', playsN: 0, rating: 4.5, added: 8,
     controls: 'Click / Tap', desc: 'One-line description.',
     url: 'games/my-game.html' }
   ```
   (`cat` must be one of the ids in `CATEGORIES`.)
2. Copy `games/snake.html` (canvas game) or `games/memory-flip.html` (DOM game) and
   change: `<title>`, meta description, favicon emoji, the `data-game` attribute on
   `<body>`, the `<h1>`, the `.game-meta` pills, and the `.game-desc` text.
3. Write `games/js/my-game.js` using the shared `GameShell` API:
   ```js
   GameShell.hud({ Score: 0, Best: 0 }, 'right-hand hint');
   GameShell.overlay.show({ title, msg, stats: [{label,value}], btn: '▶ Play', action: start });
   GameShell.overlay.hide();
   GameShell.best.get('my-game', 0);  // localStorage-backed high score
   GameShell.best.set('my-game', score);
   ```
4. Keep the script order in the page: `games.js` → `layout.js` → `game-page.js` →
   `ads.js` → your game script.

The homepage, category filters, related games, sidebars and sitemap all pick the
new game up automatically.

---

## 7. Housekeeping / notes

- **Search** uses a plain `GET` form to `index.html?q=...`, so it works with or
  without a server. Category chips rewrite the query string with
  `history.replaceState` (wrapped in try/catch for `file://`).
- **Player data** (high scores, recently played) is stored in `localStorage` only —
  no accounts, no server, nothing to breach. That is also what `privacy.html` says.
- **Contact form** is client-side only: it validates and shows a success message.
  To receive real messages, point the `<form>` at a service such as Formspree,
  Web3Forms or Formspark (a comment in `contact.html` marks the spot).
- **Accessibility**: buttons have labels, the canvases have `aria-label`s, colour
  contrast is high and all games are playable with a keyboard.
- **Do not** add third-party games you did not create or license — that is the
  fastest way to lose both search rankings and your ad account.

---

## 8. Quick pre-flight checklist before you apply for ads

- [ ] Site is live on an HTTPS domain, `index.html` at the root
- [ ] Real contact email in `contact.html`, `privacy.html`, `terms.html`
- [ ] Domain replaced in `robots.txt`, `sitemap.xml` (`https://yourdomain.com/…`)
- [ ] `ads.txt` contains your network's line
- [ ] `js/ads.js` filled in (`enabled: true`, `client`, slot IDs)
- [ ] Privacy policy mentions cookies, Google AdSense and how to opt out
- [ ] You have never clicked your own ads, and never will
