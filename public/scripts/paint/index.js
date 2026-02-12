import { createPainter } from "./painter.js";
import { createStickerManager } from "./stickers.js";

const canvas = document.querySelector("canvas");
const colorBtns = document.querySelectorAll(".color-btn");
const eraserBtn = document.querySelector("#eraser");
const downloadBtn = document.querySelector("#download");
const undoBtn = document.querySelector("#undo");
const stickerLayer = document.querySelector("#stickerLayer");
const stickerButtons = document.querySelectorAll(".big-sticker, .small-sticker");

const BIG_STICKER_SIZE = 160;
const SMALL_STICKER_SIZE = 110;

const painter = createPainter({ canvas, colorBtns, eraserBtn });
painter.bindCanvas();
painter.bindTools();

const stickerManager = createStickerManager({ stickerLayer });
stickerManager.bind();

undoBtn.addEventListener("click", painter.undo);

async function downloadCanvas() {
  const image = await stickerManager.exportComposite(canvas);
  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ dataUrl: image }),
    });

    if (!res.ok) {
      throw new Error("Upload failed");
    }

    const data = await res.json();
    alert(`저장 완료: ${data.filename}`);
  } catch (err) {
    alert("저장에 실패했습니다. 서버가 켜져있는지 확인해주세요.");
  }
}

downloadBtn.addEventListener("click", downloadCanvas);

stickerButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const img = button.querySelector("img");
    if (!img) return;
    const size = button.classList.contains("big-sticker")
      ? BIG_STICKER_SIZE
      : SMALL_STICKER_SIZE;
    stickerManager.addSticker(img.src, size);
  });
});
