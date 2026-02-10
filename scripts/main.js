const canvas = document.querySelector("canvas");
const ctx = canvas.getContext("2d");
canvas.style.touchAction = "none";

const colorBtns = document.querySelectorAll(".pallet button");
const eraserBtn = document.querySelector("#eraser");
const downloadBtn = document.querySelector("#download");
const undoBtn = document.querySelector("#undo");

// 그리기 설정
let isDrawing = false;
let isErasing = false;
const ERASER_SIZE = 20;
let hasStroke = false;
const history = [];
const MAX_HISTORY = 20;

ctx.lineWidth = 5;
ctx.strokeStyle = "black";
ctx.lineCap = "round";
ctx.lineJoin = "round";

function saveSnapshot() {
  history.push(canvas.toDataURL("image/png", 1.0));
  while (history.length > MAX_HISTORY) {
    history.shift();
  }
}

function restoreSnapshot() {
  if (history.length === 0) return;
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  };
  img.src = history[history.length - 1];
}

// 이벤트 리스너
function getCanvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  if (e.touches && e.touches.length > 0) {
    return {
      x: e.touches[0].clientX - rect.left,
      y: e.touches[0].clientY - rect.top,
    };
  }
  if (e.changedTouches && e.changedTouches.length > 0) {
    return {
      x: e.changedTouches[0].clientX - rect.left,
      y: e.changedTouches[0].clientY - rect.top,
    };
  }
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function startDrawing(e) {
  if (e.button !== undefined && e.button !== 0) return;
  isDrawing = true;
  hasStroke = false;
  if (e.pointerId !== undefined && canvas.setPointerCapture) {
    canvas.setPointerCapture(e.pointerId);
  }
  const { x, y } = getCanvasPoint(e);
  ctx.beginPath();
  ctx.moveTo(x, y);
}

function drawing(e) {
  if (!isDrawing) return;
  hasStroke = true;
  const { x, y } = getCanvasPoint(e);
  if (isErasing) {
    // 지우개(선 지우기)
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = ERASER_SIZE;
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.restore();
  } else {
    // 그리기
    ctx.lineTo(x, y);
    ctx.stroke();
  }
}

function stopDrawing(e) {
  if (!isDrawing) return;
  isDrawing = false;
  ctx.closePath();
  if (hasStroke) {
    saveSnapshot();
  }
  if (e && e.pointerId !== undefined && canvas.releasePointerCapture) {
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (err) {
      // ignore
    }
  }
}

function startErasing(e) {
  isErasing = true;
  colorBtns.forEach((button) => button.classList.remove("selected"));
  e.currentTarget.classList.add("selected");
}

async function downloadCanvas() {
  const image = canvas.toDataURL("image/png", 1.0);
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

function undoStroke() {
  if (history.length <= 1) return;
  history.pop();
  restoreSnapshot();
}

function changeColor(e) {
  isErasing = false;
  ctx.strokeStyle = e.currentTarget.dataset.color;

  // 내가 선택한 색상 활성화
  colorBtns.forEach((button) => {
    if (button === e.currentTarget) {
      button.classList.add("selected");
    } else {
      button.classList.remove("selected");
    }
  });
  eraserBtn.classList.remove("selected");
}

// 이벤트 연결
canvas.addEventListener("pointerdown", startDrawing, { passive: false });
canvas.addEventListener("pointermove", drawing, { passive: false });
canvas.addEventListener("pointerup", stopDrawing);
canvas.addEventListener("pointerleave", stopDrawing);
canvas.addEventListener("pointercancel", stopDrawing);
window.addEventListener("pointerup", stopDrawing);
window.addEventListener("pointercancel", stopDrawing);
colorBtns.forEach((button) => button.addEventListener("click", changeColor));
eraserBtn.addEventListener("click", startErasing);
downloadBtn.addEventListener("click", downloadCanvas);
undoBtn.addEventListener("click", undoStroke);

saveSnapshot();
