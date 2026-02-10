const gridEl = document.querySelector("#galleryGrid");
const emptyEl = document.querySelector("#galleryEmpty");

function showEmpty(message) {
  emptyEl.textContent = message;
  emptyEl.style.display = "block";
}

function hideEmpty() {
  emptyEl.style.display = "none";
}

function renderGallery(items) {
  gridEl.replaceChildren();

  if (!Array.isArray(items) || items.length === 0) {
    showEmpty("아직 저장된 그림이 없습니다.");
    return;
  }

  hideEmpty();
  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "gallery-card";

    const img = document.createElement("img");
    img.src = item.url;
    img.alt = item.filename;
    img.loading = "lazy";

    const label = document.createElement("p");
    label.textContent = item.filename;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "gallery-delete";
    deleteBtn.type = "button";
    deleteBtn.textContent = "삭제";
    deleteBtn.addEventListener("click", async () => {
      const ok = confirm("정말 삭제하시겠어요?");
      if (!ok) return;
      try {
        const res = await fetch("/api/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: item.filename }),
        });
        if (!res.ok) throw new Error("Delete failed");
        await loadGallery();
      } catch (err) {
        alert("삭제에 실패했습니다. 서버가 켜져있는지 확인해주세요.");
      }
    });

    card.appendChild(img);
    card.appendChild(label);
    card.appendChild(deleteBtn);
    gridEl.appendChild(card);
  });
}

async function loadGallery() {
  try {
    const res = await fetch("/api/list");
    if (!res.ok) throw new Error("Failed to load gallery");
    const items = await res.json();
    renderGallery(items);
  } catch (err) {
    gridEl.replaceChildren();
    showEmpty("갤러리를 불러오지 못했습니다.");
  }
}

loadGallery();
