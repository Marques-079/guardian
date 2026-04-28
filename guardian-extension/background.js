// Guardian background service worker
// Handles Cerebras API calls for video screening + arguing.

const CEREBRAS_ENDPOINT = "https://api.cerebras.ai/v1/chat/completions";
const DEFAULT_MODEL = "llama3.3-70b";

const SCREEN_SYSTEM_PROMPT = `You are Guardian, an AI focus gatekeeper for a university student.

The user is studying software engineering, AI, machine learning, and is interested in startups and making money. Their goal is to avoid distraction on YouTube.

You will be given a YouTube video title. Decide whether the video is genuinely educational or directly improves the user (career, skills, mindset, health, finance, productivity, deep tech topics they study).

Rules:
- Be skeptical. Entertainment, vlogs, drama, gaming, memes, reaction content, music videos, podcasts that are mostly chat, "motivational" fluff and clickbait should be BLOCKED.
- Tutorials, lectures, technical talks, conference talks, paper walkthroughs, coding sessions, founder interviews with concrete substance, finance/investing fundamentals, and similar should be ALLOWED.
- Just because a topic relates to tech does not mean it is educational. "Top 10 programmer memes" is BLOCKED.
- Keep reasoning tight: 1-3 short sentences.

Respond in this exact format:
REASONING: <one to three short sentences>
VERDICT: <ALLOW or BLOCK>`;

const ARGUE_SYSTEM_PROMPT = `You are Guardian, an AI focus gatekeeper for a university student studying software engineering, AI/ML, and interested in startups.

You previously BLOCKED a YouTube video. The user now has up to 5 messages to convince you the video is legitimately educational or beneficial. Be skeptical but fair.

Guidelines:
- Push back on weak justifications ("I just want to relax", "it's kind of related", "I'll learn something").
- Accept strong justifications: a concrete learning goal, an assignment, a specific skill the video uniquely teaches, research for a project.
- If the user provides a strong concrete reason, ALLOW.
- If after pushing back the user only gives weak excuses, keep BLOCK.
- Keep replies under 3 short sentences. Be direct, no fluff.

You MUST end every single response with one of these two lines on its own:
VERDICT: ALLOW
VERDICT: BLOCK`;

async function getApiKey() {
  const { cerebrasApiKey } = await chrome.storage.local.get("cerebrasApiKey");
  return cerebrasApiKey || "";
}

async function getModel() {
  const { cerebrasModel } = await chrome.storage.local.get("cerebrasModel");
  return cerebrasModel || DEFAULT_MODEL;
}

async function callCerebras(messages) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error("No Cerebras API key set. Open the extension options to add one.");
  }
  const model = await getModel();

  const res = await fetch(CEREBRAS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      max_tokens: 400
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cerebras API ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "";
  return content.trim();
}

function parseVerdict(text) {
  const match = text.match(/VERDICT:\s*(ALLOW|BLOCK)/i);
  const verdict = match ? match[1].toUpperCase() : null;
  const reasoning = text
    .replace(/VERDICT:\s*(ALLOW|BLOCK)/i, "")
    .replace(/^REASONING:\s*/im, "")
    .trim();
  return { verdict, reasoning };
}

async function screenVideo(title) {
  const userMsg = `Video title: "${title}"\n\nDecide.`;
  const reply = await callCerebras([
    { role: "system", content: SCREEN_SYSTEM_PROMPT },
    { role: "user", content: userMsg }
  ]);
  const { verdict, reasoning } = parseVerdict(reply);
  return {
    allowed: verdict === "ALLOW",
    reasoning: reasoning || reply,
    raw: reply
  };
}

async function argueExchange({ title, history, userMessage }) {
  const messages = [
    {
      role: "system",
      content: `${ARGUE_SYSTEM_PROMPT}\n\nThe blocked video title is: "${title}".`
    },
    ...history,
    { role: "user", content: userMessage }
  ];
  const reply = await callCerebras(messages);
  const { verdict, reasoning } = parseVerdict(reply);
  return {
    reply,
    reasoning: reasoning || reply,
    allowed: verdict === "ALLOW",
    blocked: verdict === "BLOCK"
  };
}

async function getApprovedSet() {
  const { approvedVideos } = await chrome.storage.local.get("approvedVideos");
  return new Set(approvedVideos || []);
}

async function addApproved(videoId) {
  const set = await getApprovedSet();
  set.add(videoId);
  await chrome.storage.local.set({ approvedVideos: Array.from(set) });
}

async function clearApproved() {
  await chrome.storage.local.set({ approvedVideos: [] });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "check_video") {
        const approved = await getApprovedSet();
        if (approved.has(msg.videoId)) {
          sendResponse({ ok: true, allowed: true, cached: true });
          return;
        }
        const result = await screenVideo(msg.title);
        if (result.allowed) await addApproved(msg.videoId);
        sendResponse({ ok: true, ...result });
        return;
      }

      if (msg.type === "argue") {
        const result = await argueExchange({
          title: msg.title,
          history: msg.history || [],
          userMessage: msg.userMessage
        });
        if (result.allowed) await addApproved(msg.videoId);
        sendResponse({ ok: true, ...result });
        return;
      }

      if (msg.type === "clear_approved") {
        await clearApproved();
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "is_approved") {
        const approved = await getApprovedSet();
        sendResponse({ ok: true, approved: approved.has(msg.videoId) });
        return;
      }

      sendResponse({ ok: false, error: "Unknown message type" });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();
  return true; // async response
});
