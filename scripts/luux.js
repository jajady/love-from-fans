const overlayEl = document.querySelector("#luuxOverlay");
const emptyEl = document.querySelector("#luuxEmpty");

async function loadLuux() {
  try {
    const res = await fetch("/api/list");
    if (!res.ok) throw new Error("Failed to load list");
    const items = await res.json();

    if (!Array.isArray(items) || items.length === 0) {
      emptyEl.style.display = "block";
      return;
    }

    emptyEl.style.display = "none";
    items.forEach((item) => {
      const img = document.createElement("img");
      img.src = item.url;
      img.alt = item.filename;
      img.loading = "lazy";
      overlayEl.appendChild(img);
    });
  } catch (err) {
    emptyEl.textContent = "그림을 불러오지 못했습니다.";
    emptyEl.style.display = "block";
  }
}

loadLuux();
