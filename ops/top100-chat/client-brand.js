(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var top100ObjectUrl = safeUrl(params.get('top100ObjectUrl') || params.get('shareUrl'));
  var top100ObjectType = safeText(params.get('top100ObjectType') || 'post', 40) || 'post';
  var top100ObjectTitle = safeText(params.get('top100ObjectTitle') || params.get('shareTitle') || 'Top 100 post', 180);
  var composeRequested = params.get('compose') === '1';
  var networkPatched = false;
  var composerOpened = false;

  function safeText(value, max) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  }

  function safeUrl(value) {
    var raw = safeText(value, 500);
    if (!raw) return '';
    try {
      var parsed = new URL(raw);
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'smtop100.blog') return '';
      return parsed.toString();
    } catch (e) {
      return '';
    }
  }

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

  function installContextPanel() {
    if (!top100ObjectUrl || document.getElementById('idTop100ContextPanel')) return;
    var container = document.querySelector('.divChatContainer');
    if (!container || !container.parentNode) return;

    var panel = document.createElement('section');
    panel.id = 'idTop100ContextPanel';
    panel.className = 'top100-context-panel';
    panel.innerHTML =
      '<p class="top100-context-eyebrow">Top 100 discussion</p>' +
      '<h1 class="top100-context-title"></h1>' +
      '<p class="top100-context-copy">Start a conversation about this ' + top100ObjectType + '. The discussion stays linked to the source.</p>' +
      '<a class="top100-context-link" target="_blank" rel="noopener noreferrer">View source on smtop100.blog ↗</a>';
    panel.querySelector('.top100-context-title').textContent = top100ObjectTitle;
    panel.querySelector('.top100-context-link').href = top100ObjectUrl;
    container.parentNode.insertBefore(panel, container);
  }

  function patchNetwork() {
    if (!top100ObjectUrl || networkPatched || !window.globals || !globals.myRssNetwork) return;
    var originalNewPost = globals.myRssNetwork.newPost.bind(globals.myRssNetwork);
    globals.myRssNetwork.newPost = function (postRec, callback) {
      if (postRec && postRec.top100ObjectUrl === undefined && postRec.inReplyTo === undefined) {
        postRec.top100ObjectUrl = top100ObjectUrl;
        postRec.top100ObjectType = top100ObjectType;
        postRec.top100ObjectTitle = top100ObjectTitle;
      }
      return originalNewPost(postRec, callback);
    };
    networkPatched = true;
  }

  function openComposer() {
    if (!composeRequested || composerOpened || !window.globals || !globals.myChatUserInterface || !globals.myRssNetwork) return;
    if (!globals.myRssNetwork.userIsSignedIn()) return;
    globals.myChatUserInterface.editNewItem();
    composerOpened = true;
  }

  function decorateBoundPosts() {
    if (!window.jQuery) return;
    window.jQuery('.divThread').each(function () {
      var thread = window.jQuery(this);
      var item = thread.data('item');
      if (!item || !item.top100ObjectUrl || thread.find('.top100-object-card').length) return;

      var body = thread.find('.divTweetBody').first();
      if (!body.length) return;

      var card = document.createElement('div');
      card.className = 'top100-object-card';

      var label = document.createElement('strong');
      label.textContent = 'Linked to Top 100';

      var title = document.createElement('span');
      title.textContent = item.top100ObjectTitle || 'Top 100 post';

      var link = document.createElement('a');
      link.href = item.top100ObjectUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'View source ↗';

      card.append(label, title, link);

      var actions = body.find('.divTweetActions').first();
      if (actions.length) actions.before(card);
      else body.append(card);
    });
  }

  function tick() {
    rewriteMenus();
    installContextPanel();
    patchNetwork();
    openComposer();
    decorateBoundPosts();
  }

  function boot() {
    installLogout();
    tick();
    var attempts = 0;
    var timer = setInterval(function () {
      attempts += 1;
      tick();
      if (attempts >= 240) clearInterval(timer);
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
