// Guardian — Instagram content script
// /reels/*          → always blocked immediately, no grace.
// / (home feed)     → 20-second countdown, then blocked for 5 minutes.
//                     The 5-min lockout is persisted in chrome.storage.local
//                     so refreshing the tab does not reset it.

(() => {
  if (window.__guardianIgLoaded) return;
  window.__guardianIgLoaded = true;

  const GRACE_MS   = 20 * 1000;       // 20 seconds of browsing before block
  const LOCKOUT_MS = 5 * 60 * 1000;   // 5-minute lockout
  const STORAGE_KEY = "ig_lockout_until";

  let pauseInterval   = null;
  let countdownTimer  = null;
  let countdownSecs   = 0;
  let gracePeriodActive = false;

  // ---------- video muting ----------
  function pauseAllVideos() {
    document.querySelectorAll("video").forEach((v) => {
      try { v.pause(); v.muted = true; } catch {}
    });
  }
  function startPauseLoop() {
    if (pauseInterval) return;
    pauseInterval = setInterval(pauseAllVideos, 250);
  }
  function stopPauseLoop() {
    if (pauseInterval) clearInterval(pauseInterval);
    pauseInterval = null;
    document.querySelectorAll("video").forEach((v) => {
      try { v.muted = false; } catch {}
    });
  }

  // ---------- URL classification ----------
  function urlType(url) {
    try {
      const u = new URL(url);
      if (u.hostname !== "www.instagram.com") return "other";
      if (u.pathname.startsWith("/reels")) return "reels";
      if (u.pathname === "/" || u.pathname === "") return "home";
      return "other";
    } catch { return "other"; }
  }

  // ---------- storage helpers ----------
  async function getLockoutUntil() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (res) => resolve(res[STORAGE_KEY] || 0));
    });
  }
  async function setLockout() {
    const until = Date.now() + LOCKOUT_MS;
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: until }, resolve);
    });
  }
  async function clearLockout() {
    return new Promise((resolve) => {
      chrome.storage.local.remove(STORAGE_KEY, resolve);
    });
  }

  // ---------- overlay ----------
  function ensureOverlay() {
    let host = document.getElementById("guardian-overlay-host");
    if (host) return host;

    host = document.createElement("div");
    host.id = "guardian-overlay-host";
    host.innerHTML = `
      <div class="g-backdrop"></div>
      <div class="g-modal" role="dialog" aria-modal="true">
        <div class="g-header">
          <div class="g-brand">GUARDIAN</div>
          <div class="g-mode" id="g-mode-label">BLOCKED</div>
        </div>
        <div class="g-body">
          <div class="g-state">
            <div class="g-title" id="g-title">Instagram</div>
            <div class="g-reason" id="g-reason"></div>
          </div>
        </div>
        <div class="g-actions">
          <button class="g-btn g-btn-ghost" id="g-leave">Leave page</button>
        </div>
      </div>
    `;
    (document.body || document.documentElement).appendChild(host);
    host.querySelector("#g-leave").addEventListener("click", () => {
      window.location.href = "https://www.google.com";
    });
    return host;
  }

  function setOverlayContent({ modeLabel, title, reason }) {
    const host = ensureOverlay();
    host.querySelector("#g-mode-label").textContent = modeLabel;
    host.querySelector("#g-title").textContent = title;
    host.querySelector("#g-reason").textContent = reason;
  }

  function showOverlay() {
    startPauseLoop();
    ensureOverlay().classList.add("g-visible");
  }

  function hideOverlay() {
    stopPauseLoop();
    const host = document.getElementById("guardian-overlay-host");
    if (host) host.classList.remove("g-visible");
  }

  // ---------- countdown helpers ----------
  function stopCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
    gracePeriodActive = false;
  }

  // Show a warning bar while grace period is ticking down.
  // We inject a lightweight fixed banner rather than the full modal
  // so the user can still browse normally during grace.
  function ensureBanner() {
    let b = document.getElementById("guardian-banner");
    if (b) return b;
    b = document.createElement("div");
    b.id = "guardian-banner";
    b.style.cssText = `
      position:fixed; top:0; left:0; right:0; z-index:2147483646;
      background:#000; color:#fff;
      font:600 12px/1 "Inter","Helvetica Neue",Arial,sans-serif;
      letter-spacing:0.18em; text-transform:uppercase;
      padding:10px 16px; display:flex; justify-content:space-between;
      align-items:center;
    `;
    b.innerHTML = `
      <span id="guardian-banner-text">GUARDIAN — Instagram home blocked in <strong id="guardian-countdown">20</strong>s</span>
      <span style="opacity:0.5;font-size:10px">leave or lose it</span>
    `;
    (document.body || document.documentElement).prepend(b);
    return b;
  }

  function removeBanner() {
    const b = document.getElementById("guardian-banner");
    if (b) b.remove();
  }

  function updateBannerCount(secs) {
    const el = document.getElementById("guardian-countdown");
    if (el) el.textContent = secs;
  }

  // ---------- main logic ----------
  async function handleHome() {
    const lockoutUntil = await getLockoutUntil();
    const now = Date.now();

    if (lockoutUntil > now) {
      // Still locked out — show full block with remaining time
      stopCountdown();
      removeBanner();
      const secsLeft = Math.ceil((lockoutUntil - now) / 1000);
      const minsLeft = Math.floor(secsLeft / 60);
      const s = secsLeft % 60;
      setOverlayContent({
        modeLabel: "LOCKED · INSTAGRAM HOME",
        title: "Instagram Home",
        reason: `Locked for ${minsLeft}m ${s}s. You already used your grace period. Get back to work.`
      });
      showOverlay();

      // Update the remaining-time display every second
      countdownTimer = setInterval(async () => {
        const remaining = Math.ceil(((await getLockoutUntil()) - Date.now()) / 1000);
        if (remaining <= 0) {
          stopCountdown();
          await clearLockout();
          hideOverlay();
        } else {
          const m = Math.floor(remaining / 60);
          const s2 = remaining % 60;
          const reasonEl = document.getElementById("g-reason");
          if (reasonEl) {
            reasonEl.textContent = `Locked for ${m}m ${s2}s. You already used your grace period. Get back to work.`;
          }
        }
      }, 1000);
      return;
    }

    // Grace period — let them browse for 20 seconds then lock
    if (gracePeriodActive) return; // already counting
    gracePeriodActive = true;
    countdownSecs = Math.ceil(GRACE_MS / 1000);
    ensureBanner();
    updateBannerCount(countdownSecs);

    countdownTimer = setInterval(async () => {
      countdownSecs -= 1;
      updateBannerCount(countdownSecs);

      if (countdownSecs <= 0) {
        stopCountdown();
        removeBanner();
        await setLockout();
        setOverlayContent({
          modeLabel: "LOCKED · INSTAGRAM HOME",
          title: "Instagram Home",
          reason: `Grace period expired. Locked for 5 minutes. Close the tab and do something useful.`
        });
        showOverlay();

        // Tick the lockout countdown in the overlay
        countdownTimer = setInterval(async () => {
          const remaining = Math.ceil(((await getLockoutUntil()) - Date.now()) / 1000);
          if (remaining <= 0) {
            stopCountdown();
            await clearLockout();
            hideOverlay();
          } else {
            const m = Math.floor(remaining / 60);
            const s2 = remaining % 60;
            const reasonEl = document.getElementById("g-reason");
            if (reasonEl) {
              reasonEl.textContent = `Locked for ${m}m ${s2}s. Close the tab and do something useful.`;
            }
          }
        }, 1000);
      }
    }, 1000);
  }

  function handleReels() {
    stopCountdown();
    removeBanner();
    setOverlayContent({
      modeLabel: "BLOCKED · REELS",
      title: "Instagram Reels",
      reason: "Reels are engineered for compulsive scrolling and are always blocked."
    });
    showOverlay();
  }

  function handleOther() {
    stopCountdown();
    removeBanner();
    hideOverlay();
  }

  async function handleUrl(url) {
    const type = urlType(url);
    if (type === "reels") { handleReels(); return; }
    if (type === "home")  { await handleHome(); return; }
    handleOther();
  }

  // ---------- SPA navigation watcher ----------
  let lastUrl = location.href;
  function checkUrl() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      handleUrl(lastUrl);
    }
  }
  setInterval(checkUrl, 300);

  ["pushState", "replaceState"].forEach((fn) => {
    const orig = history[fn];
    history[fn] = function (...args) {
      const ret = orig.apply(this, args);
      window.dispatchEvent(new Event("guardian:locationchange"));
      return ret;
    };
  });
  window.addEventListener("popstate", () =>
    window.dispatchEvent(new Event("guardian:locationchange"))
  );
  window.addEventListener("guardian:locationchange", () =>
    setTimeout(checkUrl, 0)
  );

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => handleUrl(location.href));
  } else {
    handleUrl(location.href);
  }
})();
