const CAPTURE_TIMEOUT_MS = 120_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const RESOURCE_TIMEOUT_MS = 30_000;
const LOCK_MS = CAPTURE_TIMEOUT_MS + UPLOAD_TIMEOUT_MS + 10_000;
const FRAME_TREE_PREFIX = "singlefile.frameTree.";
const LAZY_TIMEOUT_PREFIX = "singlefile.lazyTimeout.";
const BADGE = {
  working: { text: "…", color: "#6b7280" },
  ok: { text: "OK", color: "#15803d" },
  error: { text: "!", color: "#b91c1c" }
};

const TOAST_COLORS = { info: "#1f2937", success: "#15803d", error: "#b91c1c" };
const TOAST_HIDE_MS = { info: 0, success: 10_000, error: 0 };
const LOG_LINES = 40;
const lazyTimers = new Map();

async function log(line) {
  console.log(line);
  const { log: lines = [] } = await chrome.storage.local.get("log");
  const entry = `${new Date().toLocaleTimeString()} ${line}`;
  await chrome.storage.local.set({ log: [...lines, entry].slice(-LOG_LINES) });
}

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
  const response = await fetch(url, { credentials: "include", referrer: referrer || undefined, signal: AbortSignal.timeout(RESOURCE_TIMEOUT_MS) });
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
  // SingleFile's lazy loader delegates its timers to the background once `browser` exists.
  if (message.method?.startsWith(LAZY_TIMEOUT_PREFIX) && sender.tab) {
    const key = `${sender.tab.id}:${sender.frameId}:${message.type}`;
    clearTimeout(lazyTimers.get(key));
    lazyTimers.delete(key);
    if (message.method === `${LAZY_TIMEOUT_PREFIX}setTimeout`) {
      lazyTimers.set(key, setTimeout(() => {
        lazyTimers.delete(key);
        const reply = { method: `${LAZY_TIMEOUT_PREFIX}onTimeout`, type: message.type };
        chrome.tabs.sendMessage(sender.tab.id, reply, { frameId: sender.frameId }).catch(() => {});
      }, message.delay));
    }
    sendResponse({});
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
    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      reject(new Error("Capture was interrupted. Reload the page and try again."));
    });
    port.onMessage.addListener(message => {
      if (message.stage) log(`capture: ${message.stage}`);
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

async function getSettings() {
  const { endpoint, token } = await chrome.storage.local.get(["endpoint", "token"]);
  if (!endpoint || !token) {
    chrome.runtime.openOptionsPage();
    throw new Error("Set the Worker URL and token in the options first.");
  }
  return { endpoint, token };
}

async function upload({ html, title }, { endpoint, token }) {
  const target = new URL("/api/pages", endpoint);
  await log(`POST ${target.origin}, ${html.length} chars`);
  const response = await fetch(target, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/html; charset=utf-8",
      "X-Page-Title": encodeURIComponent(title.slice(0, 200))
    },
    body: html,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
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
  const { ok } = await chrome.runtime.sendMessage({ type: "copy", text });
  await chrome.offscreen.closeDocument();
  return ok;
}

async function toast(tabId, { text, kind = "info", link = null }) {
  try {
    await chrome.scripting.executeScript({
    target: { tabId },
    args: [text, link, TOAST_COLORS[kind], TOAST_HIDE_MS[kind], kind === "info"],
    func: (message, href, color, hideAfter, spinning) => {
      let toast = globalThis.__quickshareToast;
      if (!toast?.host.isConnected) {
        const host = document.createElement("div");
        host.setAttribute("data-quickshare-toast", "");
        host.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647";
        const box = host.attachShadow({ mode: "closed" }).appendChild(document.createElement("div"));
        box.setAttribute("role", "status");
        document.documentElement.appendChild(host);
        toast = globalThis.__quickshareToast = { host, box };
      }
      clearTimeout(toast.timer);
      toast.box.style.cssText = `font:14px/1.4 system-ui,sans-serif;color:#fff;padding:10px 14px;border-radius:8px;max-width:420px;word-break:break-word;box-shadow:0 4px 16px #0005;background:${color}`;
      toast.box.textContent = message;
      if (spinning) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        svg.style.cssText = "width:16px;height:16px;margin-right:8px;vertical-align:-3px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round";
        const path = svg.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "path"));
        path.setAttribute("d", "M6 2h12M6 22h12M7 2v3c0 3 5 5 5 7s-5 4-5 7v3M17 2v3c0 3-5 5-5 7s5 4 5 7v3");
        toast.box.prepend(svg);
        if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
          svg.animate(
            [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
            { duration: 1600, iterations: Infinity, easing: "steps(8)" }
          );
        }
      }
      if (href) {
        const anchor = toast.box.appendChild(document.createElement("a"));
        anchor.href = href;
        anchor.target = "_blank";
        anchor.rel = "noreferrer";
        anchor.textContent = href;
        anchor.style.cssText = "display:block;color:#fff;text-decoration:underline";
      }
      if (!spinning) {
        const close = toast.box.appendChild(document.createElement("button"));
        close.type = "button";
        close.textContent = "×";
        close.setAttribute("aria-label", "Close");
        close.style.cssText = "float:right;margin-left:12px;padding:0 4px;border:0;background:none;color:inherit;font:18px/1 system-ui,sans-serif;cursor:pointer";
        close.addEventListener("click", () => toast.host.remove());
        toast.box.prepend(close);
      }
      if (hideAfter) toast.timer = setTimeout(() => toast.host.remove(), hideAfter);
    }
    });
  } catch (error) {
    // Browser-internal pages refuse injection; the badge still reports the result there.
    console.warn(error);
  }
}

chrome.action.onClicked.addListener(async tab => {
  const { locks = {} } = await chrome.storage.session.get("locks");
  if (Date.now() - (locks[tab.id] ?? 0) < LOCK_MS) return;
  await chrome.storage.session.set({ locks: { ...locks, [tab.id]: Date.now() } });
  setBadge(tab.id, "working");
  try {
    await log(`start: ${new URL(tab.url ?? "about:blank").hostname || "unknown host"}`);
    await toast(tab.id, { text: "Wrapping up page…" });
    const settings = await getSettings();
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["lib/frames.js"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["lib/capture.js"] });
    const snapshot = await capture(tab.id);
    await log(`captured ${(snapshot.html.length / 1e6).toFixed(2)} MB, uploading`);
    await toast(tab.id, { text: "Uploading…" });
    const url = await upload(snapshot, settings);
    await log("uploaded");
    const copied = await copyToClipboard(url);
    await chrome.storage.session.set({ lastUrl: url });
    setBadge(tab.id, "ok");
    const text = copied ? "Link copied to clipboard" : "Could not copy the link, open it here:";
    const hasFullAccess = await chrome.permissions.contains({ origins: ["<all_urls>"] });
    if (!hasFullAccess) await log("warning: site access is limited, images from other domains are missing");
    await toast(tab.id, { text: hasFullAccess ? text : `${text} (images may be missing: set Site access to "On all sites" in the extension details)`, kind: "success", link: url });
  } catch (error) {
    await log(`error: ${error.message}`);
    setBadge(tab.id, "error");
    await chrome.action.setTitle({ tabId: tab.id, title: String(error.message) });
    await toast(tab.id, { text: `Error: ${error.message}`, kind: "error" });
  } finally {
    const { locks: current = {} } = await chrome.storage.session.get("locks");
    delete current[tab.id];
    await chrome.storage.session.set({ locks: current });
  }
});
