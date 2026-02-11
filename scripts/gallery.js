const gridEl = document.querySelector("#galleryGrid");
const emptyEl = document.querySelector("#galleryEmpty");
const titleEl = document.querySelector(".gallery-header h1");
const backLink = document.querySelector("#galleryBack");
const params = new URLSearchParams(window.location.search);
const folderParam = params.get("folder");

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
          body: JSON.stringify({ path: item.path || item.filename }),
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

function renderFolders(folders) {
  gridEl.replaceChildren();

  if (!Array.isArray(folders) || folders.length === 0) {
    showEmpty("폴더가 없습니다.");
    return;
  }

  hideEmpty();
  folders.forEach((folder) => {
    const card = document.createElement("a");
    card.className = "gallery-card gallery-folder";
    card.href = `/gallery.html?folder=${encodeURIComponent(folder.folder)}`;

    const title = document.createElement("p");
    title.className = "folder-title";
    title.textContent = folder.folder;

    const count = document.createElement("p");
    count.className = "folder-count";
    count.textContent = `${folder.count}장`;

    card.appendChild(title);
    card.appendChild(count);
    gridEl.appendChild(card);
  });
}

async function loadFolders() {
  try {
    const res = await fetch("/api/folders");
    if (!res.ok) throw new Error("Failed to load folders");
    const folders = await res.json();
    renderFolders(folders);
  } catch (err) {
    gridEl.replaceChildren();
    showEmpty("폴더 목록을 불러오지 못했습니다.");
  }
}

async function loadGallery() {
  try {
    const res = await fetch(`/api/list?folder=${encodeURIComponent(folderParam)}`);
    if (!res.ok) throw new Error("Failed to load gallery");
    const items = await res.json();
    renderGallery(items);
  } catch (err) {
    gridEl.replaceChildren();
    showEmpty("갤러리를 불러오지 못했습니다.");
  }
}

if (folderParam) {
  if (titleEl) {
    titleEl.textContent = `폴더: ${folderParam}`;
  }
  if (backLink) {
    backLink.style.display = "inline-flex";
  }
  loadGallery();
} else {
  if (backLink) {
    backLink.style.display = "none";
  }
  loadFolders();
}
