import { DEFAULT_INSTRUMENT } from './resources.js';
import { HOUR, dateKey, plusDays, validateSlot } from './model.js';
export function selectionGroups(values) {
  const times = [...new Set(values)].map(Number).sort((a, b) => a - b);
  if (times.some(x => !Number.isFinite(x) || x % HOUR)) throw Error('invalid_time');
  const groups = [];
  for (const value of times) {
    const last = groups.at(-1);
    if (last && +new Date(last.end) === value && dateKey(last.start) === dateKey(value)) last.end = new Date(value + HOUR).toISOString();
    else groups.push({ start: new Date(value).toISOString(), end: new Date(value + HOUR).toISOString() });
  }
  return groups;
}
export function validateSelection(data, user, values, now = Date.now(), instrumentId=DEFAULT_INSTRUMENT) {
  const groups = selectionGroups(values);
  if (!groups.length || values.length > 72) throw Error('invalid_selection');
  for (const g of groups) validateSlot(data, user, g.start, g.end, now,undefined,false,instrumentId);
  return groups;
}
export function rangeSelection(anchor, target) {
  const a = Number(anchor), b = Number(target);
  if (dateKey(a) !== dateKey(b)) throw Error('selection_same_day');
  const start = Math.min(a, b), end = Math.max(a, b);
  return Array.from({ length: (end - start) / HOUR + 1 }, (_, i) => start + i * HOUR);
}

export function nextAvailableDay(data,user,instrumentId=DEFAULT_INSTRUMENT,now=Date.now()){
 const today=dateKey(now);for(let n=0;n<60;n++){const day=plusDays(today,n);for(let h=9;h<22;h++){const ts=+new Date(day+'T'+String(h).padStart(2,'0')+':00:00+08:00');try{validateSlot(data,user,new Date(ts).toISOString(),new Date(ts+HOUR).toISOString(),now,undefined,false,instrumentId);if(!data.bookings.some(b=>(b.instrument_id||DEFAULT_INSTRUMENT)===instrumentId&&b.user_id===user.id&&b.status==='pending'&&ts>=+new Date(b.start)&&ts<+new Date(b.end)))return day;}catch{}}}return today;
}
