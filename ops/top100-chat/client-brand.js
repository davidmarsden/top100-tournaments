(function () {
  'use strict';

  var OBJECT_INTENT_KEY = 'top100ChatObjectIntent';
  var params = new URLSearchParams(location.search);
  var storedIntent = readStoredIntent();
  var top100ObjectUrl = safeUrl((storedIntent && storedIntent.url) || params.get('top100ObjectUrl') || params.get('shareUrl'));
  var top100ObjectType = normalizeObjectType((storedIntent && storedIntent.type) || params.get('top100ObjectType') || 'post');
  var top100ObjectTitle = safeText((storedIntent && storedIntent.title) || params.get('top100ObjectTitle') || params.get('shareTitle') || 'Top 100 post', 180);
  var composeRequested = Boolean((storedIntent && storedIntent.compose) || params.get('compose') === '1');

  var networkPatched = false;
  var sourceBindingAvailable = Boolean(top100ObjectUrl && composeRequested);
  var originalNewPost = null;
  var sourceComposerActive = false;
  var sourceComposerSeenVisible = false;
  var composerOpened = false;

  try { sessionStorage.removeItem(OBJECT_INTENT_KEY); } catch (e) {}

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

  function normalizeObjectType(value) {
    var clean = safeText(value, 40).toLowerCase();
    return clean === 'page' ? 'page' : 'post';
  }

  function readStoredIntent() {
    try {
      var raw = sessionStorage.getItem(OBJECT_INTENT_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
      return null;
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

    var eyebrow = document.createElement('p');
    eyebrow.className = 'top100-context-eyebrow';
    eyebrow.textContent = 'Top 100 discussion';

    var title = document.createElement('h1');
    title.className = 'top100-context-title';
    title.textContent = top100ObjectTitle;

    var copy = document.createElement('p');
    copy.className = 'top100-context-copy';
    copy.append('Start a conversation about this ', document.createTextNode(top100ObjectType), '. The discussion stays linked to the source.');

    var link = document.createElement('a');
    link.className = 'top100-context-link';
    link.href = top100ObjectUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'View source on smtop100.blog ↗';

    panel.append(eyebrow, title, copy, link);
    container.parentNode.insertBefore(panel, container);
  }

  function restoreNetworkBinding() {
    if (networkPatched && originalNewPost && window.globals && globals.myRssNetwork) {
      globals.myRssNetwork.newPost = originalNewPost;
    }
    networkPatched = false;
    sourceBindingAvailable = false;
    originalNewPost = null;
    sourceComposerActive = false;
  }

  function patchNetwork() {
    if (!sourceBindingAvailable || networkPatched || !window.globals || !globals.myRssNetwork) return;

    originalNewPost = globals.myRssNetwork.newPost.bind(globals.myRssNetwork);
    globals.myRssNetwork.newPost = function (postRec, callback) {
      var shouldBind = Boolean(
        sourceComposerActive &&
        postRec &&
        postRec.top100ObjectUrl === undefined &&
        postRec.inReplyTo === undefined
      );

      if (shouldBind) {
        postRec.top100ObjectUrl = top100ObjectUrl;
        postRec.top100ObjectType = top100ObjectType;
        postRec.top100ObjectTitle = top100ObjectTitle;
        var callOriginal = originalNewPost;
        restoreNetworkBinding();
        return callOriginal(postRec, callback);
      }

      return originalNewPost(postRec, callback);
    };
    networkPatched = true;
  }

  function openComposer() {
    if (!composeRequested || composerOpened || !window.globals || !globals.myChatUserInterface || !globals.myRssNetwork) return;
    if (!globals.myRssNetwork.userIsSignedIn()) return;

    patchNetwork();
    globals.myChatUserInterface.editNewItem();
    composerOpened = true;
    sourceComposerActive = true;
    sourceComposerSeenVisible = false;
  }

  function monitorSourceComposer() {
    if (!sourceComposerActive) return;
    var overlay = document.querySelector('.divReplyOverlay');
    if (!overlay) return;

    var visible = window.getComputedStyle(overlay).display !== 'none';
    if (visible) {
      sourceComposerSeenVisible = true;
      return;
    }

    if (sourceComposerSeenVisible) {
      restoreNetworkBinding();
    }
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
      link.href = safeUrl(item.top100ObjectUrl) || '#';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'View source ↗';

      card.append(label, title, link);

      var actions = body.find('.divTweetActions').first();
      if (actions.length) actions.before(card);
      else body.append(card);
    });
  }

  function refreshUi() {
    rewriteMenus();
    installContextPanel();
    monitorSourceComposer();
    decorateBoundPosts();
  }

  function installDomObserver() {
    if (!document.body || typeof MutationObserver !== 'function') return;

    var scheduled = false;
    var observer = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(function () {
        scheduled = false;
        refreshUi();
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });
  }

  function boot() {
    installLogout();
    installDomObserver();
    refreshUi();

    var attempts = 0;
    var startupTimer = setInterval(function () {
      attempts += 1;
      rewriteMenus();
      installContextPanel();
      patchNetwork();
      openComposer();
      monitorSourceComposer();
      decorateBoundPosts();

      var ready = Boolean(
        window.globals &&
        globals.myRssNetwork &&
        globals.myChatUserInterface &&
        (!composeRequested || composerOpened)
      );

      if (ready || attempts >= 240) {
        clearInterval(startupTimer);
      }
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
