export class Client {
 mode='server';sessionEpoch=0;snapshotSequence=0;authChanging=false;sessionContext=null;sessionScope=null;identityKey=null;
 constructor(){this.external=typeof location!=='undefined'&&location.hostname==='mind-instruments.github.io';this.tokenKey='cnmm-github-session';this.token=this.external?sessionStorage.getItem(this.tokenKey):null;if(typeof window!=='undefined'&&typeof BroadcastChannel==='function'){this.channel=new BroadcastChannel('cnmm-session');this.channel.onmessage=e=>{if(['changing','changed'].includes(e.data?.type))this.invalidateSession(e.data.type);};}}
 setToken(token){this.token=token;if(this.external){if(token)sessionStorage.setItem(this.tokenKey,token);else sessionStorage.removeItem(this.tokenKey);}}
 endpoint(path){return this.external?'https://xnjjptqxzimrfprsyxmb.supabase.co/functions/v1/cnmm-api/api/'+path:'./api/'+path;}
 headers(){return {'Content-Type':'application/json','X-AFM-Request':'1',...(this.sessionContext?{'X-AFM-Context':this.sessionContext}:{}),...(this.external&&this.token?{'X-CNMM-Session':this.token}:{})};}
 async resource(path){return fetch(this.endpoint(path),{credentials:this.external?'omit':'same-origin',headers:this.external&&this.token?{'X-CNMM-Session':this.token}:undefined,signal:AbortSignal.timeout(20000)});}
 invalidateSession(phase='changed'){this.sessionEpoch++;this.sessionScope=null;this.sessionContext=null;this.identityKey=null;this.onSessionChange?.(phase);}
 async init(){this.info=await this.request('info');if(this.info.version!==3||this.info.revision!==17)throw Error('server_upgrade_required');}
 async request(path,body){
  let r;try{r=await fetch(this.endpoint(path),{method:body?'POST':'GET',credentials:this.external?'omit':'same-origin',headers:this.headers(),...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});}catch{throw Error('server_error');}
  let data;try{data=await r.json();}catch{throw Error('server_error');}if(!r.ok){if(data.error==='session_changed'||data.error==='login_required'&&this.sessionContext)this.invalidateSession();if(data.error==='login_required'&&this.external)this.setToken(null);throw Error(data.error||'server_error');}if(this.external&&data.session_token){this.setToken(data.session_token);delete data.session_token;}return data;
 }
 async transition(path,body){if(this.authChanging)throw Error('session_changed');const epoch=++this.sessionEpoch;this.sessionScope=null;this.identityKey=null;this.authChanging=true;this.channel?.postMessage({type:'changing'});if(['login','register','setup'].includes(path))this.setToken(null);try{const out=await this.request(path,body);if(epoch!==this.sessionEpoch)throw Error('session_changed');return out;}finally{if(path==='logout')this.setToken(null);this.sessionContext=null;this.authChanging=false;if(epoch===this.sessionEpoch)this.sessionEpoch++;this.channel?.postMessage({type:'changed'});}}
 async login(email,password){return this.transition('login',{email,password});}
 async register(body){return this.transition('register',body);}
 async setup(body){return this.transition('setup',body);}
 async logout(){return this.transition('logout',{});}
 async switchUser(id){return this.transition('test/switch',{user_id:id});}
 async exitTest(){return this.transition('test/exit',{});}
 async snapshot(){if(this.authChanging)throw Error('session_changed');const epoch=this.sessionEpoch,sequence=++this.snapshotSequence;try{const d=await this.request('snapshot');if(epoch!==this.sessionEpoch||sequence!==this.snapshotSequence)throw Error('session_changed');this.sessionScope=(d.access?.testing?'test:':'real:')+d.me.id;this.identityKey=[this.sessionScope,d.me.role,d.me.lab_id].join('|');this.sessionContext=d.sessionContext||null;return d;}catch(e){if(epoch!==this.sessionEpoch||sequence!==this.snapshotSequence)throw Error('session_changed');throw e;}}
 pending(){if(!this.sessionScope)return null;try{return JSON.parse(sessionStorage.getItem('afm-pending-command:'+this.sessionScope)||'null');}catch{return null;}}
 clearPending(key){sessionStorage.removeItem(key);this.onPendingChange?.();}
 async mutate(action,args){
  if(this.authChanging||!this.sessionScope)throw Error('session_changed');const epoch=this.sessionEpoch,scope=this.sessionScope,identity=this.identityKey||scope,key='afm-pending-command:'+scope,payload={action,args},encoded=JSON.stringify(payload);let pending=this.pending();
  if(pending&&pending.encoded!==encoded){const prior=await this.request('command-status?request_id='+encodeURIComponent(pending.id));if(epoch!==this.sessionEpoch)throw Error('session_changed');if(!['completed','abandoned'].includes(prior.status))throw Error('pending_submission');pending=null;}
  if(pending&&pending.identity!==identity)throw Error('pending_context_changed');
  if(!pending)pending={id:crypto.randomUUID(),encoded,identity};sessionStorage.setItem(key,JSON.stringify(pending));this.onPendingChange?.();
  try{const out=await this.request('command',{...payload,request_id:pending.id});if(epoch!==this.sessionEpoch)throw Error('session_changed');this.clearPending(key);return out;}
  catch(e){if(epoch!==this.sessionEpoch)throw Error('session_changed');if(!['server_error','storage_unavailable','login_required','session_changed'].includes(e.message))this.clearPending(key);throw e;}
 }
 async recoverPending(){
  if(this.authChanging||!this.sessionScope)throw Error('session_changed');const epoch=this.sessionEpoch,pending=this.pending(),key='afm-pending-command:'+this.sessionScope;if(!pending)return {status:'none'};
  const status=await this.request('command-status?request_id='+encodeURIComponent(pending.id));if(epoch!==this.sessionEpoch)throw Error('session_changed');if(['completed','abandoned'].includes(status.status)){this.clearPending(key);return status;}
  if(pending.identity!==(this.identityKey||this.sessionScope))throw Error('pending_context_changed');const payload=JSON.parse(pending.encoded);return {status:'completed',result:await this.mutate(payload.action,payload.args)};
 }
 async abandonPending(){
  if(this.authChanging||!this.sessionScope)throw Error('session_changed');const epoch=this.sessionEpoch,pending=this.pending(),key='afm-pending-command:'+this.sessionScope;if(!pending)return {status:'none'};
  const result=await this.request('abandon-command',{request_id:pending.id});if(epoch!==this.sessionEpoch)throw Error('session_changed');this.clearPending(key);return result;
 }
}
