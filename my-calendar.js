const DAY=86400000,OFFSET=8*3600000;
export const taipeiDay=value=>new Date(+new Date(value)+OFFSET).toISOString().slice(0,10);
export const instrumentColor=id=>{let hash=0;for(const c of String(id||'vero-afm'))hash=(hash*31+c.charCodeAt(0))>>>0;return ['#356f68','#8b5b88','#ad6a37','#386c9f','#727c32','#a34d5d'][hash%6];};
export function monthDays(month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('invalid_input');
 const first=Date.parse(month+'-01T00:00:00Z'),start=first-((new Date(first).getUTCDay()+6)%7)*DAY;
 return Array.from({length:42},(_,i)=>new Date(start+i*DAY).toISOString().slice(0,10));
}
export function personalEvents(data,id,{instrument='',closed=false}={}){
 return data.bookings.filter(b=>!b.private&&(b.user_id===id||b.operator_id===id)&&(!instrument||(b.instrument_id||'vero-afm')===instrument)&&(closed||!['cancelled','rejected','released','approval_expired','expired'].includes(b.status))).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)||String(a.id).localeCompare(String(b.id)));
}
export function dayEvents(events,day){const start=Date.parse(day+'T00:00:00+08:00');return events.filter(b=>Date.parse(b.start)<start+DAY&&Date.parse(b.end)>start);}
export function createMyCalendar(context){
 function view(){
  const {d,state,t,esc,button,panel,options,empty,label,me,bookingCard}=context();
  state.homeMonth||=taipeiDay(Date.now()).slice(0,7);state.homeMode||='calendar';
  const all=personalEvents(d,me().id,{closed:true});
  const ids=new Set(all.map(b=>b.instrument_id||'vero-afm'));
  const instruments=d.instruments.filter(i=>ids.has(i.id));
  if(state.homeInstrument&&!ids.has(state.homeInstrument))state.homeInstrument='';
  const events=personalEvents(d,me().id,{instrument:state.homeInstrument,closed:state.homeClosed});
  const toolbar=`<div class="my-calendar-toolbar"><div class="segmented" aria-label="${t('顯示方式','View')}">${button(t('日曆','Calendar'),'my-view','calendar',state.homeMode==='calendar'?'small':'secondary small',`aria-pressed="${state.homeMode==='calendar'}"`)}${button(t('清單','List'),'my-view','list',state.homeMode==='list'?'small':'secondary small',`aria-pressed="${state.homeMode==='list'}"`)}</div><label>${t('儀器','Instrument')} <select id="my-instrument">${options([['',t('全部儀器','All instruments')],...instruments.map(i=>[i.id,i.name])],state.homeInstrument||'')}</select></label><label class="check-row"><input id="my-closed" type="checkbox" ${state.homeClosed?'checked':''}>${t('顯示取消、未核准、到期與釋放','Include cancelled, declined, expired and released')}</label></div>`;
  const title=t('我的預約與簽到','My sessions & attendance');
  if(state.homeMode==='list')return panel(title,toolbar+(events.length?events.map(b=>bookingCard(b,true)).join(''):empty(t('沒有符合的預約','No matching bookings'))));
  const days=monthDays(state.homeMonth),today=taipeiDay(Date.now());
  const clock=v=>new Date(Date.parse(v)+OFFSET).toISOString().slice(11,16);
  return panel(title,toolbar+`<div class="my-calendar-toolbar"><div class="toolbar-group">${button('←','my-month','-1','secondary small',`aria-label="${t('上個月','Previous month')}"`)}${button(t('今天','Today'),'my-today')}${button('→','my-month','1','secondary small',`aria-label="${t('下個月','Next month')}"`)}<input type="month" id="my-month" value="${state.homeMonth}" aria-label="${t('顯示月份','Month')}"></div><div class="instrument-legend">${instruments.map(i=>`<span><i style="background:${instrumentColor(i.id)}"></i>${esc(i.name)}</span>`).join('')}</div></div><div class="my-calendar-scroll"><div class="my-calendar" role="region" aria-label="${t('個人月曆','Personal month calendar')}">${t(['一','二','三','四','五','六','日'],['Mon','Tue','Wed','Thu','Fri','Sat','Sun']).map(x=>`<div class="my-weekday">${x}</div>`).join('')}${days.map(day=>`<section class="my-day ${day.startsWith(state.homeMonth)?'':'outside'} ${day===today?'today':''}" aria-label="${day}"><span class="my-day-number">${day.slice(8).replace(/^0/,'')}</span>${dayEvents(events,day).map(b=>{const name=d.instruments.find(i=>i.id===(b.instrument_id||'vero-afm'))?.name||b.instrument_name||'Vero AFM';return `<button class="my-event ${b.status==='pending'?'pending':''}" data-action="my-booking" data-id="${esc(b.id)}" style="--event-color:${instrumentColor(b.instrument_id)}" aria-label="${esc(name+' '+clock(b.start)+' '+label(b.status))}"><strong>${esc(name)}</strong><span>${taipeiDay(b.start)<day?t('續','cont.'):clock(b.start)} – ${taipeiDay(new Date(Date.parse(b.end)-1))>day?'→':clock(b.end)}</span><small>${esc(label(b.status))}</small></button>`;}).join('')}</section>`).join('')}</div></div>`);
 }
 function bind(){const {state,render}=context();const month=document.querySelector('#my-month'),instrument=document.querySelector('#my-instrument'),closed=document.querySelector('#my-closed');if(month)month.onchange=()=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(month.value)){state.homeMonth=month.value;render();}};if(instrument)instrument.onchange=()=>{state.homeInstrument=instrument.value;render();};if(closed)closed.onchange=()=>{state.homeClosed=closed.checked;render();};}
 async function action(action,id){const {state,render,d,me,modal,bookingCard,t}=context();if(action==='my-view'){state.homeMode=id;render();return true;}if(action==='my-month'){const month=new Date(state.homeMonth+'-01T00:00:00Z');month.setUTCMonth(month.getUTCMonth()+Number(id));state.homeMonth=month.toISOString().slice(0,7);render();return true;}if(action==='my-today'){state.homeMonth=taipeiDay(Date.now()).slice(0,7);render();return true;}if(action==='my-booking'){const b=personalEvents(d,me().id,{closed:true}).find(b=>b.id===id);if(b)modal(t('預約與簽到','Session & attendance'),bookingCard(b,true));return true;}return false;}
 return {view,bind,action};
}
