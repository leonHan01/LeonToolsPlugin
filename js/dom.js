const SVG_NS = "http://www.w3.org/2000/svg";

const PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 12h10l1-12"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z"/>',
  external: '<path d="M14 5h5v5"/><path d="M20 4 10 14"/><path d="M11 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  chevronLeft: '<path d="M15 18l-6-6 6-6"/>',
  folder: '<path d="M4 7h5l2 2h9v10H4z"/><path d="M4 7V5h5l2 2"/>',
  json: '<path d="M8 5c-2 0-3 1.5-3 4v2c0 1.5-1 3-3 3 2 0 3 1.5 3 3v2c0 2.5 1 4 3 4"/><path d="M16 5c2 0 3 1.5 3 4v2c0 1.5 1 3 3 3-2 0-3 1.5-3 3v2c0 2.5-1 4-3 4"/>',
  link: '<path d="M10 14a5 5 0 0 1 0-7l2-2a5 5 0 0 1 7 7l-1 1"/><path d="M14 10a5 5 0 0 1 0 7l-2 2a5 5 0 0 1-7-7l1-1"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  tabs: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 6V4h12a2 2 0 0 1 2 2v10"/>',
  download: '<path d="M12 4v10"/><path d="m8 10 4 4 4-4"/><path d="M5 19h14"/>',
  upload: '<path d="M12 20V10"/><path d="m8 14 4-4 4 4"/><path d="M5 5h14"/>',
  pin: '<path d="M12 17v4"/><path d="M8 7h8l-1 6H9L8 7z"/><path d="M7 7h10"/>',
  check: '<path d="M5 12l4 4 10-10"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>',
  volume: '<path d="M5 10v4h3l4 3V7L8 10H5z"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 1-7.9A6 6 0 0 0 6.1 9 4 4 0 0 0 7 18z"/>',
  grip: '<circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M4.2 6.2l1.4 1.4M18.4 16.4l1.4 1.4M3 12h2M19 12h2M4.2 17.8l1.4-1.4M18.4 7.6l1.4-1.4"/>',
};

export function icon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.classList.add("icon-svg");
  svg.innerHTML = PATHS[name] || PATHS.globe;
  return svg;
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "checked" || key === "disabled" || key === "selected") {
      node[key] = Boolean(value);
    } else if (key === "text") {
      node.textContent = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function faviconSrc(pageUrl, stored) {
  if (stored && !stored.startsWith("chrome://") && !stored.startsWith("edge://")) return stored;
  try {
    const url = new URL(chrome.runtime.getURL("/_favicon/"));
    url.searchParams.set("pageUrl", pageUrl);
    url.searchParams.set("size", "32");
    return url.toString();
  } catch {
    return stored || "";
  }
}

const FALLBACK_FAVICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#61738f" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>'
  );

export function faviconImg(pageUrl, stored, className = "favicon") {
  const img = el("img", { class: className, alt: "" });
  img.referrerPolicy = "no-referrer";
  img.src = faviconSrc(pageUrl, stored) || FALLBACK_FAVICON;
  img.addEventListener("error", () => {
    img.src = FALLBACK_FAVICON;
  });
  return img;
}

export function restoreFocus(id, start, end) {
  if (!id) return;
  const node = document.getElementById(id);
  if (!node) return;
  node.focus();
  if (typeof start === "number" && node.setSelectionRange) {
    try {
      node.setSelectionRange(start, end ?? start);
    } catch {
      /* not a text field */
    }
  }
}
