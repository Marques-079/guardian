// Guardian content script
// Watches the YouTube SPA, blocks Shorts, screens videos via Cerebras,
// and renders the block overlay + argue dialog.

(() => {
  if (window.__guardianLoaded) return;
  window.__guardianLoaded = true;

  const MAX_EXCHANGES = 5;

  let currentVideoId = null;
  let currentMode = null; // "shorts" | "video" | null
  let pauseInterval = null;
  let argueHistory = []; // [{role, content}]
  let argueExchanges = 0;
  let isOverlayLocked = false; // prevents removal while we still want to block

  // ---------- helpers ----------
  function getVideoIdFromUrl(url) {
    try {
      const u = new URL(url);
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = u.pathname.match(/^\/shorts\/([^/?#]+)/);
      if (m) return m[1];
      return null;
    } catch {
      return null;
    }
  }

  function getMode(url) {
    try {
      const u = new URL(url);
      if (u.pathname.startsWith("/shorts/")) return "shorts";
      if (u.pathname === "/watch" && u.searchParams.get("v")) return "video";
      return null;
    } catch {
      return null;
    }
  }

  function waitForTitle(timeoutMs = 8000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const raw = document.title || "";
        const cleaned = raw.replace(/\s*-\s*YouTube\s*$/i, "").trim();
        const isReady =
          cleaned &&
          cleaned.toLowerCase() !== "youtube" &&
          cleaned.toLowerCase() !== "loading...";
        if (isReady) return resolve(cleaned);
        if (Date.now() - start > timeoutMs) return resolve(cleaned || "Untitled");
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  function pauseAllVideos() {
    document.querySelectorAll("video").forEach((v) => {
      try {
        v.pause();
        v.muted = true;
      } catch {}
    });
  }

  function startPauseLoop() {
    stopPauseLoop();
    pauseInterval = setInterval(pauseAllVideos, 250);
  }

  function stopPauseLoop() {
    if (pauseInterval) clearInterval(pauseInterval);
    pauseInterval = null;
    document.querySelectorAll("video").forEach((v) => {
      try {
        v.muted = false;
      } catch {}
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
          <div class="g-mode" id="g-mode-label">SCREENING</div>
        </div>

        <div class="g-body" id="g-body">
          <div class="g-state" id="g-state">
            <div class="g-title" id="g-title">Checking…</div>
            <div class="g-reason" id="g-reason"></div>
          </div>

          <div class="g-argue" id="g-argue" hidden>
            <div class="g-chat" id="g-chat"></div>
            <div class="g-counter" id="g-counter"></div>
            <form class="g-form" id="g-form">
              <textarea
                id="g-input"
                rows="2"
                placeholder="Justify why this is worth your time…"
                autocomplete="off"
              ></textarea>
              <div class="g-form-row">
                <button type="button" class="g-btn g-btn-ghost" id="g-cancel-argue">Back</button>
                <button type="submit" class="g-btn g-btn-primary" id="g-send">Send</button>
              </div>
            </form>
          </div>
        </div>

        <div class="g-actions" id="g-actions">
          <button class="g-btn g-btn-ghost" id="g-leave">Leave page</button>
          <button class="g-btn g-btn-primary" id="g-argue-open" hidden>Argue your case</button>
        </div>
      </div>
    `;
    (document.body || document.documentElement).appendChild(host);

    host.querySelector("#g-leave").addEventListener("click", () => {
      window.location.href = "https://www.google.com";
    });
    host.querySelector("#g-argue-open").addEventListener("click", openArgue);
    host.querySelector("#g-cancel-argue").addEventListener("click", closeArgue);
    host.querySelector("#g-form").addEventListener("submit", (e) => {
      e.preventDefault();
      sendArgueMessage();
    });

    return host;
  }

  function showOverlay({ mode, title, reason, allowArgue }) {
    isOverlayLocked = true;
    startPauseLoop();
    const host = ensureOverlay();
    host.classList.add("g-visible");
    host.querySelector("#g-mode-label").textContent =
      mode === "checking"
        ? "SCREENING"
        : mode === "shorts"
        ? "BLOCKED · SHORTS"
        : mode === "video"
        ? "BLOCKED · VIDEO"
        : "BLOCKED";

    host.querySelector("#g-title").textContent = title || "";
    host.querySelector("#g-reason").textContent = reason || "";
    host.querySelector("#g-argue-open").hidden = !allowArgue;
    host.querySelector("#g-leave").hidden = mode === "checking";
    closeArgue();
  }

  function hideOverlay() {
    isOverlayLocked = false;
    stopPauseLoop();
    const host = document.getElementById("guardian-overlay-host");
    if (host) host.classList.remove("g-visible");
  }

  // ---------- argue flow ----------
  function openArgue() {
    argueHistory = [];
    argueExchanges = 0;
    const host = ensureOverlay();
    host.querySelector("#g-state").hidden = true;
    host.querySelector("#g-actions").hidden = true;
    host.querySelector("#g-argue").hidden = false;
    host.querySelector("#g-chat").innerHTML = "";
    updateCounter();
    addChatMessage(
      "guardian",
      "Make your case. You have 5 messages to convince me. Be specific."
    );
    setTimeout(() => host.querySelector("#g-input").focus(), 50);
  }

  function closeArgue() {
    const host = document.getElementById("guardian-overlay-host");
    if (!host) return;
    host.querySelector("#g-state").hidden = false;
    host.querySelector("#g-actions").hidden = false;
    host.querySelector("#g-argue").hidden = true;
  }

  function updateCounter() {
    const left = MAX_EXCHANGES - argueExchanges;
    const host = document.getElementById("guardian-overlay-host");
    if (!host) return;
    host.querySelector("#g-counter").textContent =
      left > 0
        ? `${left} message${left === 1 ? "" : "s"} left`
        : "No messages left";
  }

  function addChatMessage(who, text) {
    const host = ensureOverlay();
    const chat = host.querySelector("#g-chat");
    const row = document.createElement("div");
    row.className = `g-msg g-msg-${who}`;
    row.textContent = text;
    chat.appendChild(row);
    chat.scrollTop = chat.scrollHeight;
  }

  async function sendArgueMessage() {
    const host = ensureOverlay();
    const input = host.querySelector("#g-input");
    const sendBtn = host.querySelector("#g-send");
    const text = input.value.trim();
    if (!text) return;
    if (argueExchanges >= MAX_EXCHANGES) return;

    input.value = "";
    sendBtn.disabled = true;
    addChatMessage("user", text);

    const titleEl = host.querySelector("#g-title");
    const title = titleEl ? titleEl.textContent : "";

    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        type: "argue",
        videoId: currentVideoId,
        title,
        history: argueHistory,
        userMessage: text
      });
    } catch (err) {
      addChatMessage("guardian", `Error: ${err.message}`);
      sendBtn.disabled = false;
      return;
    }

    if (!resp || !resp.ok) {
      addChatMessage("guardian", `Error: ${resp?.error || "unknown"}`);
      sendBtn.disabled = false;
      return;
    }

    argueHistory.push({ role: "user", content: text });
    argueHistory.push({ role: "assistant", content: resp.reply });
    argueExchanges += 1;
    addChatMessage("guardian", resp.reasoning);
    updateCounter();

    if (resp.allowed) {
      addChatMessage("guardian", "Approved. Enjoy.");
      sendBtn.disabled = true;
      setTimeout(() => {
        hideOverlay();
      }, 800);
      return;
    }

    if (argueExchanges >= MAX_EXCHANGES) {
      addChatMessage(
        "guardian",
        "Out of messages. Verdict stands: blocked. Get back to work."
      );
      input.disabled = true;
      sendBtn.disabled = true;
      return;
    }

    sendBtn.disabled = false;
  }

  // ---------- main flow ----------
  async function handleUrl(url) {
    const mode = getMode(url);
    const videoId = getVideoIdFromUrl(url);

    if (!mode) {
      hideOverlay();
      currentMode = null;
      currentVideoId = null;
      return;
    }

    if (videoId === currentVideoId && currentMode === mode && isOverlayLocked) {
      return;
    }

    currentMode = mode;
    currentVideoId = videoId;

    if (mode === "shorts") {
      const title = await waitForTitle(3000);
      showOverlay({
        mode: "shorts",
        title: title || "YouTube Short",
        reason:
          "YouTube Shorts are blocked. The format is engineered for compulsive scrolling.",
        allowArgue: true
      });
      return;
    }

    // mode === "video"
    showOverlay({
      mode: "checking",
      title: "Screening this video…",
      reason: "Asking Guardian if this is worth your time.",
      allowArgue: false
    });

    const title = await waitForTitle();
    if (currentVideoId !== videoId) return; // user navigated away

    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        type: "check_video",
        videoId,
        title
      });
    } catch (err) {
      showOverlay({
        mode: "video",
        title,
        reason: `Guardian error: ${err.message}. Open the extension options to set your Cerebras API key.`,
        allowArgue: false
      });
      return;
    }

    if (currentVideoId !== videoId) return;

    if (!resp || !resp.ok) {
      showOverlay({
        mode: "video",
        title,
        reason:
          (resp && resp.error) ||
          "Guardian could not reach Cerebras. Set your API key in the extension options.",
        allowArgue: false
      });
      return;
    }

    if (resp.allowed) {
      hideOverlay();
      return;
    }

    showOverlay({
      mode: "video",
      title,
      reason: resp.reasoning || "Blocked.",
      allowArgue: true
    });
  }

  // ---------- url change watcher ----------
  let lastUrl = location.href;
  function checkUrl() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      handleUrl(lastUrl);
    }
  }
  setInterval(checkUrl, 250);

  // hook history API so we react instantly when YouTube navigates internally
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
  window.addEventListener("guardian:locationchange", () => {
    setTimeout(checkUrl, 0);
  });

  // initial run
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => handleUrl(location.href));
  } else {
    handleUrl(location.href);
  }
})();
