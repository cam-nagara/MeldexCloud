/* Calendar uses the same measured-width overflow as every application toolbar. */
(function () {
  'use strict';
  const toolbar = root => root?.matches?.('.gb-toolbar-cal') ? root : root?.querySelector?.('.gb-toolbar-cal');
  window.MeldexCalToolbarOverflow = {
    setup(root) {
      return window.MeldexToolbarOverflow.setup({ toolbar: toolbar(root) });
    },
    refresh() { window.MeldexToolbarOverflow.refresh(); },
    teardown(root) { window.MeldexToolbarOverflow.teardown(toolbar(root)); },
  };
})();
