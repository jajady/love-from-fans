export function createPainter({ canvas, colorBtns, eraserBtn }) {
  const ctx = canvas.getContext("2d");
  canvas.style.touchAction = "none";

  ctx.lineWidth = 5;
  ctx.strokeStyle = "black";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  let isDrawing = false;
  let isErasing = false;
  const ERASER_SIZE = 20;
  let hasStroke = false;
  const history = [];
  const MAX_HISTORY = 20;

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
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = ERASER_SIZE;
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.restore();
    } else {
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

  function changeColor(e) {
    isErasing = false;
    ctx.strokeStyle = e.currentTarget.dataset.color;

    colorBtns.forEach((button) => {
      if (button === e.currentTarget) {
        button.classList.add("selected");
      } else {
        button.classList.remove("selected");
      }
    });
    eraserBtn.classList.remove("selected");
  }

  function undo() {
    if (history.length <= 1) return;
    history.pop();
    restoreSnapshot();
  }

  function bindCanvas() {
    canvas.addEventListener("pointerdown", startDrawing, { passive: false });
    canvas.addEventListener("pointermove", drawing, { passive: false });
    canvas.addEventListener("pointerup", stopDrawing);
    canvas.addEventListener("pointerleave", stopDrawing);
    canvas.addEventListener("pointercancel", stopDrawing);
    window.addEventListener("pointerup", stopDrawing);
    window.addEventListener("pointercancel", stopDrawing);
  }

  function bindTools() {
    colorBtns.forEach((button) => button.addEventListener("click", changeColor));
    eraserBtn.addEventListener("click", startErasing);
  }

  saveSnapshot();

  return {
    canvas,
    ctx,
    bindCanvas,
    bindTools,
    undo,
    getDataUrl() {
      return canvas.toDataURL("image/png", 1.0);
    },
  };
}
