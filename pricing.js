export const defaultFees=()=>[{id:'standard',name:'一般',instrument_multiplier:1,probe_multiplier:1},{id:'yhc',name:'YHC group',instrument_multiplier:0,probe_multiplier:0},{id:'industry',name:'業界',instrument_multiplier:2,probe_multiplier:2}];
export const feeCategories=d=>d.fee_categories||defaultFees();
export function feeCategory(d,u){return feeCategories(d).find(x=>x.id===(u.fee_category_id||d.labs.find(l=>l.id===u.lab_id)?.fee_category_id||'standard'))||feeCategories(d).find(x=>x.id==='standard');}
export function priced(d,u,base,kind='instrument'){
 const c=feeCategory(d,u),multiplier=c[kind+'_multiplier'];
 return {category_id:c.id,category_name:c.name,base_rate:base??null,multiplier,amount:base==null?(multiplier===0?0:null):Math.round((base*multiplier+Number.EPSILON)*100)/100};
}
export function pricingCommand(d,u,action,a){
 if(!['save_fee_category','assign_fee_category'].includes(action))return null;
 if(u.role!=='system_admin')throw Error('forbidden');
 d.fee_categories||=defaultFees();
 if(action==='save_fee_category'){
  if(typeof a.name!=='string'||!a.name.trim()||a.name.length>80||!['instrument_multiplier','probe_multiplier'].every(k=>typeof a[k]==='number'&&Number.isFinite(a[k])&&a[k]>=0&&a[k]<=100&&Math.abs(a[k]*10000-Math.round(a[k]*10000))<1e-7))throw Error('invalid_input');
  if(d.fee_categories.some(x=>x.id!==a.id&&x.name.toLowerCase()===a.name.trim().toLowerCase()))throw Error('fee_duplicate');
  let c=d.fee_categories.find(x=>x.id===a.id);if(a.id&&!c)throw Error('not_found');if(!c){if(d.fee_categories.length>=100)throw Error('invalid_input');c={id:crypto.randomUUID()};d.fee_categories.push(c);}
  Object.assign(c,{name:a.name.trim(),instrument_multiplier:a.instrument_multiplier,probe_multiplier:a.probe_multiplier});return {...c};
 }
 if(!['user','lab'].includes(a.kind)||typeof a.category_id!=='string')throw Error('invalid_input');
 const target=(a.kind==='user'?d.users:d.labs).find(x=>x.id===a.id);if(!target)throw Error('not_found');
 if(a.category_id&&!d.fee_categories.some(x=>x.id===a.category_id))throw Error('invalid_input');
 target.fee_category_id=a.category_id||null;return {id:target.id,kind:a.kind,category_id:target.fee_category_id};
}
