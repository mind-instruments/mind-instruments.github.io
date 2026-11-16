import {upgradeHandovers} from './handover.js';
// Shared workflow rules. Every mutation runs on a cloned, server-owned snapshot.
const need=(ok,code='invalid_input')=>{if(!ok)throw Error(code);};
const clean=(s,n=2000)=>String(s??'').trim().slice(0,n);
const manage=u=>['system_admin','lab_manager'].includes(u.role);
const owns=(u,lab)=>u.role==='system_admin'||u.role==='lab_manager'&&u.lab_id===lab;
const find=(xs,id)=>{const x=xs.find(x=>x.id===id);need(x,'not_found');return x;};
export const slotsFor=(rows,columns)=>Array.from({length:rows},(_,r)=>Array.from({length:columns},(_,c)=>String.fromCharCode(65+r)+(c+1))).flat();
export function layoutFor(quantity){const size=Math.max(1,Number(quantity)||1),columns=size<=10?size:size>260?20:size>=50?10:Array.from({length:11-Math.ceil(Math.sqrt(size))},(_,n)=>Math.ceil(Math.sqrt(size))+n).find(n=>size%n===0)||10;return {rows:Math.ceil(size/columns),columns};}
export function upgradeWorkflows(d){
 d.mail_jobs||=[];d.attendance_requests||=[];d.stock_movements||=[];d.assets||=[];d.rule_history||=[];
 d.notification_rules||={checkin_before:15,checkin_close:10,checkin_reminder:5,checkout_reminder:10,escalation:60};
 for(const t of d.probe_tables||[]){t.status||='published';t.revision||=1;t.ordered_quantity??=d.probes.filter(p=>p.table_id===t.id).length;t.received_quantity??=d.probes.filter(p=>p.table_id===t.id).length;t.default_grants||=[];}
 return upgradeHandovers(d);
}
export function applyWorkflow(d,u,action,a,now){
 const stamp=new Date(now).toISOString(),id=()=>crypto.randomUUID();
 const movement=(p,type,reason,before)=>d.stock_movements.push({id:id(),probe_id:p.id,table_id:p.table_id,instrument_id:p.instrument_id,lab_id:p.lab_id,type,reason:clean(reason),before,after:structuredClone(p),actor_id:u.id,created_at:stamp});
 const metadata=a=>{const out={};for(const k of ['vendor','batch','location','purchase_date','arrival_date'])out[k]=clean(a[k],200);for(const k of ['purchase_date','arrival_date'])need(!out[k]||/^\d{4}-\d{2}-\d{2}$/.test(out[k])&&new Date(out[k]).toISOString().slice(0,10)===out[k]);need(!out.purchase_date||!out.arrival_date||out.arrival_date>=out.purchase_date);for(const k of ['lead_days','safety_stock']){out[k]=Number(a[k]||0);need(Number.isInteger(out[k])&&out[k]>=0&&out[k]<=3650);}return out;};
 const receive=(table,quantity,price,prefix)=>{need(Number.isInteger(quantity)&&quantity>=0&&table.received_quantity+quantity<=table.ordered_quantity);need(Number.isFinite(price)&&price>=0,'invalid_price');let seq=1;for(let n=0;n<quantity;n++){const slot=slotsFor(table.rows,table.columns).find(s=>!d.probes.some(p=>p.table_id===table.id&&p.slot===s&&p.status!=='retired'));need(slot,'capacity_exceeded');let serial;do{serial=prefix+'-'+String(seq++).padStart(6,'0');}while(d.probes.some(p=>p.serial===serial));const p={id:id(),table_id:table.id,instrument_id:table.instrument_id,serial,slot,model:table.model,lab_id:table.lab_id,price,grants:[...table.default_grants],status:'available',condition:'good',holder:null};d.probes.push(p);movement(p,'receipt','',null);}table.received_quantity+=quantity;};
 switch(action){
 case 'add_probe_table':{
  need(manage(u),'forbidden');const lab=u.role==='system_admin'?a.lab_id||null:u.lab_id;need(!lab||d.labs.some(l=>l.id===lab));a={...a,instrument_id:a.instrument_id||'vero-afm'};const quantity=a.quantity,layout=layoutFor(a.ordered_quantity??quantity),rows=a.rows??layout.rows,columns=a.columns??layout.columns;
  need(Number.isInteger(quantity)&&quantity>=0&&quantity<=520&&Number.isInteger(rows)&&rows>=1&&rows<=26&&Number.isInteger(columns)&&columns>=1&&columns<=20);need(rows*columns>=quantity,'capacity_exceeded');need(clean(a.name,100)&&clean(a.model,100)&&/^[A-Za-z0-9_-]{1,30}$/.test(a.prefix));need(d.instruments.some(i=>i.id===a.instrument_id),'instrument_not_found');
  const ordered=a.ordered_quantity??quantity;need(Number.isInteger(ordered)&&ordered>=quantity&&ordered<=rows*columns);
  const t={id:id(),name:clean(a.name,100),model:clean(a.model,100),prefix:a.prefix,instrument_id:a.instrument_id,lab_id:lab,rows,columns,status:'draft',revision:1,ordered_quantity:ordered,received_quantity:0,default_grants:[],created_by:u.id,created_at:stamp,...metadata(a)};d.probe_tables.push(t);receive(t,quantity,a.price,a.prefix);return t;
 }
 case 'edit_probe_table':case 'publish_probe_table':case 'receive_probe_table':case 'table_permissions':{
  const t=find(d.probe_tables,a.id);need(owns(u,t.lab_id),'forbidden');need(a.revision===t.revision,'stale_request');
  if(action==='edit_probe_table'){need(clean(a.name,100));Object.assign(t,{name:clean(a.name,100),...metadata(a)});}
  if(action==='publish_probe_table'){need(t.received_quantity>0,'empty_sheet');need(t.photo_id&&d.assets.some(x=>x.id===t.photo_id&&x.table_id===t.id),'photo_required');need(t.purchase_date&&t.arrival_date&&t.vendor&&t.batch,'procurement_required');t.status='published';t.published_at=stamp;}
  if(action==='receive_probe_table')receive(t,a.quantity,a.price,t.prefix||'ITEM');
  if(action==='table_permissions'){need(Array.isArray(a.user_ids));for(const member of a.user_ids)need(find(d.users,member).lab_id===t.lab_id,'wrong_lab');t.default_grants=[...new Set(a.user_ids)];for(const p of d.probes.filter(p=>p.table_id===t.id&&p.lab_id===t.lab_id&&(!a.probe_ids||a.probe_ids.includes(p.id))))p.grants=[...t.default_grants];}
  t.revision++;return t;
 }
 case 'stock_adjustment':{
  const p=find(d.probes,a.id);need(owns(u,p.lab_id),'forbidden');need(clean(a.reason),'reason_required');need(p.status!=='in_use','probe_unavailable');const before=structuredClone(p);
  if(a.kind==='lost'){need(p.status!=='retired');p.status='retired';p.condition='damaged';}
  else if(a.kind==='transfer'){for(const usage of d.usages.filter(x=>x.probe_id===p.id)){usage.lab_id??=p.lab_id;usage.instrument_id??=p.instrument_id;usage.model??=p.model;}const t=find(d.probe_tables,a.table_id);need(owns(u,t.lab_id),'forbidden');need(t.instrument_id===p.instrument_id&&t.model===p.model);need(slotsFor(t.rows,t.columns).includes(a.slot));need(!d.probes.some(x=>x.id!==p.id&&x.table_id===t.id&&x.slot===a.slot&&x.status!=='retired'),'duplicate_probe');Object.assign(p,{table_id:t.id,slot:a.slot,lab_id:t.lab_id,grants:[...t.default_grants]});}
  else need(false);movement(p,a.kind,a.reason,before);return p;
 }
 case 'correct_probe':{
  const p=find(d.probes,a.id),target=find(d.probes,a.target_id);need(owns(u,p.lab_id)&&owns(u,target.lab_id),'forbidden');need(d.probe_tables.some(t=>t.id===target.table_id&&t.status==='published'),'table_required');need(p.status==='in_use'&&target.status==='available'&&target.condition==='good'&&!target.holder&&p.lab_id===target.lab_id&&p.instrument_id===target.instrument_id,'probe_unavailable');need(clean(a.reason),'reason_required');const usage=d.usages.find(x=>x.probe_id===p.id&&!x.returned_at);need(usage);const before=structuredClone(p);usage.returned_at=stamp;usage.correction_reason=clean(a.reason);usage.corrected_by=u.id;d.usages.push({id:id(),probe_id:target.id,user_id:p.holder,actor_id:u.id,taken_at:usage.taken_at,recorded_at:stamp,corrects:usage.id,instrument_id:target.instrument_id,lab_id:target.lab_id,model:target.model,returned_at:null});target.holder=p.holder;target.status='in_use';p.holder=null;p.status='available';movement(p,'correction',a.reason,before);movement(target,'correction',a.reason,null);return p;
 }
 case 'assign_operator':{
  const b=find(d.bookings,a.id),operator=find(d.users,a.operator_id);need(owns(u,b.lab_id),'forbidden');need(b.booking_method==='assisted'&&['pending','booked'].includes(b.status));need(operator.status==='approved'&&d.certifications.some(c=>c.user_id===operator.id&&c.instrument_id===b.instrument_id&&c.level==='advanced'),'instrument_access');b.operator_id=operator.id;return b;
 }
 case 'request_attendance':{
  const b=find(d.bookings,a.id);need(b.user_id===u.id||b.operator_id===u.id,'forbidden');need(Date.parse(b.start)<=now,'invalid_time');need(['booked','checked_in','no_show','completed','released'].includes(b.status));need(!d.attendance_requests.some(x=>x.booking_id===b.id&&x.status==='pending'),'duplicate_request');const start=+new Date(a.start),end=+new Date(a.end);need(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end<=now&&end-start<=24*3600000,'invalid_time');need(clean(a.reason),'reason_required');const i=find(d.instruments,b.instrument_id);need(i.checkout_statuses.some(x=>x.id===a.instrument_status)&&i.modes.some(x=>x.id===a.usage_mode),'checkout_required');const x={id:id(),booking_id:b.id,instrument_id:b.instrument_id,user_id:b.user_id,operator_id:b.operator_id||null,requested_by:u.id,lab_id:b.lab_id,start:new Date(start).toISOString(),end:new Date(end).toISOString(),instrument_status:a.instrument_status,usage_mode:a.usage_mode,reason:clean(a.reason),status:'pending',created_at:stamp};d.attendance_requests.push(x);return x;
 }
 case 'approve_attendance':case 'reject_attendance':{
  const x=find(d.attendance_requests,a.id),b=find(d.bookings,x.booking_id);need(owns(u,x.lab_id)&&u.id!==x.user_id&&u.id!==x.requested_by,'forbidden');need(x.status==='pending','stale_request');need(clean(a.reason),'reason_required');x.review_reason=clean(a.reason);x.reviewed_by=u.id;x.reviewed_at=stamp;x.status=action==='approve_attendance'?'approved':'rejected';
  if(x.status==='approved'){need(['booked','checked_in','no_show','completed','released'].includes(b.status),'stale_request');x.before=structuredClone(b);const i=find(d.instruments,b.instrument_id),condition=i.checkout_statuses.find(o=>o.id===x.instrument_status),mode=i.modes.find(o=>o.id===x.usage_mode);need(condition&&mode,'checkout_required');if(b.status==='no_show'){const member=find(d.users,b.user_id);member.strikes=Math.max(0,member.strikes-1);if(member.strikes<=3&&member.suspension_reason==='no_show')member.suspended_until=null;b.penalty_amount=0;}Object.assign(b,{status:'completed',checked_in_at:x.start,checked_out_at:x.end,attendance_corrected:true,instrument_status:{...condition},usage_mode:{...mode},notes:x.reason});if(condition.blocks_booking)i.status='maintenance';}return x;
 }
 case 'notification_rules':{
  need(u.role==='system_admin','forbidden');const r={};for(const k of ['checkin_before','checkin_close','checkin_reminder','checkout_reminder','escalation']){need(Number.isInteger(a[k])&&a[k]>=0&&a[k]<=1440);r[k]=a[k];}need(r.checkin_reminder<r.checkin_close&&r.escalation>r.checkout_reminder);d.notification_rules=r;return {id:'notifications',...r};
 }
 default:return undefined;
 }
}
