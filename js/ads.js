/* ============================================================
   PixelPlay — advertising layer
   ------------------------------------------------------------
   HOW TO TURN ADS ON (full guide in README.md):

   1. Get approved by an ad network (Google AdSense is the usual
      choice for a site like this).
   2. Fill in `client` + the slot IDs below.
   3. Set `enabled: true`.
   4. Upload the network's ads.txt to the root of your domain.

   While the config is empty, every slot renders a tidy labelled
   placeholder so the layout still looks finished.
   ============================================================ */

window.AD_CONFIG = {
  enabled: false,

  /* Google AdSense publisher ID, e.g. 'ca-pub-1234567890123456' */
  client: '',

  /* One ad unit ID per placement (AdSense → Ads → By ad unit) */
  slots: {
    home_top: '',      /* leaderboard on the homepage, under the hero   */
    game_top: '',      /* leaderboard above the game stage              */
    in_feed: '',       /* inside the homepage game grid                 */
    sidebar: '',       /* 300x250 rectangle on game pages               */
    footer_banner: ''  /* banner above the footer                       */
  },

  /* Optional: pause ads without deleting the config (e.g. while testing) */
  paused: false
};

(function () {
  'use strict';

  var LABELS = {
    home_top:      ['Advertisement', 'Leaderboard · 728×90 · slot: home_top'],
    game_top:      ['Advertisement', 'Leaderboard · 728×90 · slot: game_top'],
    in_feed:       ['Advertisement', 'In-feed · slot: in_feed'],
    sidebar:       ['Advertisement', 'Rectangle · 300×250 · slot: sidebar'],
    footer_banner: ['Advertisement', 'Banner · slot: footer_banner']
  };

  var scriptLoaded = false;
  var fallbackScheduled = false;

  function loadAdScript() {
    if (scriptLoaded || !window.AD_CONFIG.client) return;
    scriptLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' +
            window.AD_CONFIG.client;
    document.head.appendChild(s);
  }

  function renderPlaceholder(el, key) {
    var meta = LABELS[key] || ['Advertisement', 'Ad slot: ' + key];
    el.innerHTML =
      '<span class="ad-tag">' + meta[0] + '</span>' +
      '<span class="ad-hint">' + meta[1] + '</span>';
    el.setAttribute('data-placeholder', 'true');
  }

  function renderLive(el, key) {
    var slotId = window.AD_CONFIG.slots[key];
    if (!slotId) { renderPlaceholder(el, key); return; }

    el.removeAttribute('data-placeholder');
    var ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.style.width = '100%';
    ins.setAttribute('data-ad-client', window.AD_CONFIG.client);
    ins.setAttribute('data-ad-slot', slotId);
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    el.appendChild(ins);

    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (err) {
      renderPlaceholder(el, key);
    }
  }

  function init() {
    var slots = document.querySelectorAll('[data-ad]');
    if (!slots.length) return;

    var live = window.AD_CONFIG.enabled === true &&
               !!window.AD_CONFIG.client &&
               window.AD_CONFIG.paused !== true;

    if (live) loadAdScript();

    for (var i = 0; i < slots.length; i++) {
      var el = slots[i];
      if (el.getAttribute('data-processed') === '1') continue;
      el.setAttribute('data-processed', '1');
      var key = el.getAttribute('data-ad');
      if (live) { renderLive(el, key); } else { renderPlaceholder(el, key); }
    }

    /* Safety net: if the network script never arrives (blocked, not yet
       approved, offline), fall back to a placeholder so no empty box
       is left behind. */
    if (live && !fallbackScheduled) {
      fallbackScheduled = true;
      setTimeout(function () {
        var pending = document.querySelectorAll('[data-ad] ins.adsbygoogle');
        for (var j = 0; j < pending.length; j++) {
          var box = pending[j];
          if (!box.offsetHeight && box.parentNode) {
            var key = box.parentNode.getAttribute('data-ad');
            box.parentNode.innerHTML = '';
            box.parentNode.setAttribute('data-processed', '0');
            renderPlaceholder(box.parentNode, key);
            box.parentNode.setAttribute('data-processed', '1');
          }
        }
      }, 6000);
    }
  }

  /* Called again by main.js after the game grid re-renders. */
  window.PixelPlayAds = { refresh: init };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
