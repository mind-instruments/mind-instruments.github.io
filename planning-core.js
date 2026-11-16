import {validDay as calendarDay,validTimestamp} from './dates.js';
export const HOUR=3600000,DAY=24*HOUR;
export const need=(ok,code='invalid_input')=>{if(!ok)throw Error(code);};
export const clean=(s,n=2000)=>String(s??'').trim().slice(0,n);
export const uid=()=>crypto.randomUUID();
export const time=x=>calendarDay(x)||validTimestamp(x)?Date.parse(x):NaN;
export const day=x=>new Date((typeof x==='number'?x:time(x))+8*HOUR).toISOString().slice(0,10);
export const validDay=calendarDay;
export const enabled=(u,now=Date.now())=>u?.status==='approved'&&(!u.suspended_until||time(u.suspended_until)<=now);
export const managesLab=(u,lab)=>u?.role==='system_admin'||u?.role==='lab_manager'&&u.lab_id===lab;
export const managesInstrument=(d,u,id)=>u?.role==='system_admin'||u?.role==='lab_manager'&&d.instruments.find(i=>i.id===id)?.manager_ids.includes(u.id);
export const find=(xs,id)=>{const x=xs.find(x=>x.id===id);need(x,'not_found');return x;};
export const overlaps=(s,e,a,b)=>time(s)<time(b)&&time(e)>time(a);
export const committed=b=>['booked','checked_in'].includes(b.status);
export const quotaCounted=b=>['pending','booked','checked_in','completed','no_show'].includes(b.status);
export const defaults={before_minutes:0,after_minutes:0,requires_presence:false,person_conflict:'block',approval_lead_minutes:0,approval_timeout_minutes:0,auto_release_minutes:0,offer_minutes:30,required_accessory_ids:[]};
const arrays=['booking_series','waitlist','accessories','date_exceptions','quotas','quota_movements','booking_exceptions','projects','approval_delegations','maintenance_windows','operator_requests','training_sessions','cost_disputes','cost_adjustments','archives','notices','import_sources','command_receipts'];
export function upgradePlanning(d){for(const k of arrays)d[k]||=[];d.booking_policies||={};return d;}
export const policyFor=(d,id)=>({...defaults,...d.booking_policies?.[id]});
export const dateException=(d,id,start)=>d.date_exceptions?.find(x=>x.instrument_id===id&&x.date===day(start)&&x.status==='active');
export function certificationValid(c,start,end=start){return !!c&&c.level!=='none'&&(!c.valid_from||day(start)>=c.valid_from)&&(!c.valid_until||day(end)<=c.valid_until);}
export function eligibleOperators(d,b,now=Date.now()){return d.users.filter(u=>enabled(u,now)&&d.certifications.some(c=>c.user_id===u.id&&c.instrument_id===b.instrument_id&&c.level==='advanced'&&certificationValid(c,b.start,time(b.end)-1)));}
export function canApprove(d,u,b,now=Date.now()){if(b.user_id===u.id&&u.role==='user')return false;return managesLab(u,b.lab_id)||d.approval_delegations?.some(x=>x.status==='active'&&x.user_id===u.id&&x.lab_id===u.lab_id&&x.lab_id===b.lab_id&&time(x.expires_at)>now&&enabled(d.users.find(a=>a.id===x.created_by),now)&&managesLab(d.users.find(a=>a.id===x.created_by),x.lab_id));}
export function notice(d,userId,kind,key,message,now,extra={}){if(d.notices.some(x=>x.key===key&&x.user_id===userId&&x.kind===kind))return;const u=d.users.find(x=>x.id===userId);if(!u)return;d.notices.push({id:uid(),user_id:userId,lab_id:u.lab_id,kind,key,message,created_at:new Date(now).toISOString(),...extra});}
export function notifyManagers(d,lab,kind,key,message,now){for(const u of d.users.filter(u=>enabled(u,now)&&managesLab(u,lab)))notice(d,u.id,kind,key,message,now);}
export function bufferWindow(d,b){const p=policyFor(d,b.instrument_id);return [new Date(time(b.start)-(b.before_minutes??p.before_minutes)*60000).toISOString(),new Date(time(b.end)+(b.after_minutes??p.after_minutes)*60000).toISOString()];}
export function bookingExtras(d,u,a,now){const p=policyFor(d,a.instrument_id),project=a.project_id?find(d.projects,a.project_id):null;return {accessory_ids:[...new Set([...(p.required_accessory_ids||[]),...(a.accessory_ids||[])])],before_minutes:p.before_minutes,after_minutes:p.after_minutes,...(project?{project_id:project.id,project_code:project.code,project_name:project.name}:{}),...(a.acknowledge_conflicts?{conflict_acknowledged_at:new Date(now).toISOString()}:{}),approval_deadline:new Date(Math.min(time(a.start)-p.approval_lead_minutes*60000,p.approval_timeout_minutes?now+p.approval_timeout_minutes*60000:Infinity)).toISOString()};}
function exception(d,u,id,start,end,kind){return d.booking_exceptions.some(x=>x.user_id===u.id&&x.lab_id===u.lab_id&&x.instrument_id===id&&x.kind===kind&&time(x.start)<=time(start)&&time(x.end)>=time(end)&&x.status==='approved');}
export function monthHours(start,end,peak=false,from=9,to=17){const result={};let s=time(start),endAt=time(end);while(s<endAt){const date=day(s),next=time(date+'T00:00:00+08:00')+DAY,e=Math.min(next,endAt),month=date.slice(0,7),a=peak?Math.max(s,time(date+'T'+String(from).padStart(2,'0')+':00:00+08:00')):s,b=peak?Math.min(e,time(date+'T00:00:00+08:00')+to*HOUR):e;result[month]=(result[month]||0)+Math.max(0,b-a)/HOUR;s=e;}return result;}
export function quotaUsage(d,q,exclude){const total={};for(const b of d.bookings.filter(b=>b.id!==exclude&&quotaCounted(b)&&(!q.instrument_id||q.instrument_id===b.instrument_id)&&(q.scope==='lab'?b.lab_id===q.subject_id:b.user_id===q.subject_id))){for(const [m,h]of Object.entries(monthHours(b.start,b.end,q.peak_only,q.peak_start,q.peak_end)))total[m]=(total[m]||0)+h;}return total;}
export function personalConflicts(d,u,start,end,id,exclude,operatorId){const p=policyFor(d,id),who=operatorId||u.id;if(!p.requires_presence)return [];return d.bookings.filter(b=>b.id!==exclude&&quotaCounted(b)&&!['completed','no_show'].includes(b.status)&&(b.operator_id||b.user_id)===who&&b.instrument_id!==id&&policyFor(d,b.instrument_id).requires_presence&&overlaps(start,end,b.start,b.end));}
export function validatePlanningSlot(d,u,start,end,now,exclude,id,opts={}){
 upgradePlanning(d);const p=policyFor(d,id),current=d.bookings.find(b=>b.id===exclude),a={...current,...opts};
 const cert=d.certifications.find(c=>c.user_id===u.id&&c.instrument_id===id);need(certificationValid(cert,start,new Date(time(end)-1).toISOString()),'certification_expired');
 if(a.operator_id){const op=find(d.users,a.operator_id),oc=d.certifications.find(c=>c.user_id===op.id&&c.instrument_id===id);need(enabled(op,now)&&oc?.level==='advanced'&&certificationValid(oc,start,new Date(time(end)-1).toISOString()),'operator_unqualified');}
 const project=a.project_id?find(d.projects,a.project_id):null;if(project)need(project.status==='active'&&project.lab_id===u.lab_id&&day(start)>=project.valid_from&&day(time(end)-1)<=project.valid_until,'project_unavailable');
 const occupiedWindow=bufferWindow(d,{...a,instrument_id:id,start,end});
 need(!d.maintenance_windows.some(w=>w.instrument_id===id&&w.status==='active'&&overlaps(...occupiedWindow,w.start,w.end)),'maintenance_window');
 if(!opts.skipAvailability){
  const [s,e]=bufferWindow(d,{...a,instrument_id:id,start,end});
  need(!d.bookings.some(b=>b.id!==exclude&&b.instrument_id===id&&committed(b)&&overlaps(s,e,...bufferWindow(d,b))),'buffer_conflict');
  need(![...d.waitlist,...(d.waitlist_holds||[])].some(w=>w.user_id!==u.id&&w.instrument_id===id&&((w.status==='offered'&&time(w.expires_at)>now)||(w.status==='requested'&&(time(w.hold_until)>now||d.bookings.some(b=>b.id===w.booking_id&&b.status==='pending'&&time(b.approval_deadline||b.start)>now))))&&overlaps(start,end,w.start,w.end)),'waitlist_hold');
  const ids=[...new Set([...(p.required_accessory_ids||[]),...(a.accessory_ids||[])])];need(ids.length<=30,'invalid_input');
  for(const aid of ids){const item=find(d.accessories,aid);need(item.status==='available'&&item.instrument_ids.includes(id),'accessory_unavailable');need(!d.bookings.some(b=>b.id!==exclude&&committed(b)&&b.accessory_ids?.includes(aid)&&overlaps(s,e,...bufferWindow(d,b))),'accessory_conflict');}
  const conflicts=personalConflicts(d,u,start,end,id,exclude,a.operator_id);if(conflicts.length&&p.person_conflict==='block'&&!exception(d,u,id,start,end,'personal_conflict'))need(false,'personal_conflict');
 }
 if(!opts.skipQuota)for(const q of d.quotas.filter(q=>q.status==='active'&&(!q.instrument_id||q.instrument_id===id)&&(q.scope==='lab'?q.subject_id===u.lab_id:q.subject_id===u.id))){const usage=quotaUsage(d,q,exclude),extra=monthHours(start,end,q.peak_only,q.peak_start,q.peak_end);for(const [m,h]of Object.entries(extra))need((usage[m]||0)+h<=q.hours+1e-8||exception(d,u,id,start,end,'quota'),'quota_exceeded');}
 if(!current&&u.role==='user'&&!opts.skipApproval)need(time(start)-p.approval_lead_minutes*60000>now,'approval_deadline');
}
export function assertAcknowledged(d,u,a){const p=policyFor(d,a.instrument_id);if(p.person_conflict==='warn'&&personalConflicts(d,u,a.start,a.end,a.instrument_id).length)need(a.acknowledge_conflicts,'personal_conflict_ack');}
export function reserveRequiredAccessories(d,b){b.accessory_ids=[...new Set([...(b.accessory_ids||[]),...policyFor(d,b.instrument_id).required_accessory_ids])];}
export function operatorRequestCurrent(r,b,now){return !!b&&['pending','booked'].includes(b.status)&&b.booking_method==='assisted'&&time(b.start)>now&&time(r.booking_start)===time(b.start)&&time(r.booking_end)===time(b.end)&&r.user_id===b.user_id&&(r.from_id||null)===(b.operator_id||null);}
export function closeObsoleteOperatorRequests(d,bookingIds,now,actor='system'){
 for(const r of d.operator_requests.filter(r=>r.status==='pending'&&bookingIds.has(r.booking_id))){const b=d.bookings.find(b=>b.id===r.booking_id);if(operatorRequestCurrent(r,b,now))continue;
  Object.assign(r,{status:'cancelled',closed_at:new Date(now).toISOString(),closed_by:actor,closure_reason:'booking_changed'});
  notice(d,r.to_id,'operator_offer_closed',r.id,'原預約時段、狀態或指派已變更，舊代工邀請已失效。 / The original booking changed; this operator invitation is no longer valid.',now,{booking_id:r.booking_id});
 }
}
export function afterPlanningMutation(before,d,action,u,now){
 // Close pending extensions whenever this command ends the source reservation.
 // Only transitions made by this command are reconciled; old records stay intact.
 const previous=new Map(before.bookings.map(b=>[b.id,b])),current=new Map(d.bookings.map(b=>[b.id,b]));
 const changedBookings=new Set(d.bookings.filter(b=>{const old=previous.get(b.id);return old&&['start','end','status','user_id','operator_id','booking_method'].some(k=>old[k]!==b[k]);}).map(b=>b.id));
 closeObsoleteOperatorRequests(d,changedBookings,now,u?.id||'system');
 for(const x of d.extensions.filter(x=>x.status==='pending')){const old=previous.get(x.booking_id),b=current.get(x.booking_id);if(old&&b&&old.status!==b.status&&['completed','cancelled','released','no_show','expired','rejected'].includes(b.status))x.status='cancelled';}
 for(const w of d.waitlist.filter(w=>w.status==='requested')){const b=d.bookings.find(b=>b.id===w.booking_id);if(b&&['booked','checked_in','completed'].includes(b.status))w.status='fulfilled';else if(!b||b.status!=='pending')w.status='closed';}

 if(!['create_booking','cancel_booking','request_extension','approve_extension','reject_booking','no_show','maintenance_resolve','reschedule_booking','cancel_training','approve_attendance','planning_tick'].includes(action))return;
 const stamp=new Date(now).toISOString();
 for(const x of d.attendance_requests.filter(x=>x.status==='pending'))if(d.bookings.some(b=>b.id===x.booking_id&&b.status==='cancelled'))Object.assign(x,{status:'cancelled',closed_at:stamp,closure_reason:'booking_cancelled'});
 for(const session of d.training_sessions){const b=d.bookings.find(b=>b.id===session.booking_id);if(!b)continue;const cancelled=['cancelled','released','expired','rejected','no_show'].includes(b.status);if(session.start!==b.start||session.end!==b.end||cancelled&&session.status!=='cancelled'){Object.assign(session,{start:b.start,end:b.end,...(cancelled?{status:'cancelled'}:{})});for(const p of session.attendees.filter(p=>p.status!=='cancelled'))notice(d,p.user_id,'training_changed',session.id+'|'+b.start+'|'+b.end+'|'+b.status,'訓練時段或狀態已更新，請查看場次。 / Your training schedule has changed.',now);}}

 for(const b of d.bookings){const old=previous.get(b.id),prev=old&&quotaCounted(old)?monthHours(old.start,old.end):{},next=quotaCounted(b)?monthHours(b.start,b.end):{};for(const month of new Set([...Object.keys(prev),...Object.keys(next)])){const delta=(next[month]||0)-(prev[month]||0);if(delta)d.quota_movements.push({id:uid(),booking_id:b.id,user_id:b.user_id,lab_id:b.lab_id,instrument_id:b.instrument_id,month,hours:delta,action,actor_id:u?.id||'system',created_at:stamp});}}
}
export function costRows(d,u){return d.bookings.filter(b=>!b.private&&(b.user_id===u.id||enabled(u)&&managesLab(u,b.lab_id))&&['completed','no_show'].includes(b.status)).map(b=>{const base=b.status==='no_show'?b.penalty_amount:(b.hourly_rate==null?null:Math.round(b.hourly_rate*(time(b.end)-time(b.start))/HOUR*100)/100),adjustments=d.cost_adjustments.filter(x=>x.booking_id===b.id),adjustment=adjustments.reduce((s,x)=>s+x.amount,0);return {id:b.id,user_id:b.user_id,lab_id:b.lab_id,instrument_id:b.instrument_id,project_code:b.project_code||'',start:b.start,end:b.end,base,adjustment,total:base==null?null:base+adjustment,held:d.cost_disputes.some(x=>x.booking_id===b.id&&x.status==='open')};});}
export function planningSnapshot(d,u,now=Date.now()){
 upgradePlanning(d);const own=x=>x.user_id===u.id||enabled(u,now)&&managesLab(u,x.lab_id),staff=x=>enabled(u,now)&&managesInstrument(d,u,x.instrument_id),delegated=b=>enabled(u,now)&&canApprove(d,u,b,now);
 return {booking_policies:d.booking_policies,accessories:d.accessories,date_exceptions:d.date_exceptions,maintenance_windows:d.maintenance_windows.map(w=>staff(w)?w:({id:w.id,instrument_id:w.instrument_id,start:w.start,end:w.end,status:w.status,reason:w.reason})),booking_series:d.booking_series.filter(own),waitlist:d.waitlist.filter(own),waitlist_holds:d.waitlist.filter(w=>['offered','requested'].includes(w.status)).map(w=>({instrument_id:w.instrument_id,start:w.start,end:w.end,user_id:w.user_id===u.id?u.id:null,status:w.status,expires_at:w.expires_at,hold_until:d.bookings.find(b=>b.id===w.booking_id&&b.status==='pending')?.approval_deadline})),quotas:d.quotas.filter(q=>enabled(u,now)&&u.role==='system_admin'||q.scope==='lab'&&q.subject_id===u.lab_id||q.scope==='user'&&(q.subject_id===u.id||enabled(u,now)&&managesLab(u,d.users.find(x=>x.id===q.subject_id)?.lab_id))),quota_movements:d.quota_movements.filter(own),projects:d.projects.filter(p=>enabled(u,now)&&(u.role==='system_admin'||p.lab_id===u.lab_id)),booking_exceptions:d.booking_exceptions.filter(own),approval_delegations:d.approval_delegations.filter(own),delegated_bookings:d.bookings.filter(b=>b.status==='pending'&&delegated(b)),operator_requests:d.operator_requests.filter(x=>own(x)||x.to_id===u.id||staff(x)).map(r=>({...r,outdated:r.status==='pending'&&!operatorRequestCurrent(r,d.bookings.find(b=>b.id===r.booking_id),now)})),training_sessions:d.training_sessions.map(x=>staff(x)||enabled(u,now)&&x.instructor_id===u.id?x:{...x,attendees:x.attendees.filter(a=>a.user_id===u.id),enrolled_count:x.attendees.filter(a=>a.status!=='cancelled').length}),cost_disputes:d.cost_disputes.filter(own),cost_adjustments:d.cost_adjustments.filter(own),cost_rows:costRows(d,u),archives:d.archives.filter(x=>enabled(u,now)&&managesLab(u,x.lab_id)).map(({payload,...a})=>a),notices:d.notices.filter(x=>x.user_id===u.id).slice(-150)};
}
