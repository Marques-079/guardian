const $ = (id) => document.getElementById(id);

async function refresh() {
  const { approvedVideos, cerebrasApiKey } = await chrome.storage.local.get([
    "approvedVideos",
    "cerebrasApiKey"
  ]);
  $("count").textContent = (approvedVideos || []).length.toString();
  $("apiKey").textContent = cerebrasApiKey ? "Set" : "Not set";
}

document.addEventListener("DOMContentLoaded", () => {
  refresh();
  $("clear").addEventListener("click", async () => {
    await chrome.storage.local.set({ approvedVideos: [] });
    $("status").textContent = "Cleared";
    setTimeout(() => ($("status").textContent = ""), 2000);
    refresh();
  });
  $("settings").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
});
