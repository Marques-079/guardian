const $ = (id) => document.getElementById(id);

async function load() {
  const { cerebrasApiKey, cerebrasModel } = await chrome.storage.local.get([
    "cerebrasApiKey",
    "cerebrasModel"
  ]);
  if (cerebrasApiKey) $("apiKey").value = cerebrasApiKey;
  $("model").value = cerebrasModel || "llama3.3-70b";
}

async function save() {
  const cerebrasApiKey = $("apiKey").value.trim();
  const cerebrasModel = $("model").value.trim() || "llama3.3-70b";
  await chrome.storage.local.set({ cerebrasApiKey, cerebrasModel });
  setStatus("status", "Saved", "ok");
}

async function test() {
  setStatus("status", "Testing…", "ok");
  const cerebrasApiKey = $("apiKey").value.trim();
  const cerebrasModel = $("model").value.trim() || "llama3.3-70b";
  if (!cerebrasApiKey) {
    setStatus("status", "Set an API key first", "err");
    return;
  }
  try {
    const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cerebrasApiKey}`
      },
      body: JSON.stringify({
        model: cerebrasModel,
        messages: [{ role: "user", content: "Say OK." }],
        max_tokens: 5
      })
    });
    if (!res.ok) {
      const txt = await res.text();
      setStatus("status", `Error ${res.status}: ${txt.slice(0, 120)}`, "err");
      return;
    }
    setStatus("status", "Connection OK", "ok");
  } catch (err) {
    setStatus("status", `Failed: ${err.message}`, "err");
  }
}

async function clearApprovals() {
  await chrome.storage.local.set({ approvedVideos: [] });
  setStatus("clearStatus", "Cleared", "ok");
}

function setStatus(id, msg, cls) {
  const el = $(id);
  el.textContent = msg;
  el.className = `status ${cls || ""}`;
  setTimeout(() => {
    if (el.textContent === msg) {
      el.textContent = "";
      el.className = "status";
    }
  }, 4000);
}

document.addEventListener("DOMContentLoaded", () => {
  load();
  $("save").addEventListener("click", save);
  $("test").addEventListener("click", test);
  $("clear").addEventListener("click", clearApprovals);
});
