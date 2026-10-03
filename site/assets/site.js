// LeakHound site: Copy buttons and the tool tabs on /install. Nothing else.
(function () {
  'use strict';

  var live = document.getElementById('copy-status');

  function announce(text) {
    if (!live) return;
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 30);
  }

  // navigator.clipboard needs a secure context and may be refused; then try a hidden textarea
  function writeClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }

  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); }
      catch (e) { reject(e); }
      finally { document.body.removeChild(area); }
    });
  }

  function textFor(button) {
    if (button.hasAttribute('data-copy')) return button.getAttribute('data-copy');
    var target = document.getElementById(button.getAttribute('data-copy-target'));
    return target ? target.textContent : '';
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-copy], [data-copy-target]');
    if (!button) return;
    var label = button.getAttribute('data-label') || button.textContent;
    button.setAttribute('data-label', label);
    writeClipboard(textFor(button)).then(function () {
      button.textContent = 'Copied';
      announce('Copied to clipboard');
    }, function () {
      button.textContent = 'Press Ctrl+C';
      announce('Could not copy automatically');
    });
    clearTimeout(button._resetTimer);
    button._resetTimer = setTimeout(function () { button.textContent = label; }, 1600);
  });

  // Tabs (WAI-ARIA tabs pattern: click, arrow keys, Home / End)
  Array.prototype.forEach.call(document.querySelectorAll('[role="tablist"]'), function (list) {
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));

    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
      if (focus) tab.focus();
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab, false); });
      tab.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
        else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === 'Home') next = tabs[0];
        else if (e.key === 'End') next = tabs[tabs.length - 1];
        if (next) { e.preventDefault(); select(next, true); }
      });
    });
  });
})();
