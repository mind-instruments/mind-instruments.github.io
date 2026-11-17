import {need,clean} from './planning-core.js';
export function zonedTime(value,zone='Asia/Taipei'){
 const raw=String(value||'');if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw)){const local=raw.replace(/(Z|[+-]\d{2}:\d{2})$/,''),wall=Date.parse(local+'Z');need(Number.isFinite(wall)&&new Date(wall).toISOString().slice(0,local.length)===local,'import_time');const t=Date.parse(raw);need(Number.isFinite(t),'import_time');return new Date(t).toISOString();}
 const m=raw.match(/^(\d{4})-?(\d{2})-?(\d{2})T(\d{2}):?(\d{2})(?::?(\d{2}))?(Z)?$/);need(m,'import_time');const p=m.slice(1,7).map(Number);p[5]||=0;const wall=Date.UTC(p[0],p[1]-1,p[2],p[3],p[4],p[5]);need(new Date(wall).toISOString().slice(0,19)===`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${String(p[5]).padStart(2,'0')}`,'import_time');if(m[7])return new Date(wall).toISOString();
 let format;try{format=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});}catch{throw Error('import_timezone');}
 const parts=t=>Object.fromEntries(format.formatToParts(new Date(t)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
 const offsets=new Set();for(const delta of [-2,-1,0,1,2]){const t=wall+delta*86400000,v=parts(t);offsets.add(Date.UTC(v.year,v.month-1,v.day,v.hour,v.minute,v.second)-t);}
 const matches=[...offsets].map(o=>wall-o).filter(t=>{const v=parts(t);return v.year===p[0]&&v.month===p[1]&&v.day===p[2]&&v.hour===p[3]&&v.minute===p[4]&&v.second===p[5];});need(matches.length===1,'import_ambiguous_time');return new Date(matches[0]).toISOString();
}
export function csv(text){
 const rows=[];let row=[],field='',state='start';
 const finishField=()=>{row.push(field);field='';state='start';};
 const finishRow=()=>{finishField();if(row.some(Boolean))rows.push(row);row=[];};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(state==='quoted'){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else state='closed';}else field+=c;continue;}
  if(c===','){finishField();continue;}
  if(c==='\r'||c==='\n'){finishRow();if(c==='\r'&&text[i+1]==='\n')i++;continue;}
  if(c==='"'){need(state==='start','import_format');state='quoted';continue;}
  need(state!=='closed','import_format');field+=c;state='unquoted';
 }
 need(state!=='quoted','import_format');finishRow();
 const heads=rows.shift()?.map(h=>h.trim());
 need(heads?.includes('start')&&heads.includes('end')&&heads.every(Boolean)&&new Set(heads).size===heads.length,'import_format');
 return rows.map(values=>{need(values.length===heads.length,'import_format');return Object.fromEntries(heads.map((h,i)=>[h,values[i]]));});
}
export function parseImport(text,format='csv',zone='Asia/Taipei'){
 need(typeof text==='string'&&text.length>0&&text.length<=50000,'import_limit');let rows;
 if(format==='csv')rows=csv(text.replace(/^\uFEFF/,''));
 else {need(format==='ics'&&text.includes('BEGIN:VCALENDAR'),'import_format');const lines=text.replace(/\r?\n[ \t]/g,'').split(/\r?\n/);rows=[];let event=null,cancelMessage=false;for(const line of lines){if(line==='BEGIN:VEVENT'){need(!event,'import_format');event={};continue;}if(line==='END:VEVENT'){need(event,'import_format');rows.push(event);event=null;continue;}if(!event){if(/^METHOD:CANCEL$/i.test(line))cancelMessage=true;continue;}const colon=line.indexOf(':');if(colon<0)continue;const key=line.slice(0,colon),value=line.slice(colon+1),name=key.split(';')[0];if(['RRULE','RDATE','EXDATE','RECURRENCE-ID','DURATION'].includes(name))event.error='import_recurrence';if(name==='STATUS'&&value.toUpperCase()==='CANCELLED')event.error='import_cancelled';if(name==='UID')event.source_uid=clean(value,200);if(name==='SUMMARY')event.purpose=value.replace(/\\n/gi,'\n').replace(/\\([,;\\])/g,'$1');if(['DTSTART','DTEND'].includes(name)){const part=name==='DTSTART'?'start':'end';event[part]=value;event[part+'_zone']=key.match(/TZID=([^;]+)/)?.[1].replace(/^"|"$/g,'')||zone;}}need(!event,'import_format');if(cancelMessage)for(const row of rows)row.error='import_cancelled';}
 need(rows.length>0&&rows.length<=50,'import_limit');return rows.map((r,index)=>{try{if(r.error)throw Error(r.error);const start=zonedTime(r.start,r.start_zone||r.timezone||zone),end=zonedTime(r.end,r.end_zone||r.timezone||zone);return {index,start,end,purpose:clean(r.purpose),source_uid:clean(r.source_uid||`${start}|${end}|${r.purpose||''}`,500)};}catch(e){return {index,error:e.message,purpose:clean(r.purpose),source_uid:clean(r.source_uid,500)};}});
}
