/*
 * Startup guard: the standalone /recover.html page only helps when something
 * can still run JavaScript — but the classic broken-deploy case is a cached
 * index.html referencing a hashed bundle the server no longer has. The module
 * script then fails before React mounts, no error boundary renders, and the
 * user is stuck on a blank page with no way to discover the recovery page.
 *
 * This plain (non-module) script is self-hosted, so the CSP allows it, and it
 * boots before the bundle. If the app fails to mount, it forwards to
 * /recover.html. The first forward per tab session asks the recovery page to
 * repair automatically (`auto=1`); every later forward tells it to stay put and
 * show its UI (`auto=0`). Without that handoff a genuinely broken deploy would
 * ping-pong between blank page and auto-repair, wipe the local preferences on
 * every round, and never show the user a working button.
 */
(() => {
  'use strict';

  var FLAG = 'keeplocal-guard-redirected';
  // Evidence-based failures can redirect quickly; the "nothing mounted" net
  // must wait long enough that a slow device/network is not mistaken for a
  // dead bundle.
  var MOUNT_CHECK_DELAY_FAST = 4000;
  var MOUNT_CHECK_DELAY_SLOW = 15000;
  // Pure double-fire safety (both error listeners could schedule in the same
  // page life). A repeat attempt is NOT suppressed any longer: it forwards to
  // the recovery page with auto=0, which shows its UI and waits for a click
  // instead of bouncing back — that is what ends the chain. Suppressing the
  // redirect instead would strand the user on a blank page.
  var LOOP_GUARD_MS = 2000;

  function appMounted() {
    var root = document.getElementById('root');
    return Boolean(root && root.childElementCount > 0);
  }

  function previousRedirectAt() {
    try {
      var stamp = Number(window.sessionStorage.getItem(FLAG));
      return Number.isFinite(stamp) && stamp > 0 ? stamp : 0;
    } catch {
      return 0;
    }
  }

  var scheduled = false;
  function scheduleRecoveryCheck(reason, delay) {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(function () {
      if (appMounted()) return;

      var last = previousRedirectAt();
      var now = Date.now();
      if (last && now - last < LOOP_GUARD_MS) return;

      var alreadyTried = Boolean(last);
      try {
        window.sessionStorage.setItem(FLAG, String(now));
      } catch {
        // Storage can be blocked; redirect anyway — recover.html is static.
      }
      window.location.replace(
        '/recover.html?from=guard&reason=' + encodeURIComponent(reason) +
        (alreadyTried ? '&auto=0' : '&auto=1')
      );
    }, delay || MOUNT_CHECK_DELAY_FAST);
  }

  // Resource errors (failed script/css loads) do not bubble; capture them here.
  window.addEventListener(
    'error',
    function (event) {
      var target = event && event.target;
      if (target && target.tagName === 'SCRIPT') {
        scheduleRecoveryCheck('script-load-failed');
      }
    },
    true
  );

  // Uncaught errors during boot (before React's error boundary exists).
  window.addEventListener('error', function (event) {
    if (event && event.error) {
      scheduleRecoveryCheck('boot-error');
    }
  });

  // Safety net: no script failed, but nothing mounted either (e.g. a hanging
  // import or a blocked dynamic import in a hardened browser).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      scheduleRecoveryCheck('not-mounted', MOUNT_CHECK_DELAY_SLOW);
    });
  } else {
    scheduleRecoveryCheck('not-mounted', MOUNT_CHECK_DELAY_SLOW);
  }
})();
