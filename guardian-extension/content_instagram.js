// Guardian — Instagram content script
// Blocks all Reels pages (/reels/*). No AI check — Reels are always blocked.

(() => {
  if (window.__guardianIgLoaded) return;
  window.__guardianIgLoaded = true;

  let pauseInterval = null;

  function pauseAllVideos() {
    document.querySelectorAll("video").forEach((v) => {
      try {
        v.pause();
        v.muted = true;
      } catch {}
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

  function isReels(url) {
    try {
      const u = new URL(url);
      return u.pathname.startsWith("/reels");
    } catch {
      return false;
    }
  }

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
          <div class="g-mode" id="g-mode-label">BLOCKED · REELS</div>
        </div>
        <div class="g-body">
          <div class="g-state">
            <div class="g-title">Instagram Reels</div>
            <div class="g-reason">Reels are engineered for compulsive scrolling and are always blocked.</div>
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

  function showOverlay() {
    startPauseLoop();
    const host = ensureOverlay();
    host.classList.add("g-visible");
  }

  function hideOverlay() {
    stopPauseLoop();
    const host = document.getElementById("guardian-overlay-host");
    if (host) host.classList.remove("g-visible");
  }

  function handleUrl(url) {
    if (isReels(url)) {
      showOverlay();
    } else {
      hideOverlay();
    }
  }

  // Watch for SPA navigation
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
