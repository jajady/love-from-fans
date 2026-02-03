const gridEl = document.querySelector("#galleryGrid");
const emptyEl = document.querySelector("#galleryEmpty");

async function loadGallery() {
  try {
    const res = await fetch("/api/list");
    if (!res.ok) throw new Error("Failed to load gallery");
    const items = await res.json();

    if (!Array.isArray(items) || items.length === 0) {
      emptyEl.style.display = "block";
      return;
    }

    emptyEl.style.display = "none";
    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "gallery-card";

      const img = document.createElement("img");
      img.src = item.url;
      img.alt = item.filename;
      img.loading = "lazy";

      const label = document.createElement("p");
      label.textContent = item.filename;

      card.appendChild(img);
      card.appendChild(label);
      gridEl.appendChild(card);
    });
  } catch (err) {
    emptyEl.textContent = "갤러리를 불러오지 못했습니다.";
    emptyEl.style.display = "block";
  }
}

loadGallery();
