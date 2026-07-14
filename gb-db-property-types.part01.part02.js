        if ((cfg.type === 'relation' || cfg.type === 'multi-relation') && p !== (statePropName || '')) relProps.push(p);
      }
    }
    const cascadeOpts = relProps.map(p => `<option value="${esc(p)}"${p===(current.cascadeFrom||'')?'selected':''}>${esc(p)}</option>`).join('');
    // ペア候補: 同DB内の他のリレーションプロパティ
    const pairOpts = relProps.map(p => `<option value="${esc(p)}"${p===(current.pairWith||'')?'selected':''}>${esc(p)}</option>`).join('');
    optDiv.innerHTML = `<div class="field"><label>参照先シートフォルダのパス</label>
      <input id="pt-relation-db" type="text" value="${esc(current.relationDb||'')}" placeholder="例: 設定/キャラ（空欄 = 自分自身のシート）">
    </div>
    <div class="field"><label>同一シート内の相互反映先プロパティ</label>
      <select id="pt-pair-with">
        <option value="">(なし)</option>
        ${pairOpts}
      </select>
      <div class="pt-hint">同一シート内の自己参照リレーションで、片方を変更した時に相手側プロパティにも自動反映します</div>
    </div>
    <div class="field"><label>タイムライン依存方向</label>
      <select id="pt-dependency-direction">
        <option value="" ${!current.dependencyDirection?'selected':''}>依存矢印に使わない</option>
        <option value="target-to-entry" ${current.dependencyDirection==='target-to-entry'?'selected':''}>参照先 → このエントリ</option>
        <option value="entry-to-target" ${current.dependencyDirection==='entry-to-target'?'selected':''}>このエントリ → 参照先</option>
      </select>
      <div class="pt-hint">タイムラインの依存矢印で、プロパティ名に依存せず向きを決めます</div>
    </div>
    <div class="field">
      <label class="pt-check-label">
        <input id="pt-bidirectional-enabled" type="checkbox" ${current.bidirectional ? 'checked' : ''}>
        双方向リレーション
      </label>
      <div class="pt-hint">参照先シート側にも対応プロパティを持たせ、どちら側の編集でも相手シートへ反映します。初期値はオフです</div>
    </div>
    <div id="pt-bidirectional-prop-row" class="field"${current.bidirectional ? '' : ' style="display:none;"'}><label>参照先シート側の対応プロパティ</label>
      <input id="pt-bidirectional-prop" type="text" value="${esc(current.bidirectionalProp || statePropName || '')}" placeholder="空欄なら同名">
      <div class="pt-hint">未作成なら自動で作成し、既存なら双方向設定を付与します</div>
    </div>
    <div class="field"><label>絞り込み（カスケード）</label>
      <select id="pt-cascade-from">
        <option value="">(なし)</option>
        ${cascadeOpts}
      </select>
    </div>
    <div id="pt-cascade-key-row" class="field"${current.cascadeFrom?'':' style="display:none;"'}><label>参照先シート側の絞り込みプロパティ</label>
      <input id="pt-cascade-key" type="text" value="${esc(current.cascadeKey||current.cascadeFrom||'')}" placeholder="参照先シート側で照合に使うプロパティ名">
      <div class="pt-hint">参照先シートの各エントリについて、このプロパティの値が依存元の選択値と一致するものだけを候補に出します</div>
    </div>
    <div class="pt-hint">
      指定したシートフォルダ内のエントリ名がドロップダウンに表示されます。
      ${type==='relation'?'単一選択（1つだけ選べます）':'複数選択（カンマ区切りで複数選べます）'}
    </div>`;
    // DBピッカーを参照先DB入力に取り付け
    setTimeout(() => { const dbInput = _ptGet('pt-relation-db', scope); if (dbInput) _attachDbPicker(dbInput); }, 0);
    _ptGet('pt-bidirectional-enabled', scope)?.addEventListener('change', function() {
      const row = _ptGet('pt-bidirectional-prop-row', scope);
      const propInput = _ptGet('pt-bidirectional-prop', scope);
      if (!row || !propInput) return;
      if (this.checked) {
        row.style.display = '';
        if (!propInput.value) propInput.value = statePropName || '';
      } else {
        row.style.display = 'none';
      }
    });
    _ptGet('pt-cascade-from', scope)?.addEventListener('change', function() {
      const keyRow = _ptGet('pt-cascade-key-row', scope);
      const keyInput = _ptGet('pt-cascade-key', scope);
      if (this.value) {
        keyRow.style.display = '';
        if (!keyInput.value) keyInput.value = this.value;
      } else {
        keyRow.style.display = 'none';
        keyInput.value = '';
      }
    });
  } else if (type === 'number') {
    optDiv.innerHTML = `<div class="field"><label>単位（任意）</label>
      <input id="pt-number-unit" type="text" value="${esc(current.unit||'')}" placeholder="例: ページ, cm, kg">
    </div>`;
  } else if (type === 'formula') {
    optDiv.innerHTML = typeof _ptBuildFormulaOptionsHtml === 'function'
      ? _ptBuildFormulaOptionsHtml(current, scope)
      : `<div class="field"><label>数式（Notion互換構文）</label>
        <textarea id="pt-formula-src" class="pt-formula-textarea" rows="8">${esc(current.formula||'')}</textarea>
        <div class="pt-hint">
          使用可能: prop("名前"), if(条件, 真, 偽), let/lets(変数, 値, ..., 本体), and, or, not, empty, contains, replace, floor, round, mod, toNumber, format, year, month, day, dateBetween, dateSubtract, now, +, -, *, /, >, <, ==, !=
        </div>
      </div>
      <div class="field">
        <button data-action="testFormula(this.closest('[data-pt-root]'))" class="pt-small-btn">テスト</button>
        <span id="pt-formula-result" class="pt-hint"></span>
      </div>`;
    if (typeof _ptBindFormulaEditor === 'function') _ptBindFormulaEditor(scope);
  } else if (type === 'rollup' && typeof buildRollupOptionsHtml === 'function') {
    const { dbPath, pivotData } = _ptState(scope);
    const rawProps = pivotData?.properties || [];
    const allProps = typeof filterDeletedDbProperties === 'function' ? filterDeletedDbProperties(dbPath, rawProps) : rawProps;
    const propTypes = getPropertyTypes(dbPath);
    optDiv.innerHTML = buildRollupOptionsHtml(current, allProps, propTypes, scope);
    const relSel = _ptGet('rollup-relation-prop', scope);
    relSel?.addEventListener('change', () => onRollupRelationChange(relSel.value, null, scope));
  } else if (type === 'button') {
    optDiv.innerHTML = `<div class="field"><label>ボタンラベル</label>
      <input id="pt-btn-label" type="text" value="${esc(current.label||'実行')}" placeholder="実行">
    </div>
    <div class="field"><label>アクション</label>
      <div id="pt-btn-actions"></div>
      <button id="pt-btn-add-action" class="pt-small-btn">+ アクション追加</button>
    </div>`;
    _renderButtonActions(current.actions || [], scope);
    _ptGet('pt-btn-add-action', scope)?.addEventListener('click', () => {
      const acts = _collectButtonActions(scope);
      acts.push({ type: 'set-value', targetProp: '', value: '' });
      _renderButtonActions(acts, scope);
    });
  } else if (type === 'multi-source-relation') {
    const curMode = current.mode || 'manual';
    optDiv.innerHTML = `<div class="field"><label>モード</label>
      <select id="pt-msr-mode">
        <option value="manual" ${curMode==='manual'?'selected':''}>手動</option>
        <option value="auto" ${curMode==='auto'?'selected':''}>自動</option>
      </select>
    </div>
    <div class="field"><label>ソース</label>
      <div id="pt-msr-sources"></div>
      <button id="pt-msr-add-source" class="pt-small-btn">+ ソース追加</button>
    </div>`;
    _renderMsrSources(current.sources || [], curMode, scope);
    _ptGet('pt-msr-mode', scope)?.addEventListener('change', function() {
      const s = _collectMsrSources(scope);
      _renderMsrSources(s, this.value, scope);
    });
    _ptGet('pt-msr-add-source', scope)?.addEventListener('click', () => {
      const s = _collectMsrSources(scope);
      const mode = _ptGet('pt-msr-mode', scope)?.value || 'manual';
      s.push({ db: '', label: '', matchRules: [] });
      _renderMsrSources(s, mode, scope);
    });
  } else if (type === 'date') {
    const curSource = current.source || '';
    const withTime = !!current.withTime;
    const isAutoSource = _ptIsAutoDateSource(curSource);
    const isRange = !!current.range && !isAutoSource;
    optDiv.innerHTML = `<div class="field"><label>データソース</label>
      <select id="pt-date-source">
        <option value="" ${!curSource?'selected':''}>候補値（通常）</option>
        <option value="created" ${curSource==='created'?'selected':''}>作成日時（自動・読み取り専用）</option>
        <option value="modified" ${curSource==='modified'?'selected':''}>更新日時（自動・読み取り専用）</option>
      </select>
    </div>
    <label class="pt-check-label">
      <input id="pt-date-with-time" type="checkbox" ${withTime?'checked':''}>
      時刻（時分）を入力できるようにする
    </label>
    <label class="pt-check-label">
      <input id="pt-date-range" type="checkbox" ${isRange?'checked':''} ${isAutoSource?'disabled':''}>
      開始と終了を持つ期間にする
    </label>
    <div id="pt-date-range-note" class="pt-hint"${isAutoSource?'':' style="display:none;"'}>
      自動日時は単一日時として扱います。
    </div>
