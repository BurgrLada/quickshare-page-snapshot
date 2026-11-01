import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import puppeteer from "puppeteer";

const TOKEN = "e2e-token";
const WORKER = "http://127.0.0.1:8799";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const site = createServer((req, res) => {
  const loggedIn = req.headers.cookie?.includes("session=1");
  if (req.url === "/app.css") return res.writeHead(200, { "content-type": "text/css" }).end("h1{color:rgb(1,2,3)}");
  if (req.url === "/private.png") {
    return loggedIn ? res.writeHead(200, { "content-type": "image/png" }).end(PNG) : res.writeHead(403).end();
  }
  if (req.url === "/frame") return res.writeHead(200, { "content-type": "text/html" }).end('<p>obsah-iframu</p><input type="hidden" value="TAJNY-FRAME">');
  if (!loggedIn) return res.writeHead(302, { "set-cookie": "session=1; Path=/", location: "/" }).end();
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><html><head><title>Zamčená stránka ěšč</title>
    <meta name="csrf-token" content="TAJNY-META"><link rel="stylesheet" href="/app.css"></head>
    <body><h1>Nadpis</h1><img src="/private.png" width="20" height="20"><img src="http://localhost:8798/cross.png" width="20" height="20">
    <form><input type="hidden" name="csrf" value="TAJNY-INPUT"><input type="password" value="TAJNE-HESLO"></form>
    <iframe src="/frame"></iframe><script>document.body.dataset.js = "bezel"</script></body></html>`);
}).listen(8797);

const crossOrigin = createServer((_req, res) => res.writeHead(200, { "content-type": "image/png" }).end(PNG)).listen(8798);

const dir = mkdtempSync(join(tmpdir(), "quickshare-"));
writeFileSync(join(dir, ".dev.vars"), `UPLOAD_TOKEN=${TOKEN}\n`);
const wrangler = spawn("npx", ["wrangler", "dev", "--config", "worker/wrangler.toml", "--port", "8799", "--env-file", join(dir, ".dev.vars"), "--persist-to", join(dir, "r2")], { stdio: "pipe", detached: true });

async function waitFor(check, label, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check().catch(() => null);
    if (value) return value;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`timeout: ${label}`);
}

let browser;
try {
  await waitFor(() => fetch(`${WORKER}/nic`).then(r => r.status === 404), "worker");

  const ext = resolve("extension");
  browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: [ext],
    args: ["--no-sandbox"]
  });
  const swTarget = await browser.waitForTarget(t => t.type() === "service_worker" && t.url().endsWith("background.js"));
  const sw = await swTarget.worker();
  await sw.evaluate((endpoint, token) => chrome.storage.local.set({ endpoint, token }), WORKER, TOKEN);

  const page = await browser.newPage();
  await page.goto("http://localhost:8797/");

  const share = async () => {
    await page.bringToFront();
    await sw.evaluate(async () => {
      await chrome.storage.session.remove("lastUrl");
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      chrome.action.onClicked.dispatch(tab);
    });
    try {
      return await waitFor(() => sw.evaluate(async () => (await chrome.storage.session.get("lastUrl")).lastUrl), "lastUrl", 45000);
    } catch (error) {
      const title = await sw.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return chrome.action.getTitle({ tabId: tab.id });
      });
      throw new Error(`${error.message}; stav rozšíření: ${title}`);
    }
  };

  const url = await share();
  console.log("odkaz:", url);
  const response = await fetch(url);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(response.headers.get("content-security-policy"), /sandbox/);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.match(html, /Zamčená stránka ěšč/);
  assert.match(html, /rgb\(1,\s*2,\s*3\)|#010203/);
  assert.equal(html.match(/data:image\/png/g)?.length >= 1, true, "obrázky vložené");
  assert.doesNotMatch(html, /src="?http:\/\/localhost:8798/, "cross-origin image inlined");
  assert.doesNotMatch(html, /private\.png/);
  assert.match(html, /obsah-iframu/);
  assert.doesNotMatch(html, /<script/i);
  for (const secret of ["TAJNY-META", "TAJNY-INPUT", "TAJNE-HESLO", "TAJNY-FRAME"]) assert.ok(!html.includes(secret), secret);

  const second = await share();
  assert.notEqual(second, url);
  assert.equal(await (await fetch(second)).text().then(t => t === html), true, "druhé kliknutí dá stejný výsledek");

  const viewer = await browser.newPage();
  await viewer.goto(url);
  assert.equal(await viewer.$eval("h1", el => getComputedStyle(el).color), "rgb(1, 2, 3)");
  await viewer.screenshot({ path: join(dir, "view.png") });

  assert.equal((await fetch(`${WORKER}/api/pages`, { method: "POST", body: "x" })).status, 401);
  assert.equal((await fetch(url, { method: "DELETE" })).status, 401);
  assert.equal((await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${TOKEN}` } })).status, 204);
  assert.equal((await fetch(url)).status, 404);
  console.log("OK, screenshot:", join(dir, "view.png"));
} finally {
  await browser?.close();
  site.close();
  crossOrigin.close();
  try { process.kill(-wrangler.pid); } catch {}
}
process.exit(0);
