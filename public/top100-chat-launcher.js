// Top 100 Chat launcher: a floating "Chat" button on every Top 100 page. The same file is
// served by the blog, Stats & History and the tournaments apps; keep the copies identical.
// The button opens the Manager Portal's chat page, which signs managers in and hands them
// to chat.smtop100.blog.
(function () {
  var CHAT_URL = 'https://manager.smtop100.blog/chat';
  if (typeof document === 'undefined' || window.__top100ChatLauncher) return;
  window.__top100ChatLauncher = true;
  // Not on the chat page itself.
  if (location.hostname === 'chat.smtop100.blog' || /^\/(?:manager\/)?chat\/?$/.test(location.pathname)) return;

  var css = [
    '.top100-chat-launcher{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:2147483000;',
    'display:inline-flex;align-items:center;gap:8px;padding:12px 18px;border-radius:999px;background:#10B981;color:#0B1F3B;',
    'font:800 15px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-decoration:none;',
    'box-shadow:0 8px 24px rgba(0,0,0,.35);border:2px solid rgba(255,255,255,.18);transition:transform .15s ease,background .15s ease}',
    '.top100-chat-launcher:hover,.top100-chat-launcher:focus-visible{background:#34D399;color:#0B1F3B;transform:translateY(-2px);text-decoration:none}',
    '.top100-chat-launcher:focus-visible{outline:3px solid #fff;outline-offset:2px}',
    '.top100-chat-launcher span[aria-hidden]{font-size:18px}',
    '@media (max-width:600px){.top100-chat-launcher{padding:11px 15px;font-size:14px}}',
    '@media print{.top100-chat-launcher{display:none}}'
  ].join('');

  function mount() {
    if (document.querySelector('.top100-chat-launcher')) return;
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    var link = document.createElement('a');
    link.className = 'top100-chat-launcher';
    link.href = CHAT_URL;
    link.setAttribute('aria-label', 'Open Top 100 Chat');
    link.innerHTML = '<span aria-hidden="true">\uD83D\uDCAC</span><span>Chat</span>';
    document.body.appendChild(link);
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
