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
  var sourceContextDismissed = false;
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

  function rewriteUserDisplayName() {
    var username = document.getElementById('idUsername');
    if (!username || typeof window.appPrefs !== 'object' || !window.appPrefs) return;

    var displayName = safeText(window.appPrefs.myFeedTitle, 120);
    if (displayName && username.textContent !== displayName) {
      username.textContent = displayName;
      username.title = 'Top 100 manager';
    }
  }

  function rewriteMenus() {
    var product = document.querySelector('.divMenuProductName');
    if (product && product.textContent !== 'Top 100') product.textContent = 'Top 100';

    document.title = 'Top 100 Chat';

    var docs = document.querySelector('#idDocsMenu > a');
    if (docs && !docs.dataset.top100Branded) {
      docs.dataset.top100Branded = 'true';
      docs.innerHTML = 'Top 100&nbsp;<b class="caret"></b>';
    }

    var docsMenu = document.querySelector('#idDocsMenu .dropdown-menu');
    if (docsMenu && !docsMenu.dataset.top100Branded) {
      docsMenu.dataset.top100Branded = 'true';
      docsMenu.innerHTML = [
        '<li><a href="https://smtop100.blog/">Top 100 website</a></li>',
        '<li><a href="https://manager.smtop100.blog/">My Matches</a></li>',
        '<li><a href="https://tournaments.smtop100.blog/">Tournaments</a></li>',
        '<li><a href="https://rules.smtop100.blog/">Rules</a></li>',
        '<li class="divider"></li>',
        '<li><a href="#" id="idTop100Notifications">Enable notifications</a></li>'
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

  function showTop100Toast(message) {
    var old = document.querySelector('.top100-share-toast');
    if (old) old.remove();
    var toast = document.createElement('div');
    toast.className = 'top100-share-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(function () {
      if (toast.parentNode) toast.remove();
    }, 5000);
  }

  function urlBase64ToUint8Array(value) {
    var padding = '='.repeat((4 - value.length % 4) % 4);
    var base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = window.atob(base64);
    return Uint8Array.from(raw, function (char) { return char.charCodeAt(0); });
  }

  async function getPushSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return null;
    var registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
  }

  async function refreshNotificationMenu() {
    var link = document.getElementById('idTop100Notifications');
    if (!link) return;

    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      link.textContent = 'Notifications unavailable';
      link.dataset.disabled = 'true';
      return;
    }

    if (Notification.permission === 'denied') {
      link.textContent = 'Notifications blocked';
      link.dataset.disabled = 'true';
      return;
    }

    try {
      var subscription = await getPushSubscription();
      link.textContent = subscription ? 'Disable notifications' : 'Enable notifications';
      link.dataset.disabled = 'false';
    } catch (e) {
      link.textContent = 'Enable notifications';
      link.dataset.disabled = 'false';
    }
  }

  async function toggleNotifications(event) {
    if (event) event.preventDefault();
    var link = document.getElementById('idTop100Notifications');
    if (!link || link.dataset.disabled === 'true') return;

    try {
      var registration = await navigator.serviceWorker.ready;
      var existing = await registration.pushManager.getSubscription();

      if (existing) {
        await fetch('/push/subscribe', {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: existing.endpoint })
        });
        await existing.unsubscribe();
        showTop100Toast('Reply notifications are off on this device.');
        await refreshNotificationMenu();
        return;
      }

      var permission = Notification.permission;
      if (permission !== 'granted') permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        showTop100Toast(permission === 'denied' ? 'Notifications are blocked in your browser settings.' : 'Notifications were not enabled.');
        await refreshNotificationMenu();
        return;
      }

      var configResponse = await fetch('/push/config', { credentials: 'same-origin', cache: 'no-store' });
      if (!configResponse.ok) throw new Error('Could not load notification settings.');
      var config = await configResponse.json();
      if (!config.enabled || !config.vapidPublicKey) throw new Error('Notifications are not configured on the server.');

      var subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey)
      });

      var saveResponse = await fetch('/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() })
      });
      if (!saveResponse.ok) {
        await subscription.unsubscribe();
        throw new Error('Could not save this device for notifications.');
      }

      showTop100Toast('Reply notifications are on for this device.');
      await refreshNotificationMenu();
    } catch (error) {
      showTop100Toast(error && error.message ? error.message : 'Could not change notification settings.');
      await refreshNotificationMenu();
    }
  }

  function wireNotificationMenu() {
    var link = document.getElementById('idTop100Notifications');
    if (!link || link.dataset.top100NotificationsWired) return;
    link.dataset.top100NotificationsWired = 'true';
    link.addEventListener('click', toggleNotifications);
    refreshNotificationMenu();
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
    if (!top100ObjectUrl || sourceContextDismissed || document.getElementById('idTop100ContextPanel')) return;
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

  function removeContextPanel() {
    var panel = document.getElementById('idTop100ContextPanel');
    if (panel) panel.remove();
  }

  function restoreNetworkBinding(removeContext) {
    if (networkPatched && originalNewPost && window.globals && globals.myRssNetwork) {
      globals.myRssNetwork.newPost = originalNewPost;
    }
    networkPatched = false;
    sourceBindingAvailable = false;
    originalNewPost = null;
    sourceComposerActive = false;
    if (removeContext) {
      sourceContextDismissed = true;
      removeContextPanel();
    }
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
        return callOriginal(postRec, function () {
          var args = arguments;
          var err = args[0];

          if (!err) {
            restoreNetworkBinding(false);
          }

          if (typeof callback === 'function') {
            return callback.apply(null, args);
          }
        });
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
      restoreNetworkBinding(true);
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
    rewriteUserDisplayName();
    wireNotificationMenu();
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
      rewriteUserDisplayName();
      wireNotificationMenu();
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
