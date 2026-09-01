/* Cloud/PWA Viewer local file selection. Files remain browser-local and are
   exposed to the existing viewer scene only through short-lived blob URLs. */
(function (global) {
  'use strict';

  const IMAGE_EXTENSIONS = new Set([
    'png', 'apng', 'jpg', 'jpeg', 'jpe', 'jfif', 'gif', 'bmp', 'webp', 'svg', 'ico', 'avif',
  ]);
  let activeUrls = [];

  function isCloudViewer() {
    return document.documentElement.getAttribute('data-standalone-cloud') === 'viewer';
  }

  const CLOUD_ANNOTATION_REASON = 'Cloud版ビューワーではアノテートを利用できません';

  // Cloud の単独Viewerは、ローカルファイルを Blob URL で一時表示するだけであり、
  // アノテートを安全に保存する対象パスを持たない。ファイル選択後ではなく起動直後から
  // capability を明示して、メニューやショートカットが一瞬だけ現れることも防ぐ。
  function annotationCapability() {
    return isCloudViewer()
      ? { available: false, reason: CLOUD_ANNOTATION_REASON }
      : { available: true, reason: '' };
  }

  function applyAnnotationCapability() {
    const capability = annotationCapability();
    document.documentElement.dataset.viewerAnnotationCapability = capability.available ? 'enabled' : 'disabled';
    global.MeldexViewerAnnotations?.setAvailability?.(capability.available, capability.reason);
    return capability;
  }

  function accepted(file) {
    const name = String(file?.name || '').toLowerCase();
    const ext = name.includes('.') ? name.split('.').pop() : '';
    return file?.type === 'application/pdf' || file?.type?.startsWith('image/')
      || ext === 'pdf' || IMAGE_EXTENSIONS.has(ext);
  }

  async function openFiles(fileList) {
    let files = Array.from(fileList || []).filter(accepted);
    if (!files.length) {
      document.getElementById('hud-info').textContent = '画像またはPDFを選択してください';
      return false;
    }
    const firstPdf = files.find(file => file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
    if (firstPdf) files = [firstPdf];
    const nextUrls = files.map(file => URL.createObjectURL(file));
    const params = new URLSearchParams();
    if (files.length === 1 && (files[0].type === 'application/pdf' || /\.pdf$/i.test(files[0].name))) {
      params.set('pdf', nextUrls[0]);
    } else {
      nextUrls.forEach(url => params.append('files', url));
    }
    try {
      await global.MeldexViewerScene.ready;
      await global.MeldexViewerScene.reopenWithUrl(location.pathname + '?' + params.toString());
    } catch (error) {
      nextUrls.forEach(url => URL.revokeObjectURL(url));
      document.getElementById('hud-info').textContent = 'ファイルを開けませんでした: ' + (error?.message || error);
      return false;
    }
    activeUrls.forEach(url => URL.revokeObjectURL(url));
    activeUrls = nextUrls;
    applyAnnotationCapability();
    document.getElementById('hud-status').textContent = files.map(file => file.name).join(' / ');
    return true;
  }

  function install() {
    if (!isCloudViewer()) return;
    const input = document.getElementById('viewer-local-file-input');
    const button = document.getElementById('btn-open-local-file');
    if (!input || !button) return;
    button.hidden = false;
    button.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      await openFiles(input.files);
      input.value = '';
    });
    document.addEventListener('dragover', event => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      event.preventDefault();
      document.body.dataset.viewerFileDrop = 'ready';
    });
    document.addEventListener('dragleave', event => {
      if (!event.relatedTarget) delete document.body.dataset.viewerFileDrop;
    });
    document.addEventListener('drop', async event => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      delete document.body.dataset.viewerFileDrop;
      await openFiles(event.dataTransfer.files);
    });
    global.addEventListener('pagehide', () => {
      activeUrls.forEach(url => URL.revokeObjectURL(url));
      activeUrls = [];
    }, { once: true });
  }

  global.MeldexViewerCloudFileOpen = Object.freeze({
    accepted, openFiles, isCloudViewer, annotationCapability, applyAnnotationCapability,
  });
  // controls/context-menu より先に分類値を固定する。アノテートcontrollerは後から読み込まれるため、
  // microtask と DOMContentLoaded の両方で availability を渡す。
  applyAnnotationCapability();
  queueMicrotask(applyAnnotationCapability);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      applyAnnotationCapability();
      install();
    }, { once: true });
  } else {
    applyAnnotationCapability();
    install();
  }
})(window);
