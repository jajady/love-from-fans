const STICKER_LONG_PRESS_MS = 400;
const STICKER_MIN_SIZE = 40;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function createStickerManager({ stickerLayer }) {
  const stickers = new Map();
  let activeStickerId = null;
  let dragState = null;
  let longPressTimer = null;
  let longPressInfo = null;

  function getLayerRect() {
    return stickerLayer.getBoundingClientRect();
  }

  function setStickerPosition(sticker, x, y) {
    sticker.x = x;
    sticker.y = y;
    sticker.el.style.left = `${x}px`;
    sticker.el.style.top = `${y}px`;
  }

  function setStickerSize(sticker, width, height) {
    sticker.w = width;
    sticker.h = height;
    sticker.el.style.width = `${width}px`;
    sticker.el.style.height = `${height}px`;
  }

  function getStickerRatio(sticker) {
    if (sticker.ratio && Number.isFinite(sticker.ratio)) {
      return sticker.ratio;
    }
    if (sticker.w && sticker.h) {
      return sticker.w / sticker.h;
    }
    return 1;
  }

  function getSizeForRatio(targetSize, ratio) {
    if (!Number.isFinite(ratio) || ratio <= 0) {
      return { width: targetSize, height: targetSize };
    }
    if (ratio >= 1) {
      return { width: targetSize, height: targetSize / ratio };
    }
    return { width: targetSize * ratio, height: targetSize };
  }

  function getMinSizeForRatio(ratio) {
    if (!Number.isFinite(ratio) || ratio <= 0) {
      return { minW: STICKER_MIN_SIZE, minH: STICKER_MIN_SIZE };
    }
    if (ratio >= 1) {
      return { minW: STICKER_MIN_SIZE * ratio, minH: STICKER_MIN_SIZE };
    }
    return { minW: STICKER_MIN_SIZE, minH: STICKER_MIN_SIZE / ratio };
  }

  function clearSelection() {
    activeStickerId = null;
    stickers.forEach((sticker) => {
      sticker.el.classList.remove("selected");
      sticker.el.style.zIndex = "1";
    });
  }

  function selectSticker(id) {
    activeStickerId = id;
    stickers.forEach((sticker) => {
      const isActive = sticker.id === id;
      sticker.el.classList.toggle("selected", isActive);
      sticker.el.style.zIndex = isActive ? "10" : "1";
    });
  }

  function createStickerElement(src) {
    const wrapper = document.createElement("div");
    wrapper.className = "sticker-item";
    wrapper.dataset.id = `sticker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const img = document.createElement("img");
    img.src = src;
    img.alt = "";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "sticker-delete";
    deleteBtn.textContent = "×";
    deleteBtn.setAttribute("aria-label", "스티커 삭제");

    const handle = document.createElement("div");
    handle.className = "sticker-handle";
    handle.setAttribute("aria-hidden", "true");

    wrapper.appendChild(img);
    wrapper.appendChild(deleteBtn);
    wrapper.appendChild(handle);

    return { wrapper, img, deleteBtn, handle };
  }

  function addSticker(src, size) {
    const { wrapper, img, deleteBtn, handle } = createStickerElement(src);
    stickerLayer.appendChild(wrapper);

    const id = wrapper.dataset.id;
    const rect = getLayerRect();
    const ratio =
      img.complete && img.naturalWidth && img.naturalHeight
        ? img.naturalWidth / img.naturalHeight
        : 1;
    const initialSize = getSizeForRatio(size, ratio);
    const width = initialSize.width;
    const height = initialSize.height;
    const x = clamp((rect.width - width) / 2, 0, rect.width - width);
    const y = clamp((rect.height - height) / 2, 0, rect.height - height);

    const sticker = {
      id,
      src,
      el: wrapper,
      imgEl: img,
      x,
      y,
      w: width,
      h: height,
      ratio,
      baseSize: size,
      hasCustomSize: false,
    };

    stickers.set(id, sticker);
    setStickerSize(sticker, width, height);
    setStickerPosition(sticker, x, y);
    selectSticker(id);

    img.addEventListener("load", () => {
      if (sticker.hasCustomSize) return;
      if (!img.naturalWidth || !img.naturalHeight) return;
      const nextRatio = img.naturalWidth / img.naturalHeight;
      if (!Number.isFinite(nextRatio) || nextRatio <= 0) return;
      if (Math.abs(nextRatio - sticker.ratio) < 0.001) return;
      const centerX = sticker.x + sticker.w / 2;
      const centerY = sticker.y + sticker.h / 2;
      const sized = getSizeForRatio(sticker.baseSize, nextRatio);
      const nextW = sized.width;
      const nextH = sized.height;
      const layerRect = getLayerRect();
      const nextX = clamp(centerX - nextW / 2, 0, layerRect.width - nextW);
      const nextY = clamp(centerY - nextH / 2, 0, layerRect.height - nextH);
      sticker.ratio = nextRatio;
      setStickerSize(sticker, nextW, nextH);
      setStickerPosition(sticker, nextX, nextY);
    });

    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      stickers.delete(id);
      wrapper.remove();
      if (activeStickerId === id) {
        activeStickerId = null;
      }
    });

    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectSticker(id);
      startResize(e, sticker);
    });

    wrapper.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target === deleteBtn || e.target === handle) return;
      e.preventDefault();
      if (activeStickerId === id) {
        startDrag(e, sticker);
        return;
      }
      startLongPress(e, sticker);
    });
  }

  function startDrag(e, sticker) {
    dragState = {
      type: "drag",
      id: sticker.id,
      startX: e.clientX,
      startY: e.clientY,
      originX: sticker.x,
      originY: sticker.y,
    };
    sticker.el.setPointerCapture?.(e.pointerId);
  }

  function startResize(e, sticker) {
    sticker.hasCustomSize = true;
    dragState = {
      type: "resize",
      id: sticker.id,
      startX: e.clientX,
      startY: e.clientY,
      originW: sticker.w,
      originH: sticker.h,
    };
    sticker.el.setPointerCapture?.(e.pointerId);
  }

  function startLongPress(e, sticker) {
    clearLongPress();
    longPressInfo = {
      id: sticker.id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
    };
    longPressTimer = window.setTimeout(() => {
      if (!longPressInfo || longPressInfo.id !== sticker.id) return;
      selectSticker(sticker.id);
      startDrag(
        { clientX: longPressInfo.currentX, clientY: longPressInfo.currentY, pointerId: e.pointerId },
        sticker
      );
      clearLongPress();
    }, STICKER_LONG_PRESS_MS);
  }

  function clearLongPress() {
    if (longPressTimer) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressInfo = null;
  }

  function handlePointerMove(e) {
    if (longPressInfo && longPressInfo.pointerId === e.pointerId) {
      longPressInfo.currentX = e.clientX;
      longPressInfo.currentY = e.clientY;
      const dx = e.clientX - longPressInfo.startX;
      const dy = e.clientY - longPressInfo.startY;
      if (Math.hypot(dx, dy) > 6) {
        clearLongPress();
      }
    }

    if (!dragState) return;
    const sticker = stickers.get(dragState.id);
    if (!sticker) return;

    const rect = getLayerRect();
    if (dragState.type === "drag") {
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      const nextX = clamp(dragState.originX + dx, 0, rect.width - sticker.w);
      const nextY = clamp(dragState.originY + dy, 0, rect.height - sticker.h);
      setStickerPosition(sticker, nextX, nextY);
      return;
    }

    if (dragState.type === "resize") {
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      const ratio = getStickerRatio(sticker);
      const { minW, minH } = getMinSizeForRatio(ratio);
      const maxW = rect.width - sticker.x;
      const maxH = rect.height - sticker.y;
      const maxScale = Math.min(maxW / dragState.originW, maxH / dragState.originH);
      const minScale = Math.max(minW / dragState.originW, minH / dragState.originH);
      const scaleX = (dragState.originW + dx) / dragState.originW;
      const scaleY = (dragState.originH + dy) / dragState.originH;
      let scale = Math.abs(dx) >= Math.abs(dy) ? scaleX : scaleY;
      if (!Number.isFinite(scale)) {
        scale = 1;
      }
      scale = clamp(scale, minScale, maxScale);
      const nextW = dragState.originW * scale;
      const nextH = dragState.originH * scale;
      setStickerSize(sticker, nextW, nextH);
    }
  }

  function handlePointerUp(e) {
    if (longPressInfo && longPressInfo.pointerId === e.pointerId) {
      clearLongPress();
    }
    dragState = null;
  }

  async function exportComposite(canvas) {
    if (stickers.size === 0) {
      return canvas.toDataURL("image/png", 1.0);
    }

    const layerRect = getLayerRect();
    const scaleX = canvas.width / layerRect.width;
    const scaleY = canvas.height / layerRect.height;

    const composed = document.createElement("canvas");
    composed.width = canvas.width;
    composed.height = canvas.height;
    const composedCtx = composed.getContext("2d");
    composedCtx.drawImage(canvas, 0, 0);

    const elements = Array.from(stickerLayer.querySelectorAll(".sticker-item"));
    for (const el of elements) {
      const sticker = stickers.get(el.dataset.id);
      if (!sticker) continue;
      const img = sticker.imgEl;
      if (!img.complete) {
        try {
          await img.decode();
        } catch (err) {
          // ignore decode errors
        }
      }
      composedCtx.drawImage(
        img,
        sticker.x * scaleX,
        sticker.y * scaleY,
        sticker.w * scaleX,
        sticker.h * scaleY
      );
    }

    return composed.toDataURL("image/png", 1.0);
  }

  function bind() {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    document.addEventListener("pointerdown", (e) => {
      if (!e.target.closest(".sticker-item")) {
        clearSelection();
      }
    });
  }

  return {
    addSticker,
    bind,
    clearSelection,
    exportComposite,
  };
}
