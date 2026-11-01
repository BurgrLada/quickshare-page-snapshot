const endpoint = document.getElementById("endpoint");
const token = document.getElementById("token");
const status = document.getElementById("status");

const saved = await chrome.storage.local.get(["endpoint", "token"]);
endpoint.value = saved.endpoint ?? "";
token.value = saved.token ?? "";

document.getElementById("form").addEventListener("submit", async event => {
  event.preventDefault();
  await chrome.storage.local.set({ endpoint: endpoint.value.trim(), token: token.value.trim() });
  status.textContent = "Saved";
});
