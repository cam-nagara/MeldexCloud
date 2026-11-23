/* Request-scoped Cloud tools use the same permission, lock and CAS routes as the UI. */
(function(global){
  'use strict';
  const definitions=[
    {name:'read_file',description:'参照対象のUTF-8ファイルを読む。全文を読めた時だけ更新用etagを返す。',
      parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}},
    {name:'write_file',description:'参照対象のテキストを作成・更新する。既存ファイルは直前read_fileの全文とetagが必須。構造化データは専用操作を使う。',
      parameters:{type:'object',properties:{path:{type:'string'},content:{type:'string'},expected_etag:{type:'string'}},required:['path','content'],additionalProperties:false}},
  ];
  const fail=(message,code='invalid_tool_input')=>Object.assign(new Error(message),{code});
  function normalize(path){
    const raw=String(path||'').replace(/\\/g,'/').trim();
    if(!raw||/[\x00-\x1f]/.test(raw)||/^[a-z][a-z\d+.-]*:/i.test(raw)
      ||raw.split('/').some(part=>part==='.'||part==='..'))throw fail('参照対象内のファイルを指定してください','path_outside_scope');
    return raw.replace(/\/{2,}/g,'/').replace(/\/$/,'');
  }
  // Keep the desktop chat tool's protected metadata and credential boundaries.
  const protectedFiles=new Set(['_users.json','_permissions.json','.env.chat','_avatars.json',
    '_meldex_team.json','_notion-db.json','notion_config.json','google_calendar_token.json','editor-config.json','meldex.db']);
  const protectedParts=new Set(['credential','credentials','key','keys','secret','secrets','token','tokens']);
  function protectedPath(path){
    const parts=path.toLowerCase().split('/');
    return protectedFiles.has(parts[parts.length-1])||parts.some(part=>part.startsWith('.')
      ||protectedParts.has(part)||/^_(?:meldex|chat|permissions)(?:$|\.)/.test(part)
      ||/\.env|credentials|secret|token.*\.json$/.test(part));
  }
  function structured(path,content){
    return /\.(?:mel-sheet|mel-board|mel-scenario|mel-timer|scriptnote\.json|timer\.json)$/i.test(path)
      ||/^\uFEFF?---\r?\n[\s\S]*?^type:\s*(?:settings-db|settings-entry|board|topic-view|meldex-topic-view|annotation|quick-memo)\s*$/m.test(content);
  }
  function resolvePath(body,raw){
    const requested=normalize(raw);
    const references=(Array.isArray(body.reference_targets)?body.reference_targets:[])
      .filter(item=>item&&typeof item.path==='string').map(item=>({path:normalize(item.path),folder:/folder|directory|workspace/.test(item.kind||'')}));
    if(!references.length&&body.target_path)references.push({path:normalize(body.target_path),folder:false});
    const roots=references.length?references:[body.work_folder,body.source_folder].filter(Boolean).map(path=>({path:normalize(path),folder:true}));
    const inside=path=>roots.some(root=>path.toLowerCase()===root.path.toLowerCase()
      ||root.folder&&path.toLowerCase().startsWith(root.path.toLowerCase()+'/'));
    let path=requested;
    if(!inside(path)&&!path.startsWith('/')){
      const exact=roots.filter(root=>!root.folder&&root.path.toLowerCase().endsWith('/'+path.toLowerCase()));
      if(exact.length===1)path=exact[0].path;
      else {const folder=roots.find(root=>root.folder);if(folder)path=folder.path+'/'+path;}
    }
    if(!inside(path)||protectedPath(path))throw fail('参照対象の外や管理用のファイルは操作できません。対象を選び直してください','path_outside_scope');
    const exact=roots.find(root=>root.path.toLowerCase()===path.toLowerCase());
    if(exact)return exact.path;
    const folder=roots.find(root=>root.folder&&path.toLowerCase().startsWith(root.path.toLowerCase()+'/'));
    return folder?folder.path+path.slice(folder.path.length):path;
  }
  function parseArguments(value){
    const args=typeof value==='string'?JSON.parse(value):value;
    if(!args||typeof args!=='object'||Array.isArray(args))throw fail('ツールの引数が不正です');
    return args;
  }
  function declarations(format){
    if(format==='anthropic')return definitions.map(d=>({name:d.name,description:d.description,input_schema:d.parameters}));
    if(format==='gemini')return [{functionDeclarations:definitions.map(d=>({name:d.name,description:d.description,parameters:d.parameters}))}];
    if(format==='responses')return definitions.map(d=>({type:'function',...d,strict:false}));
    return definitions.map(d=>({type:'function',function:d}));
  }
  function history(payload,format,turns=[]){
    for(const turn of turns){
      if(format==='anthropic'){
        payload.messages.push({role:'assistant',content:turn.format===format?turn.assistant:
          turn.calls.map(c=>({type:'tool_use',id:c.id,name:c.name,input:parseArguments(c.arguments)}))});
        payload.messages.push({role:'user',content:turn.results.map(r=>({type:'tool_result',tool_use_id:r.id,content:r.content}))});
      }else if(format==='chat'){
        payload.messages.push({role:'assistant',content:turn.format===format?turn.text||null:null,
          tool_calls:turn.calls.map(c=>({id:c.id,type:'function',function:{name:c.name,arguments:typeof c.arguments==='string'?c.arguments:JSON.stringify(c.arguments)}}))});
        payload.messages.push(...turn.results.map(r=>({role:'tool',tool_call_id:r.id,content:r.content})));
      }else if(format==='responses'){
        payload.input.push(...(turn.format===format&&turn.assistant?.length?turn.assistant:
          turn.calls.map(c=>({type:'function_call',call_id:c.id,name:c.name,arguments:typeof c.arguments==='string'?c.arguments:JSON.stringify(c.arguments)}))));
        payload.input.push(...turn.results.map(r=>({type:'function_call_output',call_id:r.id,output:r.content})));
      }else{
        payload.contents.push(turn.format===format?turn.assistant:{role:'model',parts:turn.calls.map(c=>({functionCall:{name:c.name,args:parseArguments(c.arguments)}}))});
        payload.contents.push({role:'user',parts:turn.results.map(r=>{
          const call=turn.calls.find(c=>c.id===r.id);
          return {functionResponse:{name:r.name,response:JSON.parse(r.content),...(call?.providerId?{id:call.providerId}:{})}};
        })});
      }
    }
  }
  let sequence=0;
  function create(body,send,signal){
    const reads=new Map();
    const current=()=>{if(signal?.aborted)throw new DOMException('操作を中止しました','AbortError');};
    async function execute(name,input){
      try{
        current();
        if(!definitions.some(d=>d.name===name))throw fail('宣言されていないツールは実行できません','unknown_tool');
        const args=parseArguments(input),allowed=name==='read_file'?['path']:['path','content','expected_etag'];
        if(typeof args.path!=='string'||Object.keys(args).some(key=>!allowed.includes(key)))throw fail('ツールの引数が不正です');
        const path=resolvePath(body,args.path);
        if(name==='read_file'){
          const result=await global.apiFetch('/file?path='+encodeURIComponent(path)+'&raw_text=1',{signal});
          if(typeof result.content!=='string'||!result.etag)throw fail('ファイルの本文と保存番号を確認できません','read_unavailable');
          if(new TextEncoder().encode(result.content).length>2000000)throw fail('ファイルが大きすぎます（2MB超）');
          const truncated=result.content.length>16000;
          if(!truncated)reads.set(path.toLowerCase(),{...result,path});
          return JSON.stringify({ok:true,path:args.path,content:result.content.slice(0,16000),truncated,full_write_allowed:!truncated,
            ...(!truncated?{etag:result.etag}:{write_blocked_reason:'全文を読めていないため更新できません'})});
        }
        if(typeof args.content!=='string')throw fail('書き込む本文を指定してください');
        if(new TextEncoder().encode(args.content).length>500000)throw fail('コンテンツが大きすぎます（500KB超）');
        const before=reads.get(path.toLowerCase());
        if(structured(path,args.content)||before&&structured(path,before.content))throw fail('構造化データは専用の操作を使ってください','structured_write_requires_domain_tool');
        if(args.expected_etag&&(!before||before.etag!==args.expected_etag))throw fail('read_fileで最新の全文と保存番号を取得してください','precondition_required');
        if(before&&!args.expected_etag)throw fail('既存ファイルにはread_fileの保存番号を指定してください','precondition_required');
        const revision=before?.transport_revision;
        const coordinator=global.MeldexDocumentSaveCoordinator;
        const token=revision&&coordinator?.revisionTokenForWrite?coordinator.revisionTokenForWrite(revision,coordinator.currentTransportName()):before?.etag;
        current();
        const result=await global.apiPut('/file?path='+encodeURIComponent(path),{content:args.content,
          include_saved_content:true,
          ...(before?{if_match_etag:token,transport_revision:revision,expected_content:before.content,skip_if_missing:true}:{create_only:true})},{signal});
        if(result?.skipped||result?.missing||result?.conflictPending||!result?.etag)throw fail('ファイルへの保存を確認できません','save_unconfirmed');
        const after=result.saved_content??result.savedMd??args.content;
        reads.delete(path.toLowerCase());
        if(before&&before.content!==after)send({type:'meldex_file_changed',path,path_aliases:[path,args.path],seq:++sequence,
          before_content:before.content,after_content:after,before_etag:before.etag,after_etag:result.etag,
          after_transport_revision:result.transport_revision});
        return JSON.stringify({ok:true,path:args.path,path_aliases:[path,args.path],etag:result.etag});
      }catch(error){
        if(error?.name==='AbortError')throw error;
        return JSON.stringify({ok:false,code:error?.code||error?.meldexCode||'tool_failed',error:String(error?.message||error),status:error?.status||0});
      }
    }
    return {execute};
  }
  global.MeldexLlmTools=Object.freeze({definitions,declarations,history,parseArguments,resolvePath,create});
})(window);
