import {directoryRows} from './user-directory.js';

export function createUserDirectory(get){
 function rows(){
  const c=get(),{d,state,t,esc,button,username,labname,label,active,me,manages,system}=c;
  const days=Number(state.userDirectory.days);
  const items=directoryRows(d.users,d.bookings,d.labs,state.userDirectory);
  const markup=items.map(({user,count})=>`<tr><td><strong>${esc(username(user.id))}</strong><small>${esc(user.email||'—')}</small></td><td>${esc(labname(user.lab_id))}</td><td>${esc(label(user.role))}</td><td>${c.badge(user.blacklisted_at?'blacklisted':active(user)?user.status:user.status==='approved'?'disabled':user.status)}${user.suspended_until?`<small>${c.fmt(user.suspended_until)}</small>`:''}</td><td><strong>${count}</strong></td><td>${button(t('查看認證','View certification'),'member-certifications',user.id)}</td><td>${user.id!==me().id&&manages(me(),user)?`${user.blacklisted_at?'':button(t('設定權限','Edit access'),'user',user.id)} ${system(me())&&['system_admin','lab_manager'].includes(user.role)?button(t('管理者退場','Offboard manager'),'offboard-manager',user.id):''} ${system(me())?button(user.blacklisted_at?t('解除黑名單','Remove blacklist'):t('列入黑名單','Blacklist'),'blacklist-user',user.id):''}`:'—'}</td></tr>`).join('')||`<tr><td colspan="7" class="directory-empty">${t('找不到符合的使用者','No matching members')}</td></tr>`;
  return {markup,count:items.length,days};
 }
 function view(){
  const c=get(),{d,state,t,esc,button,head,options,system,me}=c,filters=state.userDirectory,list=rows();
  return `<div class="toolbar">${system(me())?button(t('新增實驗室','Add lab'),'add-lab'):''}${d.access?.canTest&&!d.access.testing?button(t('角色測試','Test roles'),'start-test'):''}</div>`+
   head(t('帳號與權限','Accounts & access'),system(me())?t('查看所有 CNMM 使用者，認證實驗室代表並管理權限。','View all CNMM members, certify lab representatives and manage access.'):t('查看與管理直屬實驗室成員。','View and manage members of your lab.'))+
   `<div class="cert-toolbar directory-toolbar"><div class="toolbar-group"><input id="directory-search" class="search" type="search" aria-label="${t('搜尋使用者','Search members')}" placeholder="${t('搜尋姓名或信箱','Search name or email')}" value="${esc(filters.search)}">${system(me())?`<select id="directory-lab" aria-label="${t('篩選實驗室','Filter lab')}">${options([['',t('所有實驗室','All labs')],...d.labs.map(l=>[l.id,c.labname(l.id)])],filters.lab)}</select>`:''}<select id="directory-role" aria-label="${t('篩選權限','Filter role')}">${options([['',t('所有層級','All roles')],['system_admin',t('主系統管理者','System admin')],['lab_manager',t('實驗室管理者','Lab manager')],['user',t('一般使用者','Member')]],filters.role)}</select></div><div class="toolbar-group"><label class="directory-control">${t('預約期間','Booking period')} <select id="directory-days" aria-label="${t('預約統計期間','Booking period')}">${options([30,90,365].map(n=>[String(n),t(`近 ${n} 天`,`Last ${n} days`)]),String(filters.days))}</select></label><label class="directory-control">${t('排序','Sort by')} <select id="directory-sort" aria-label="${t('排序方式','Sort by')}">${options([['lab',t('實驗室','Lab')],['role',t('權限層級','Role')],['frequency',t('預約頻率','Booking frequency')],['name',t('姓名','Name')]],filters.sort)}</select></label>${button(filters.descending?t('由高到低','Descending'):t('由低到高','Ascending'),'directory-direction','','secondary small','id="directory-direction" aria-label="'+t('切換排序方向','Reverse sort order')+'"')}</div></div>`+
   `<p class="directory-note">${t('預約數以開始時間計算，包含已核准、已簽到、已完成及未到場；不含待審、取消與退回。','Counts use the booking start time and include confirmed, checked-in, completed and no-show sessions; pending, cancelled and declined requests are excluded.')} <span id="directory-count" role="status">${t(`顯示 ${list.count} 位使用者`,`Showing ${list.count} members`)}</span></p>`+
   `<section class="panel table-scroll"><table class="table directory-table"><thead><tr>${[t('姓名 / 信箱','Name / email'),t('實驗室','Lab'),t('層級','Role'),t('狀態','Status'),t(`近 ${list.days} 天預約`,`Bookings · ${list.days} days`),t('儀器認證','Instrument certification'),t('操作','Actions')].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody id="directory-rows">${list.markup}</tbody></table></section>`;
 }
 function bind(){
  const c=get(),state=c.state.userDirectory;
  const update=()=>{const body=document.querySelector('#directory-rows');if(!body)return;const result=rows();body.innerHTML=result.markup;document.querySelector('#directory-count').textContent=c.t(`顯示 ${result.count} 位使用者`,`Showing ${result.count} members`);document.querySelector('.directory-table thead th:nth-child(5)').textContent=c.t(`近 ${result.days} 天預約`,`Bookings · ${result.days} days`);document.querySelector('#directory-direction').textContent=state.descending?c.t('由高到低','Descending'):c.t('由低到高','Ascending');};
  const search=document.querySelector('#directory-search');if(!search)return;
  search.oninput=e=>{state.search=e.target.value;update();};
  const lab=document.querySelector('#directory-lab');if(lab)lab.onchange=e=>{state.lab=e.target.value;update();};
  document.querySelector('#directory-role').onchange=e=>{state.role=e.target.value;update();};
  document.querySelector('#directory-days').onchange=e=>{state.days=Number(e.target.value);update();};
  document.querySelector('#directory-sort').onchange=e=>{state.sort=e.target.value;state.descending=state.sort==='frequency';update();};
  document.querySelector('#directory-direction').onclick=()=>{state.descending=!state.descending;update();};
 }
 return {view,bind};
}
