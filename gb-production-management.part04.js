  // gb-production-management.part02.js から分離したセル保存時の自動追従フック群
  // （制作管理UX改善計画 2026-08-04 §5-1/§5-3/Stage 4対応で part02.js が1500行制限を
  // 超えたため切り出した。gb-production-management.part01.js〜.part04.js は同じ共有
  // クロージャに属する raw concatenation で、自前の IIFE は持たない。ただし part01.js が
  // 開いたIIFEの閉じ括弧 })(); は、ロード順で最後になるこのファイルの末尾へ移した
  // （旧: part02.js末尾で閉じていたため、それより後にロードされる part03.js/part04.js の
  // 宣言がIIFEの外側スコープになり、IIFE内部の _pmCloud* 関数を直接呼べない不具合があった。
  // JSの関数宣言ホイスティングは「呼び出し元より後で宣言されていても同じスコープ内なら
  // 見える」だけで、別スコープ（IIFEの外）の宣言までは見えないため、これが必要）。
  function _pmCloudTaskSheetEntryInfo(internals, path) {
    if (!internals) return null;
    const root = String(_pmCloudRoot(internals) || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const normalized = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!root || !normalized.startsWith(root + '/')) return null;
    const rest = normalized.slice(root.length + 1).split('/').filter(Boolean);
    if (rest.length < 2) return null;
    const sheet = rest[0];
    return _pmCloudIsTaskSheetName(sheet) ? { sheet } : null;
  }

  // 制作管理UX改善計画（2026-08-04）§5-1「開始日時・完了日時」: 状況が作業中系/完了へ変わった
  // 時、対応する日時列が空なら現在時刻を自動記録する（Desktop
  // meldex_production_management_support.apply_task_status_timestamps と同じ規則）。
  // changedProperty を問わず、タスクシートエントリの保存であれば毎回チェックする（idempotent。
  // 既に値があれば何もしない）。
  const PM_STATUS_TIMESTAMP_TARGETS = { '作業中': '開始日時', '進行中': '開始日時', '着手中': '開始日時', '完了': '完了日時' };

  function _pmCloudApplyStatusTimestampHook(path, frontmatter) {
    if (!frontmatter) return false;
    const internals = window.__MeldexPwaDataAccessInternals;
    if (!_pmCloudTaskSheetEntryInfo(internals, path)) return false;
    const statusValue = _pmCloudPropValue(frontmatter, '状況');
    const targetProp = PM_STATUS_TIMESTAMP_TARGETS[statusValue];
    if (!targetProp || _pmCloudPropValue(frontmatter, targetProp)) return false;
    const nowText = typeof formatLocalDateTime === 'function' ? formatLocalDateTime(new Date()) : new Date().toISOString().slice(0, 16);
    const createdMeta = new Date().toISOString();
    frontmatter.properties = frontmatter.properties && typeof frontmatter.properties === 'object' ? frontmatter.properties : {};
    frontmatter.properties[targetProp] = [{ value: nowText, status: '採用', note: '', created: createdMeta }];
    return true;
  }

  // 制作管理UX改善計画（2026-08-04）Stage 4「タスク名自動更新のCloud仕上げ」: タスクリスト系
  // シートのセル保存後、タスク名（エントリ名）がまだ自動管理対象（プレースホルダ名のまま、
  // または前回も自動生成された）なら、gb-production-task-naming.js の合成規則で新しい名前を
  // 計算し、必要なら管理付きリネーム（renameManagedEntry。リレーション参照・カレンダー等の
  // 追従込み）で実際にファイルを移動する。Desktop
  // meldex_production_task_name_autofill.auto_rename_task_entry_after_sheet_edit と同じ判定
  // 規則・同じ「名前が変わらなくても task_name_auto_generated は維持/付与する」挙動を踏襲する
  // （初回はプレースホルダ名一致で発火するが、このフラグが無いと2回目以降の編集で自動更新が
  // 止まってしまうため）。「タスク名を固定」（production_internal.task_name_fixed）が
  // 立っていれば何もしない。呼び出し元（gb-data-access-dropbox-expanded.part01.js の4つの
  // 値書込み関数）は、この関数が返す rename_info を _attachAutoTaskRenameResult 経由で
  // レスポンスへ合流させ、Desktopの /value 応答と同じ契約（path/file/new_path/
  // auto_renamed_entry）でフロントへ返す（gb-db-core.js の _dbApplyAutoTaskRenameResult が
  // 既にこの契約を汎用的に消費するため、フロント側の追加対応は不要）。
  // コミット前レビュー指摘 #6: 対象シートが cloud_storage: 'sheet-store-v1'（_meldex_sheet
  // .cloud.json への集約保存）の場合、renameManagedEntry の物理移動（内部で
  // provider.movePath を呼ぶ）は個別.mdファイルしか動かさず、シート保管JSONの行には
  // 触れない。放置すると次の2つの不整合が起きる: ①物理ミラーを持たない新規行（sheet-store
  // 化後に作成されたタスク）は移動元が存在せず物理移動そのものが失敗し、自動リネームが
  // 丸ごと止まる ②物理ミラーが残っている旧データでは、移動後も旧名の行がシート保管に
  // 残存し、一覧に重複行として現れる。どちらもシート保管JSONの該当行を直接付け替える
  // ことで解決する（gb-data-access-dropbox-expanded.part01.js の _renameEntity と同じ
  // 「rows[key]を差し替えて書き戻す」方式。あちらは別IIFEに閉じており直接呼べないため
  // 同等の処理をここに実装する）。名前が衝突した場合はDesktopの_unique_pathと同様に
  // 連番を付けて回避し、それでも解決できない極端なケースは改名を諦めてconsole.warnのみ
  // 行う（フラグ付与などその他の更新は続行する）。
  //
  // 戻り値: 実際に使われたファイル名（例: "タスクA.md"）。対象シートがsheet-store未使用、
  // またはこのエントリがJSON行を持たない（＝物理ファイルのみで管理されている）場合は null。
  async function _pmCloudRenameSheetStoreRow(provider, internals, sheetDir, oldName, newName, frontmatterPatch) {
    const storePath = internals._joinPath(sheetDir, '_meldex_sheet.cloud.json');
    let store;
    try {
      store = await provider.readJson(storePath);
    } catch (err) {
      return null;
    }
    if (!store || typeof store.rows !== 'object' || !store.rows) return null;
    const oldFileName = `${oldName}.md`;
    const row = store.rows[oldFileName];
    if (!row) return null;
    let finalFileName = oldFileName;
    if (newName && newName !== oldName) {
      let candidateFileName = `${newName}.md`;
      if (store.rows[candidateFileName]) {
        let resolved = '';
        for (let i = 2; i < 1000; i += 1) {
          const candidate = `${newName} ${i}.md`;
          if (!store.rows[candidate]) { resolved = candidate; break; }
        }
        if (resolved) {
          candidateFileName = resolved;
        } else {
          console.warn('制作管理: タスク名自動リネームでシート保管の行名衝突を解決できず、旧名のまま残します:', oldFileName, '→', candidateFileName);
          candidateFileName = oldFileName;
        }
      }
      finalFileName = candidateFileName;
    }
    if (finalFileName === oldFileName && !frontmatterPatch) return oldFileName;
    if (finalFileName !== oldFileName) delete store.rows[oldFileName];
    store.rows[finalFileName] = {
      ...row,
      file_name: finalFileName,
      name: finalFileName.replace(/\.md$/i, ''),
      path: internals._joinPath(sheetDir, finalFileName),
      frontmatter: { ...(row.frontmatter || {}), ...(frontmatterPatch || {}) },
    };
    store.modified = new Date().toISOString();
    await provider.writeJson(storePath, store);
    return finalFileName;
  }

  async function _pmCloudApplyTaskNameAutoRename(provider, path, frontmatter) {
    const internals = window.__MeldexPwaDataAccessInternals;
    const naming = window.MeldexProductionTaskNaming;
    const migration = window.MeldexProductionSchemaMigration;
    if (!frontmatter || !internals || !naming || !migration) return null;
    const sheetInfo = _pmCloudTaskSheetEntryInfo(internals, path);
    if (!sheetInfo) return null;
    const currentName = internals._basename(path).replace(/\.md$/i, '');
    if (!naming.shouldAutoUpdateName(currentName, frontmatter)) return null;
    const generatedName = naming.buildTaskEntryName(frontmatter.properties || {});
    if (!generatedName) return null;
    const safeName = _pmSafeName(generatedName);
    if (!safeName) return null;
    const sheetDir = internals._joinPath(_pmCloudRoot(internals), sheetInfo.sheet);

    let targetPath = path;
    if (safeName !== currentName) {
      let renameResult = null;
      try {
        renameResult = await _pmCloudWithProductionLease(provider, () => migration.renameManagedEntry(
          _pmCloudManagedNameContext(provider, internals), path, generatedName, {},
        ));
      } catch (err) {
        // sheet-store専用行（物理ミラー無し）はここで失敗し得る。行の直接付け替えへ
        // フォールバックするため、握りつぶさずログのみ残して先へ進む。
        console.warn('タスク名の自動リネーム（物理移動）に失敗しました。シート保管の行同期を試みます:', err);
      }
      const renamedFileName = await _pmCloudRenameSheetStoreRow(
        provider, internals, sheetDir, currentName, safeName,
      ).catch((err) => {
        console.warn('制作管理: タスク名自動リネーム時のシート保管同期に失敗しました:', err);
        return null;
      });
      if (renameResult?.ok && renameResult.new_path) {
        targetPath = renameResult.new_path;
      } else if (renamedFileName) {
        targetPath = internals._joinPath(sheetDir, renamedFileName);
      } else {
        return null;
      }
    }
    // task_name_auto_generated を確認・付与する（既に立っていれば追加の書込みはしない）。
    // renameManagedEntry は移動元のfrontmatterをそのまま移すだけでこのフラグの意味を
    // 知らないため、ここで別途確認する。sheet-store行にしか実体が無いエントリでは、
    // 物理ファイルを新規作成してしまわないよう先に行の存在を確認する（コミット前レビュー
    // 指摘 #6）。
    try {
      const finalName = internals._basename(targetPath).replace(/\.md$/i, '');
      const rowFlagged = await _pmCloudRenameSheetStoreRow(
        provider, internals, sheetDir, finalName, finalName, { task_name_auto_generated: true },
      );
      if (!rowFlagged) {
        const parsed = await _pmCloudReadFrontmatter(provider, targetPath);
        const targetFm = parsed.frontmatter || {};
        if (!targetFm.task_name_auto_generated) {
          targetFm.task_name_auto_generated = true;
          await provider.writeText(targetPath, _pmCloudFrontmatterText(targetFm, parsed.body || ''));
        }
      }
    } catch (err) {
      console.error('task_name_auto_generated の付与に失敗しました:', err);
    }
    return {
      auto_generated: true,
      old_path: path,
      new_path: targetPath,
      old_name: currentName,
      new_name: internals._basename(targetPath).replace(/\.md$/i, ''),
      generated_name: generatedName,
    };
  }

  // 制作管理UX改善計画（2026-08-04）§5-3「作業順の空欄対策」: 作業内容リストへ行を直接追加した
  // 時（タスク生成経由の _pmCloudEnsureTaskReferences ではない、汎用エントリ作成
  // gb-data-access-dropbox-expanded.part01.js の _createEntity 経由）、作業順が空欄なら
  // 既存最大値+10（空シートなら100）を自動設定する。Desktop
  // meldex_production_management_support.next_work_order_value と同じ基準・刻み幅。
  const PM_WORK_ORDER_BASE = 100;
  const PM_WORK_ORDER_STEP = 10;

  function _pmNextWorkOrderValue(existingRawValues) {
    let maxOrder = 0;
    (existingRawValues || []).forEach(raw => {
      const value = Number(raw);
      if (Number.isFinite(value) && value > maxOrder) maxOrder = value;
    });
    const next = maxOrder > 0 ? maxOrder + PM_WORK_ORDER_STEP : PM_WORK_ORDER_BASE;
    return String(Math.round(next * 100) / 100);
  }

  async function _pmCloudApplyWorkOrderDefault(provider, path, frontmatter) {
    const internals = window.__MeldexPwaDataAccessInternals;
    if (!frontmatter || !internals) return false;
    const root = String(_pmCloudRoot(internals) || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const normalized = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!root || !normalized.startsWith(`${root}/作業内容リスト/`)) return false;
    if (_pmCloudPropValue(frontmatter, '作業順')) return false;
    const siblings = await _pmCloudListEntries(provider, internals, '作業内容リスト');
    const existingValues = siblings.map(entry => _pmCloudPropValue(entry.frontmatter, '作業順'));
    // 汎用エントリ作成（この関数自身の呼び出し元 _createEntity）が呼ぶ _ensureFolderNote は、
    // settings-db フォルダを必ず sheet-store（_meldex_sheet.cloud.json）へ自動移行する。移行後は
    // _pmCloudListEntries（内部の internals._listDirectoryEntries が物理ファイルしか見ない）が
    // 既存行を見失うため、直接追加が2件目以降になる時点で常に空シート扱い（100固定）に
    // 戻ってしまう。ここではベストエフォートで sheet-store の行も読んで既存値へ合流させる
    // （読めなくても既定値100へフォールバックするだけで、致命的な失敗にはしない）。
    try {
      const storePath = internals._joinPath(root, '作業内容リスト', '_meldex_sheet.cloud.json');
      const store = await provider.readJson(storePath);
      if (store && store.rows && typeof store.rows === 'object') {
        Object.values(store.rows).forEach(row => {
          if (row && row.frontmatter) existingValues.push(_pmCloudPropValue(row.frontmatter, '作業順'));
        });
      }
    } catch (err) { /* sheet-store未使用・読めない場合は物理ファイルの結果のみで進める */ }
    const nextValue = _pmNextWorkOrderValue(existingValues);
    frontmatter.properties = frontmatter.properties && typeof frontmatter.properties === 'object' ? frontmatter.properties : {};
    frontmatter.properties['作業順'] = [{ value: nextValue, status: '採用', note: '', created: new Date().toISOString() }];
    return true;
  }

  async function _pmCloudApplyDurationRecalcHook(provider, path, frontmatter, changedProperty) {
    if (!frontmatter || !PM_DURATION_RECALC_TRIGGER_PROPS.has(String(changedProperty || ''))) return false;
    const internals = window.__MeldexPwaDataAccessInternals;
    if (!_pmCloudTaskSheetEntryInfo(internals, path)) return false;
    const reason = window.MeldexProductionCloudTaskStructure?.protectionReason?.(
      { frontmatter }, { propValue: _pmCloudPropValue },
    );
    if (reason) return false;
    const target = String(_pmCloudPropValue(frontmatter, '作業対象リスト') || '').trim();
    const content = String(_pmCloudPropValue(frontmatter, '作業内容リスト') || '').trim();
    const scale = String(_pmCloudPropValue(frontmatter, '作業規模リスト') || '').trim();
    // コミット前レビュー指摘 #2: Desktop _recompute_task_duration と同じ保護。作業対象・
    // 作業内容・作業規模の3分類が揃っていない行は計算式を通さず、手動指定の目標作業時間を
    // 温存する（production-management-ux-improvement-plan-2026-08-04.md §3-3「手動で時間を
    // 指定したい場合に備え…」）。
    if (!target || !content || !scale) return false;
    const row = {
      '作業対象リスト': target,
      '作業内容リスト': content,
      '作業規模リスト': scale,
      '対象数': _pmCloudPropValue(frontmatter, '対象数'),
    };
    await _pmCloudApplyTaskDurations(provider, internals, [row]);
    // 計算結果が既存値と同じなら書き込まない（Desktopの unchanged 判定と同じ。無用な
    // frontmatter更新・modified更新・下流フックの発火を避ける）。
    const currentValue = String(_pmCloudPropValue(frontmatter, '目標作業時間_値') || '');
    if (currentValue === String(row['目標作業時間_値'] || '')) return false;
    const now = new Date().toISOString();
    frontmatter.properties = frontmatter.properties && typeof frontmatter.properties === 'object' ? frontmatter.properties : {};
    frontmatter.properties['目標作業時間_値'] = [{ value: row['目標作業時間_値'], status: '採用', note: '', created: now }];
    frontmatter.properties['目標作業時間'] = [{ value: row['目標作業時間'], status: '採用', note: '', created: now }];
    return true;
  }
})();
