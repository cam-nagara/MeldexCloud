/* Read-only history projection consumed by the ordinary Sheet app. */
(function (global) {
  'use strict';
  const PATH = 'meldex-chat-history/管理シート';
  const columns = [
    ['provider','プロバイダー','text'],['model','モデル','text'],['targetPath','対象ファイル','text'],
    ['created','作成日時','date'],['modified','最終更新日時','date'],['messageCount','メッセージ数','number'],
    ['hasAttachments','添付','checkbox'],['path','履歴の保存場所','text'],['store','保存元','text'],
  ];
  let rows = [], loaded = false, pending = null, toolbar = null, selection = {query:'',filters:{}}, refreshTimer;
  const byPath = new Map();
  const isPath = path => String(path || '').startsWith('meldex-chat-history/');
  const cloud = () => global.MeldexRuntimeAdapter?.isBrowserDataMode?.() === true;
  async function loadCloud() {
    const home = await GBChatStorageContext.resolveForHistory();
    const sources = new Map([[home.sourceFolder,{sourceFolder:home.sourceFolder}]]);
    const options = typeof _chatSourceOptions==='function' ? _chatSourceOptions() : [];
    options.forEach(option=>{
      const folder=String(option.path || option.value || '');
      if(folder && !sources.has(folder))sources.set(folder,{sourceFolder:folder,workspaceId:option.workspaceId || ''});
    });
    const items=[], seen=new Set();let unreadableCount=0;
    // One listing per scope, never a request per conversation.
    for(const scope of sources.values()) {
      try {
        const query=scope.workspaceId?'workspace_id='+encodeURIComponent(scope.workspaceId):'source_folder='+encodeURIComponent(scope.sourceFolder);
        const data=await apiFetch('/chat/history?'+query);
        unreadableCount+=Number(data.unreadableCount || 0);
        for(const row of data.items || []) {
          const id=scope.sourceFolder+'/'+row.path;
          if(seen.has(id))continue;seen.add(id);
          items.push({...row,id,sourceFolder:scope.sourceFolder});
        }
      } catch(error) {
        if(scope.sourceFolder===home.sourceFolder)throw error;
        unreadableCount++;
      }
    }
    return {items,unreadableCount};
  }
  async function load(refresh = false) {
    if (pending) return pending;
    if (loaded && !refresh) return rows;
    pending = (async () => {
      const data = cloud() ? await loadCloud() : await apiFetch('/chat/management-history');
      if(!data || !Array.isArray(data.items))throw new Error('履歴を読み込めませんでした。再試行してください');
      rows = (data?.items || []).map(row => ({...row, id:row.id || row.path}));
      rows.sort((a,b)=>(Date.parse(b.modified || '') || 0)-(Date.parse(a.modified || '') || 0));
      if(data.unreadableCount && typeof showStatus==='function')showStatus(`${data.unreadableCount}件の履歴を読み込めませんでした`,true);
      loaded = true;
      return rows;
    })().finally(() => { pending = null; });
    return pending;
  }
  function matches(row, value = selection) {
    const query = String(value.query || '').trim().toLocaleLowerCase();
    if (query && !(`${row.title || ''}\n${row.searchText || ''}`).toLocaleLowerCase().includes(query)) return false;
    const filters = value.filters || {};
    if (filters.provider && row.provider !== filters.provider) return false;
    if (filters.model && row.model !== filters.model) return false;
    if (filters.target && !String(row.targetPath || '').toLocaleLowerCase().includes(filters.target.toLocaleLowerCase())) return false;
    const date = String(row.modified || '').slice(0,10);
    if (filters.date?.from && date < filters.date.from) return false;
    if (filters.date?.to && date > filters.date.to) return false;
    if (filters.attachments && !!row.hasAttachments !== (filters.attachments === 'yes')) return false;
    return true;
  }
  function pivot() {
    const entities = Object.create(null); byPath.clear();
    rows.filter(row=>matches(row)).forEach(row => {
      const token = encodeURIComponent(row.id);
      const entryPath = PATH + '/' + token;
      let name = row.title || '無題のチャット';
      if(Object.hasOwn(entities,name)) name += ' · ' + token;
      const entry = {_id:entryPath, _entry_path:entryPath};
      columns.forEach(([key,label]) => {entry[label] = [{id:entryPath+'/'+key, value:key==='hasAttachments'?(row[key]?'true':'false'):String(row[key] ?? ''),status:'採用',entry_path:entryPath}];});
      entities[name] = entry; byPath.set(entryPath,row);
    });
    return {properties:columns.map(c=>c[1]),entities,format:'new'};
  }
  function metadata() {
    return {display_title:'チャット履歴（読み取り専用）',system_managed:true,
      property_types:Object.fromEntries(columns.map(([,label,type])=>[label,{type,readOnly:true}])),view_config:getDbViewConfig(PATH)};
  }
  async function handleApi(path, opts = {}) {
    const url = new URL(path,'http://local');
    let body; try {body=typeof opts.body==='string'?JSON.parse(opts.body):opts.body;} catch {}
    const values = [...url.searchParams.values(), ...Object.values(body || {})];
    if (!values.some(v => typeof v === 'string' && isPath(v))) return null;
    const method = String(opts.method || 'GET').toUpperCase();
    if (url.pathname==='/view-lock') {
      // This generated document has no backing file. Display locks belong to
      // this device, just like its column widths and saved views.
      const viewKey=url.searchParams.get('view_key') || body?.view_key || PATH;
      const key='meldex:chat-history-view-lock:'+viewKey;
      if(method==='PUT') {
        const lock={...body,view_key:viewKey};localStorage.setItem(key,JSON.stringify(lock));
        return {value:{ok:true,...lock}};
      }
      if(method==='GET')return {value:JSON.parse(localStorage.getItem(key) || 'null') || {view_key:viewKey,locked:false,state:{}}};
    }
    if (url.pathname==='/db-metadata' && method==='PUT' && body?.view_config && Object.keys(body).every(k=>k==='view_config')) return {value:{ok:true}};
    if (method !== 'GET') throw new Error('チャット履歴の管理シートは読み取り専用です');
    if (url.pathname==='/db-metadata') return {value:metadata()};
    if (url.pathname==='/pivot') {await load(true);return {value:pivot()};}
    if (url.pathname==='/contained-files') return {value:[]};
    throw new Error('この管理シートでは利用できない操作です');
  }
  function contexts() {return typeof _dbPaneContextsForPath==='function' ? _dbPaneContextsForPath(PATH) : [];}
  function redraw() {
    const data = pivot();
    contexts().forEach(ctx => {
      ctx.pivotData=data;
      if(state.currentDbPath===PATH)state.pivotData=data;
      if(typeof _renderCurrentDbView==='function')_renderCurrentDbView(ctx,PATH);else renderPivot(ctx);
    });
  }
  async function refresh() {if(pending)await pending;await load(true);redraw();return rows;}
  async function open() {
    const cfg=getDbViewConfig(PATH);
    if(!cfg.savedViews?.length) saveDbViewConfig(PATH,{...cfg,savedViews:[{name:'履歴',viewMode:'pivot',entityColumnLabel:'タイトル'}],currentViewIdx:0},{skipBackend:true,skipHistory:true});
    const paneId=GBPaneDefaultLayout.resolveMainPaneId({contentOnly:true});
    GBTabs.addTab(paneId,'チャット履歴 管理シート','pivot',PATH,{dbPath:PATH},{preferTargetPane:true});
    return selectDatabase(PATH,typeof getPaneContext==='function'?getPaneContext(paneId):null);
  }
  function notifyMutation(path, body) {
    if(!loaded)return;
    const route=String(path).split('?')[0];
    if(!route.startsWith('/chat/') && !route.startsWith('/cli-transcripts/') && !JSON.stringify(body || {}).replace(/\\\\/g,'/').includes('_chat/'))return;
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(()=>refresh().then(()=>renderChatHistory({localOnly:true,skipSheetRefresh:true})).catch(error=>showStatus('履歴を更新できません: '+error.message,true)),30);
  }
  function openRow(path) {
    const row=byPath.get(path);if(!row)return false;
    if(row.store==='cli') {switchChatHistoryView('cli');global.GBChatCli?.openSession?.(row.provider,row.sessionId);}
    else openSavedChat(row.path,'',row.sourceFolder);
    return true;
  }
  function ensureToolbar() {
    const host=document.getElementById('chat-history-management-tools');if(!host)return;
    if(toolbar?.el.parentElement===host)return;
    const button=host.querySelector('#chat-history-open-sheet') || document.createElement('button');
    button.remove();
    toolbar?.destroy();
    host.replaceChildren();
    const options = key => [...new Set(rows.map(row=>row[key]).filter(Boolean))].sort();
    toolbar=MeldexSearchFilterRow.create({label:'チャットのタイトルと本文を検索',placeholder:'ワード検索',filters:[
      {id:'provider',label:'プロバイダー',icon:'bot',options:()=>options('provider')},
      {id:'model',label:'モデル',icon:'cpu',options:()=>options('model')},
      {id:'target',label:'対象ファイル・フォルダー',icon:'folder',type:'text'},
      {id:'date',label:'期間',icon:'calendar',type:'date-range'},
      {id:'attachments',label:'添付',icon:'paperclip',options:[{value:'yes',label:'あり'},{value:'no',label:'なし'}]},
    ],onChange:value=>{selection=value;redraw();if(typeof renderChatHistory==='function')renderChatHistory({localOnly:true,skipSheetRefresh:true});}});
    toolbar.setValue(selection);
    button.id='chat-history-open-sheet';button.type='button';button.className='tb-text-btn';button.textContent='管理シート';
    button.dataset.e2eId='chat-history-open-sheet';button.dataset.action='openChatHistorySheet()';toolbar.actions.append(button);
    host.append(toolbar.el);
  }
  global.MeldexChatManagementSheet=Object.freeze({PATH,isPath,load,matches,handleApi,openRow,ensureToolbar,rows:()=>rows,refresh,redraw,notifyMutation,open});
  global.openChatHistorySheet=open;
  global.refreshOpenChatHistorySheet=refresh;
})(window);
