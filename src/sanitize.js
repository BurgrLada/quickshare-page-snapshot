const SECRET_META = /csrf|xsrf|token|nonce/i;

function strip(doc) {
  doc.querySelectorAll("script, input[type='hidden']").forEach(el => el.remove());
  doc.querySelectorAll("input[type='password']").forEach(el => el.removeAttribute("value"));
  doc.querySelectorAll("meta[name]").forEach(el => {
    if (SECRET_META.test(el.getAttribute("name"))) el.remove();
  });
  // Captured frames are serialized into srcdoc, out of reach of the selectors above.
  doc.querySelectorAll("iframe[srcdoc]").forEach(frame => {
    frame.setAttribute("srcdoc", stripSecrets(frame.getAttribute("srcdoc")));
  });
}

export function stripSecrets(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  strip(doc);
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}
