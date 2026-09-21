(function () {
  'use strict';

  var SHARE_KEY = 'top100ChatShareIntent';

  function safeText(value, max) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  }

  function captureShareIntentFromLocation() {
    var params = new URLSearchParams(location.search);
    if (params.get('compose') !== '1') return;
    var title = safeText(params.get('shareTitle'), 180);
    var url = safeText(params.get('shareUrl'), 500);
    if (!url) return;
    try {
      sessionStorage.setItem(SHARE_KEY, JSON.stringify({ title: title, url: url }));
    } catch (e) {}
  }

  captureShareIntentFromLocation();

  function top100Logout () {
    try { localStorage.removeItem('rssNetworkMemory'); } catch (e) {}
    location.href = '/auth/logout';
  }

  function rewriteMenus() {
    var product = document.querySelector('.divMenuProductName');
    if (product) product.textContent = 'Top 100';

    document.title = 'Top 100 Chat';

    var docs = document.querySelector('#idDocsMenu > a');
    if (docs) docs.innerHTML = 'Top 100&nbsp;<b class="caret"></b>';

    var docsMenu = document.querySelector('#idDocsMenu .dropdown-menu');
    if (docsMenu) {
      docsMenu.innerHTML = [
        '<li><a href="https://smtop100.blog/">Top 100 website</a></li>',
        '<li><a href="https://manager.smtop100.blog/">My Matches</a></li>',
        '<li><a href="https://tournaments.smtop100.blog/">Tournaments</a></li>',
        '<li><a href="https://rules.smtop100.blog/">Rules</a></li>'
      ].join('');
    }

    var nav = document.querySelector('.navbar .nav');
    if (nav && !document.querySelector('.top100-chat-nav-link')) {
      var li = document.createElement('li');
      li.className = 'top100-chat-nav-link top100-chat-nav-primary';
      li.innerHTML = '<a href="https://manager.smtop100.blog/">My Matches</a>';
      nav.appendChild(li);
    }
  }

  function installLogout() {
    window.signOutCommand = function () {
      if (typeof confirmDialog === 'function') {
        confirmDialog('OK to sign out?', top100Logout);
      } else if (window.confirm('OK to sign out?')) {
        top100Logout();
      }
    };

    var attempts = 0;
    var timer = setInterval(function () {
      attempts += 1;
      if (window.globals && globals.myRssNetwork) {
        globals.myRssNetwork.signOut = top100Logout;
        clearInterval(timer);
      } else if (attempts >= 200) {
        clearInterval(timer);
      }
    }, 50);
  }

  function showToast(message) {
    var old = document.querySelector('.top100-share-toast');
    if (old) old.remove();
    var toast = document.createElement('div');
    toast.className = 'top100-share-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 4500);
  }

  function openShareComposer() {
    var raw = '';
    try {
      raw = sessionStorage.getItem(SHARE_KEY) || '';
    } catch (e) {}
    if (!raw) return;

    var intent;
    try { intent = JSON.parse(raw); } catch (e) { return; }
    if (!intent || !intent.url) return;

    var attempts = 0;
    var timer = setInterval(function () {
      attempts += 1;
      if (typeof window.newPostCommand === 'function') {
        try { window.newPostCommand(); } catch (e) {}
      }

      var composer = document.querySelector('.divChat .inputComposer');
      if (composer) {
        var text = intent.title ? intent.title + '\n\n' + intent.url : intent.url;
        composer.textContent = text;
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        composer.focus();
        try { sessionStorage.removeItem(SHARE_KEY); } catch (e) {}
        clearInterval(timer);
        showToast('Ready to discuss this Top 100 page — edit the post if you want, then send it.');
      } else if (attempts >= 160) {
        clearInterval(timer);
      }
    }, 75);
  }

  function boot() {
    rewriteMenus();
    installLogout();
    openShareComposer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
