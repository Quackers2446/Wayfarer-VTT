import {escape} from "./format.mjs";
import {icon} from "./icons.mjs";
import {storedImage, decodeImage} from "./character-token.mjs";

export function drawTokenFrame(ctx, cx, cy, r, style) {
  if (!style || style === "none") return;
  ctx.save();

  const fw = r * 0.088; // Frame width: ~22.5px on a 256px radius
  const outerR = r - fw / 2;

  let strokeGrad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  let innerStrokeColor = "rgba(0,0,0,0.45)";
  let outerStrokeColor = "rgba(0,0,0,0.55)";

  if (style === "gold") {
    strokeGrad.addColorStop(0, "#fff2a8");
    strokeGrad.addColorStop(0.2, "#dfb743");
    strokeGrad.addColorStop(0.5, "#f5de7a");
    strokeGrad.addColorStop(0.8, "#825c12");
    strokeGrad.addColorStop(1, "#caa034");
    innerStrokeColor = "#4a3406";
    outerStrokeColor = "#2b1d02";
  } else if (style === "silver") {
    strokeGrad.addColorStop(0, "#ffffff");
    strokeGrad.addColorStop(0.25, "#cfd8dc");
    strokeGrad.addColorStop(0.5, "#eceff1");
    strokeGrad.addColorStop(0.75, "#607d8b");
    strokeGrad.addColorStop(1, "#90a4ae");
    innerStrokeColor = "#37474f";
    outerStrokeColor = "#21292d";
  } else if (style === "iron") {
    strokeGrad.addColorStop(0, "#757575");
    strokeGrad.addColorStop(0.3, "#303030");
    strokeGrad.addColorStop(0.6, "#616161");
    strokeGrad.addColorStop(0.85, "#1e1e1e");
    strokeGrad.addColorStop(1, "#424242");
    innerStrokeColor = "#141414";
    outerStrokeColor = "#000000";
  } else if (style === "arcane") {
    strokeGrad.addColorStop(0, "#cffafe");
    strokeGrad.addColorStop(0.25, "#22d3ee");
    strokeGrad.addColorStop(0.5, "#06b6d4");
    strokeGrad.addColorStop(0.75, "#0e7490");
    strokeGrad.addColorStop(1, "#164e63");
    innerStrokeColor = "#164e63";
    outerStrokeColor = "#083344";
  } else if (style === "ruby") {
    strokeGrad.addColorStop(0, "#fecdd3");
    strokeGrad.addColorStop(0.25, "#f43f5e");
    strokeGrad.addColorStop(0.5, "#e11d48");
    strokeGrad.addColorStop(0.75, "#881337");
    strokeGrad.addColorStop(1, "#be123c");
    innerStrokeColor = "#4c0519";
    outerStrokeColor = "#24020a";
  }

  // Draw main ring
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.lineWidth = fw;
  ctx.strokeStyle = strokeGrad;
  ctx.stroke();

  // Inner dividing stroke
  ctx.beginPath();
  ctx.arc(cx, cy, r - fw, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.5, r * 0.012);
  ctx.strokeStyle = innerStrokeColor;
  ctx.stroke();

  // Outer border stroke
  ctx.beginPath();
  ctx.arc(cx, cy, r - 0.75, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.2, r * 0.01);
  ctx.strokeStyle = outerStrokeColor;
  ctx.stroke();

  ctx.restore();
}

export function renderTokenToCanvas(canvas, img, {panX, panY, zoom, transparent, bgColor, frame}) {
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;

  ctx.clearRect(0, 0, size, size);

  // 1. Clip to circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
  ctx.clip();

  // 2. Background color
  if (!transparent) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, size, size);
  }

  // 3. Draw image with pan and zoom
  if (img) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const minEdge = Math.min(img.naturalWidth, img.naturalHeight);
    const baseScale = size / minEdge;
    const s = baseScale * zoom;
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    const dx = cx - dw / 2 + panX;
    const dy = cy - dh / 2 + panY;

    ctx.drawImage(img, dx, dy, dw, dh);
  }

  ctx.restore();

  // 4. Draw frame on top
  drawTokenFrame(ctx, cx, cy, r, frame);
}

const BG_PRESETS = [
  {name: "Forest", color: "#192720"},
  {name: "Obsidian", color: "#111312"},
  {name: "Crimson", color: "#3b1414"},
  {name: "Navy", color: "#122038"},
  {name: "Violet", color: "#281438"},
  {name: "Parchment", color: "#382e18"},
  {name: "White", color: "#f5f5f5"}
];

const FRAMES = [
  {id: "none", name: "No Frame", color: "transparent"},
  {id: "gold", name: "Gold", color: "#dfb743"},
  {id: "silver", name: "Silver", color: "#b0bec5"},
  {id: "iron", name: "Dark Iron", color: "#424242"},
  {id: "arcane", name: "Arcane", color: "#06b6d4"},
  {id: "ruby", name: "Ruby", color: "#e11d48"}
];

export async function openTokenMaker({file, imageBlob, characterName = "Character", onSave, onCancel}) {
  let img = null;
  const blob = file || imageBlob;
  if (blob) {
    img = await decodeImage(blob).catch(() => null);
  }
  if (!img?.naturalWidth || !img?.naturalHeight) {
    throw new Error("This image could not be loaded for token creation.");
  }

  let dialog = document.getElementById("token-maker-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "token-maker-dialog";
    dialog.className = "token-maker-dialog";
    dialog.setAttribute("closedby", "any");
    dialog.setAttribute("aria-labelledby", "token-maker-title");
    document.body.appendChild(dialog);
  }

  // State
  let panX = 0;
  let panY = 0;
  let zoom = 1.0;
  let transparent = true;
  let bgColor = "#192720";
  let frame = "gold";

  // Build markup
  dialog.innerHTML = `
    <header class="token-maker-header">
      <div class="token-maker-title-group">
        <span class="token-maker-icon">${icon("users", 20)}</span>
        <div>
          <h2 id="token-maker-title">Token Maker &amp; Editor</h2>
          <p>Crop, style, and frame the token for ${escape(characterName)}</p>
        </div>
      </div>
      <button type="button" class="icon-button" data-token-action="cancel" aria-label="Close token maker">✕</button>
    </header>

    <div class="token-maker-body">
      <div class="token-preview-column">
        <div class="token-canvas-wrapper">
          <canvas width="512" height="512" class="token-preview-canvas" id="token-preview-canvas" aria-label="Token preview"></canvas>
        </div>
        <p class="token-preview-hint">Drag image to adjust position · Scroll to zoom</p>
        <div class="token-quick-buttons">
          <button type="button" class="button outline small" id="token-btn-fit" title="Fit entire image in token">Fit</button>
          <button type="button" class="button outline small" id="token-btn-fill" title="Fill circle edge-to-edge">Fill</button>
          <button type="button" class="button outline small" id="token-btn-center" title="Reset image position to center">Center</button>
        </div>
      </div>

      <div class="token-controls-column">
        <!-- Scale & Position -->
        <div class="token-control-group">
          <div class="token-group-header">
            <span>Size &amp; Scale</span>
            <span class="token-zoom-value" id="token-zoom-label">100%</span>
          </div>
          <div class="token-slider-row">
            <button type="button" class="token-step-btn" id="token-zoom-out" aria-label="Zoom out">−</button>
            <input type="range" id="token-zoom-range" min="0.2" max="3.5" step="0.02" value="1.0" aria-label="Zoom scale">
            <button type="button" class="token-step-btn" id="token-zoom-in" aria-label="Zoom in">+</button>
          </div>
        </div>

        <!-- Background & Transparency -->
        <div class="token-control-group">
          <div class="token-group-header">
            <span>Background</span>
          </div>
          <label class="token-check-label">
            <input type="checkbox" id="token-transparent-toggle" ${transparent ? "checked" : ""}>
            <span>Transparent background</span>
          </label>
          <div class="token-bg-options ${transparent ? "is-disabled" : ""}" id="token-bg-controls">
            <div class="token-color-presets">
              ${BG_PRESETS.map((p) => `
                <button type="button" class="token-color-swatch ${bgColor === p.color && !transparent ? "active" : ""}" data-color="${p.color}" title="${p.name}" style="background-color: ${p.color};"></button>
              `).join("")}
              <label class="token-color-picker-wrap" title="Custom color">
                <input type="color" id="token-custom-color" value="${bgColor}" aria-label="Custom background color">
                <span class="token-custom-color-indicator" style="background-color: ${bgColor};"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- Frame Selection -->
        <div class="token-control-group">
          <div class="token-group-header">
            <span>Token Frame</span>
          </div>
          <div class="token-frame-grid" role="radiogroup" aria-label="Token frame style">
            ${FRAMES.map((f) => `
              <button type="button" role="radio" aria-checked="${frame === f.id ? "true" : "false"}" class="token-frame-btn ${frame === f.id ? "active" : ""}" data-frame="${f.id}">
                <span class="token-frame-swatch ${f.id}"></span>
                <span>${f.name}</span>
              </button>
            `).join("")}
          </div>
        </div>
      </div>
    </div>

    <footer class="token-maker-footer">
      <button type="button" class="button outline" data-token-action="cancel">Cancel</button>
      <button type="button" class="button primary" id="token-save-btn">Save Token</button>
    </footer>
  `;

  const canvas = dialog.querySelector("#token-preview-canvas");
  const zoomRange = dialog.querySelector("#token-zoom-range");
  const zoomLabel = dialog.querySelector("#token-zoom-label");
  const transparentToggle = dialog.querySelector("#token-transparent-toggle");
  const bgControls = dialog.querySelector("#token-bg-controls");
  const customColorInput = dialog.querySelector("#token-custom-color");
  const customColorInd = dialog.querySelector(".token-custom-color-indicator");

  function redraw() {
    renderTokenToCanvas(canvas, img, {panX, panY, zoom, transparent, bgColor, frame});
    zoomLabel.textContent = Math.round(zoom * 100) + "%";
    zoomRange.value = zoom;
  }

  redraw();

  // Pointer drag on canvas
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let initialPanX = 0;
  let initialPanY = 0;

  canvas.addEventListener("pointerdown", (e) => {
    isDragging = true;
    canvas.setPointerCapture(e.pointerId);
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    initialPanX = panX;
    initialPanY = panY;
    canvas.classList.add("is-dragging");
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    // The canvas is displayed at 256px wide, internal buffer is 512px (ratio = 2)
    const scaleFactor = canvas.width / canvas.clientWidth;
    panX = initialPanX + (e.clientX - dragStartX) * scaleFactor;
    panY = initialPanY + (e.clientY - dragStartY) * scaleFactor;
    redraw();
  });

  const stopDrag = (e) => {
    if (isDragging) {
      isDragging = false;
      canvas.classList.remove("is-dragging");
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    }
  };

  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);

  // Wheel to zoom
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    zoom = Math.min(3.5, Math.max(0.2, zoom * factor));
    redraw();
  }, {passive: false});

  // Zoom controls
  zoomRange.addEventListener("input", () => {
    zoom = Number(zoomRange.value);
    redraw();
  });

  dialog.querySelector("#token-zoom-in").addEventListener("click", () => {
    zoom = Math.min(3.5, Math.round((zoom + 0.1) * 10) / 10);
    redraw();
  });

  dialog.querySelector("#token-zoom-out").addEventListener("click", () => {
    zoom = Math.max(0.2, Math.round((zoom - 0.1) * 10) / 10);
    redraw();
  });

  // Fit, Fill, Center
  dialog.querySelector("#token-btn-fit").addEventListener("click", () => {
    const minEdge = Math.min(img.naturalWidth, img.naturalHeight);
    const maxEdge = Math.max(img.naturalWidth, img.naturalHeight);
    zoom = minEdge / maxEdge;
    panX = 0;
    panY = 0;
    redraw();
  });

  dialog.querySelector("#token-btn-fill").addEventListener("click", () => {
    zoom = 1.0;
    panX = 0;
    panY = 0;
    redraw();
  });

  dialog.querySelector("#token-btn-center").addEventListener("click", () => {
    panX = 0;
    panY = 0;
    redraw();
  });

  // Background controls
  transparentToggle.addEventListener("change", () => {
    transparent = transparentToggle.checked;
    bgControls.classList.toggle("is-disabled", transparent);
    updateColorSwatches();
    redraw();
  });

  function updateColorSwatches() {
    for (const swatch of dialog.querySelectorAll(".token-color-swatch")) {
      swatch.classList.toggle("active", !transparent && swatch.dataset.color === bgColor);
    }
    if (customColorInd) customColorInd.style.backgroundColor = bgColor;
  }

  bgControls.addEventListener("click", (e) => {
    const swatch = e.target.closest(".token-color-swatch");
    if (!swatch) return;
    bgColor = swatch.dataset.color;
    transparent = false;
    transparentToggle.checked = false;
    bgControls.classList.remove("is-disabled");
    updateColorSwatches();
    redraw();
  });

  customColorInput.addEventListener("input", () => {
    bgColor = customColorInput.value;
    transparent = false;
    transparentToggle.checked = false;
    bgControls.classList.remove("is-disabled");
    updateColorSwatches();
    redraw();
  });

  // Frame buttons
  const frameGrid = dialog.querySelector(".token-frame-grid");
  frameGrid.addEventListener("click", (e) => {
    const btn = e.target.closest(".token-frame-btn");
    if (!btn) return;
    frame = btn.dataset.frame;
    for (const b of frameGrid.querySelectorAll(".token-frame-btn")) {
      const active = b === btn;
      b.classList.toggle("active", active);
      b.setAttribute("aria-checked", active ? "true" : "false");
    }
    redraw();
  });

  // Cancel & Close
  function closeDialog() {
    dialog.close();
    onCancel?.();
  }

  for (const btn of dialog.querySelectorAll('[data-token-action="cancel"]')) {
    btn.addEventListener("click", closeDialog);
  }

  // Light dismiss fallback
  if (!("closedBy" in HTMLDialogElement.prototype)) {
    dialog.addEventListener("click", (e) => {
      if (e.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside = rect.top <= e.clientY && e.clientY <= rect.bottom && rect.left <= e.clientX && e.clientX <= rect.right;
      if (!inside) closeDialog();
    });
  }

  // Save Token
  const saveBtn = dialog.querySelector("#token-save-btn");
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = exportCanvas.height = 512;
      renderTokenToCanvas(exportCanvas, img, {panX, panY, zoom, transparent, bgColor, frame});

      const tokenBlob = await new Promise((resolve) => exportCanvas.toBlob(resolve, "image/webp", 0.92));
      if (!tokenBlob) throw new Error("Could not create token image blob.");

      const digest = await crypto.subtle.digest("SHA-256", await tokenBlob.arrayBuffer());
      const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      await storedImage(id, tokenBlob);

      dialog.close();
      await onSave?.(id);
    } catch (err) {
      alert("Error saving token: " + err.message);
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Token";
    }
  });

  dialog.showModal();
}
