const gridEl = document.querySelector("#galleryGrid");
const emptyEl = document.querySelector("#galleryEmpty");
const titleEl = document.querySelector(".gallery-header h1");
const backLink = document.querySelector("#galleryBack");
const trashLink = document.querySelector("#galleryTrash");
const params = new URLSearchParams(window.location.search);
const trashParam = params.get("trash");

let authPrompting = false;

async function ensureLogin() {
  if (authPrompting) return false;
  authPrompting = true;
  const password = prompt("관리자 비밀번호를 입력하세요.");
  authPrompting = false;
  if (!password) return false;
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    alert("비밀번호가 올바르지 않습니다.");
    return false;
  }
  return true;
}

async function fetchWithAuth(url, options) {
  const res = await fetch(url, options);
  if (res.status !== 401) return res;
  const loggedIn = await ensureLogin();
  if (!loggedIn) return res;
  return fetch(url, options);
}

function showEmpty(message) {
  emptyEl.textContent = message;
  emptyEl.style.display = "block";
}

function hideEmpty() {
  emptyEl.style.display = "none";
}

function createGalleryCard(item, onDelete) {
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
  deleteBtn.addEventListener("click", onDelete);

  card.appendChild(img);
  card.appendChild(label);
  card.appendChild(deleteBtn);
  return card;
}

function renderBatches(payload) {
  gridEl.replaceChildren();
  gridEl.classList.remove("gallery-grid");
  gridEl.classList.add("gallery-batches");

  const batches = payload?.batches;
  if (!Array.isArray(batches) || batches.length === 0) {
    showEmpty("아직 저장된 그림이 없습니다.");
    return;
  }

  hideEmpty();
  gridEl.classList.add("gallery-batches");
  const batchSize = Number(payload?.batchSize) || 24;
  const selectedIndex = Number(payload?.selectedIndex);

  batches.forEach((batch) => {
    const section = document.createElement("section");
    section.className = "gallery-batch";
    if (batch.isSelected) {
      section.classList.add("selected");
    }

    const header = document.createElement("div");
    header.className = "gallery-batch-header";

    const title = document.createElement("h2");
    const batchNumber = Number(batch.index) + 1;
    const count = Number(batch.count) || 0;
    title.textContent = `묶음 ${batchNumber} (${count}/${batchSize})`;

    const actions = document.createElement("div");
    actions.className = "gallery-batch-actions";

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "gallery-batch-select";
    if (batch.isSelected || batch.index === selectedIndex) {
      selectBtn.textContent = "Luux 표시중";
      selectBtn.disabled = true;
    } else {
      selectBtn.textContent = "Luux에 표시";
      selectBtn.addEventListener("click", async () => {
        try {
          const res = await fetchWithAuth("/api/batches/select", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ index: batch.index }),
          });
          if (!res.ok) throw new Error("Select failed");
          await loadGallery();
        } catch (err) {
          alert("Luux 선택에 실패했습니다. 서버가 켜져있는지 확인해주세요.");
        }
      });
    }

    actions.appendChild(selectBtn);
    header.appendChild(title);
    header.appendChild(actions);

    const grid = document.createElement("div");
    grid.className = "gallery-grid gallery-batch-grid";

    const items = Array.isArray(batch.items) ? batch.items : [];
    items.forEach((item) => {
      const card = createGalleryCard(item, async () => {
        const ok = confirm("정말 삭제하시겠어요?");
        if (!ok) return;
        try {
          const res = await fetchWithAuth("/api/delete", {
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
      grid.appendChild(card);
    });

    section.appendChild(header);
    section.appendChild(grid);
    gridEl.appendChild(section);
  });
}

function renderTrash(items) {
  gridEl.replaceChildren();
  gridEl.classList.remove("gallery-batches");
  gridEl.classList.add("gallery-grid");

  if (!Array.isArray(items) || items.length === 0) {
    showEmpty("휴지통이 비어 있습니다.");
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

    const restoreBtn = document.createElement("button");
    restoreBtn.className = "gallery-restore";
    restoreBtn.type = "button";
    restoreBtn.textContent = "복원";
    restoreBtn.addEventListener("click", async () => {
      try {
        const res = await fetchWithAuth("/api/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id }),
        });
        if (!res.ok) throw new Error("Restore failed");
        await loadTrash();
      } catch (err) {
        alert("복원에 실패했습니다. 서버가 켜져있는지 확인해주세요.");
      }
    });

    card.appendChild(img);
    card.appendChild(label);
    card.appendChild(restoreBtn);
    gridEl.appendChild(card);
  });
}

async function loadTrash() {
  try {
    const res = await fetchWithAuth("/api/trash");
    if (!res.ok) throw new Error("Failed to load trash");
    const items = await res.json();
    renderTrash(items);
  } catch (err) {
    gridEl.replaceChildren();
    showEmpty("휴지통을 불러오지 못했습니다.");
  }
}

async function loadGallery() {
  try {
    const res = await fetchWithAuth("/api/batches");
    if (!res.ok) throw new Error("Failed to load gallery");
    const payload = await res.json();
    renderBatches(payload);
  } catch (err) {
    gridEl.replaceChildren();
    showEmpty("갤러리를 불러오지 못했습니다.");
  }
}

if (trashParam) {
  if (titleEl) {
    titleEl.textContent = "휴지통";
  }
  if (backLink) {
    backLink.style.display = "inline-flex";
  }
  if (trashLink) {
    trashLink.style.display = "none";
  }
  loadTrash();
} else {
  if (titleEl) {
    titleEl.textContent = "저장된 그림";
  }
  if (backLink) {
    backLink.style.display = "none";
  }
  if (trashLink) {
    trashLink.style.display = "inline-flex";
  }
  loadGallery();
}
