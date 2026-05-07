/**
 * Meldex Duplicate Image Detection & CLIP Image Search
 * 重複画像検出＆統合整理 + CLIP画像類似検索
 */

// 重複スキャン結果のモーダルを表示
async function showDuplicateScanModal(folderPath) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.folderPath = folderPath || '';
  overlay.innerHTML = `<div class="gb-modal" style="min-width:700px;max-width:90vw;">
    <header class="gb-modal-header">
      <h3 class="gb-modal-title">重複画像スキャン</h3>
      <button class="gb-modal-close" data-action="this.closest('.modal-overlay').remove()">${lucide('x', 14)}</button>
    </header>
    <div class="gb-modal-body">
      <div id="dup-status" class="gb-section-desc" style="margin-bottom:var(--ui-space-3);">スキャン中...</div>
      <div id="dup-results" style="min-height:200px;"></div>
    </div>
    <footer class="gb-modal-footer">
      <button class="gb-btn gb-btn-sm" data-action="this.closest('.modal-overlay').remove()">閉じる</button>
    </footer>
  </div>`;
  document.body.appendChild(overlay);

  try {
    const res = await apiPost('/duplicate-scan', { path: folderPath, threshold: 10 });
    const statusEl = overlay.querySelector('#dup-status');
    const resultsEl = overlay.querySelector('#dup-results');
    if (!statusEl || !resultsEl) return; // モーダルが閉じられた

    if (res.groups.length === 0) {
      statusEl.textContent = `${res.total_images} 枚の画像をスキャン — 重複は見つかりませんでした`;
      resultsEl.innerHTML = '<div class="gb-empty-placeholder">重複画像はありません</div>';
      return;
    }

    statusEl.textContent = `${res.total_images} 枚スキャン → ${res.groups.length} グループ / ${res.total_duplicates} 件の重複を検出`;

    let html = '';
    res.groups.forEach((group, gi) => {
      const typeBadge = group.type === 'exact'
        ? '<span class="gb-badge gb-badge-danger">完全一致</span>'
        : '<span class="gb-badge gb-badge-warn">類似</span>';

      html += `<div class="dup-group" data-group="${gi}">
        <div class="dup-group-header">
          ${typeBadge}
          <span class="dup-group-title">グループ ${gi + 1}</span>
          <span class="dup-group-count">${group.images.length} 枚</span>
          <span style="flex:1;"></span>
          <button class="gb-btn gb-btn-xs gb-btn-primary" data-action="_dupResolveGroup(this, ${gi})">選択した画像を残す</button>
        </div>
        <div class="dup-group-body">`;

      group.images.forEach((img, ii) => {
        const thumbUrl = API_BASE + '/thumb?path=' + encodeURIComponent(img.rel_path) + '&size=150';
        const sizeStr = formatFileSize(img.size);
        const dimStr = img.width ? `${img.width}×${img.height}` : '?';
        const name = img.rel_path.split('/').pop();
        const isRec = img.recommended;

        html += `<div class="dup-item${isRec ? ' dup-item-recommended' : ''}" data-group="${gi}" data-index="${ii}" data-path="${esc(img.rel_path)}"
          data-action="_dupToggleSelect(this, ${gi}, ${ii})">
          <div class="dup-item-thumb">
            <img src="${thumbUrl}" onerror="this.src='';this.alt='読込失敗';">
          </div>
          <div class="dup-item-info">
            <div class="dup-item-name" title="${esc(img.rel_path)}">${esc(name)}</div>
            <div class="dup-item-meta">${dimStr} / ${sizeStr}</div>
            <div class="dup-item-radio">
              <input type="radio" name="dup-keep-${gi}" value="${ii}" ${isRec ? 'checked' : ''} data-action="event.stopPropagation();">
              <span class="${isRec ? 'dup-item-rec-label' : 'dup-item-keep-label'}">${isRec ? '推奨（最高解像度）' : '残す'}</span>
            </div>
          </div>
        </div>`;
      });

      html += '</div></div>';
    });

    resultsEl.innerHTML = html;

    // グループデータを保持
    overlay._dupGroups = res.groups;

  } catch (e) {
    const s = overlay.querySelector('#dup-status');
    if (s) { s.textContent = 'スキャンに失敗しました: ' + (e.message || e); s.classList.add('dup-status-error'); }
  }
}

function _dupToggleSelect(el, gi, ii) {
  // ラジオボタンを選択
  const radio = el.querySelector('input[type=radio]');
  if (radio) radio.checked = true;
  // 選択状態クラスを切替 (旧インライン style もクリア)
  el.closest('.dup-group').querySelectorAll('.dup-item').forEach(item => {
    item.classList.remove('dup-item-selected');
    item.style.borderColor = '';
  });
  el.classList.add('dup-item-selected');
}

async function _dupResolveGroup(sourceOrGi, maybeGi) {
  const sourceEl = sourceOrGi && typeof sourceOrGi.closest === 'function' ? sourceOrGi : null;
  const gi = sourceEl ? maybeGi : sourceOrGi;
  const overlay = sourceEl?.closest('.modal-overlay')
    || document.querySelector(`.dup-group[data-group="${gi}"]`)?.closest('.modal-overlay');
  if (!overlay || !overlay._dupGroups) return;
  const groupEl = overlay.querySelector(`.dup-group[data-group="${gi}"]`);
  if (!groupEl) return;
  const group = overlay._dupGroups[gi];
  if (!group) return;

  // 選択されたラジオボタンを取得
  const radio = groupEl.querySelector(`input[name="dup-keep-${gi}"]:checked`);
  if (!radio) { showStatus('残す画像を選択してください', true); return; }
  const keepIdx = parseInt(radio.value);
  const keepImg = group.images[keepIdx];
  const replaceImgs = group.images.filter((_, i) => i !== keepIdx);

  if (!await cfConfirm(
    `「${keepImg.rel_path.split('/').pop()}」を残し、他 ${replaceImgs.length} 枚を整理しますか？\n\n` +
    `残す画像: ${keepImg.width}×${keepImg.height} / ${formatFileSize(keepImg.size)}\n` +
    `整理対象: ${replaceImgs.map(i => i.rel_path.split('/').pop()).join(', ')}\n\n` +
    `重複画像はゴミ箱に移動し、元のフォルダには残す画像へのリンクが登録されます。`
  )) return;

  try {
    const res = await apiPost('/duplicate-resolve', {
      keep: keepImg.rel_path,
      replace: replaceImgs.map(i => i.rel_path),
    });

    const succeeded = res.results.filter(r => r.status === 'replaced').length;
    const failed = res.results.filter(r => r.status === 'error').length;
    showStatus(`${succeeded} 件を整理（ゴミ箱+リンク登録）${failed ? ` / ${failed} 件失敗` : ''}`);

    // グループUIを更新（解決済みマーク）
    if (groupEl) {
      groupEl.classList.add('dup-group-resolved');
      groupEl.querySelector('button').disabled = true;
      groupEl.querySelector('button').innerHTML = lucide('check', 12) + ' 解決済み';
    }

    // フォルダビューをリロード
    const scannedFolder = overlay.dataset.folderPath || '';
    if (typeof renderFolderGrid === 'function' && scannedFolder && typeof _folderPath !== 'undefined' && _folderPath === scannedFolder) {
      _folderItems = await apiFetch('/browse?path=' + encodeURIComponent(scannedFolder) + '&detail=true&all_files=true');
      renderFolderGrid();
    } else if (typeof loadOutliner === 'function') {
      loadOutliner();
    }
  } catch (e) {
    showStatus('置換に失敗: ' + (e.message || e), true);
  }
}


// ==============================
// CLIP 画像類似検索
// ==============================

async function clipIndexFolder(folderPath) {
  showStatus('画像インデックスを作成中...');
  try {
    const res = await apiPost('/clip/index', { path: folderPath });
    showStatus(`インデックス完了: ${res.processed} 枚処理 / ${res.skipped} 枚スキップ / 合計 ${res.total} 枚`);
    return res;
  } catch (e) {
    showStatus('インデックス作成失敗: ' + (e.message || e), true);
    return null;
  }
}

async function clipSearchImages(query, folder) {
  try {
    const res = await apiPost('/clip/search', { query, top_k: 20, folder: folder || '' });
    return res;
  } catch (e) {
    showStatus('画像検索失敗: ' + (e.message || e), true);
    return null;
  }
}

function showClipSearchResults(results, query) {
  if (!results || !results.results || results.results.length === 0) {
    const message = results?.message ? `<div class="gb-section-desc">${esc(results.message)}</div>` : '';
    return `「${esc(query)}」に該当する画像は見つかりませんでした。${message}`;
  }
  let html = `<div class="gb-section-desc" style="margin-bottom:var(--ui-space-3);">「${esc(query)}」の検索結果（${results.results.length} 件）</div>`;
  html += '<div class="clip-search-grid">';
  results.results.forEach(r => {
    const thumbUrl = API_BASE + '/thumb?path=' + encodeURIComponent(r.path) + '&size=120';
    const score = Math.round(r.score * 100);
    // パスは data-path に格納し、data-action="_openClipViewerResult" でデリゲート実行
    // （esc() は HTML エスケープであり JS 文字列エスケープではないため）
    html += `<div class="clip-search-item" data-path="${esc(r.path)}" data-action="_openClipViewerResult">
      <img class="clip-search-thumb" src="${thumbUrl}" onerror="this.alt='読込失敗';">
      <div class="clip-search-name" title="${esc(r.path)}">${esc(r.name)}</div>
      <div class="clip-search-score">類似度: ${score}%</div>
    </div>`;
  });
  html += '</div>';
  return html;
}

function _openClipViewerResult(e) {
  const el = e?.target?.closest('[data-path]');
  const p = el?.dataset?.path;
  if (p) openViewer('/viewer?file=' + encodeURIComponent(p));
}
