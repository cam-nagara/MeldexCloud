/* 注釈を初めて選んだ時も、単独版の遅延読込を完了してから同じ操作を実行する。 */
(function () {
  'use strict';
  let pendingViewerAnnotationLoad = null;
  let viewerAnnotationEntryFailed = false;

  function ensureReady() {
    const capability = window.MeldexViewerCloudFileOpen?.annotationCapability?.();
    if (capability?.available === false) return Promise.reject(new Error(capability.reason));
    if (window.MeldexViewerAnnotations) return Promise.resolve(window.MeldexViewerAnnotations);
    if (!window.MeldexStandaloneNative) return Promise.reject(new Error('アノテートを読み込めませんでした'));
    if (!pendingViewerAnnotationLoad) {
      pendingViewerAnnotationLoad = window.MeldexStandaloneNative.loadFeature('annotations').then(async () => {
        const controller = window.MeldexViewerAnnotations;
        if (!controller) throw new Error('アノテートを読み込めませんでした');
        await controller.load();
        return controller;
      }).finally(() => { pendingViewerAnnotationLoad = null; });
    }
    return pendingViewerAnnotationLoad;
  }

  function toggle(fromShortcut = false) {
    const apply = controller => {
      const result = fromShortcut ? controller.toggleFromShortcut() : controller.toggle();
      if (viewerAnnotationEntryFailed) {
        viewerAnnotationEntryFailed = false;
        window.MeldexViewerScene?.flashStatus?.('アノテートを開きました', 1500);
      }
      return result;
    };
    // 通常の本体・読込済みの操作は同じイベント内で反映する。
    if (window.MeldexViewerAnnotations) return apply(window.MeldexViewerAnnotations);
    return ensureReady().then(apply).catch(error => {
      viewerAnnotationEntryFailed = true;
      window.MeldexViewerScene?.flashStatus?.('アノテートを開けませんでした: ' + error.message, 5000);
      return false;
    });
  }

  window.MeldexViewerAnnotationEntry = Object.freeze({ ensureReady, toggle });
})();
