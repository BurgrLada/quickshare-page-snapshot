const CAPTURE_TIMEOUT_MS = 120_000;
const FRAME_TREE_PREFIX = "singlefile.frameTree.";
const BADGE = {
  working: { text: "…", color: "#6b7280" },
  ok: { text: "OK", color: "#15803d" },
  error: { text: "!", color: "#b91c1c" }
};

function setBadge(tabId, state) {
  chrome.action.setBadgeText({ tabId, text: BADGE[state].text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE[state].color });
}

function bytesToBase64(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

async function refetch({ url, referrer }) {
  const response = await fetch(url, { credentials: "include", referrer: referrer || undefined });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    url: response.url,
    status: response.status,
    headers: [...response.headers],
    base64: bytesToBase64(bytes)
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.method?.startsWith(FRAME_TREE_PREFIX) && sender.tab) {
    chrome.tabs.sendMessage(sender.tab.id, message, { frameId: 0 }).catch(() => {});
    return false;
  }
  if (message.type !== "fetch") return false;
  (async () => {
    try {
      sendResponse(await refetch(message));
    } catch (error) {
      sendResponse({ error: String(error?.message ?? error) });
    }
  })();
  return true;
});

function capture(tabId) {
  return new Promise((resolve, reject) => {
    const port = chrome.tabs.connect(tabId, { name: "capture", frameId: 0 });
    const chunks = [];
    const timer = setTimeout(() => {
      port.disconnect();
      reject(new Error("Capture timed out."));
    }, CAPTURE_TIMEOUT_MS);
    port.onMessage.addListener(message => {
      if (message.chunk) chunks.push(message.chunk);
      if (message.error) {
        clearTimeout(timer);
        reject(new Error(message.error));
      }
      if (message.done) {
        clearTimeout(timer);
        resolve({ html: chunks.join(""), title: message.title });
      }
    });
    port.postMessage({ start: true });
  });
}

async function upload({ html, title }) {
  const { endpoint, token } = await chrome.storage.local.get(["endpoint", "token"]);
  if (!endpoint || !token) {
    chrome.runtime.openOptionsPage();
    throw new Error("Set the Worker URL and token in the options first.");
  }
  const response = await fetch(new URL("/api/pages", endpoint), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/html; charset=utf-8",
      "X-Page-Title": encodeURIComponent(title.slice(0, 200))
    },
    body: html
  });
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()).url;
}

async function copyToClipboard(text) {
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["CLIPBOARD"],
      justification: "Copy the snapshot link"
    });
  }
  await chrome.runtime.sendMessage({ type: "copy", text });
  await chrome.offscreen.closeDocument();
}

async function toast(tabId, message, isError) {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [message, isError],
    func: (text, error) => {
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647";
      const box = host.attachShadow({ mode: "closed" }).appendChild(document.createElement("div"));
      box.textContent = text;
      box.style.cssText = `font:14px/1.4 system-ui,sans-serif;color:#fff;padding:10px 14px;border-radius:8px;max-width:420px;word-break:break-word;box-shadow:0 4px 16px #0005;background:${error ? "#b91c1c" : "#15803d"}`;
      document.documentElement.appendChild(host);
      setTimeout(() => host.remove(), error ? 8000 : 4000);
    }
  }).catch(() => {});
}

chrome.action.onClicked.addListener(async tab => {
  const { activeTabs = [] } = await chrome.storage.session.get("activeTabs");
  if (activeTabs.includes(tab.id)) return;
  await chrome.storage.session.set({ activeTabs: [...activeTabs, tab.id] });
  setBadge(tab.id, "working");
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["lib/frames.js"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["lib/capture.js"] });
    const url = await upload(await capture(tab.id));
    await copyToClipboard(url);
    await chrome.storage.session.set({ lastUrl: url });
    setBadge(tab.id, "ok");
    await toast(tab.id, `Link copied: ${url}`, false);
  } catch (error) {
    console.error(error);
    setBadge(tab.id, "error");
    await chrome.action.setTitle({ tabId: tab.id, title: String(error.message) });
    await toast(tab.id, `Share failed: ${error.message}`, true);
  } finally {
    const { activeTabs: current = [] } = await chrome.storage.session.get("activeTabs");
    await chrome.storage.session.set({ activeTabs: current.filter(id => id !== tab.id) });
  }
});
