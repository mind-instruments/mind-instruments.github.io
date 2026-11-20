import {priced,feeCategories,pricingCommand} from './pricing.js';
import {importHistory} from './history-import.js';
import {validTimestamp} from './dates.js';
import {validatePlanningSlot,bookingExtras,assertAcknowledged,planningSnapshot,afterPlanningMutation,dateException,canApprove,certificationValid,reserveRequiredAccessories} from './planning-core.js';
import {applyPlanning,previewPlanning,reconcilePlanning} from './planning-actions.js';
import {applyHandover,handoverSnapshot,historyAccess,bookingAccount} from './handover.js';
import {applyWorkflow, slotsFor} from './workflows.js';
import {visibleProbeModels} from './probe-models.js';
import { DEFAULT_INSTRUMENT, defaultInstrument, upgradeData, resourceId, instrumentFor, instrumentAdmin, instrumentAccess, configureInstrument, certificationLevels, certificationFor, qualification, bookingMethod } from './resources.js';
// Authoritative mutations execute on the server; the browser reuses validation for feedback.
export const HOUR = 3600000;
export const active = (u, now = Date.now()) => u?.status === 'approved' && !u.blacklisted_at && (!u.suspended_until || +new Date(u.suspended_until) <= now);
export const system = u => u?.role === 'system_admin';
export const manager = u => ['system_admin', 'lab_manager'].includes(u?.role);
export const manages = (u, target) => system(u) || (u?.role === 'lab_manager' && target?.lab_id === u.lab_id && target.role === 'user');
export const labAccess = (u, lab) => system(u) || (u?.role === 'lab_manager' && lab === u.lab_id);
export const occupied = b => ['booked', 'checked_in'].includes(b.status);
const fail = code => { throw new Error(code); };
const need = (ok, code = 'forbidden') => { if (!ok) fail(code); };
const uid = () => crypto.randomUUID();
const text = (s, max = 2000) => String(s ?? '').trim().slice(0, max);
export const dateKey = (d = new Date()) => new Date(+new Date(d) + 8 * HOUR).toISOString().slice(0, 10);
export const plusDays = (d, n) => dateKey(new Date(+new Date(`${d}T12:00:00+08:00`) + n * 24 * HOUR));
export function seed(now = Date.now()) {
  const mk = (id, name, role, lab, level = 'basic') => ({ id, name, role, lab_id: lab, level, status: 'approved', can_book: true, can_take: true, strikes: 0 });
  const users = [mk('admin', '系統管理者', 'system_admin', 'center', 'advanced'), mk('manager-a', '實驗室 A 代表', 'lab_manager', 'lab-a', 'advanced'), mk('user-a', '使用者 A', 'user', 'lab-a'), mk('manager-b', '實驗室 B 代表', 'lab_manager', 'lab-b', 'advanced'), mk('user-b', '使用者 B', 'user', 'lab-b', 'advanced')];
  let day = plusDays(dateKey(now), 1);
  while ([0, 6].includes(new Date(`${day}T12:00:00+08:00`).getUTCDay())) day = plusDays(day, 1);
  const probes = ['A1', 'A2', 'A3', 'B1', 'B2', 'C1'].map((slot, i) => ({ id: `probe-${i + 1}`, serial: `OPUS-${String(i + 1).padStart(6, '0')}`, slot, model: 'OPUS Silicon Tip', lab_id: i < 3 ? 'lab-a' : i === 3 ? 'lab-b' : null, price: 1000, status: i === 0 ? 'in_use' : 'available', condition: 'good', holder: i === 0 ? 'user-a' : null, grants: i < 3 ? ['user-a'] : i === 3 ? ['user-b'] : [] }));
  probes.forEach(p => p.table_id = 'table-opus');
  return { version: 2, instruments:[defaultInstrument()], certifications:users.map(u=>({id:uid(),user_id:u.id,instrument_id:DEFAULT_INSTRUMENT,level:u.level,certified_by:'admin',certified_at:new Date(now).toISOString(),revision:1})), users, labs: [{ id: 'center', name: '奈微與材料科技中心' }, { id: 'lab-a', name: '實驗室 A' }, { id: 'lab-b', name: '實驗室 B' }], probe_tables: [{ id: 'table-opus', name: 'OPUS Silicon Tip', model: 'OPUS Silicon Tip', lab_id: null, rows: 4, columns: 6, created_by: 'admin', created_at: new Date(now).toISOString() }], probes,
    bookings: [{ id: uid(), user_id: 'user-a', lab_id: 'lab-a', start: `${day}T10:00:00+08:00`, end: `${day}T11:00:00+08:00`, purpose: '表面形貌量測 / Surface topography', status: 'booked', approved_by: 'manager-a', responsible_id: 'manager-a', calendar_status: 'simulated', hourly_rate: null, created_at: new Date(now).toISOString() }],
    purchases: [], extensions: [], usages: [{ id: uid(), probe_id: 'probe-1', user_id: 'user-a', actor_id: 'manager-a', taken_at: new Date(now).toISOString(), returned_at: null }], audit: [], calendar_jobs: [],
    rules: { global: { start_hour: 9, end_hour: 19, max_hours: 4, weekend: 'advanced', evening: 'advanced', extension_role: 'lab_manager', hourly_rate: null }, labs: {} } };
}
export function rulesFor(d, user, instrumentId=DEFAULT_INSTRUMENT) {
  const custom=instrumentFor(d,instrumentId)?.rules;const g = {...d.rules.global,...custom}, l = d.rules.labs[user.lab_id];if(d.rules.global.extension_role==='system_admin')g.extension_role='system_admin';
  if (!l) return { ...g };
  const rank = { all: 0, advanced: 1, closed: 2 };
  return { ...g, ...l, start_hour: Math.max(g.start_hour, l.start_hour), end_hour: Math.min(g.end_hour, l.end_hour), max_hours: Math.min(g.max_hours, l.max_hours), weekend: rank[g.weekend] >= rank[l.weekend] ? g.weekend : l.weekend, evening: rank[g.evening] >= rank[l.evening] ? g.evening : l.evening, extension_role: g.extension_role === 'system_admin' ? 'system_admin' : l.extension_role, hourly_rate: g.hourly_rate };
}
function validateUse(d,user,start,end,now,instrumentId,extension=false){
  need(active(user,now)&&(manager(user)||user.can_book),'inactive');
  const i=instrumentFor(d,instrumentId);need(i,'instrument_not_found');need(i.status==='available','instrument_unavailable');need(instrumentAccess(user,i,d),'instrument_access');
  const s=+new Date(start),e=+new Date(end),r=rulesFor(d,user,instrumentId),exception=dateException(d,instrumentId,start);
  {
    if (!extension) need(e - s <= r.max_hours * HOUR, 'max_hours');
    need(dateKey(s) === dateKey(e - 1), 'same_day');
    for (let t = s; t < e; t += HOUR) {
      const dt = new Date(t + 8 * HOUR), h = dt.getUTCHours(), w = [0, 6].includes(dt.getUTCDay());
      const allowed = rule => rule === 'all' || (rule === 'advanced' && qualification(d,user.id,instrumentId) === 'advanced');
      if(exception){need(exception.kind==='open'&&h>=exception.start_hour&&h<exception.end_hour&&allowed(exception.access),'date_closed');}
      else {if (w) need(allowed(r.weekend), 'weekend_restricted');if (h < r.start_hour || h >= r.end_hour) need(allowed(r.evening), 'evening_restricted');}
    }
  }
}
export function validateSlot(d, user, start, end, now, exclude, extension = false, instrumentId=DEFAULT_INSTRUMENT, extra={}) {
  need(validTimestamp(start)&&validTimestamp(end),'invalid_time');
  const s = +new Date(start), e = +new Date(end), r = rulesFor(d, user,instrumentId);
  need(Number.isFinite(s) && Number.isFinite(e) && e > s && e > now && (extension || s > now), 'invalid_time');
  need(s % HOUR === 0 && e % HOUR === 0, 'whole_hours');
  validateUse(d,user,start,end,now,instrumentId,extension);
  if(!extra.skipAvailability)need(!d.bookings.some(b => resourceId(b)===instrumentId && b.id !== exclude && occupied(b) && s < +new Date(b.end) && e > +new Date(b.start)), 'overlap');
  validatePlanningSlot(d,user,start,end,now,exclude,instrumentId,extra);
}
export function canSign(d, user, p) { if(d.probe_tables?.find(t=>t.id===p.table_id)?.status==='draft')return false; return active(user) && (manager(user) || user.can_take) && p.lab_id != null && (system(user) || (user.lab_id === p.lab_id && (manager(user) || p.grants.includes(user.id)))); }
export function snapshot(d, id, calendarMode = 'simulated') {
  d=upgradeData(structuredClone(d));
  const u = d.users.find(x => x.id === id); need(u && !u.blacklisted_at, 'login_required');
  const ownOrManaged = x => x.user_id === id || x.operator_id === id || (active(u) && labAccess(u, x.lab_id));
  const result = {
    probe_models:active(u)?visibleProbeModels(d,u):[],
    fee_categories:feeCategories(d), version: d.version, schema_revision:d.schema_revision||6, certifications:(d.certifications||[]).filter(c=>c.user_id===id||active(u)&&manages(u,d.users.find(x=>x.id===c.user_id))), instruments:(d.instruments||[defaultInstrument()]).map(i=>({...i,authorized_user_ids:active(u)&&instrumentAdmin(u,i)?i.authorized_user_ids:i.authorized_user_ids.filter(id=>id===u.id)})), me: u, labs: d.labs, rules: { global: d.rules.global, labs: system(u) ? d.rules.labs : { [u.lab_id]: d.rules.labs[u.lab_id] } }, calendarMode,
    users: d.users.filter(x => x.id === id || (active(u) && (system(u) || x.lab_id === u.lab_id && manager(u)))).map(x=>{if(system(u))return x;const {blacklist_history,blacklist_reason,blacklisted_by,...visible}=x;return visible;}),
    people: d.users.filter(x => x.lab_id === u.lab_id || system(x) || d.bookings.some(b => b.user_id === id && b.responsible_id === x.id)).map(({ id, name }) => ({ id, name })),
    probe_tables: (d.probe_tables || []).filter(t => (t.status!=='draft'||active(u)&&labAccess(u,t.lab_id)) && (active(u) && (system(u) || !t.lab_id || t.lab_id === u.lab_id) || d.probes.some(p => p.table_id === t.id && p.holder === id))),
    // Occupancy is shared. Private fields and identities are not.
    bookings: d.bookings.filter(b => historyAccess(d,u,'bookings',b.id)||ownOrManaged(b) || (active(u) && ['booked', 'checked_in', 'pending', 'completed'].includes(b.status))).map(b => (ownOrManaged(b)||historyAccess(d,u,'bookings',b.id)) ? { ...b } : { id: b.id, instrument_id:resourceId(b), start: b.start, end: b.end, status: b.status, before_minutes:b.before_minutes,after_minutes:b.after_minutes,accessory_ids:b.accessory_ids||[],private: true }),
    probes: d.probes.filter(p => (d.probe_tables.find(t=>t.id===p.table_id)?.status!=='draft'||active(u)&&labAccess(u,p.lab_id)) && ( p.holder === id || (active(u) && (system(u) || !p.lab_id || p.lab_id === u.lab_id)))).map(p => ({ ...p, grants: manager(u) ? p.grants : p.grants.filter(x => x === id) })),
    purchases: d.purchases.filter(ownOrManaged), extensions: d.extensions.filter(ownOrManaged),
    usages: d.usages.filter(x => x.user_id === id || (active(u) && labAccess(u, x.lab_id ?? d.probes.find(p=>p.id===x.probe_id)?.lab_id))),
    audit: d.audit.filter(x => (system(u)||x.action!=='set_blacklist')&&(x.actor_id === id || x.user_id === id || (active(u) && labAccess(u, x.lab_id)))),
    ...handoverSnapshot(d,u),...planningSnapshot(d,u),notification_rules:d.notification_rules,
    attendance_requests:d.attendance_requests.filter(ownOrManaged),
    stock_movements:d.stock_movements.filter(x=>active(u)&&labAccess(u,x.lab_id)),
    mail_jobs:d.mail_jobs.filter(x=>x.user_id===id||active(u)&&labAccess(u,x.lab_id)).map(({body,to,...x})=>x),
    calendar_jobs: active(u) && system(u) ? d.calendar_jobs : []
  };
  return structuredClone(result);
}
function queueCalendar(d, b, mode, now) {
  const desired = ['cancelled', 'no_show','released','expired'].includes(b.status) ? 'delete' : 'upsert';
  // A single desired-state job per booking prevents stale create/delete races.
  let job = d.calendar_jobs.find(j => j.booking_id === b.id);
  if (!job) { job = { id: uid(), booking_id: b.id, event_id: 'afm' + b.id.replaceAll('-', ''), attempts: 0 }; d.calendar_jobs.push(job); }
  Object.assign(job, { operation: desired, revision: (job.revision || 0) + 1, status: mode === 'google' ? 'pending' : mode === 'disabled' ? 'not_configured' : 'simulated', updated_at: now, error: null, next_attempt:null, attempts:0 });
  b.calendar_status = job.status;
}
// Copy-on-write: failed validation never partially changes persisted data.
export function command(source, actorId, action, a = {}, { now = Date.now(), calendarMode = 'simulated' } = {}) {
  const d = upgradeData(structuredClone(source)), u = d.users.find(x => x.id === actorId), stamp = new Date(now).toISOString();
  need(u, 'login_required');
  need(!u.blacklisted_at, 'blacklisted');
  need(active(u, now) || ['cancel_booking', 'return_probe', 'probe_condition', 'checkout_booking', 'request_attendance'].includes(action), 'inactive');
  if(['save_fee_category','assign_fee_category'].includes(action)){const result=pricingCommand(d,u,action,a);d.audit.unshift({id:uid(),action,entity_id:result.id,actor_id:u.id,user_id:u.id,lab_id:u.lab_id,created_at:stamp,detail:{...result}});return {data:d,result};}
  if(action==='preview_history'||action==='import_history'){
    const result=importHistory(d,u,a.rows,a.reason,now);
    if(action==='preview_history'||result.errors.length)return {data:structuredClone(source),result};
    d.audit.unshift({id:uid(),action,entity_id:result.id,actor_id:u.id,user_id:u.id,lab_id:u.lab_id,created_at:stamp,detail:{reason:a.reason,added:result.added,skipped:result.skipped}});
    return {data:d,result};
  }
  if(action==='set_backfill_permission'){
    need(system(u)&&typeof a.enabled==='boolean','forbidden');const target=d.users.find(x=>x.id===a.id);need(target&&target.role!=='system_admin'&&!target.blacklisted_at,'forbidden');target.can_backfill=a.enabled;
    d.audit.unshift({id:uid(),action,entity_id:target.id,actor_id:u.id,user_id:target.id,lab_id:target.lab_id,created_at:stamp,detail:{enabled:a.enabled}});return {data:d,result:{id:target.id,enabled:a.enabled}};
  }
  const find = (xs, id) => { const x = xs.find(x => x.id === id); need(x, 'not_found'); return x; };
  let entity, subject = u, detail = {};
  const checkMethod=b=>need(!b.booking_method||b.booking_method===bookingMethod(d,b.user_id,resourceId(b)),'booking_qualification_changed');
  const booking = () => find(d.bookings, a.id);
  const ownerOrManager = b => b.user_id === u.id || active(u, now) && manages(u, find(d.users, b.user_id));
  const approveBooking = b => { const t = find(d.users, b.user_id); need(canApprove(d,u,b,now) && b.status === 'pending', 'forbidden');need(now<+new Date(b.approval_deadline||b.start),'approval_deadline'); validateSlot(d, t, b.start, b.end, now, b.id,false,resourceId(b));checkMethod(b);reserveRequiredAccessories(d,b); Object.assign(b, { status: 'booked', approved_by: u.id, responsible_id: u.id, approved_at: stamp, pricing:priced(d,t,rulesFor(d,t,resourceId(b)).hourly_rate),hourly_rate: priced(d,t,rulesFor(d,t,resourceId(b)).hourly_rate).amount }); queueCalendar(d, b, calendarMode, stamp); };
  const approvePurchase = p => { const t = find(d.users, p.user_id), item = find(d.probes, p.probe_id); need(active(t), 'inactive'); need(p.status === 'pending' && (!item.lab_id) && item.status === 'available' && (!item.condition||item.condition==='good') && d.probe_tables.find(t=>t.id===item.table_id)?.status==='published', 'stock_unavailable'); Object.assign(item, { lab_id: p.lab_id, grants: [...new Set([...item.grants, t.id])] }); Object.assign(p, { status: 'approved', approved_by: u.id, approved_at: stamp, pricing:priced(d,t,item.price,'probe'),price: priced(d,t,item.price,'probe').amount }); for(const other of d.purchases.filter(x=>x.id!==p.id&&x.probe_id===p.probe_id&&x.status==='pending'))Object.assign(other,{status:'unavailable',reason:'stock_unavailable'}); };
  const planningContext={command,validateSlot,queueCalendar,calendarMode};
  const workflow=applyPlanning(d,u,action,a,now,planningContext)||applyHandover(d,u,action,a,now,{validateSlot,bookingMethod,queueCalendar,calendarMode})||applyWorkflow(d,u,action,a,now);
  if(workflow){afterPlanningMutation(source,d,action,u,now);d.audit.unshift({id:uid(),action,entity_id:workflow.id,actor_id:u.id,user_id:workflow.user_id||u.id,lab_id:workflow.lab_id||u.lab_id,created_at:stamp,detail:{args:a}});return {data:d,result:structuredClone(workflow)};}
  switch (action) {
    case 'create_bookings': {
      need(Array.isArray(a.slots) && a.slots.length > 0 && a.slots.length <= 36, 'invalid_selection');
      let next = d; const created = [];
      for (const slot of a.slots) { const result = command(next, actorId, 'create_booking', { ...a, ...slot, slots:undefined, instrument_id:a.instrument_id }, { now, calendarMode }); next = result.data; created.push(result.result); }
      return { data: next, result: created };
    }
    case 'create_booking': {
      const instrument_id=a.instrument_id||DEFAULT_INSTRUMENT;
      // Public input can select resources, never validation bypasses or reserved timing.
      const extra={accessory_ids:a.accessory_ids,project_id:a.project_id};
      validateSlot(d, u, a.start, a.end, now,undefined,false,instrument_id,extra);assertAcknowledged(d,u,{...a,instrument_id});const confirmed=manager(u)&&!a.force_pending;
      need(!d.bookings.some(b => resourceId(b)===instrument_id && b.user_id === u.id && b.status === 'pending' && +new Date(a.start) < +new Date(b.end) && +new Date(a.end) > +new Date(b.start)), 'duplicate_request');
      const method=bookingMethod(d,u.id,instrument_id);need(a.booking_method==null||a.booking_method===method,'booking_method_denied');
      const b = { ...bookingExtras(d,u,{...a,instrument_id},now),...bookingAccount(d,u,a.lab_account_id),id: uid(), instrument_id,booking_method:method,qualification_at_booking:qualification(d,u.id,instrument_id),instrument_name:instrumentFor(d,instrument_id).name, user_id: u.id, lab_id: u.lab_id, start: a.start, end: a.end, purpose: text(a.purpose), created_at: stamp, status: confirmed ? 'booked' : 'pending', calendar_status: confirmed ? 'pending' : 'awaiting_approval', pricing:priced(d,u,rulesFor(d,u,instrument_id).hourly_rate),hourly_rate: priced(d,u,rulesFor(d,u,instrument_id).hourly_rate).amount };
      if (confirmed) { b.approved_by = u.id; b.responsible_id = u.id; queueCalendar(d, b, calendarMode, stamp); }
      d.bookings.push(b); entity = b; break;
    }
    case 'approve_booking': { entity = booking(); subject = find(d.users, entity.user_id); approveBooking(entity); break; }
    case 'reject_booking': { entity = booking(); subject = find(d.users, entity.user_id); need(canApprove(d,u,entity,now) && entity.status === 'pending', 'forbidden'); need(text(a.reason), 'reason_required'); Object.assign(entity, { status: 'rejected', calendar_status: 'not_required', reason: text(a.reason), reviewed_by: u.id, reviewed_at: stamp }); break; }
    case 'cancel_booking': { entity = booking(); subject = find(d.users, entity.user_id); need(ownerOrManager(entity) && ['booked', 'pending'].includes(entity.status), 'forbidden'); need(now < +new Date(entity.start) || active(u, now) && manager(u), 'already_started'); const synced = entity.status === 'booked'; Object.assign(entity, { status: 'cancelled', cancelled_at: stamp, cancelled_by: u.id }); if (synced) queueCalendar(d, entity, calendarMode, stamp); else entity.calendar_status = 'not_required'; for (const x of d.extensions.filter(x => x.booking_id === entity.id && x.status === 'pending')) x.status = 'cancelled'; break; }
    case 'checkin_booking': { entity = booking(); subject = find(d.users, entity.user_id);need((entity.booking_method||bookingMethod(d,subject.id,resourceId(entity)))!=='assisted'||entity.operator_id,'operator_required'); need((entity.operator_id||entity.user_id) === u.id && entity.status === 'booked', 'forbidden'); need(instrumentFor(d,resourceId(entity)).status==='available','instrument_unavailable');need(qualification(d,u.id,resourceId(entity))!=='none','instrument_access');need(certificationValid(certificationFor(d,u.id,resourceId(entity)),new Date(now).toISOString()),'certification_expired');need(!d.bookings.some(b=>b.id!==entity.id&&resourceId(b)===resourceId(entity)&&b.status==='checked_in'),'previous_session_running');validatePlanningSlot(d,subject,entity.start,entity.end,now,entity.id,resourceId(entity),{skipApproval:true});validateUse(d,subject,entity.start,entity.end,now,resourceId(entity),true);checkMethod(entity);if(entity.operator_id)need(qualification(d,u.id,resourceId(entity))==='advanced','instrument_access');need(now >= +new Date(entity.start) - (d.notification_rules.checkin_before) * 60000 && now < +new Date(entity.start) + (d.notification_rules.checkin_close) * 60000, 'checkin_window'); reserveRequiredAccessories(d,entity);Object.assign(entity, { status: 'checked_in', checked_in_at: stamp, checked_in_by:u.id }); break; }
    case 'checkout_booking': {
      entity=booking();subject=find(d.users,entity.user_id);need((entity.operator_id||entity.user_id)===u.id&&entity.status==='checked_in','forbidden');
      const instrument=instrumentFor(d,resourceId(entity)),status=instrument.checkout_statuses.find(x=>x.id===a.instrument_status),mode=instrument.modes.find(x=>x.id===a.usage_mode);
      need(status&&mode,'checkout_required');need(!status.requires_notes||text(a.notes,5000),'notes_required');
      Object.assign(entity,{status:'completed',checked_out_at:stamp,checked_out_by:u.id,notes:text(a.notes,5000),instrument_status:{...status},usage_mode:{...mode}});
      if(status.blocks_booking){instrument.status='maintenance';instrument.issue_booking_id=entity.id;}
      for(const x of d.extensions.filter(x=>x.booking_id===entity.id&&x.status==='pending'))x.status='cancelled';break;
    }
    case 'no_show': { entity = booking(); subject = find(d.users, entity.user_id); need(manages(u, subject) && entity.status === 'booked', 'forbidden'); need(now >= +new Date(entity.start) + (d.notification_rules.checkin_close) * 60000, 'too_early'); entity.status = 'no_show'; entity.penalty_amount = entity.hourly_rate == null ? null : entity.hourly_rate * (+new Date(entity.end) - +new Date(entity.start)) / HOUR * .4; subject.strikes++; if (subject.strikes > 3) { const until = new Date(now); until.setUTCMonth(until.getUTCMonth() + 1); subject.suspended_until = until.toISOString(); subject.suspension_reason = 'no_show'; } for (const x of d.extensions.filter(x => x.booking_id === entity.id && x.status === 'pending')) x.status = 'cancelled'; queueCalendar(d, entity, calendarMode, stamp); break; }
    case 'request_extension': {
      const b = booking(); subject = find(d.users, b.user_id); need(ownerOrManager(b) && occupied(b), 'forbidden'); need(!d.extensions.some(x => x.booking_id === b.id && x.status === 'pending'), 'duplicate_request'); need(+new Date(a.end) > +new Date(b.end), 'invalid_time'); validateSlot(d, subject, b.start, a.end, now, b.id, true,resourceId(b));checkMethod(b);
      const r = rulesFor(d, subject,resourceId(b)), x = { id: uid(), booking_id: b.id,instrument_id:resourceId(b), user_id: b.user_id, lab_id: b.lab_id, original_end: b.end, end: a.end, status: 'pending', created_at: stamp, requested_by: u.id, approval_role: r.extension_role };
      if (system(u) || r.extension_role === 'lab_manager' && labAccess(u, b.lab_id)) { x.status = 'approved'; x.approved_by = u.id; x.approved_at = stamp; b.end = x.end;reserveRequiredAccessories(d,b); queueCalendar(d, b, calendarMode, stamp); }
      d.extensions.push(x); entity = x; break;
    }
    case 'approve_extension': case 'reject_extension': {
      const x = find(d.extensions, a.id), b = find(d.bookings, x.booking_id); subject = find(d.users, x.user_id); need(x.status === 'pending' && occupied(b), 'stale_request'); const role = rulesFor(d, subject,resourceId(b)).extension_role; need(system(u) || role === 'lab_manager' && labAccess(u, b.lab_id), 'forbidden');
      if (action === 'approve_extension') { need(b.end === x.original_end, 'stale_request'); validateSlot(d, subject, b.start, x.end, now, b.id, true,resourceId(b));checkMethod(b); b.end = x.end;reserveRequiredAccessories(d,b); queueCalendar(d, b, calendarMode, stamp); x.status = 'approved'; } else { need(text(a.reason), 'reason_required'); x.status = 'rejected'; x.reason = text(a.reason); }
      Object.assign(x, { approved_by: u.id, reviewed_at: stamp }); entity = x; break;
    }
    case 'purchase_probe': { const p = find(d.probes, a.probe_id); need(!p.lab_id && p.status === 'available' && (!p.condition||p.condition==='good') && d.probe_tables.find(t=>t.id===p.table_id)?.status==='published', 'stock_unavailable'); need(!d.purchases.some(x => x.user_id === u.id && x.probe_id === p.id && x.status === 'pending'), 'duplicate_request'); const x = { id: uid(), probe_id: p.id, user_id: u.id, lab_id: u.lab_id, status: 'pending', created_at: stamp, pricing:priced(d,u,p.price,'probe'),price: priced(d,u,p.price,'probe').amount }; d.purchases.push(x); if (manager(u)) approvePurchase(x); entity = x; break; }
    case 'approve_purchase': case 'reject_purchase': { const x = find(d.purchases, a.id); subject = find(d.users, x.user_id); need(manages(u, subject) && x.status === 'pending', 'forbidden'); if (action === 'approve_purchase') approvePurchase(x); else { need(text(a.reason), 'reason_required'); Object.assign(x, { status: 'rejected', reason: text(a.reason), reviewed_at: stamp, reviewed_by: u.id }); } entity = x; break; }
    case 'sign_probe': {
      const p = find(d.probes, a.id), t = find(d.users, a.user_id); need(d.probe_tables?.some(table => table.id === p.table_id && table.status !== 'draft'), 'table_required'); need(t.id === u.id || manages(u, t), 'forbidden'); need(canSign(d, t, p), 'probe_permission'); need(p.status === 'available', 'probe_unavailable');
      Object.assign(p, { holder: t.id, status: 'in_use' }); d.usages.push({ id: uid(), probe_id: p.id, user_id: t.id, actor_id: u.id, taken_at: stamp, instrument_id:p.instrument_id,lab_id:p.lab_id,model:p.model,returned_at: null }); entity = p; subject = t; break;
    }
    case 'probe_condition': case 'return_probe': {
      const p = find(d.probes, a.id); need(p.status === 'in_use' && (p.holder === u.id || active(u) && labAccess(u, p.lab_id)), 'forbidden'); subject = find(d.users, p.holder); need(['good', 'worn', 'contaminated', 'damaged'].includes(a.condition), 'invalid_condition');
      const usage = d.usages.find(x => x.probe_id === p.id && !x.returned_at); need(usage, 'not_found');
      Object.assign(usage, { condition: a.condition, notes: text(a.notes), condition_at: stamp }); p.condition = a.condition;
      if (action === 'return_probe' || a.condition === 'damaged') { usage.returned_at = stamp; p.holder = null; p.status = a.condition === 'good' ? 'available' : 'inspection'; }
      entity = p; detail.condition = a.condition; break;
    }
    case 'review_probe': { const p = find(d.probes, a.id); need(labAccess(u, p.lab_id) && p.status === 'inspection', 'forbidden'); need(text(a.notes), 'notes_required'); p.status = a.retire ? 'retired' : 'available'; p.condition = a.retire ? 'damaged' : 'good'; entity = p; detail.notes = text(a.notes); break; }
    case 'probe_permissions': { const p = find(d.probes, a.id); need(labAccess(u, p.lab_id), 'forbidden'); need(Array.isArray(a.user_ids), 'invalid_input'); for (const id of a.user_ids) { const t = find(d.users, id); need(t.lab_id === p.lab_id, 'wrong_lab'); } p.grants = [...new Set(a.user_ids)]; entity = p; detail.grants = p.grants; break; }
    case 'add_probe': { need(manager(u), 'forbidden'); const table = find(d.probe_tables || [], a.table_id); need(labAccess(u, table.lab_id), 'forbidden'); need(slotsFor(table.rows,table.columns).includes(a.slot) && text(a.serial, 80) && text(a.model, 100)===table.model, 'invalid_input'); need(Number.isFinite(a.price) && a.price >= 0, 'invalid_price'); const lab = table.lab_id; need(!d.probes.some(p => p.serial === text(a.serial, 80) || p.table_id === table.id && p.slot === a.slot && p.status !== 'retired'), 'duplicate_probe'); entity = { id: uid(), table_id: table.id,instrument_id:table.instrument_id, serial: text(a.serial, 80), model: text(a.model, 100), slot: a.slot, price: a.price, lab_id: lab, grants: [...(table.default_grants||[])], status: 'available', condition: 'good', holder: null }; const replacement=d.probes.some(p=>p.table_id===table.id&&p.slot===a.slot&&p.status==='retired');if(replacement)table.replacement_quantity=(table.replacement_quantity||0)+1;else{table.received_quantity++;table.ordered_quantity=Math.max(table.ordered_quantity,table.received_quantity);}d.probes.push(entity); d.stock_movements.push({id:uid(),probe_id:entity.id,table_id:table.id,type:replacement?'replacement':'receipt',actor_id:u.id,lab_id:lab,created_at:new Date(now).toISOString(),before:null,after:structuredClone(entity)}); table.revision++; break; }
    case 'set_certifications': {
      need(manager(u),'forbidden');need(Array.isArray(a.changes)&&a.changes.length>0&&a.changes.length<=500,'invalid_input');
      const seen=new Set(),results=[];
      for(const change of a.changes){
        const target=find(d.users,change.user_id);need(manages(u,target),'forbidden');find(d.instruments,change.instrument_id);
        need(certificationLevels.includes(change.level),'invalid_input');
        const key=JSON.stringify([target.id,change.instrument_id]);need(!seen.has(key),'invalid_input');seen.add(key);
        const previous=certificationFor(d,target.id,change.instrument_id);need(change.revision===(previous?.revision||0),'certification_stale');
        const affected=d.bookings.filter(b=>b.user_id===target.id&&b.instrument_id===change.instrument_id&&['pending','booked'].includes(b.status));for(const b of affected)b.qualification_notice_at=stamp;
        const next={id:previous?.id||uid(),user_id:target.id,instrument_id:change.instrument_id,level:change.level,certified_by:u.id,certified_at:stamp,revision:(previous?.revision||0)+1};
        if(previous)Object.assign(previous,next);else d.certifications.push(next);
        d.audit.unshift({id:uid(),action:'set_certifications',instrument_id:next.instrument_id,entity_id:next.id,actor_id:u.id,user_id:target.id,lab_id:target.lab_id,created_at:stamp,detail:{before:source.certifications?.find(c=>c.id===next.id)||null,after:{...next}}});
        results.push({...next});
      }
      return {data:d,result:results};
    }
    case 'save_instrument': {
      const current=a.id?find(d.instruments,a.id):null;const item=configureInstrument(d,u,a,current);if(current){detail.before=structuredClone(current);Object.assign(current,item);entity=current;}else{d.instruments.push(item);entity=item;}detail.after=structuredClone(item);break;
    }
    case 'add_lab': {
      need(system(u), 'forbidden'); const name = text(a.name, 100); need(name && !d.labs.some(l => l.name === name), 'invalid_input'); entity = { id: uid(), name }; d.labs.push(entity); break;
    }
    case 'update_user': {
      need(['can_book','can_take'].every(k=>a[k]===undefined||typeof a[k]==='boolean'),'invalid_input');
      const t = find(d.users, a.id); need(t.id !== u.id && manages(u, t), 'forbidden'); need(['approved', 'disabled', 'pending'].includes(a.status) && ['basic', 'advanced'].includes(a.level), 'invalid_input');
      need(!t.blacklisted_at,'blacklisted');
      const before = { ...t }; if (system(u)) { need(['system_admin', 'lab_manager', 'user'].includes(a.role), 'invalid_input'); if (a.lab_id) find(d.labs, a.lab_id); need(!a.lab_id || a.lab_id === t.lab_id || (!d.probes.some(p => p.holder === t.id) && !d.bookings.some(b => b.user_id === t.id && (occupied(b) || b.status === 'pending')) && !d.purchases.some(p => p.user_id === t.id && p.status === 'pending') && !d.lab_accounts.some(x=>x.custodian_id===t.id&&x.status==='active') && !d.handovers.some(h=>[h.from_id,h.to_id].includes(t.id)&&!['completed','cancelled'].includes(h.status))), 'open_assignments'); if(a.role!==t.role&&a.role==='user')for(const h of d.handovers.filter(h=>h.to_id===t.id&&!['completed','cancelled'].includes(h.status))){h.approved_by=null;h.approved_at=null;h.requires_approval=true;h.status=h.accepted_at?'awaiting_approval':'awaiting_acceptance';h.revision++;}
      t.role = a.role; t.lab_id = a.lab_id || t.lab_id; if (t.role === 'lab_manager') { t.certified_by = u.id; t.certified_at = stamp; } }
      else need(!a.role || a.role === t.role, 'forbidden');
      Object.assign(t, { status: a.status, level: a.level, can_book: Boolean(a.can_book), can_take: Boolean(a.can_take) }); if (a.status === 'approved') t.suspended_until = null; entity = t; subject = t; detail = { before, after: { ...t } }; break;
    }
    case 'offboard_manager': {
      need(system(u),'forbidden');
      const t=find(d.users,a.id),successor=find(d.users,a.successor_id),reason=text(a.reason,500);
      need(t.id!==u.id&&manager(t),'forbidden');need(reason,'reason_required');
      need(successor.id!==t.id&&active(successor,now)&&successor.role===t.role&&(t.role==='system_admin'||successor.lab_id===t.lab_id),'offboard_successor');
      need(!d.bookings.some(b=>(b.user_id===t.id||b.operator_id===t.id)&&(['pending','booked'].includes(b.status)&&+new Date(b.end)>now||b.status==='checked_in'))&&!d.probes.some(p=>p.holder===t.id)&&!d.lab_accounts.some(x=>x.custodian_id===t.id&&x.status==='active')&&!d.handovers.some(h=>[h.from_id,h.to_id].includes(t.id)&&!['completed','cancelled'].includes(h.status)),'offboard_obligations');
      const before={...t},reassigned=[];
      for(const b of d.bookings.filter(b=>b.responsible_id===t.id&&['pending','booked','checked_in'].includes(b.status)&&+new Date(b.end)>now)){b.original_responsible_id||=t.id;b.responsible_id=successor.id;reassigned.push(b.id);}
      for(const instrument of d.instruments){if(instrument.manager_ids?.includes(t.id)){instrument.manager_ids=instrument.manager_ids.filter(id=>id!==t.id);if(successor.role==='lab_manager'&&!instrument.manager_ids.includes(successor.id))instrument.manager_ids.push(successor.id);}}
      Object.assign(t,{role:'user',status:'disabled',can_book:false,can_take:false,offboarded_at:stamp,offboarded_by:u.id,offboarded_to:successor.id,offboard_reason:reason});
      entity=t;subject=t;detail={before,after:{...t},successor_id:successor.id,reassigned_booking_ids:reassigned,reason};break;
    }
    case 'set_blacklist': {
      need(system(u),'forbidden');const t=find(d.users,a.id),reason=text(a.reason,500);
      need(t.id!==u.id,'forbidden');need(typeof a.enabled==='boolean'&&reason,'reason_required');
      need(Boolean(t.blacklisted_at)!==a.enabled,'invalid_input');
      const before={...t};t.blacklist_history||=[];t.blacklist_history.push({at:stamp,by:u.id,enabled:a.enabled,reason});
      if(a.enabled){Object.assign(t,{blacklisted_at:stamp,blacklisted_by:u.id,blacklist_reason:reason,status:'disabled',can_book:false,can_take:false});d.password_resets=(d.password_resets||[]).filter(x=>x.user_id!==t.id);for(const job of d.mail_jobs||[])if(job.kind==='password_reset'&&job.user_id===t.id&&['pending','failed','not_configured'].includes(job.status)){job.status='cancelled';delete job.body;}}
      else {t.blacklisted_at=null;t.blacklisted_by=null;t.blacklist_reason=null;}
      entity=t;subject=t;detail={before,after:{...t},reason};break;
    }
    case 'update_rules': {
      need(manager(u), 'forbidden'); const r = a.rules; need(r && Number.isInteger(r.start_hour) && Number.isInteger(r.end_hour) && r.start_hour >= 0 && r.end_hour <= 24 && r.start_hour < r.end_hour && Number.isInteger(r.max_hours) && r.max_hours >= 1 && r.max_hours <= 24 && ['all', 'advanced', 'closed'].includes(r.weekend) && ['all', 'advanced', 'closed'].includes(r.evening) && ['system_admin', 'lab_manager'].includes(r.extension_role), 'invalid_rules');
      const clean = { start_hour: r.start_hour, end_hour: r.end_hour, max_hours: r.max_hours, weekend: r.weekend, evening: r.evening, extension_role: r.extension_role };
      if (system(u) && !a.lab_id) { need(r.hourly_rate == null || Number.isFinite(r.hourly_rate) && r.hourly_rate >= 0, 'invalid_price'); d.rules.global = { ...clean, hourly_rate: r.hourly_rate ?? null }; }
      else { const lab = system(u) ? a.lab_id : u.lab_id; find(d.labs, lab); d.rules.labs[lab] = clean; }
      entity = { id: a.lab_id || (system(u) ? 'global' : u.lab_id) }; detail = clean; break;
    }
    case 'retry_calendar': { need(system(u), 'forbidden'); const j = find(d.calendar_jobs, a.id); need(['failed', 'pending'].includes(j.status), 'invalid_input'); j.status = 'pending'; j.next_attempt = null; entity = j; break; }
    default: fail('unknown_action');
  }
  afterPlanningMutation(source,d,action,u,now);
  if(['update_rules','save_instrument'].includes(action))d.rule_history.push({at:stamp,before:{rules:structuredClone(source.rules),instruments:structuredClone(source.instruments||[])},after:{rules:structuredClone(d.rules),instruments:structuredClone(d.instruments)}});
  d.audit.unshift({ id: uid(), action,instrument_id:entity?.instrument_id||(action==='save_instrument'?entity.id:undefined), entity_id: entity?.id, actor_id: u.id, user_id: subject.id, lab_id: entity?.lab_id || subject.lab_id, created_at: stamp, detail });
  return { data: d, result: structuredClone(entity) };
}

export function planningPreview(source,actorId,kind,args,now=Date.now()){const d=upgradeData(structuredClone(source)),u=d.users.find(x=>x.id===actorId);need(u,'login_required');return previewPlanning(d,u,kind,args,now,{command,validateSlot});}
export function planningTick(source,now=Date.now(),calendarMode='disabled'){return reconcilePlanning(upgradeData(structuredClone(source)),now,{validateSlot,queueCalendar,calendarMode});}
