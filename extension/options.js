const endpoint = document.getElementById("endpoint");
const token = document.getElementById("token");
const status = document.getElementById("status");

const log = document.getElementById("log");
const showLog = lines => { log.textContent = (lines ?? []).join("\n") || "No activity yet."; };

const saved = await chrome.storage.local.get(["endpoint", "token"]);
endpoint.value = saved.endpoint ?? "";
token.value = saved.token ?? "";
showLog((await chrome.storage.local.get("log")).log);

chrome.storage.onChanged.addListener(changes => {
  if (changes.log) showLog(changes.log.newValue);
});

document.getElementById("form").addEventListener("submit", async event => {
  event.preventDefault();
  await chrome.storage.local.set({ endpoint: endpoint.value.trim(), token: token.value.trim() });
  status.textContent = "Saved";
});
