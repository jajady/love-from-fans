const overlayEl = document.querySelector("#luuxOverlay");
const emptyEl = document.querySelector("#luuxEmpty");
const itemEls = new Map();
const POLL_MS = 4000;

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function applyLayout(el, item) {
  if (isFiniteNumber(item.x)) {
    el.style.left = `${item.x}px`;
  }
  if (isFiniteNumber(item.y)) {
    el.style.top = `${item.y}px`;
  }
  if (isFiniteNumber(item.w)) {
    el.style.width = `${item.w}px`;
  }
  if (isFiniteNumber(item.h)) {
    el.style.height = `${item.h}px`;
  }
}

function appendItem(item) {
  const img = document.createElement("img");
  img.src = item.url;
  img.alt = item.filename;
  img.loading = "lazy";
  applyLayout(img, item);
  overlayEl.appendChild(img);
  itemEls.set(item.filename, img);
}

function removeItem(filename) {
  const el = itemEls.get(filename);
  if (!el) return;
  el.remove();
  itemEls.delete(filename);
}

function syncOverlay(items) {
  if (!Array.isArray(items) || items.length === 0) {
    overlayEl.replaceChildren();
    itemEls.clear();
    if (emptyEl) {
      emptyEl.style.display = "block";
    }
    return;
  }

  if (emptyEl) {
    emptyEl.style.display = "none";
  }
  const next = new Set(items.map((item) => item.filename));

  itemEls.forEach((_, filename) => {
    if (!next.has(filename)) {
      removeItem(filename);
    }
  });

  items.forEach((item) => {
    const existing = itemEls.get(item.filename);
    if (existing) {
      applyLayout(existing, item);
      return;
    }
    appendItem(item);
  });
}

async function loadLuux() {
  try {
    const res = await fetch("/api/slots");
    if (!res.ok) throw new Error("Failed to load list");
    const items = await res.json();
    syncOverlay(items);
  } catch (err) {
    if (emptyEl) {
      emptyEl.textContent = "그림을 불러오지 못했습니다.";
      if (itemEls.size === 0) {
        emptyEl.style.display = "block";
      }
    }
  }
}

loadLuux();
setInterval(loadLuux, POLL_MS);
