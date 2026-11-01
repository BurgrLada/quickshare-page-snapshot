import "./browser-shim.js";
import { getPageData, init } from "single-file-core/single-file.js";
import { stripSecrets } from "./sanitize.js";

const CHUNK_CHARS = 16 * 1024 * 1024;

const OPTIONS = {
  removeHiddenElements: true,
  removeUnusedStyles: true,
  removeUnusedFonts: true,
  removeFrames: false,
  removeImports: true,
  blockScripts: true,
  blockVideos: false,
  blockAudios: false,
  compressHTML: true,
  compressCSS: false,
  loadDeferredContent: true,
  loadDeferredContentMaxIdleTime: 1500,
  loadDeferredContentKeepZoomLevel: true,
  groupDuplicateImages: true,
  maxResourceSizeEnabled: true,
  maxResourceSize: 15,
  saveFavicon: true,
  insertCanonicalLink: false,
  insertSingleFileComment: false,
  includeInfobar: false,
  filenameTemplate: "{page-title}"
};

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Pages cannot read cross-origin assets because of CORS, so the worker refetches those.
async function fetchResource(url, options = {}) {
  try {
    const response = await fetch(url, { cache: "force-cache", credentials: "include" });
    if (response.ok) return response;
  } catch {
    // Fall through to the extension context, which has host permissions.
  }
  const reply = await chrome.runtime.sendMessage({ type: "fetch", url, referrer: options.referrer });
  if (reply.error) throw new Error(reply.error);
  const buffer = base64ToBytes(reply.base64).buffer;
  return {
    url: reply.url,
    status: reply.status,
    headers: new Headers(reply.headers),
    arrayBuffer: async () => buffer
  };
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "capture") return;
  port.onMessage.addListener(async () => {
    try {
      const page = await getPageData(OPTIONS, { fetch: fetchResource, frameFetch: fetchResource });
      const html = stripSecrets(page.content);
      for (let i = 0; i < html.length; i += CHUNK_CHARS) {
        port.postMessage({ chunk: html.slice(i, i + CHUNK_CHARS) });
      }
      port.postMessage({ done: true, title: document.title });
    } catch (error) {
      port.postMessage({ error: String(error?.message ?? error) });
    }
  });
});

init({ fetch: fetchResource, frameFetch: fetchResource });
