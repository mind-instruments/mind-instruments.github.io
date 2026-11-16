import {bufferWindow,dateException,overlaps} from './planning-core.js';
import {resourceId} from './resources.js';
const HOUR=3600000,DAY=24*HOUR;
const dayOf=time=>new Date(+new Date(time)+8*HOUR).toISOString().slice(0,10);
const midnight=day=>Date.parse(day+'T00:00:00+08:00');
const addDay=(day,n)=>dayOf(midnight(day)+n*DAY);
const duration=(s,e,from,to)=>Math.max(0,Math.min(e,to)-Math.max(s,from))/HOUR;
const validTime=x=>x!=null&&Number.isFinite(+new Date(x));
const num=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const assert=(ok,code='invalid_analysis_range')=>{if(!ok)throw Error(code);};
const normalizeDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(midnight(value))&&dayOf(midnight(value))===value;

export function linearFit(values){
 const n=values.length;if(n<2)return null;
 const mx=(n-1)/2,my=values.reduce((s,y)=>s+y,0)/n;
 let numerator=0,denominator=0;values.forEach((y,x)=>{numerator+=(x-mx)*(y-my);denominator+=(x-mx)**2;});
 const slope=numerator/denominator,intercept=my-slope*mx;
 return {slope,intercept};
}

function currentRules(data,instrument,lab){
 const g={...data.rules.global,...instrument.rules},l=lab?data.rules.labs[lab]:null;
 if(!l)return g;
 const rank={all:0,advanced:1,closed:2};
 return {...g,start_hour:Math.max(g.start_hour,l.start_hour),end_hour:Math.min(g.end_hour,l.end_hour),weekend:rank[g.weekend]>=rank[l.weekend]?g.weekend:l.weekend,evening:rank[g.evening]>=rank[l.evening]?g.evening:l.evening};
}
function openHour(r,time){const dt=new Date(time+8*HOUR),h=dt.getUTCHours();return !([0,6].includes(dt.getUTCDay())&&r.weekend==='closed')&&(h>=r.start_hour&&h<r.end_hour||r.evening!=='closed');}
function unionHours(intervals,from,to){
 const xs=intervals.map(([s,e])=>[Math.max(from,s),Math.min(to,e)]).filter(([s,e])=>e>s).sort((a,b)=>a[0]-b[0]);let total=0,end=from;
 for(const [s,e]of xs){total+=Math.max(0,e-Math.max(s,end));end=Math.max(end,e);}return total/HOUR;
}

export function analyze(data,actorId,filters={},now=Date.now()){
 const actor=data.users.find(u=>u.id===actorId);
 assert(actor&&['system_admin','lab_manager'].includes(actor.role)&&actor.status==='approved'&&(!actor.suspended_until||Date.parse(actor.suspended_until)<=now),'forbidden');
 const admin=actor.role==='system_admin',today=dayOf(now),from=filters.from||addDay(today,-29),to=filters.to||today;
 assert(normalizeDay(from)&&normalizeDay(to)&&from<=to&&to<=today&&(midnight(to)-midnight(from))/DAY<366);
 const lab=admin?(filters.lab||''):actor.lab_id;
 assert(!lab||data.labs.some(l=>l.id===lab),'invalid_input');
 if(!admin&&filters.lab&&filters.lab!==lab)throw Error('forbidden');
 const instrumentId=filters.instrument||'';assert(!instrumentId||data.instruments.some(i=>i.id===instrumentId),'instrument_not_found');
 const instruments=data.instruments.filter(i=>!instrumentId||i.id===instrumentId),ids=new Set(instruments.map(i=>i.id)),start=midnight(from),end=Math.min(midnight(to)+DAY,now);
 const inPeriod=time=>validTime(time)&&Date.parse(time)>=start&&Date.parse(time)<end;
 const allBookings=data.bookings.filter(b=>ids.has(resourceId(b))),ownBookings=allBookings.filter(b=>!lab||b.lab_id===lab);
 const ownProbe=p=>!lab||p.lab_id===lab;
 const probes=data.probes.filter(p=>ids.has(resourceId(p))&&ownProbe(p)&&data.probe_tables?.find(t=>t.id===p.table_id)?.status!=='draft');
 const days=Array.from({length:Math.round((midnight(to)-start)/DAY)+1},(_,n)=>({day:addDay(from,n),booked:0,actual:0,capacity:0,instrumentRevenue:0,consumableRevenue:0,noShowRevenue:0}));
 const daily=new Map(days.map(x=>[x.day,x]));
 let missingRate=0,missingAttendance=0,completed=0,missingPurchasePrice=0;
 const byInstrument=instruments.map(i=>{
   const bookings=ownBookings.filter(b=>resourceId(b)===i.id),r=currentRules(data,i,lab);let booked=0,actual=0,capacity=0;
   const confirmedIntervals=bookings.filter(b=>['booked','checked_in','completed','no_show'].includes(b.status)).map(b=>[Date.parse(b.start),Date.parse(b.end)]);
   const actualIntervals=bookings.filter(b=>['checked_in','completed'].includes(b.status)&&validTime(b.checked_in_at)&&(b.status==='checked_in'||validTime(b.checked_out_at))).map(b=>[Date.parse(b.checked_in_at),b.status==='checked_in'?Math.min(now,Date.parse(b.end)):Date.parse(b.checked_out_at)]);
   for(const day of days){const s=midnight(day.day),e=Math.min(s+DAY,end);if(e<=s)continue;
     let db=0,da=0,dc=0;
     for(let h=s;h<e;h+=HOUR){const futureChange=(data.rule_history||[]).find(x=>Date.parse(x.at)>h),pastChange=(data.rule_history||[]).filter(x=>Date.parse(x.at)<=h).at(-1),saved=futureChange?.before||pastChange?.after,oldInstrument=saved?.instruments.find(x=>x.id===i.id);const rr=saved&&oldInstrument?currentRules(saved,oldInstrument,lab):r;if((!oldInstrument||oldInstrument.status==='available')&&openHour(rr,h))dc+=duration(h,h+HOUR,s,e);}
     db=unionHours(confirmedIntervals,s,e);
     da=unionHours(actualIntervals,s,e);
     day.booked+=db;day.actual+=da;day.capacity+=dc;booked+=db;actual+=da;capacity+=dc;
   }
   return {id:i.id,name:i.name,booked,actual,capacity,utilization:capacity?actual/capacity:null};
 });
 for(const b of ownBookings){
   if(b.status==='completed'&&inPeriod(b.checked_out_at||b.end)){
     completed++;if(!validTime(b.checked_in_at)||!validTime(b.checked_out_at))missingAttendance++;
     if(num(b.hourly_rate)){daily.get(dayOf(b.checked_out_at||b.end)).instrumentRevenue+=Math.max(0,Date.parse(b.end)-Date.parse(b.start))/HOUR*b.hourly_rate;}else missingRate++;
   }
   if(b.status==='no_show'&&inPeriod(b.start)){if(num(b.penalty_amount))daily.get(dayOf(b.start)).noShowRevenue+=b.penalty_amount;else missingRate++;}
 }
 let costAdjustment=0;for(const b of ownBookings){const at=b.status==='no_show'?b.start:b.checked_out_at||b.end;if(!['completed','no_show'].includes(b.status)||!inPeriod(at))continue;const adjustment=(data.cost_adjustments||[]).filter(x=>x.booking_id===b.id).reduce((n,x)=>n+x.amount,0);daily.get(dayOf(at))[b.status==='no_show'?'noShowRevenue':'instrumentRevenue']+=adjustment;costAdjustment+=adjustment;}
 const purchases=data.purchases.filter(p=>p.status==='approved'&&(!lab||p.lab_id===lab)&&inPeriod(p.approved_at)&&ids.has(resourceId(data.probes.find(x=>x.id===p.probe_id))));
 for(const p of purchases){if(num(p.price))daily.get(dayOf(p.approved_at)).consumableRevenue+=p.price;else missingPurchasePrice++;}
 // Capacity uses the current opening policy, never fabricated maintenance history.
 const future=Array.from({length:7},(_,n)=>({day:addDay(today,n),slots:Array.from({length:24},(_,hour)=>({hour,capacity:0,free:0}))}));
 for(const i of instruments){if(i.status!=='available')continue;const r=currentRules(data,i,lab),bookings=allBookings.filter(b=>resourceId(b)===i.id&&['booked','checked_in'].includes(b.status));
   for(const day of future)for(const slot of day.slots){const s=midnight(day.day)+slot.hour*HOUR;const exception=dateException(data,i.id,new Date(s).toISOString()),open=exception?exception.kind==='open'&&slot.hour>=exception.start_hour&&slot.hour<exception.end_hour:openHour(r,s);if(s<=now||!open||(data.maintenance_windows||[]).some(w=>w.instrument_id===i.id&&w.status==='active'&&overlaps(new Date(s).toISOString(),new Date(s+HOUR).toISOString(),w.start,w.end)))continue;slot.capacity++;if(bookings.some(b=>b.status==='checked_in'&&Date.parse(b.end)<now)){slot.uncertain=true;continue;}if(!bookings.some(b=>{const [start,end]=bufferWindow(data,b);return Date.parse(start)<s+HOUR&&Date.parse(end)>s;}))slot.free++;}
 }
 const groups=new Map(),probeMap=new Map(data.probes.map(p=>[p.id,p])),firstUse=new Map();
 for(const usage of data.usages){if(!usage.correction_reason&&validTime(usage.taken_at)&&Date.parse(usage.taken_at)<=now&&(!firstUse.has(usage.probe_id)||Date.parse(usage.taken_at)<Date.parse(firstUse.get(usage.probe_id))))firstUse.set(usage.probe_id,usage.taken_at);}
 for(const p of probes){const key=JSON.stringify([resourceId(p),p.model||'']);if(!groups.has(key))groups.set(key,{key,instrument_id:resourceId(p),instrument_name:instruments.find(i=>i.id===resourceId(p))?.name,model:p.model||'',stock:{new:0,reusable:0,inUse:0,inspection:0,retired:0,other:0},issues:0,newUses:0,dates:[],daily:days.map(d=>({day:d.day,count:0}))});
   const g=groups.get(key);if(p.status==='available'&&(!p.condition||p.condition==='good'))g.stock[firstUse.has(p.id)?'reusable':'new']++;else if(p.status==='in_use')g.stock.inUse++;else if(p.status==='inspection')g.stock.inspection++;else if(p.status==='retired')g.stock.retired++;else g.stock.other++;
 }
 const earliest=new Map();for(const usage of data.usages){if(usage.correction_reason||!validTime(usage.taken_at)||Date.parse(usage.taken_at)>now)continue;const old=earliest.get(usage.probe_id);if(!old||Date.parse(usage.taken_at)<Date.parse(old.taken_at))earliest.set(usage.probe_id,usage);}
 for(const usage of data.usages){if(usage.correction_reason)continue;const p=probeMap.get(usage.probe_id);if(!p)continue;const iid=usage.instrument_id||resourceId(p),model=usage.model||p.model||'',owner=usage.lab_id??p.lab_id;if(!ids.has(iid)||lab&&owner!==lab)continue;const key=JSON.stringify([iid,model]);if(!groups.has(key))groups.set(key,{key,instrument_id:iid,instrument_name:instruments.find(i=>i.id===iid)?.name,model,stock:{new:0,reusable:0,inUse:0,inspection:0,retired:0,other:0},issues:0,newUses:0,dates:[],daily:days.map(d=>({day:d.day,count:0}))});const g=groups.get(key);if(inPeriod(usage.taken_at))g.issues++;if(earliest.get(p.id)===usage){g.dates.push(dayOf(usage.taken_at));if(inPeriod(usage.taken_at)){g.newUses++;g.daily.find(x=>x.day===dayOf(usage.taken_at)).count++;}}}
 const consumables=[...groups.values()].map(g=>{
   const observedFrom=g.dates.length?g.dates.reduce((a,b)=>a<b?a:b):to,fitFrom=observedFrom>from?observedFrom:from;
   let total=0;const series=g.daily.map(x=>({...x,cumulative:total+=x.count})),sample=series.filter(x=>x.day>=fitFrom),fit=linearFit(sample.map(x=>x.cumulative));
   const eventDays=sample.filter(x=>x.count>0).map(x=>x.day),span=eventDays.length?(midnight(eventDays.at(-1))-midnight(eventDays[0]))/DAY:0;
   let status=g.stock.new===0?'empty':g.newUses===0&&g.dates.length?'flat':eventDays.length<3||span<7||sample.length<14?'insufficient':!fit||fit.slope<=0?'flat':'ready';
   const rate=status==='ready'?fit.slope:null,daysLeft=rate?Math.ceil(g.stock.new/rate):null;
   if(daysLeft>3650)status='distant';
   const boxes=(data.probe_tables||[]).filter(t=>resourceId(t)===g.instrument_id&&t.model===g.model&&(!lab||t.lab_id===lab)),leadDays=Math.max(0,...boxes.map(t=>t.lead_days||0)),safety=boxes.reduce((n,t)=>n+(t.safety_stock||0),0),incoming=boxes.reduce((n,t)=>n+Math.max(0,(t.ordered_quantity||0)-(t.received_quantity||0)),0);
   return {...g,replenishment:{leadDays,safety,incoming,orderBy:status==='ready'?addDay(today,daysLeft-leadDays-Math.ceil(safety/rate)):null},dates:undefined,series,fit:fit?{...fit,from:fitFrom}:null,forecast:{status,rate,daysLeft,exhaustion:status==='ready'?addDay(today,daysLeft):null,observedDays:sample.length,eventDays:eventDays.length}};
 });
 const total=days.reduce((a,d)=>{for(const k of ['booked','actual','capacity','instrumentRevenue','consumableRevenue','noShowRevenue'])a[k]+=d[k];return a;},{booked:0,actual:0,capacity:0,instrumentRevenue:0,consumableRevenue:0,noShowRevenue:0});
 const unverifiedHours=ownBookings.filter(b=>b.status==='checked_in'&&Date.parse(b.end)<now).reduce((n,b)=>n+duration(Date.parse(b.end),now,start,end),0);
 const details=ownBookings.filter(b=>Date.parse(b.start)<end&&Date.parse(b.end)>start).map(b=>({id:b.id,instrument:b.instrument_name||resourceId(b),status:b.status,start:b.start,end:b.end,checked_in_at:b.checked_in_at||null,checked_out_at:b.checked_out_at||null,hourly_rate:b.hourly_rate??null,lab_id:b.lab_id}));
 return {unverifiedHours,details,asOf:new Date(now).toISOString(),from,to,scope:{lab:lab||null,admin},total:{...total,costAdjustment,completed,missingRate,missingAttendance,missingPurchasePrice,utilization:total.capacity?total.actual/total.capacity:null,futureFree:future.flatMap(d=>d.slots).reduce((n,s)=>n+s.free,0),futureCapacity:future.flatMap(d=>d.slots).reduce((n,s)=>n+s.capacity,0)},days,byInstrument,future,consumables};
}
