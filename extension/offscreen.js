chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "copy") return false;
  const buffer = document.getElementById("buffer");
  buffer.value = message.text;
  buffer.select();
  // navigator.clipboard needs a focused document, which offscreen documents never have.
  sendResponse({ ok: document.execCommand("copy") });
  return false;
});
