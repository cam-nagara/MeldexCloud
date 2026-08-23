(function () {
  'use strict';

  const SETTINGS_KEY = 'meldex-quick-memo-pen-settings-v2';
  const HISTORY_LIMIT = 80;
  const COLOR_TOLERANCE = 18;

  function safeSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return {
        color: /^#[0-9a-f]{6}$/i.test(parsed.color || '') ? parsed.color : '#4ec9b0',
        opacity: Math.max(1, Math.min(100, Number(parsed.opacity) || 100)),
        width: Math.max(2, Math.min(24, Number(parsed.width) || 4)),
      };
    } catch (_) {
      return { color: '#4ec9b0', opacity: 100, width: 4 };
    }
  }

  function hexRgba(hex, opacity) {
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
      a: Math.round(255 * opacity / 100),
    };
  }

  function pointFromEvent(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
      nx: rect.width ? (event.clientX - rect.left) / rect.width : 0,
      ny: rect.height ? (event.clientY - rect.top) / rect.height : 0,
    };
  }

  function configureStroke(context, command, width, height) {
    context.globalCompositeOperation = command.tool === 'eraser' ? 'destination-out' : 'source-over';
    context.globalAlpha = command.tool === 'eraser' ? 1 : command.opacity / 100;
    context.strokeStyle = command.color;
    context.fillStyle = command.color;
    context.lineWidth = Math.max(1, command.widthRatio * Math.min(width, height));
    context.lineCap = 'round';
    context.lineJoin = 'round';
  }

  function drawStroke(context, command, width, height) {
    if (!command.points.length) return;
    configureStroke(context, command, width, height);
    const points = command.points.map((point) => ({ x: point.x * width, y: point.y * height }));
    if (points.length === 1) {
      context.beginPath();
      context.arc(points[0].x, points[0].y, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
      return;
    }
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index].x, points[index].y);
    }
    context.stroke();
  }

  function matchesTarget(data, index, target) {
    const alpha = data[index + 3];
    if (target.a <= COLOR_TOLERANCE && alpha <= COLOR_TOLERANCE) return true;
    return Math.abs(data[index] - target.r) <= COLOR_TOLERANCE
      && Math.abs(data[index + 1] - target.g) <= COLOR_TOLERANCE
      && Math.abs(data[index + 2] - target.b) <= COLOR_TOLERANCE
      && Math.abs(alpha - target.a) <= COLOR_TOLERANCE;
  }

  function findFillSpans(imageData, startX, startY) {
    const { width, height, data } = imageData;
    const visited = new Uint8Array(width * height);
    const startIndex = (startY * width + startX) * 4;
    const target = { r: data[startIndex], g: data[startIndex + 1], b: data[startIndex + 2], a: data[startIndex + 3] };
    const stack = [[startX, startY]];
    const spans = [];
    let touchesEdge = false;

    while (stack.length) {
      const [seedX, y] = stack.pop();
      if (seedX < 0 || seedX >= width || y < 0 || y >= height) continue;
      let left = seedX;
      while (left > 0 && !visited[y * width + left - 1] && matchesTarget(data, (y * width + left - 1) * 4, target)) left -= 1;
      let right = left;
      while (right < width && !visited[y * width + right] && matchesTarget(data, (y * width + right) * 4, target)) right += 1;
      right -= 1;
      if (right < left) continue;
      for (let x = left; x <= right; x += 1) visited[y * width + x] = 1;
      spans.push([y, left, right]);
      if (left === 0 || right === width - 1 || y === 0 || y === height - 1) touchesEdge = true;
      [y - 1, y + 1].forEach((nextY) => {
        if (nextY < 0 || nextY >= height) return;
        let inRun = false;
        for (let x = left; x <= right; x += 1) {
          const match = !visited[nextY * width + x] && matchesTarget(data, (nextY * width + x) * 4, target);
          if (match && !inRun) stack.push([x, nextY]);
          inRun = match;
        }
      });
    }
    return { spans, touchesEdge, target };
  }

  function floodFill(context, canvas, command, rejectOpen) {
    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(command.x * canvas.width)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(command.y * canvas.height)));
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const found = findFillSpans(imageData, x, y);
    if (rejectOpen && found.touchesEdge) return { changed: false, open: true };
    const replacement = hexRgba(command.color, command.opacity);
    if (
      Math.abs(found.target.r - replacement.r) <= COLOR_TOLERANCE
      && Math.abs(found.target.g - replacement.g) <= COLOR_TOLERANCE
      && Math.abs(found.target.b - replacement.b) <= COLOR_TOLERANCE
      && Math.abs(found.target.a - replacement.a) <= COLOR_TOLERANCE
    ) return { changed: false, open: false };
    found.spans.forEach(([row, left, right]) => {
      for (let column = left; column <= right; column += 1) {
        const index = (row * canvas.width + column) * 4;
        imageData.data[index] = replacement.r;
        imageData.data[index + 1] = replacement.g;
        imageData.data[index + 2] = replacement.b;
        imageData.data[index + 3] = replacement.a;
      }
    });
    context.putImageData(imageData, 0, 0);
    return { changed: found.spans.length > 0, open: false };
  }

  function create(options) {
    const canvas = options.canvas;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const settings = safeSettings();
    const commands = [];
    let cursor = 0;
    let tool = 'pen';
    let activeStroke = null;
    let baseDataUrl = '';
    let renderEpoch = 0;
    let logicalWidth = 1;
    let logicalHeight = 1;

    options.colorInput.value = settings.color;
    options.opacityInput.value = String(settings.opacity);
    options.widthInput.value = String(settings.width);

    function icon(name) {
      return typeof window.lucide === 'function' ? window.lucide(name, 19) : '';
    }

    function renderIcons() {
      options.penBtn.innerHTML = icon('pencil');
      options.fillBtn.innerHTML = icon('paintBucket');
      options.eraserBtn.innerHTML = icon('eraser');
      options.clearBtn.innerHTML = icon('trash2');
    }

    function persistSettings() {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        color: options.colorInput.value,
        opacity: Number(options.opacityInput.value),
        width: Number(options.widthInput.value),
      }));
    }

    function updateSwatch() {
      const rgba = hexRgba(options.colorInput.value, Number(options.opacityInput.value));
      options.swatch.style.setProperty('--qm-swatch', `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a / 255})`);
      options.opacityValue.value = `${options.opacityInput.value}%`;
      persistSettings();
    }

    function isBlank() {
      let blank = !baseDataUrl;
      for (let index = 0; index < cursor; index += 1) {
        blank = commands[index].type === 'clear' ? true : false;
      }
      return blank;
    }

    function notifyHistory() {
      options.onHistoryChange?.({ canUndo: cursor > 0, canRedo: cursor < commands.length });
    }

    function resetContext() {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    }

    function loadImage(dataUrl) {
      return new Promise((resolve) => {
        if (!dataUrl) {
          resolve(null);
          return;
        }
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = dataUrl;
      });
    }

    async function renderAll() {
      const epoch = ++renderEpoch;
      const baseImage = await loadImage(baseDataUrl);
      if (epoch !== renderEpoch) return;
      resetContext();
      if (baseImage) context.drawImage(baseImage, 0, 0, logicalWidth, logicalHeight);
      for (let index = 0; index < cursor; index += 1) {
        const command = commands[index];
        if (command.type === 'stroke') drawStroke(context, command, logicalWidth, logicalHeight);
        if (command.type === 'fill') floodFill(context, canvas, command, false);
        if (command.type === 'clear') resetContext();
      }
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(rect.width));
      const nextHeight = Math.max(1, Math.round(rect.height));
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      if (nextWidth === logicalWidth && nextHeight === logicalHeight && canvas.width === Math.round(nextWidth * dpr)) return;
      logicalWidth = nextWidth;
      logicalHeight = nextHeight;
      canvas.width = Math.round(nextWidth * dpr);
      canvas.height = Math.round(nextHeight * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderAll();
    }

    function pushCommand(command) {
      if (cursor < commands.length) commands.splice(cursor);
      commands.push(command);
      if (commands.length > HISTORY_LIMIT) {
        baseDataUrl = canvas.toDataURL('image/png');
        commands.length = 0;
        cursor = 0;
      } else {
        cursor = commands.length;
      }
      notifyHistory();
      options.onChanged?.();
    }

    function selectTool(nextTool) {
      tool = nextTool;
      [options.penBtn, options.fillBtn, options.eraserBtn].forEach((button) => button.classList.remove('is-active'));
      ({ pen: options.penBtn, fill: options.fillBtn, eraser: options.eraserBtn })[tool].classList.add('is-active');
      canvas.style.cursor = tool === 'fill' ? 'cell' : 'crosshair';
    }

    function beginStroke(event) {
      const point = pointFromEvent(canvas, event);
      if (tool === 'fill') {
        const command = {
          type: 'fill',
          x: point.nx,
          y: point.ny,
          color: options.colorInput.value,
          opacity: Number(options.opacityInput.value),
        };
        const result = floodFill(context, canvas, command, true);
        if (result.open) {
          options.onStatus?.('閉じた領域を選んでください', true);
        } else if (result.changed) {
          pushCommand(command);
        }
        return;
      }
      canvas.setPointerCapture(event.pointerId);
      activeStroke = {
        pointerId: event.pointerId,
        type: 'stroke',
        tool,
        color: options.colorInput.value,
        opacity: Number(options.opacityInput.value),
        widthRatio: Number(options.widthInput.value) / Math.min(logicalWidth, logicalHeight),
        points: [{ x: point.nx, y: point.ny }],
      };
      configureStroke(context, activeStroke, logicalWidth, logicalHeight);
    }

    function continueStroke(event) {
      if (!activeStroke || activeStroke.pointerId !== event.pointerId) return;
      const point = pointFromEvent(canvas, event);
      const previous = activeStroke.points[activeStroke.points.length - 1];
      if (Math.hypot(point.nx - previous.x, point.ny - previous.y) < 0.0015) return;
      context.beginPath();
      context.moveTo(previous.x * logicalWidth, previous.y * logicalHeight);
      context.lineTo(point.nx * logicalWidth, point.ny * logicalHeight);
      context.stroke();
      activeStroke.points.push({ x: point.nx, y: point.ny });
    }

    function endStroke(event) {
      if (!activeStroke || activeStroke.pointerId !== event.pointerId) return;
      const command = activeStroke;
      activeStroke = null;
      if (command.points.length === 1) drawStroke(context, command, logicalWidth, logicalHeight);
      pushCommand(command);
    }

    function clear() {
      if (isBlank()) return;
      resetContext();
      pushCommand({ type: 'clear' });
    }

    function undo() {
      if (cursor <= 0) return false;
      cursor -= 1;
      renderAll();
      notifyHistory();
      options.onChanged?.();
      return true;
    }

    function redo() {
      if (cursor >= commands.length) return false;
      cursor += 1;
      renderAll();
      notifyHistory();
      options.onChanged?.();
      return true;
    }

    function reset(dataUrl) {
      baseDataUrl = dataUrl || '';
      commands.length = 0;
      cursor = 0;
      renderAll();
      notifyHistory();
    }

    function toggleColorPopover() {
      options.popover.hidden = !options.popover.hidden;
      if (!options.popover.hidden) {
        if (typeof window.positionPopup === 'function') {
          window.positionPopup(options.popover, options.swatch.getBoundingClientRect(), { prefer: 'below', gap: 8 });
        }
        options.colorInput.focus();
      }
    }

    function addOpacityControl(palette) {
      if (!palette || palette.querySelector('[data-quick-memo-opacity]')) return;
      const row = document.createElement('label');
      row.className = 'qm-palette-opacity';
      row.dataset.quickMemoOpacity = '1';
      const label = document.createElement('span');
      label.textContent = '不透明度';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '1';
      slider.max = '100';
      slider.value = options.opacityInput.value;
      slider.setAttribute('aria-label', '不透明度');
      slider.dataset.e2eId = 'quick-memo-opacity-range';
      const output = document.createElement('output');
      output.value = `${slider.value}%`;
      slider.addEventListener('input', () => {
        options.opacityInput.value = slider.value;
        options.opacityInput.dispatchEvent(new Event('input', { bubbles: true }));
        output.value = `${slider.value}%`;
      });
      row.append(label, slider, output);
      const closeRow = palette.querySelector('.gb-palette-close-row');
      palette.insertBefore(row, closeRow || null);
    }

    function openColorEditor() {
      if (typeof window.openColorPalette !== 'function') {
        toggleColorPopover();
        return;
      }
      options.popover.hidden = true;
      window.openColorPalette(options.swatch, options.colorInput.value, color => {
        if (!color || color === 'transparent') return;
        options.colorInput.value = color;
        options.colorInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      requestAnimationFrame(() => addOpacityControl(document.querySelector('.gb-palette-popup')));
    }

    options.swatch.addEventListener('click', openColorEditor);
    options.colorInput.addEventListener('input', updateSwatch);
    options.opacityInput.addEventListener('input', updateSwatch);
    options.widthInput.addEventListener('input', persistSettings);
    options.penBtn.addEventListener('click', () => selectTool('pen'));
    options.fillBtn.addEventListener('click', () => selectTool('fill'));
    options.eraserBtn.addEventListener('click', () => selectTool('eraser'));
    options.clearBtn.addEventListener('click', clear);
    canvas.addEventListener('pointerdown', beginStroke);
    canvas.addEventListener('pointermove', continueStroke);
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    document.addEventListener('pointerdown', (event) => {
      if (!options.popover.hidden && !options.popover.contains(event.target) && !options.swatch.contains(event.target)) {
        options.popover.hidden = true;
      }
    });
    window.addEventListener('resize', () => {
      options.popover.hidden = true;
      resize();
    });
    if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(canvas);

    renderIcons();
    updateSwatch();
    selectTool('pen');
    window.requestAnimationFrame(resize);
    return {
      undo,
      redo,
      reset,
      resize,
      hasDrawing: () => !isBlank(),
      toDataURL: () => isBlank() ? '' : canvas.toDataURL('image/png'),
      state: () => ({ canUndo: cursor > 0, canRedo: cursor < commands.length }),
      setActive(value) {
        if (value) window.requestAnimationFrame(resize);
        else options.popover.hidden = true;
      },
    };
  }

  const api = { create, findFillSpans };
  if (typeof window !== 'undefined') window.MeldexQuickMemoDrawing = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
