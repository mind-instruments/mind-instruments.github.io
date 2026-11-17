import {canBackfill,historyCsv,historyParse,historyTemplate,historyExport,historyBatches} from './history-import.js';
import {downloadBlob} from './exports.js';

export function createHistoryUI(get){
 let draft={rows:[],reason:'',file:'',result:null,error:'',done:false},owner=null,working=false,selection={};
 const reset=()=>{draft={rows:[],reason:'',file:'',result:null,error:'',done:false};owner=null;selection={};};
 const permitted=()=>get().active(get().me())&&canBackfill(get().me());
 function view(){
  const {d,me,t,esc,head,button,panel}=get();
  if(owner!==me().id){reset();owner=me().id;}
  if(!permitted())return head(t('歷史補登','Historical records'),t('沒有補登權限','Backfill permission required'));
  const result=draft.result,batches=historyBatches(historyExport(d,me()));selection.exportPage=Math.min(Number(selection.exportPage)||0,Math.max(0,batches.length-1));
  const people=d.users.filter(x=>me().role==='system_admin'||x.lab_id===me().lab_id&&(me().role==='lab_manager'||x.id===me().id));
  if(!people.some(x=>x.id===selection.user))selection.user=people[0]?.id;
  if(!d.instruments.some(x=>x.id===selection.instrument))selection.instrument=d.instruments[0]?.id;
  const person=people.find(x=>x.id===selection.user),boxes=d.probe_tables.filter(x=>x.status==='published'&&x.instrument_id===selection.instrument&&d.probes.some(p=>p.table_id===x.id&&p.lab_id===person?.lab_id));
  if(!boxes.some(x=>x.id===selection.box))selection.box=boxes[0]?.id||'';
  const select=(key,title,items)=>`<label class="field">${title}<select id="history-${key}">${items.map(x=>`<option value="${esc(x.id)}" ${x.id===selection[key]?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>`;
  const i=d.instruments.find(x=>x.id===selection.instrument),codes=`<p>${t('儀器使用代號','Instrument codes')} — mode: ${i?.modes.map(x=>esc(x.id)+' ('+esc(x.name)+')').join(' / ')}；condition: ${i?.checkout_statuses.map(x=>esc(x.id)+' ('+esc(x.name)+')').join(' / ')}</p>`;
  const choices=select('user',t('範例帳戶','Template account'),people)+select('instrument',t('儀器','Instrument'),d.instruments)+select('box',t('針盒','Probe box'),boxes.length?boxes:[{id:'',name:t('尚無已發佈針盒（僅產生儀器使用範例）','No published box (booking example only)')}]);
  return head(t('歷史補登','Historical records'),t('補入已發生的使用與購買紀錄，依發生日期納入分析圖表。','Add past usage and purchases to analytics by their actual dates.'))+
   panel(t('1. 下載與編輯','1. Download and edit'),`${choices}<label class="field">${t('從第幾支探針開始（每份最多 99 支）','First probe number (up to 99 per template)')}<input id="history-offset" type="number" min="1" max="520" value="${(Number(selection.offset)||0)+1}"></label><label class="field">${t('匯出批次','Export batch')}<select id="history-export-page">${(batches.length?batches:[[]]).map((rows,index)=>`<option value="${index}" ${index===selection.exportPage?'selected':''}>${index+1} / ${batches.length||1} · ${rows.length} ${t('筆','rows')}</option>`).join('')}</select></label><div class="card-actions">${button(t('下載匯入範例','Download template'),'history-template')}${button(t('匯出補登紀錄','Export backfilled records'),'history-export')}</div><p>${t('範例已填入你可使用的帳戶、實驗室、儀器與已發佈針盒標籤。刪除不需要的列，再填寫真實資料；ID 用於比對，標籤僅方便辨識。不存在的針盒或探針會匯入失敗，請先建立並發佈。','Templates contain existing accounts, labs, instruments and published boxes in your scope. Remove unused rows and enter real data. IDs identify records; labels are for reference. Create and publish missing boxes before import.')}</p><details><summary>${t('欄位填寫方式','Column instructions')}</summary><ul><li>source_id：${t('每筆唯一英數代號；重匯相同內容會略過，內容不同則拒絕。','Unique alphanumeric ID; identical reimports are skipped, changed content is rejected.')}</li><li>type：booking = ${t('已完成儀器使用','completed instrument use')}；purchase = ${t('探針購買','probe purchase')}；usage = ${t('已結束探針領用','closed probe use')}。</li><li>start / end：2026-01-15T09:00:00+08:00。${t('使用紀錄需起訖時間，儀器單筆最多 24 小時；探針可跨日；購買只填 start。','Usage needs start and end; bookings allow at most 24 hours, probe use can span days; purchases use start only.')}</li><li>amount：${t('booking 填每小時費率；purchase 填單支購買金額；usage 留空。','Hourly rate for booking, unit purchase price for purchase, blank for usage.')}</li><li>mode / condition：${t('儀器使用請沿用範例中的模式與狀態代號；探針使用狀況填 good、worn、contaminated 或 damaged。','For bookings use the template mode and status IDs; probe condition is good, worn, contaminated or damaged.')}</li></ul>${codes}<p>${t('另存 CSV UTF-8；每批最多 200 筆、200 KB。補登不變更目前探針持有人及實物狀態，也不發送過期通知或建立 Google 日曆事件。練習前請洽系統負責人安排隔離角色測試。','Save as CSV UTF-8; up to 200 rows and 200 KB. Backfill does not change current probe holders or physical status, send old reminders or create calendar events. Ask the system administrator to arrange isolated role testing before practice.')}</p></details>`)+
   panel(t('2. 上傳並檢查','2. Upload and validate'),`<label class="field">${t('補登原因','Reason')}<input id="history-reason" maxlength="500" value="${esc(draft.reason)}" placeholder="${t('例如：紙本使用紀錄數位化','For example: digitizing paper records')}"></label><label class="field">CSV UTF-8<input id="history-file" type="file" accept=".csv,text/csv"></label><p>${esc(draft.file)} ${draft.rows.length?t(`共 ${draft.rows.length} 筆`,`${draft.rows.length} rows`):''}</p><div class="card-actions">${button(t('檢查匯入資料','Validate import'),'history-preview','','secondary',working||!draft.rows.length?'disabled':'')}${button(t('確認補登','Confirm backfill'),'history-commit','','',working||!result||result.errors.length||draft.done?'disabled':'')}</div><div role="status" id="history-result">${draft.error?`<p class="form-error">${esc(draft.error)}</p>`:''}${result?`<p>${draft.done?t(`已補登 ${result.added} 筆，略過 ${result.skipped} 筆。`,`Added ${result.added}; skipped ${result.skipped}.`):t(`預計新增 ${result.added} 筆，略過 ${result.skipped} 筆。尚未寫入。`,`Ready to add ${result.added}; skip ${result.skipped}. Not saved yet.`)}</p>${result.errors.length?`<p>${t('檢查未通過，整批不寫入。請修正後重新上傳。','Validation failed. Nothing will be saved. Fix and upload again.')}</p><ul>${result.errors.map(e=>`<li>${t('第','Row ')} ${e.row} ${t('列：',': ')}${esc(e.message)}</li>`).join('')}</ul>`:''}`:''}</div>`)+
   (draft.rows.length?panel(t('上傳內容預覽','Uploaded records'),`<div class="table-scroll"><table class="table"><thead><tr>${['source_id','type','user_label','box_label','probe_label','start','end','amount'].map(k=>`<th>${k}</th>`).join('')}</tr></thead><tbody>${draft.rows.slice(0,200).map(r=>`<tr>${['source_id','type','user_label','box_label','probe_label','start','end','amount'].map(k=>`<td>${esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`):'');
 }
 function bind(){
  for(const key of ['user','instrument','box']){const control=document.querySelector('#history-'+key);if(control)control.onchange=e=>{selection[key]=e.target.value;get().render();};}
  const exportPage=document.querySelector('#history-export-page');if(exportPage)exportPage.onchange=e=>{selection.exportPage=Number(e.target.value);};
  const offset=document.querySelector('#history-offset');if(offset)offset.onchange=e=>{selection.offset=Math.max(0,Math.min(519,Number(e.target.value)-1||0));};
  const reason=document.querySelector('#history-reason'),file=document.querySelector('#history-file');if(!reason)return;
  reason.oninput=e=>{draft.reason=e.target.value;draft.result=null;draft.done=false;document.querySelector('[data-action="history-commit"]').disabled=true;document.querySelector('#history-result').textContent='';};
  file.onchange=async e=>{const f=e.target.files[0];if(!f)return;const currentOwner=owner;draft.result=null;draft.done=false;draft.error='';draft.rows=[];draft.file=f.name;try{if(f.size>200000)throw Error('檔案限 200 KB');const text=await f.text();if(currentOwner!==get().me().id)return;draft.rows=historyParse(text);}catch(error){draft.error=error.message;}get().render();};
 }
 async function action(action,id){
  const {d,me,system,run,refresh,render,t,toast,modal,field}=get();
  if(action==='backfill-permission'){
   if(!system(me()))return true;const user=d.users.find(x=>x.id===id);if(!user||user.role==='system_admin')return true;
   const enabled=!user.can_backfill;modal(enabled?t('授予補登權限','Grant backfill'):t('撤銷補登權限','Revoke backfill'),`<p>${get().esc(user.name)}</p><p>${t('實驗室管理者可補登直屬實驗室；一般使用者僅能補登自己的紀錄。撤銷後立即禁止新的補登。','Lab managers may backfill their lab; members may backfill only their own records. Revocation blocks new backfills immediately.')}</p>`,async()=>{await run('set_backfill_permission',{id,enabled});});return true;
  }
  if(!action.startsWith('history-'))return false;if(!permitted()||working)return true;
  if(action==='history-template'||action==='history-export'){const rows=action==='history-template'?historyTemplate(d,me(),Date.now(),selection):(historyBatches(historyExport(d,me()))[selection.exportPage||0]||[]);downloadBlob(new Blob([historyCsv(rows)],{type:'text/csv;charset=utf-8'}),action==='history-template'?'cnmm-history-template.csv':'cnmm-history-'+((selection.exportPage||0)+1)+'.csv');return true;}
  if(action!=='history-preview'&&action!=='history-commit')return false;
  if(draft.reason.trim().length<2){draft.error=t('請填寫至少兩字的補登原因','Enter a reason (at least 2 characters)');render();return true;}
  if(action==='history-commit'&&(!draft.result||draft.result.errors.length||draft.done))return true;
  working=true;draft.error='';render();
  try{const result=await run(action==='history-preview'?'preview_history':'import_history',{rows:draft.rows,reason:draft.reason});draft.result=result;draft.done=action==='history-commit'&&!result.errors.length;await refresh();}
  catch(e){draft.result=null;draft.error=get().err(e);}
  finally{working=false;render();}return true;
 }
 return {view,bind,action,reset};
}
