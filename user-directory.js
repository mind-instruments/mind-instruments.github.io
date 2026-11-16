const DAY=24*60*60*1000;
const countedStatuses=new Set(['booked','checked_in','completed','no_show']);
const roleOrder={system_admin:0,lab_manager:1,user:2};
const collator=new Intl.Collator('zh-Hant',{numeric:true,sensitivity:'base'});

export function directoryRows(users,bookings,labs,filters={},now=Date.now()){
 const days=[30,90,365].includes(Number(filters.days))?Number(filters.days):90;
 const lower=now-days*DAY;
 const counts=new Map();
 for(const booking of bookings){
  const start=Date.parse(booking.start);
  if(booking.private||!countedStatuses.has(booking.status)||!Number.isFinite(start)||start<lower||start>now)continue;
  counts.set(booking.user_id,(counts.get(booking.user_id)||0)+1);
 }
 const labNames=new Map(labs.map(lab=>[lab.id,lab.name]));
 const query=String(filters.search||'').trim().toLocaleLowerCase();
 const result=users.filter(user=>{
  if(filters.lab&&user.lab_id!==filters.lab)return false;
  if(filters.role&&user.role!==filters.role)return false;
  return !query||[user.name,user.email,labNames.get(user.lab_id)].some(value=>String(value||'').toLocaleLowerCase().includes(query));
 }).map(user=>({user,count:counts.get(user.id)||0}));
 const sort=['lab','role','frequency','name'].includes(filters.sort)?filters.sort:'lab';
 const direction=filters.descending?-1:1;
 result.sort((a,b)=>{
  let primary=0;
  if(sort==='lab')primary=collator.compare(labNames.get(a.user.lab_id)||'',labNames.get(b.user.lab_id)||'');
  if(sort==='role')primary=(roleOrder[a.user.role]??99)-(roleOrder[b.user.role]??99);
  if(sort==='frequency')primary=a.count-b.count;
  if(sort==='name')primary=collator.compare(a.user.name||'',b.user.name||'');
  return direction*primary||collator.compare(labNames.get(a.user.lab_id)||'',labNames.get(b.user.lab_id)||'')||collator.compare(a.user.name||'',b.user.name||'')||collator.compare(a.user.id,b.user.id);
 });
 return result;
}
