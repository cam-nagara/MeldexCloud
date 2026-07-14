/* ==============================
   gb-component.js: ToolComponent基底クラス + コンポーネントレジストリ（v5.0）
   ============================== */

// === ToolComponent 基底クラス ===
class ToolComponent {
  constructor(paneId, tabId) {
    this.paneId = paneId;
    this.tabId = tabId;
    this.el = null;        // ルートDOM要素
    this.state = {};       // ツール固有の状態
    this._mounted = false;
    this._active = false;
    this._displayBeforeDeactivate = null;
  }

  // --- ライフサイクル ---

  /** DOM要素を生成して返す（サブクラスでオーバーライド） */
  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-tool-component';
    return this.el;
  }

  /** containerにDOM要素を追加 */
  mount(container) {
    if (!this.el) this.create();
    container.appendChild(this.el);
    this._mounted = true;
  }

  /** タブがアクティブになった時（描画更新等）*/
  activate() {
    this._active = true;
    if (this.el) {
      this.el.style.display = this._displayBeforeDeactivate == null ? '' : this._displayBeforeDeactivate;
      this._displayBeforeDeactivate = null;
    }
  }

  /** タブが非アクティブになった時（リソース解放等）*/
  deactivate() {
    this._active = false;
    if (this.el) {
      if (this.el.style.display !== 'none') this._displayBeforeDeactivate = this.el.style.display;
      this.el.style.display = 'none';
    }
  }

  /** containerからDOM要素を除去 */
  unmount() {
    if (this.el && this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
    this._mounted = false;
  }

  /** イベントリスナー除去、メモリ解放 */
  destroy() {
    this.unmount();
    this.el = null;
    this.state = {};
    this._displayBeforeDeactivate = null;
  }

  // --- 状態管理 ---

  /** 永続化用の状態を返す */
  getState() {
    return { ...this.state };
  }

  /** 状態を復元する */
  restoreState(savedState) {
    if (savedState) this.state = { ...savedState };
  }

  // --- 詳細パネル連携 ---

  /** アクティブ時に詳細ペインに表示する内容を返す（HTMLまたはDOM要素） */
  getDetailContent() {
    return null;
  }

  // --- キーボードショートカット ---

  /** キーイベントハンドラ（trueを返すと伝搬停止）*/
  handleKeyDown(e) {
    return false;
  }
}

// === LegacyWrapperComponent ===
// 既存のDOM要素をペインコンテンツとしてラップするコンポーネント
// Phase B移行期に使用し、各ツールのコンポーネント化完了後に除去
class LegacyWrapperComponent extends ToolComponent {
  constructor(paneId, tabId, legacyEl) {
    super(paneId, tabId);
    this._legacyEl = legacyEl; // ラップ対象のDOM要素
    this._legacyDisplayBeforeDeactivate = null;
  }

  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-tool-legacy-wrapper';
    this.el.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';
    if (this._legacyEl) {
      this.el.appendChild(this._legacyEl);
    }
    return this.el;
  }

  activate() {
    super.activate();
    if (this._legacyEl) {
      this._legacyEl.style.display = this._legacyDisplayBeforeDeactivate == null ? '' : this._legacyDisplayBeforeDeactivate;
      this._legacyDisplayBeforeDeactivate = null;
    }
  }

  deactivate() {
    super.deactivate();
    if (this._legacyEl) {
      if (this._legacyEl.style.display !== 'none') this._legacyDisplayBeforeDeactivate = this._legacyEl.style.display;
      this._legacyEl.style.display = 'none';
    }
  }

  destroy() {
    // レガシー要素は破棄しない（元の位置に戻す可能性）
    if (this._legacyEl && this._legacyEl.parentNode === this.el) {
      this.el.removeChild(this._legacyEl);
    }
    super.destroy();
  }
}

// === コンポーネントレジストリ ===
const TOOL_REGISTRY = {};

// レジストリにコンポーネントクラスを登録
function registerToolComponent(type, config) {
  TOOL_REGISTRY[type] = {
    cls: config.cls,
    icon: config.icon || 'page',
    label: config.label || type,
    multi: config.multi !== false, // デフォルトtrue
    // Audit-P2 H-7: 表示状態の固定（view_lock）が必要なツールか
    requiresViewLock: !!config.requiresViewLock,
  };
}

// ViewLock 判定用ヘルパー（gb-view-lock.js から呼び出せるようグローバル公開）
function getToolRequiresViewLock(type) {
  return !!(TOOL_REGISTRY[type] && TOOL_REGISTRY[type].requiresViewLock);
}

// タイプからコンポーネントインスタンスを生成
function createToolComponent(type, paneId, tabId, options) {
  const reg = TOOL_REGISTRY[type];
  if (reg && reg.cls) {
    return new reg.cls(paneId, tabId, options);
  }
  // レジストリに未登録の場合はレガシーラッパーを返す
  return null;
}

// === コンポーネントインスタンス管理 ===
const _componentInstances = {}; // tabId → ToolComponent instance

function getComponentInstance(tabId) {
  return _componentInstances[tabId] || null;
}

function setComponentInstance(tabId, instance) {
  _componentInstances[tabId] = instance;
}

function removeComponentInstance(tabId) {
  const inst = _componentInstances[tabId];
  if (inst) {
    inst.destroy();
    delete _componentInstances[tabId];
  }
}

// 全インスタンスを走査
function forEachComponent(fn) {
  for (const tabId in _componentInstances) {
    fn(_componentInstances[tabId], tabId);
  }
}
