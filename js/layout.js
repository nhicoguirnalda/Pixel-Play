/* ============================================================
   PixelPlay — shared header & footer injector
   Keeps one source of truth for navigation across all pages.
   ============================================================ */

(function () {
  var root = document.body.getAttribute('data-root') || '';
  var nav = document.body.getAttribute('data-nav') || '';

  var navItems = [
    { key: 'home',    label: 'Home',        href: root + 'index.html' },
    { key: 'popular', label: 'Popular',     href: root + 'index.html?sort=popular' },
    { key: 'new',     label: 'New Games',   href: root + 'index.html?sort=new' },
    { key: 'about',   label: 'About',       href: root + 'about.html' },
    { key: 'contact', label: 'Contact',     href: root + 'contact.html' }
  ];

  function navHTML() {
    var out = '';
    for (var i = 0; i < navItems.length; i++) {
      var it = navItems[i];
      out += '<a href="' + it.href + '" data-nav="' + it.key + '"' +
             (nav === it.key ? ' class="active"' : '') + '>' + it.label + '</a>';
    }
    return out;
  }

  var header = document.getElementById('site-header');
  if (header) {
    header.className = 'site-header';
    header.innerHTML =
      '<div class="container header-inner">' +
        '<a class="logo" href="' + root + 'index.html">' +
          '<span class="logo-mark">🎮</span>Pixel<b style="color:inherit">Play</b>' +
        '</a>' +
        '<button class="menu-btn" type="button" aria-label="Toggle menu" aria-expanded="false">☰ Menu</button>' +
        '<nav class="nav-links" id="mainNav">' + navHTML() + '</nav>' +
        '<form class="header-search" action="' + root + 'index.html" method="get">' +
          '<input type="search" name="q" placeholder="Search games..." aria-label="Search games" value="">' +
          '<button type="submit" aria-label="Search">🔍</button>' +
        '</form>' +
      '</div>';

    var menuBtn = header.querySelector('.menu-btn');
    var mainNav = header.querySelector('#mainNav');
    if (menuBtn && mainNav) {
      menuBtn.addEventListener('click', function () {
        var open = mainNav.classList.toggle('open');
        menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
  }

  var footer = document.getElementById('site-footer');
  if (footer) {
    footer.className = 'site-footer';
    footer.innerHTML =
      '<div class="container">' +
        '<div class="footer-grid">' +
          '<div class="footer-brand">' +
            '<a class="logo" href="' + root + 'index.html">' +
              '<span class="logo-mark">🎮</span><span>PixelPlay</span>' +
            '</a>' +
            '<p>Free browser games you can play instantly — no downloads, no installs, no account needed. New games added regularly.</p>' +
          '</div>' +
          '<div>' +
            '<h2>Games</h2>' +
            '<a href="' + root + 'index.html?cat=arcade">Arcade</a>' +
            '<a href="' + root + 'index.html?cat=puzzle">Puzzle</a>' +
            '<a href="' + root + 'index.html?cat=action">Action</a>' +
            '<a href="' + root + 'index.html?cat=sports">Sports</a>' +
            '<a href="' + root + 'index.html?cat=shooter">Shooting</a>' +
            '<a href="' + root + 'index.html?cat=fps">FPS</a>' +
            '<a href="' + root + 'index.html?cat=stickman">Stickman</a>' +
            '<a href="' + root + 'index.html?cat=word">Word Games</a>' +
          '</div>' +
          '<div>' +
            '<h2>Company</h2>' +
            '<a href="' + root + 'about.html">About Us</a>' +
            '<a href="' + root + 'contact.html">Contact</a>' +
            '<a href="' + root + 'index.html?sort=new">New Games</a>' +
          '</div>' +
          '<div>' +
            '<h2>Legal</h2>' +
            '<a href="' + root + 'privacy.html">Privacy Policy</a>' +
            '<a href="' + root + 'terms.html">Terms of Use</a>' +
            '<a href="' + root + 'index.html#ads">Advertising</a>' +
          '</div>' +
        '</div>' +
        '<div class="footer-bottom">' +
          '<span>© 2026 PixelPlay. All rights reserved.</span>' +
          '<span>Made for players, everywhere 🌍</span>' +
        '</div>' +
        '<p class="footer-disclaimer">PixelPlay is an independent browser-game portal. It is not affiliated with, endorsed by or sponsored by Y8 or any other game portal. All games on this site are original titles built in-house. This site uses cookies for advertising and analytics purposes — see our <a href="' + root + 'privacy.html">Privacy Policy</a>.</p>' +
      '</div>';
  }
})();
