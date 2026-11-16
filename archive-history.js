// Reconstruct only the old lab's historical state; never import the new owner's live custody.
export function includeHistoricalProbes(d,payload,lab,cutoff){
 const ids=new Set(['usages','purchases','stock_movements'].flatMap(k=>(payload[k]||[]).map(r=>r.probe_id)).filter(Boolean));
 for(const id of ids){const movements=d.stock_movements.filter(m=>m.probe_id===id).sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));const future=movements.find(m=>Date.parse(m.created_at)>=cutoff&&m.before?.lab_id===lab),past=movements.filter(m=>Date.parse(m.created_at)<cutoff&&m.after?.lab_id===lab).at(-1),live=d.probes.find(p=>p.id===id&&p.lab_id===lab),reference=payload.usages.find(u=>u.probe_id===id)||payload.purchases.find(p=>p.probe_id===id)||{};
 const snapshot=future?.before||past?.after||live||{id,lab_id:lab,instrument_id:reference.instrument_id,model:reference.model,serial:reference.probe_serial,status:'historical',holder:null,grants:[]};
 const p={...structuredClone(snapshot),historical_as_of:new Date(cutoff-1).toISOString(),historical_source:future||past?'stock_movement':live?'current_record':'partial_reference'};p.lab_id=lab;
 const old=payload.probes.findIndex(p=>p.id===id);if(old<0)payload.probes.push(p);else payload.probes[old]=p;
 if(p.table_id&&!payload.probe_tables.some(t=>t.id===p.table_id)){const table=d.probe_tables.find(t=>t.id===p.table_id);if(table&&(table.lab_id==null||table.lab_id===lab)){payload.probe_tables.push({...structuredClone(table),default_grants:[]});for(const a of d.assets.filter(a=>a.table_id===table.id))if(!payload.assets.some(x=>x.id===a.id))payload.assets.push(structuredClone(a));}else payload.probe_tables.push({id:p.table_id,lab_id:lab,name:p.model||'Historical consumable',model:p.model,instrument_id:p.instrument_id,default_grants:[],historical_reference:true});}
 }
}
