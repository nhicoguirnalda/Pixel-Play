/* ============================================================
   PixelPlay — homepage logic
   Category chips, search, sorting, recently played.
   ============================================================ */

(function () {
  'use strict';

  var grid = document.getElementById('gameGrid');
  if (!grid) return;

  var chipsRow   = document.getElementById('categoryChips');
  var gridTitle  = document.getElementById('gridTitle');
  var gridCount  = document.getElementById('gridCount');
  var recentSec  = document.getElementById('recentSection');
  var recentGrid = document.getElementById('recentGrid');
  var root       = siteRoot();

  var params;
  try { params = new URLSearchParams(window.location.search); }
  catch (e) { params = { get: function () { return null; } }; }

  var state = {
    q:    (params.get('q') || '').trim().toLowerCase(),
    cat:  params.get('cat') || 'all',
    sort: params.get('sort') || 'featured'
  };

  function matches(g) {
    if (state.cat !== 'all' && g.cat !== state.cat) return false;
    if (state.q) {
      var hay = (g.title + ' ' + g.desc + ' ' + categoryLabel(g.cat) + ' ' + g.controls).toLowerCase();
      if (hay.indexOf(state.q) === -1) return false;
    }
    return true;
  }

  function sorted(list) {
    var out = list.slice();
    if (state.sort === 'popular') {
      out.sort(function (a, b) { return b.playsN - a.playsN; });
    } else if (state.sort === 'new') {
      out.sort(function (a, b) { return b.added - a.added; });
    }
    return out;
  }

  function renderChips() {
    if (!chipsRow) return;
    var html = '';
    for (var i = 0; i < CATEGORIES.length; i++) {
      var c = CATEGORIES[i];
      html += '<button type="button" class="chip' + (state.cat === c.id ? ' active' : '') +
              '" data-cat="' + c.id + '">' + c.icon + ' ' + c.label + '</button>';
    }
    chipsRow.innerHTML = html;
  }

  function renderGrid() {
    var list = sorted(GAMES.filter(matches));
    var html = '';

    for (var i = 0; i < list.length; i++) {
      html += gameCardHTML(list[i], root);
      if (i === 5 && list.length > 6) {
        html += '<div class="ad-slot ad-infeed" data-ad="in_feed"></div>';
      }
    }

    if (!list.length) {
      html = '<div class="empty-state">No games found' +
             (state.q ? ' for <b>' + state.q.replace(/[<>&]/g, '') + '</b>' : '') +
             '. Try a different search or pick another category.</div>';
    }

    grid.innerHTML = html;

    if (gridTitle) {
      var t = 'Featured Games';
      if (state.q) t = 'Results for “' + state.q + '”';
      else if (state.cat !== 'all') {
        var lbl = categoryLabel(state.cat);
        t = /Games$/i.test(lbl) ? lbl : lbl + ' Games';
      }
      else if (state.sort === 'popular') t = 'Most Popular Games';
      else if (state.sort === 'new') t = 'New Games';
      gridTitle.textContent = t;
    }

    if (gridCount) {
      gridCount.textContent = list.length + (list.length === 1 ? ' game' : ' games');
    }

    if (window.PixelPlayAds) window.PixelPlayAds.refresh();
  }

  function renderRecent() {
    if (!recentSec || !recentGrid) return;
    var ids = RecentStore.list();
    var games = [];
    for (var i = 0; i < ids.length; i++) {
      var g = getGame(ids[i]);
      if (g) games.push(g);
    }
    if (!games.length) { recentSec.style.display = 'none'; return; }
    recentSec.style.display = '';
    var html = '';
    for (var j = 0; j < games.length && j < 8; j++) html += gameCardHTML(games[j], root);
    recentGrid.innerHTML = html;
  }

  function syncNav() {
    var key = state.sort === 'popular' ? 'popular'
            : state.sort === 'new' ? 'new'
            : (document.body.getAttribute('data-nav') || 'home');
    var links = document.querySelectorAll('#mainNav a');
    for (var i = 0; i < links.length; i++) {
      links[i].classList.toggle('active', links[i].getAttribute('data-nav') === key);
    }
  }

  function syncUrl() {
    try {
      var qs = [];
      if (state.q) qs.push('q=' + encodeURIComponent(state.q));
      if (state.cat !== 'all') qs.push('cat=' + encodeURIComponent(state.cat));
      if (state.sort !== 'featured') qs.push('sort=' + encodeURIComponent(state.sort));
      var url = location.pathname + (qs.length ? '?' + qs.join('&') : '');
      history.replaceState(null, '', url);
    } catch (e) { /* file:// in some browsers blocks this — non-critical */ }
  }

  function prefillSearch() {
    var inputs = document.querySelectorAll('.header-search input[name="q"], .hero-search input[name="q"]');
    for (var i = 0; i < inputs.length; i++) inputs[i].value = state.q ? unescape(state.q) : '';
  }

  if (chipsRow) {
    chipsRow.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('.chip') : null;
      if (!btn) return;
      state.cat = btn.getAttribute('data-cat');
      renderChips();
      renderGrid();
      syncUrl();
      var head = document.getElementById('games');
      if (head && window.scrollY > head.offsetTop + 200) {
        head.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  renderChips();
  renderGrid();
  renderRecent();
  syncNav();
  prefillSearch();
})();
