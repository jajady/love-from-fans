const canvas = document.querySelector("canvas");
const ctx = canvas.getContext("2d");

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

ctx.lineWidth = 5;
ctx.strokeStyle = "black";
ctx.lineCap = "round";
ctx.lineJoin = "round";

function saveSnapshot() {
  history.push(canvas.toDataURL("image/png", 1.0));
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
function startDrawing(e) {
  isDrawing = true;
  hasStroke = false;
  ctx.beginPath();
  ctx.moveTo(e.offsetX, e.offsetY);
}

function drawing(e) {
  if (!isDrawing) return;
  hasStroke = true;
  if (isErasing) {
    // 지우개(선 지우기)
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = ERASER_SIZE;
    ctx.lineTo(e.offsetX, e.offsetY);
    ctx.stroke();
    ctx.restore();
  } else {
    // 그리기
    ctx.lineTo(e.offsetX, e.offsetY);
    ctx.stroke();
  }
}

function stopDrawing() {
  isDrawing = false;
  ctx.closePath();
  if (hasStroke) {
    saveSnapshot();
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
canvas.addEventListener("mousedown", startDrawing);
canvas.addEventListener("mousemove", drawing);
canvas.addEventListener("mouseup", stopDrawing);
colorBtns.forEach((button) => button.addEventListener("click", changeColor));
eraserBtn.addEventListener("click", startErasing);
downloadBtn.addEventListener("click", downloadCanvas);
undoBtn.addEventListener("click", undoStroke);

saveSnapshot();
