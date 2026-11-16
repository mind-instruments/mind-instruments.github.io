import {upgradePlanning} from './planning-core.js';
import {upgradeWorkflows} from './workflows.js';
export const DEFAULT_INSTRUMENT='vero-afm';
export function defaultInstrument(){return {id:DEFAULT_INSTRUMENT,name:'Vero AFM',location:'',status:'available',access:'approved',authorized_user_ids:[],manager_ids:[],rules:null,modes:[{id:'self',name:'自行操作',en:'Self-operated'},{id:'assisted',name:'委託操作',en:'Assisted service'},{id:'training',name:'教育訓練',en:'Training'}],checkout_statuses:[{id:'normal',name:'正常',en:'Normal',requires_notes:false,blocks_booking:false},{id:'issue',name:'異常但可使用',en:'Issue — usable',requires_notes:true,blocks_booking:false},{id:'stop',name:'故障／停止使用',en:'Fault — stop use',requires_notes:true,blocks_booking:true}]};}
export function upgradeData(d){
 d.instruments||=[defaultInstrument()];d.schema_revision=17;
 // Legacy account levels alone are not proof of instrument certification.
 d.certifications||=[];
 for(const i of d.instruments){i.manager_ids||=[];i.authorized_user_ids||=[];i.access||='approved';}
 for(const b of d.bookings){b.instrument_id||=DEFAULT_INSTRUMENT;b.instrument_name||=d.instruments.find(i=>i.id===b.instrument_id)?.name||'Vero AFM';}
 for(const t of d.probe_tables||[])t.instrument_id||=DEFAULT_INSTRUMENT;
 for(const p of d.probes)p.instrument_id||=d.probe_tables?.find(t=>t.id===p.table_id)?.instrument_id||DEFAULT_INSTRUMENT;
 for(const x of d.extensions)x.instrument_id||=d.bookings.find(b=>b.id===x.booking_id)?.instrument_id||DEFAULT_INSTRUMENT;
 return upgradePlanning(upgradeWorkflows(d));
}
export const resourceId=x=>x?.instrument_id||DEFAULT_INSTRUMENT;
export const instrumentFor=(d,id=DEFAULT_INSTRUMENT)=>d.instruments?.find(i=>i.id===id)||(id===DEFAULT_INSTRUMENT&&!d.instruments?defaultInstrument():null);
export const instrumentAdmin=(u,i)=>u?.role==='system_admin'||u?.role==='lab_manager'&&i?.manager_ids?.includes(u.id);
export const certificationLevels=['none','assisted','basic','advanced'];
export const certificationFor=(d,userId,instrumentId=DEFAULT_INSTRUMENT)=>d.certifications?.find(c=>c.user_id===userId&&c.instrument_id===instrumentId);
export const qualification=(d,userId,instrumentId=DEFAULT_INSTRUMENT)=>certificationFor(d,userId,instrumentId)?.level||'none';
export const bookingMethod=(d,userId,instrumentId=DEFAULT_INSTRUMENT)=>({assisted:'assisted',basic:'self',advanced:'self'})[qualification(d,userId,instrumentId)]||null;
export function instrumentAccess(u,i,d){return !!u&&!!i&&!!bookingMethod(d,u.id,i.id);}
export function configureInstrument(d,u,a,existing){
 const need=(ok,code='invalid_input')=>{if(!ok)throw Error(code);},trim=x=>String(x??'').trim();
 need(existing?instrumentAdmin(u,existing):u.role==='system_admin','forbidden');
 need(trim(a.name)&&trim(a.name).length<=100&&['available','maintenance','inactive'].includes(a.status));
 const cleanOptions=(items,kind)=>{need(Array.isArray(items)&&items.length>0&&items.length<=40,'checkout_options');const seen=new Set();return items.map(x=>{const name=trim(x.name),en=trim(x.en);need(name&&name.length<=100&&en.length<=100&&!seen.has(name),'checkout_options');seen.add(name);const id=existing?.[kind]?.some(v=>v.id===x.id)?x.id:crypto.randomUUID();return {id,name,en:en||name,...(kind==='checkout_statuses'?{requires_notes:!!x.requires_notes,blocks_booking:!!x.blocks_booking}:{})};});};
 const modes=cleanOptions(a.modes,'modes'),statuses=cleanOptions(a.checkout_statuses,'checkout_statuses');
 need(new Set(modes.map(x=>x.id)).size===modes.length&&new Set(statuses.map(x=>x.id)).size===statuses.length,'checkout_options');
 const ids=u.role==='system_admin'?(Array.isArray(a.authorized_user_ids)?[...new Set(a.authorized_user_ids)]:[]):existing.authorized_user_ids;need(ids.every(id=>d.users.some(u=>u.id===id)));need(['approved','trained'].includes(a.access));
 const managerIds=u.role==='system_admin'?[...new Set(a.manager_ids||[])]:existing.manager_ids;need(managerIds.every(id=>d.users.some(u=>u.id===id&&['system_admin','lab_manager'].includes(u.role))));
 let rules=null;if(a.rules){const r=a.rules;need(Number.isInteger(r.start_hour)&&Number.isInteger(r.end_hour)&&r.start_hour>=0&&r.end_hour<=24&&r.start_hour<r.end_hour&&Number.isInteger(r.max_hours)&&r.max_hours>=1&&r.max_hours<=24&&['all','advanced','closed'].includes(r.weekend)&&['all','advanced','closed'].includes(r.evening)&&['system_admin','lab_manager'].includes(r.extension_role),'invalid_rules');need(r.hourly_rate==null||Number.isFinite(r.hourly_rate)&&r.hourly_rate>=0,'invalid_price');rules={start_hour:r.start_hour,end_hour:r.end_hour,max_hours:r.max_hours,weekend:r.weekend,evening:r.evening,extension_role:r.extension_role,hourly_rate:r.hourly_rate??null};}
 return {id:existing?.id||crypto.randomUUID(),name:trim(a.name),location:trim(a.location).slice(0,200),status:a.status,access:u.role==='system_admin'?a.access:existing.access,authorized_user_ids:ids,manager_ids:managerIds,rules,modes,checkout_statuses:statuses};
}
