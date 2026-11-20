// Catalog specifications are copied into each box to preserve procurement history.
export const probeSpecFields=['tip','tip_radius','coating','resonance_frequency','force_constant'];
export const probeContactFields=['vendor','supplier_phone'];
export function probeFields(input,keys=probeSpecFields){
 const out={};for(const key of keys){const value=input[key]??'';if(typeof value!=='string'||value.trim().length>200||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw Error('invalid_input');out[key]=value.trim();}return out;
}
export const visibleProbeModels=(d,u)=>(d.probe_models||[]).filter(m=>u.status==='approved'&&['system_admin','lab_manager'].includes(u.role)&&(u.role==='system_admin'||!m.lab_id||m.lab_id===u.lab_id));
export function applyProbeModel(d,u,action,a,stamp){
 if(!['add_probe_model','edit_probe_model'].includes(action))return;
 const need=(ok,code='invalid_input')=>{if(!ok)throw Error(code);};
 need(['system_admin','lab_manager'].includes(u.role),'forbidden');
 let model;if(action==='edit_probe_model'){model=d.probe_models.find(x=>x.id===a.id);need(model,'not_found');need(u.role==='system_admin'||model.lab_id===u.lab_id,'forbidden');need(model.revision===a.revision,'stale_request');}
 const instrument=model?.instrument_id||a.instrument_id,lab=model?model.lab_id:u.role==='system_admin'?a.lab_id||null:u.lab_id;
 need(d.instruments.some(x=>x.id===instrument));need(!lab||d.labs.some(x=>x.id===lab));
 need(typeof a.name==='string'&&a.name.trim().length>0&&a.name.trim().length<=100);
 const name=a.name.trim();need(!d.probe_models.some(x=>x.id!==model?.id&&x.lab_id===lab&&x.instrument_id===instrument&&x.name.toLowerCase()===name.toLowerCase()),'duplicate_probe_model');
 const values={name,...probeFields(a),...probeFields(a,probeContactFields)};
 if(model)Object.assign(model,values,{revision:model.revision+1,updated_by:u.id,updated_at:stamp});
 else{model={id:crypto.randomUUID(),instrument_id:instrument,lab_id:lab,revision:1,created_by:u.id,created_at:stamp,...values};d.probe_models.push(model);}
 return model;
}
