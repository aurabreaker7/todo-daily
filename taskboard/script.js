// ══════════════════════════════════════
//  SUPABASE
// ══════════════════════════════════════
const API_BASE=(window.TASKBOARD_API_URL||'').replace(/\/$/,'');
const API_SESSION_KEY='tb_api_session_v1';
function apiSession(){try{return JSON.parse(localStorage.getItem(API_SESSION_KEY));}catch{return null;}}
function setApiSession(v){localStorage.setItem(API_SESSION_KEY,JSON.stringify(v));}
function delApiSession(){localStorage.removeItem(API_SESSION_KEY);}
function captureOAuthSessionFromHash(){
  if(!location.hash||!location.hash.includes('access_token='))return false;
  const params=new URLSearchParams(location.hash.slice(1));
  const access_token=params.get('access_token');
  if(!access_token)return false;
  const expiresIn=Number(params.get('expires_in')||0);
  setApiSession({
    access_token,
    refresh_token:params.get('refresh_token')||'',
    token_type:params.get('token_type')||'bearer',
    expires_in:expiresIn,
    expires_at:expiresIn?Math.floor(Date.now()/1000)+expiresIn:null,
    provider_token:params.get('provider_token')||'',
    user:null
  });
  history.replaceState(null,document.title,location.pathname+location.search);
  return true;
}
async function apiFetch(path,options={}){
  const session=apiSession();
  const headers={'content-type':'application/json',...(options.headers||{})};
  if(session?.access_token)headers.authorization='Bearer '+session.access_token;
  const res=await fetch(API_BASE+path,{...options,headers});
  const text=await res.text();
  const data=text?JSON.parse(text):null;
  if(!res.ok)throw new Error(typeof data?.detail==='string'?data.detail:text||res.statusText);
  return data;
}
function encodeParams(params){
  const q=new URLSearchParams();
  Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null)q.set(k,String(v));});
  const s=q.toString();return s?'?'+s:'';
}
class ApiQuery{
  constructor(table){this.table=table;this.method='GET';this.params={};this.body=undefined;this.headers={};this._single=false;this._maybe=false;}
  select(cols='*'){this.params.select=cols;return this;}
  eq(k,v){this.params[k]='eq.'+v;return this;}
  order(k,opt={}){this.params.order=k+'.'+(opt.ascending?'asc':'desc');return this;}
  limit(n){this.params.limit=n;return this;}
  insert(payload){this.method='POST';this.body=payload;return this;}
  update(payload){this.method='PATCH';this.body=payload;return this;}
  delete(){this.method='DELETE';return this;}
  upsert(payload){this.method='POST';this.body=payload;this.headers['x-upsert']='true';return this;}
  single(){this._single=true;return this.execute();}
  maybeSingle(){this._maybe=true;return this.execute();}
  async execute(){
    try{
      const data=await apiFetch('/api/rest/'+encodeURIComponent(this.table)+encodeParams(this.params),{method:this.method,headers:this.headers,body:this.body!==undefined?JSON.stringify(this.body):undefined});
      if(this._single||this._maybe){
        const row=Array.isArray(data)?data[0]||null:data;
        if(this._single&&!row)return {data:null,error:{message:'No rows returned'}};
        return {data:row,error:null};
      }
      return {data,error:null};
    }catch(e){return {data:null,error:{message:e.message||String(e)}};}
  }
  then(resolve,reject){return this.execute().then(resolve,reject);}
}
const supa={
  from(table){return new ApiQuery(table);},
  rpc(){return Promise.resolve({data:null,error:{message:'RPC calls now need explicit Railway API endpoints.'}});},
  auth:{
    async signInWithPassword({email,password}){try{const data=await apiFetch('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})});setApiSession(data);return {data:{session:data,user:data.user},error:null};}catch(e){return {data:null,error:{message:e.message||String(e)}};}},
    async signUp({email,password,options}){try{const name=options?.data?.name||options?.data?.full_name||email.split('@')[0];const data=await apiFetch('/api/auth/signup',{method:'POST',body:JSON.stringify({name,email,password})});if(data.access_token)setApiSession(data);return {data:{user:data.user||data,session:data.access_token?data:null},error:null};}catch(e){return {data:null,error:{message:e.message||String(e)}};}},
    async getSession(){
      captureOAuthSessionFromHash();
      const session=apiSession();
      if(!session?.access_token)return {data:{session:null},error:null};
      // Always re-validate the token against the backend on boot — a
      // cached session.user from a previous visit doesn't mean the
      // access_token is still valid (it may have expired/been revoked
      // server-side), so a stale local-storage session must never be
      // trusted without a live check.
      try{
        session.user=await apiFetch('/api/auth/user');
        setApiSession(session);
      }catch(e){delApiSession();return {data:{session:null},error:{message:e.message||String(e)}};}
      return {data:{session:{...session,user:session.user}},error:null};
    },
    async signOut(){delApiSession();return {error:null};},
    onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},
    async signInWithOAuth({provider}={}){
      if(provider==='telegram'){
        window.location.href=API_BASE+'/api/auth/telegram/start';
        return {error:null};
      }
      if(provider!=='google')return {error:{message:'Only Google and Telegram OAuth are configured.'}};
      window.location.href=API_BASE+'/api/auth/google/start';
      return {error:null};
    },
    async updateUser(){return {error:{message:'Password change must be implemented on the Railway backend before use.'}};}
  }
};
const SES_KEY='tb_session_v1';
function getSes(){try{return JSON.parse(localStorage.getItem(SES_KEY));}catch{return null;}}
function setSes(v){localStorage.setItem(SES_KEY,JSON.stringify(v));}
function delSes(){localStorage.removeItem(SES_KEY);}

// ══════════════════════════════════════
//  STATE
// ══════════════════════════════════════
let CU=null,CU_ID=null,DB={},viewDate=new Date(),tFilter='all';
let USER_PROFILE=null;
let calY=new Date().getFullYear(),calM=new Date().getMonth();
let editId=null,editDK=null;

const DEFAULT_AVATARS=[
  ['#3A86FF','#06D6A0','ST'],['#8338EC','#3A86FF','JS'],['#EF476F','#FFB703','AI'],['#06D6A0','#1F283E','DB'],['#FFB703','#3A86FF','UX'],
  ['#2A3654','#8338EC','GO'],['#EF476F','#8338EC','PY'],['#06D6A0','#FFB703','CS'],['#3A86FF','#EF476F','FE'],['#8338EC','#06D6A0','XP']
].map(([a,b,t])=>'data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="160" height="160" rx="44" fill="url(#g)"/><circle cx="80" cy="60" r="29" fill="rgba(255,255,255,.9)"/><path d="M30 144c8-36 30-54 50-54s42 18 50 54" fill="rgba(255,255,255,.9)"/><text x="80" y="151" text-anchor="middle" font-family="Arial" font-size="20" font-weight="800" fill="rgba(5,10,8,.72)">${t}</text></svg>`));
function profileCacheKey(){return CU_ID?'tb_profile_v2_'+CU_ID:'';}
function readProfileCache(){
  if(!CU_ID)return {};
  try{return JSON.parse(localStorage.getItem(profileCacheKey())||'{}');}catch{return {};}
}
function writeProfileCache(patch){
  if(!CU_ID)return;
  const next={...readProfileCache(),...patch,updated_at:new Date().toISOString()};
  try{localStorage.setItem(profileCacheKey(),JSON.stringify(next));}catch(e){}
}
function avatarValue(){return (USER_PROFILE&&USER_PROFILE.avatar_url)||readProfileCache().avatar_url||'';}
function paintAvatar(el,name,avatar){
  if(!el)return;
  const src=avatar||'';
  if(src)el.innerHTML=`<img alt="" src="${esc(src)}">`;
  else el.textContent=(name||CU||'U').trim().charAt(0).toUpperCase()||'U';
}
function applyProfileUI(profile){
  if(!profile)return;
  USER_PROFILE={...(USER_PROFILE||{}),...profile};
  CU=USER_PROFILE.name||CU||'User';
  const status=USER_PROFILE.status_message||'';
  const avatar=avatarValue();
  const first=CU.split(' ')[0]||CU;
  const hun=document.getElementById('hun');if(hun)hun.textContent=CU;
  const greet=document.getElementById('greet');if(greet)greet.textContent=first;
  const dName=document.getElementById('dName');if(dName)dName.textContent=CU;
  const pName=document.getElementById('pName');if(pName)pName.textContent=CU;
  ['hav','dAv','pAv'].forEach(id=>paintAvatar(document.getElementById(id),CU,avatar));
  const pfName=document.getElementById('pf-name');if(pfName)pfName.value=CU;
  const pfStatus=document.getElementById('pf-status');if(pfStatus)pfStatus.value=status;
}
async function syncUserProfile(patch){
  if(!CU_ID)return {error:{message:'Not signed in'}};
  const {data,error}=await supa.from('users').update(patch).eq('id',CU_ID);
  if(!error&&data){
    const row=Array.isArray(data)?data[0]:data;
    if(row)USER_PROFILE={...(USER_PROFILE||{}),...row};
  }
  return {data,error};
}

// ══════════════════════════════════════════════════════════
//  STUDY TIMER  — COMPLETELY REWRITTEN, NO BUGS
//
//  FIX 1: subjects array holds all data; intervals stored in
//          a separate Map (not on the object) so JSON
//          serialize/parse cycle never breaks anything.
//  FIX 2: renderStudyList() builds fresh HTML every time
//          but ONLY targets #studyList, never touches the
//          add-row or the header.
//  FIX 3: toggleSubjectTimer() updates DOM directly for the
//          button + time display WITHOUT calling render(),
//          so there's zero delay and no flicker.
//  FIX 4: midnight auto-reset uses Date comparison.
// ══════════════════════════════════════════════════════════
const SCOLS=['#38c9a8','#e8a838','#a87de8','#e85c5c','#e8d038','#4a9eff','#ff7b54','#b5e853','#ff54c0','#54c8ff'];
// Keys set after CU_ID is confirmed — never use placeholder
let _SK='', _SDK='';
function _initStudyKeys(){ _SK='tb_study_v3_'+CU_ID; _SDK='tb_sdate_v3_'+CU_ID; }

// intervalMap: id -> setInterval handle (never serialised)
const imap=new Map();
// subjects array: [{id,name,secs,color}]  — plain data only
let subjects=[];

/* ── persistence ── */
function studySave(){
  if(!_SK) return;
  try{
    localStorage.setItem(_SK, JSON.stringify(
      subjects.map(s=>({id:s.id,name:s.name,secs:s.secs,color:s.color}))
    ));
    localStorage.setItem(_SDK, dKey(new Date()));
  }catch(e){}
}

/* ── sync study totals to Supabase `users` row for the global leaderboard ──
   Requires columns on `users`: total_study_seconds (int), today_study_seconds (int), study_date (text 'YYYY-MM-DD') */
function lifetimeStudySeconds(){
  // Sums every day in the local history snapshot (excluding today, which is live in `subjects`)
  // so the running total never double-counts today's still-ticking seconds.
  const hist=getStudyHistory();
  const today=dKey(new Date());
  let total=0;
  Object.keys(hist).forEach(k=>{
    if(k===today) return;
    total+=Object.values(hist[k]).reduce((a,v)=>a+(v.secs||0),0);
  });
  return total+studyTotal();
}
let _lastSyncedTotal=-1;
async function syncStudyToCloud(force){
  if(!CU_ID) return;
  const todaySecs=studyTotal();
  const lifetime=lifetimeStudySeconds();
  if(force || todaySecs!==_lastSyncedTotal){
    _lastSyncedTotal=todaySecs;
    
    // Check if there is an active running timer locally
    let activeTimer = null;
    if (imap.size > 0) {
      const activeId = imap.keys().next().value;
      const rec = imap.get(activeId);
      const subj = subjects.find(s=>s.id===activeId);
      activeTimer = {
        subject_id: activeId,
        started_at: Math.floor(rec.startTs / 1000),
        subject_name: subj ? subj.name : 'Subject'
      };
    }
    
    try{
      await supa.from('users').update({
        total_study_seconds: lifetime,
        today_study_seconds: todaySecs,
        study_date: dKey(new Date()),
        study_subjects: subjects.map(s=>({id:s.id,name:s.name,secs:s.secs,color:s.color})),
        study_timer: activeTimer
      }).eq('id',CU_ID);
    }catch(e){ /* non-fatal — leaderboard/resume just show stale data until next sync */ }
  }
  syncHistoryToCloud(); // keep the day-by-day Insights history in sync too
}
/* ── push today's finished/in-progress daily snapshot to `study_history` for cross-device Insights ── */
async function syncHistoryToCloud(){
  if(!CU_ID) return;
  const hist=getStudyHistory();
  const today=dKey(new Date());
  const snap=hist[today];
  if(!snap||!Object.keys(snap).length) return;
  const totalSecs=Object.values(snap).reduce((a,v)=>a+(v.secs||0),0);
  try{
    await supa.from('study_history').upsert({
      user_id:String(CU_ID),
      date:today,
      subjects:snap,
      total_secs:totalSecs,
      updated_at:new Date().toISOString()
    },{onConflict:'user_id,date'});
  }catch(e){ /* non-fatal — Insights falls back to whatever is cached locally */ }
}
/* ── on login, pull cloud history + any in-progress cross-device session into local cache ── */
async function hydrateStudyFromCloud(){
  if(!CU_ID) return;
  try{
    const {data:histRows}=await supa.from('study_history').select('date,subjects').eq('user_id',String(CU_ID));
    if(histRows&&histRows.length){
      const localHist=getStudyHistory();
      histRows.forEach(r=>{
        if(!localHist[r.date]) localHist[r.date]=r.subjects||{};
      });
      try{ localStorage.setItem('tb_study_hist_'+CU_ID, JSON.stringify(localHist)); }catch(e){}
    }
    const {data:u}=await supa.from('users').select('study_subjects,study_date,study_timer').eq('id',CU_ID).maybeSingle();
    const today = dKey(new Date());
    
    if (u && u.study_date === today && Array.isArray(u.study_subjects) && u.study_subjects.length) {
      const cloudTotal = u.study_subjects.reduce((a,s)=>a+(s.secs||0),0);
      const localTotal = subjects.reduce((a,s)=>a+(s.secs||0),0);
      
      // If cloud seconds differ, or if there's an active timer in cloud, or local is empty, sync from cloud
      if (cloudTotal !== localTotal || u.study_timer || subjects.length === 0) {
        // Clear local intervals first
        imap.forEach((rec)=>{
          clearInterval(rec.handle);
        });
        imap.clear();
        
        subjects = u.study_subjects.map(s=>({id:s.id,name:s.name||'Subject',secs:s.secs||0,color:s.color||'#38c9a8'}));
        studySave();
        
        // If there's an active timer in the cloud, resume ticking locally
        if (u.study_timer && u.study_timer.subject_id) {
          const sid = Number(u.study_timer.subject_id);
          const subj = subjects.find(s=>s.id===sid);
          if (subj) {
            const startTs = u.study_timer.started_at * 1000;
            const baseSecs = subj.secs;
            const iv = setInterval(()=>{
              subj.secs = baseSecs + Math.floor((Date.now() - startTs)/1000);
              const tel = document.getElementById('stm_'+sid);
              if(tel) tel.textContent = studyFmt(subj.secs);
              const maxSecs = Math.max(...subjects.map(s=>s.secs),1);
              subjects.forEach(s=>{
                const pb = document.getElementById('spb_'+s.id);
                if(pb) pb.style.width = Math.round((s.secs/maxSecs)*100)+'%';
              });
              studyUpdateTotal();
              updateFocusScore();
              if(subj.secs%30===0) studySave();
            },1000);
            imap.set(sid, {handle:iv, startTs, baseSecs});
          }
        }
        renderStudyList();
        studyUpdateTotal();
      }
    }
  }catch(e){ console.error('cloud history hydrate failed',e); }
}
function studyLoad(){
  if(!_SK) return;
  try{
    const savedDate=localStorage.getItem(_SDK);
    const today=dKey(new Date());
    const raw=localStorage.getItem(_SK);
    if(raw){
      const parsed=JSON.parse(raw);
      const isNewDay=savedDate && savedDate!==today;
      subjects=parsed.map(s=>({
        id:s.id,
        name:s.name||'Subject',
        secs:isNewDay?0:(s.secs||0),
        color:s.color||'#38c9a8'
      }));
    } else {
      subjects=[];
    }
  }catch(e){ subjects=[]; }
  imap.clear();
  studySave(); // stamp today
}

/* ── total ── */
function studyTotal(){return subjects.reduce((a,s)=>a+s.secs,0);}
function studyTotalStr(){
  const t=studyTotal();
  const h=Math.floor(t/3600),m=Math.floor((t%3600)/60);
  return `${h}h ${String(m).padStart(2,'0')}m`;
}
function studyUpdateTotal(){
  const el=document.getElementById('studyTotalDisplay');
  if(el) el.textContent=studyTotalStr();
}
function studyFmt(s){
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60;
  if(h>0) return `${h}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
}

/* ── add subject UI ── */
function openAddSubject(){
  if(subjects.length>=10){toast('⚠️','Max 10 subjects allowed!','err');return;}
  document.getElementById('studyAddRow').classList.add('open');
  const inp=document.getElementById('studyNewName');
  inp.value='';
  inp.focus();
}
function cancelAddSubject(){
  document.getElementById('studyAddRow').classList.remove('open');
}
function confirmAddSubject(){
  const inp=document.getElementById('studyNewName');
  const name=inp.value.trim();
  if(!name){toast('⚠️','Enter a subject name!','err');inp.focus();return;}
  if(subjects.length>=10){toast('⚠️','Max 10 subjects!','err');return;}
  const id=Date.now();
  subjects.push({id,name,secs:0,color:SCOLS[subjects.length%SCOLS.length]});
  studySave();
  cancelAddSubject();
  // Append new card directly — no full re-render needed
  renderStudyList();
  toast('📚','Subject added!','suc');
}

/* ── toggle timer ── */
function toggleSubjectTimer(id){
  const subj=subjects.find(s=>s.id===id);
  if(!subj) return;
  const running=imap.has(id);

  if(running){
    // PAUSE — commit real elapsed time (guards against throttled/background tabs) before stopping
    const rec=imap.get(id);
    subj.secs=_liveSecs(rec,subj);
    clearInterval(rec.handle);
    imap.delete(id);
    studySave();
    _updateSubjCard(id,false);
    syncStudyToCloud(true);
  } else {
    // Stop any other running subject first (also commits its real elapsed time)
    imap.forEach((rec,oid)=>{
      const other=subjects.find(s=>s.id===oid);
      if(other) other.secs=_liveSecs(rec,other);
      clearInterval(rec.handle);
      imap.delete(oid);
      _updateSubjCard(oid,false);
    });
    // START this one — track wall-clock start time + base seconds so drift from
    // tab throttling/backgrounding never desyncs the displayed vs. saved time.
    const baseSecs=subj.secs, startTs=Date.now();
    const iv=setInterval(()=>{
      subj.secs=baseSecs+Math.floor((Date.now()-startTs)/1000);
      // Update only the time display element — no re-render
      const tel=document.getElementById('stm_'+id);
      if(tel) tel.textContent=studyFmt(subj.secs);
      // Update progress bar
      const maxSecs=Math.max(...subjects.map(s=>s.secs),1);
      subjects.forEach(s=>{
        const pb=document.getElementById('spb_'+s.id);
        if(pb) pb.style.width=Math.round((s.secs/maxSecs)*100)+'%';
      });
      studyUpdateTotal();
      updateFocusScore();
      // Save every 30s
      if(subj.secs%30===0) studySave();
    },1000);
    imap.set(id,{handle:iv,startTs,baseSecs});
    _updateSubjCard(id,true);
    syncStudyToCloud(true);
  }
}
/* real elapsed seconds for a running subject, computed from wall-clock time not tick count */
function _liveSecs(rec,subj){
  if(!rec) return subj.secs;
  return rec.baseSecs+Math.floor((Date.now()-rec.startTs)/1000);
}

/* update a single card's visual state without re-rendering */
function _updateSubjCard(id,running){
  const row=document.getElementById('srow_'+id);
  const btn=document.getElementById('sbtn_'+id);
  const tel=document.getElementById('stm_'+id);
  const subj=subjects.find(s=>s.id===id);
  if(!row||!btn||!tel||!subj) return;
  if(running){
    row.classList.add('is-running');
    btn.innerHTML='⏸';
    btn.classList.add('on');
    tel.classList.add('running');
  } else {
    row.classList.remove('is-running');
    btn.innerHTML='▶';
    btn.classList.remove('on');
    tel.classList.remove('running');
  }
}

/* ── reset one subject ── */
function resetSubjectTimer(id){
  if(imap.has(id)){clearInterval(imap.get(id).handle);imap.delete(id);}
  const subj=subjects.find(s=>s.id===id);
  if(!subj) return;
  subj.secs=0;
  studySave();
  const tel=document.getElementById('stm_'+id);
  if(tel) tel.textContent=studyFmt(0);
  const pb=document.getElementById('spb_'+id);
  if(pb) pb.style.width='0%';
  _updateSubjCard(id,false);
  studyUpdateTotal();
}

/* ── delete subject ── */
function deleteSubject(id){
  if(imap.has(id)){clearInterval(imap.get(id).handle);imap.delete(id);}
  subjects=subjects.filter(s=>s.id!==id);
  studySave();
  // Remove just that card from DOM
  const row=document.getElementById('srow_'+id);
  if(row) row.parentElement.remove(); // remove wrapper div
  // If empty, show message
  const list=document.getElementById('studyList');
  if(list&&subjects.length===0){
    list.innerHTML='<div class="study-empty-msg">No subjects yet. Add one to start tracking! 📖</div>';
  }
  studyUpdateTotal();
}

/* ── rename ── */
function renameSubject(id,val){
  const subj=subjects.find(s=>s.id===id);
  if(subj){subj.name=val.trim()||subj.name;studySave();}
}

/* ── reset all ── */
function resetAllStudy(){
  if(!confirm('Reset all study timers to 0?')) return;
  imap.forEach(rec=>clearInterval(rec.handle));
  imap.clear();
  subjects.forEach(s=>s.secs=0);
  studySave();
  renderStudyList();
  studyUpdateTotal();
  toast('↺','All timers reset.','inf');
}

/* ── RENDER — builds full list, called only on load/reset/delete-all ── */
function renderStudyList(){
  const list=document.getElementById('studyList');
  if(!list) return;
  if(subjects.length===0){
    list.innerHTML='<div class="study-empty-msg">No subjects yet. Add one to start tracking! 📖</div>';
    studyUpdateTotal();
    return;
  }
  const maxSecs=Math.max(...subjects.map(s=>s.secs),1);
  list.innerHTML=subjects.map(s=>{
    const pct=Math.round((s.secs/maxSecs)*100);
    const running=imap.has(s.id);
    return `<div style="padding:0 20px 0;margin-bottom:9px">
      <div class="subj-row ${running?'is-running':''}" id="srow_${s.id}">
        <div class="subj-color-bar" style="background:${s.color}"></div>
        <div class="subj-name-wrap">
          <input class="subj-name-inp" value="${esc(s.name)}" placeholder="Subject"
            onblur="renameSubject(${s.id},this.value)"
            onkeydown="if(event.key==='Enter')this.blur()"
            maxlength="36" title="Click to rename"/>
          <div class="subj-name-hint">Click to rename</div>
        </div>
        <div class="subj-time-display ${running?'running':''}" id="stm_${s.id}">${studyFmt(s.secs)}</div>
        <div class="subj-controls">
          <button class="s-btn play ${running?'on':''}" id="sbtn_${s.id}"
            onclick="toggleSubjectTimer(${s.id})">${running?'⏸':'▶'}</button>
          <button class="s-btn rst" onclick="resetSubjectTimer(${s.id})" title="Reset">↺</button>
          <button class="s-btn del" onclick="deleteSubject(${s.id})" title="Remove">✕</button>
        </div>
      </div>
      <div class="subj-prog-wrap" style="margin:0 0 0 0">
        <div class="subj-prog-fill" id="spb_${s.id}" style="width:${pct}%;background:${s.color}"></div>
      </div>
    </div>`;
  }).join('');
  studyUpdateTotal();
}

// ══════════════════════════════════════
//  POMODORO
// ══════════════════════════════════════
let pomState='idle',pomLeft=25*60,pomTotalMin=25,pomIv=null,pomSessCount=0,pomFocusSecs=0,pomStartSecs=0;
function setPomDur(mins,btn){
  if(pomState==='running') return;
  pomTotalMin=mins; pomLeft=mins*60;
  updatePomDisplay();
  document.querySelectorAll('.pom-dur-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('pomProgFill').style.width='100%';
}
function togglePom(){
  if(pomState==='idle'||pomState==='done'){
    pomLeft=pomTotalMin*60; pomStartSecs=pomLeft; pomState='running';
    document.getElementById('pomBtn').textContent='⏸ Pause';
    document.getElementById('pomStatusChip').style.display='flex';
    pomIv=setInterval(pomTick,1000);
  } else if(pomState==='running'){
    clearInterval(pomIv); pomState='paused';
    document.getElementById('pomBtn').textContent='▶ Resume';
    document.getElementById('pomStatusChip').style.display='none';
  } else if(pomState==='paused'){
    pomState='running';
    document.getElementById('pomBtn').textContent='⏸ Pause';
    document.getElementById('pomStatusChip').style.display='flex';
    pomIv=setInterval(pomTick,1000);
  }
}
function pomTick(){
  pomLeft--; pomFocusSecs++;
  updatePomDisplay();
  document.getElementById('pomProgFill').style.width=((pomLeft/pomStartSecs)*100)+'%';
  if(pomLeft<=0){
    clearInterval(pomIv); pomState='done'; pomSessCount++;
    document.getElementById('pomBtn').textContent='🔄 Restart';
    document.getElementById('pomSessions').textContent=pomSessCount;
    document.getElementById('pomStatusChip').style.display='none';
    const m=Math.floor(pomFocusSecs/60),h=Math.floor(m/60),r=m%60;
    document.getElementById('pomTotalFocus').textContent=h>0?`${h}h ${r}m`:`${m}m`;
    toast('🍅','Pomodoro complete! Great work! 🎉','suc');
  }
}
function resetPom(){
  clearInterval(pomIv); pomState='idle'; pomLeft=pomTotalMin*60;
  updatePomDisplay();
  document.getElementById('pomBtn').textContent='▶ Start';
  document.getElementById('pomProgFill').style.width='100%';
  document.getElementById('pomStatusChip').style.display='none';
}
function updatePomDisplay(){
  const m=Math.floor(pomLeft/60),s=pomLeft%60;
  document.getElementById('pomTime').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ══════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════
function dKey(d){const dt=d instanceof Date?d:new Date(d);return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;}
function tKey(){return dKey(new Date());}
function fmtT(s){if(!s)return '';const[h,m]=s.split(':');const hr=parseInt(h);return `${hr%12||12}:${m} ${hr<12?'AM':'PM'}`;}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function getDay(dk){return Array.isArray(DB[dk])?DB[dk]:[];}
function hideLoader(){const el=document.getElementById('loading-screen');if(el){el.classList.add('hide');setTimeout(()=>el.style.display='none',500);}}
function showLoader(msg){const el=document.getElementById('loading-screen');if(el){el.style.display='flex';el.classList.remove('hide');const m=document.getElementById('load-msg');if(m)m.textContent=msg||'Loading…';}}

// ══════════════════════════════════════
//  AUTH
// ══════════════════════════════════════
// hashPass is kept ONLY to verify old name+password_hash accounts during
// the one-time migration flow below — it is never used for the new login.
async function hashPass(p){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(p));return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');}

async function doGoogleSignIn(){
  showLoader('Redirecting to Google…');
  const {error}=await supa.auth.signInWithOAuth({
    provider:'google',
    options:{ redirectTo: window.location.origin + window.location.pathname }
  });
  if(error){ hideLoader(); showErr('li-err','Google sign-in error: '+error.message); }
  // On success the browser navigates away to Google, then back — _boot() picks up the session on return.
}

async function doTelegramSignIn(){
  showLoader('Redirecting to Telegram…');
  const {error}=await supa.auth.signInWithOAuth({
    provider:'telegram'
  });
  if(error){ hideLoader(); showErr('li-err','Telegram sign-in error: '+error.message); }
}

async function doSignup(){
  const n=document.getElementById('su-n').value.trim();
  const email=document.getElementById('su-e').value.trim();
  const p=document.getElementById('su-p').value;
  const p2=document.getElementById('su-p2').value;
  if(!n){showErr('su-err','Enter your name.');return;}
  if(!email){showErr('su-err','Enter your email.');return;}
  if(p.length<6){showErr('su-err','Password needs min 6 chars.');return;}
  if(p!==p2){showErr('su-err','Passwords do not match.');return;}
  showLoader('Creating account…');
  const {data:authData,error:authErr}=await supa.auth.signUp({email,password:p});
  if(authErr){hideLoader();showErr('su-err','Error: '+authErr.message);return;}
  if(!authData.session){
    // Email confirmation is required by the project's Auth settings — profile
    // row gets created on first successful login instead (see doLogin()).
    hideLoader();
    showOk('su-ok','✓ Check your email to confirm your account, then sign in.');
    pendingProfileName=n; // used to create the profile row right after confirmation+first login
    try{localStorage.setItem('tb_pending_name',n);}catch(e){}
    return;
  }
  const {error:insErr}=await supa.from('users').insert({name:n,email,auth_id:authData.user.id});
  hideLoader();
  if(insErr){
    if(insErr.message&&insErr.message.toLowerCase().includes('duplicate')) showErr('su-err','That name is already taken — pick another.');
    else showErr('su-err','Account created but profile setup failed: '+insErr.message);
    return;
  }
  showOk('su-ok','✓ Account created! Signing you in…');
  setTimeout(()=>launchApp(),600);
}

async function doLogin(){
  const email=document.getElementById('li-e').value.trim();
  const p=document.getElementById('li-p').value;
  if(!email||!p){showErr('li-err','Please fill in all fields.');return;}
  showLoader('Signing in…');
  const {data,error}=await supa.auth.signInWithPassword({email,password:p});
  if(error||!data.session){hideLoader();showErr('li-err','Wrong email or password.');return;}
  await launchApp();
}

function doLogout(){
  imap.forEach(rec=>clearInterval(rec.handle));imap.clear();
  clearInterval(pomIv);
  studySave();
  saveStudyHistory(); // save final snapshot before logout
  syncStudyToCloud(true); // push final totals so the leaderboard reflects this session
  supa.auth.signOut();
  CU=null;CU_ID=null;DB={};subjects=[];_SK='';_SDK='';
  document.getElementById('app').classList.remove('visible');
  document.getElementById('auth').classList.add('visible');
  document.getElementById('li-e').value='';
  document.getElementById('li-p').value='';
}

let pendingProfileName=null;
/* fetch (or, for a just-confirmed signup / first OAuth login, create) this auth user's `users` profile row */
async function loadOrCreateProfile(authUser){
  let {data:profile}=await supa.from('users').select('*').eq('auth_id',authUser.id).maybeSingle();
  if(!profile){
    const meta=authUser.user_metadata||{};
    let name=pendingProfileName||localStorage.getItem('tb_pending_name')||meta.full_name||meta.name||(authUser.email?authUser.email.split('@')[0]:'User');
    // Google sign-ins carry the person's Google account photo inside
    // user_metadata (as "avatar_url" or "picture" depending on provider
    // version) — reuse it so their TaskBoard avatar matches automatically.
    const googleAvatar=meta.avatar_url||meta.picture||'';
    // `name` has a unique constraint — Google sign-ins don't let the person pick one up
    // front, so on a collision retry with a short random suffix instead of failing.
    let created=null,error=null;
    for(let attempt=0;attempt<5;attempt++){
      const tryName=attempt===0?name:`${name}${Math.floor(1000+Math.random()*9000)}`;
      const insertPayload={name:tryName,email:authUser.email,auth_id:authUser.id};
      if(googleAvatar)insertPayload.avatar_url=googleAvatar;
      const res=await supa.from('users').insert(insertPayload).select().single();
      if(!res.error){ created=res.data; error=null; break; }
      error=res.error;
      if(!(error.message&&error.message.toLowerCase().includes('duplicate'))) break; // some other error — stop retrying
    }
    if(!created){ toast('⚠️','Could not finish account setup: '+(error?.message||'unknown error'),'err'); return null; }
    profile=created;
    try{localStorage.removeItem('tb_pending_name');}catch(e){}
  }else if(!profile.avatar_url){
    // Existing account with no avatar set yet — if this is a Google sign-in,
    // backfill it from their Google photo (best-effort, doesn't block boot).
    const meta=authUser.user_metadata||{};
    const googleAvatar=meta.avatar_url||meta.picture||'';
    if(googleAvatar){
      supa.from('users').update({avatar_url:googleAvatar}).eq('auth_id',authUser.id).then(({data:row})=>{
        if(row)profile.avatar_url=row.avatar_url||googleAvatar;
      }).catch(()=>{});
      profile={...profile,avatar_url:googleAvatar};
    }
  }
  return profile;
}

async function launchApp(){
  showLoader('Fetching your data…');
  const {data:sessionData}=await supa.auth.getSession();
  const authUser=sessionData?.session?.user;
  if(!authUser){ hideLoader(); document.getElementById('auth').classList.add('visible'); return; }
  const pendingClaimId=localStorage.getItem('tb_pending_claim_id');
  if(pendingClaimId){
    try{ await supa.rpc('claim_legacy_account',{p_legacy_id:pendingClaimId}); }catch(e){}
    try{ localStorage.removeItem('tb_pending_claim_id'); }catch(e){}
  }
  const profile=await loadOrCreateProfile(authUser);
  if(!profile){ hideLoader(); return; }
  CU=profile.name; CU_ID=profile.id; USER_PROFILE=profile;
  const cachedProfile=readProfileCache();
  if(cachedProfile&&Object.keys(cachedProfile).length)applyProfileUI({...profile,...cachedProfile});
  try{
    const {data:tasks,error:te}=await supa.from('tasks').select('*').eq('user_id',CU_ID).order('created_at',{ascending:false});
    if(te) throw te;
    DB={};
    (tasks||[]).forEach(t=>{
      const dk=t.date||tKey();
      if(!DB[dk])DB[dk]=[];
      DB[dk].push({id:t.id,title:t.title,desc:t.description||'',category:t.category||'other',priority:t.priority||'normal',date:t.date||tKey(),time:t.time||'',done:t.done||false,pinned:t.pinned||false,subtasks:t.subtasks||[],doneAt:t.done_at||null,owner:CU,createdAt:t.created_at});
    });
    const {data:qn}=await supa.from('quick_notes').select('content').eq('user_id',CU_ID).maybeSingle();
    if(qn&&document.getElementById('qNote'))document.getElementById('qNote').value=qn.content||'';
  }catch(e){console.error(e);toast('⚠️','Error loading data','err');}
  hideLoader();
  document.getElementById('auth').classList.remove('visible');
  document.getElementById('app').classList.add('visible');
  applyProfileUI(USER_PROFILE);
  writeProfileCache({name:USER_PROFILE.name,status_message:USER_PROFILE.status_message||'',avatar_url:USER_PROFILE.avatar_url||avatarValue()});
  // Update drawer user info
  const de=document.getElementById('t-date');if(de)de.value=tKey();
  viewDate=new Date();tFilter='all';
  // Init study storage keys for this specific user, then load
  _initStudyKeys();
  studyLoad();
  await hydrateStudyFromCloud(); // pull day-history + any in-progress session from another device
  renderStudyList();
  showPage('tasks',document.querySelector('[data-p=tasks]'));
}

// BOOT
async function _boot(){
  showLoader('Checking session…');
  let data;
  try{
    ({data}=await supa.auth.getSession());
  }catch(e){
    // Never let a boot-time error (bad/expired token, network hiccup, etc.)
    // leave the app stuck on the loader — fall back to the login screen.
    console.error(e);
    delApiSession();
    data=null;
  }
  if(data?.session?.user){
    try{
      await launchApp();
      return;
    }catch(e){
      console.error(e);
      delApiSession();
      hideLoader();
    }
  }
  hideLoader();
  document.getElementById('auth').classList.add('visible');
  _setupKeys();
}
// Keep the app in sync if the Supabase session changes in another tab, OAuth redirect completes, expires, etc.
let _authHandled=false;
supa.auth.onAuthStateChange((event)=>{
  if(event==='SIGNED_OUT'&&document.getElementById('app').classList.contains('visible')){
    doLogout();
  }
  if(event==='SIGNED_IN'&&!document.getElementById('app').classList.contains('visible')&&!_authHandled){
    _authHandled=true;
    launchApp().finally(()=>{_authHandled=false;});
  }
});
function _setupKeys(){
  document.getElementById('li-e')?.addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
  document.getElementById('li-p')?.addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
  document.getElementById('su-n')?.addEventListener('keydown',e=>{if(e.key==='Enter')doSignup();});
  document.getElementById('su-e')?.addEventListener('keydown',e=>{if(e.key==='Enter')doSignup();});
  document.getElementById('su-p')?.addEventListener('keydown',e=>{if(e.key==='Enter')doSignup();});
  document.getElementById('su-p2')?.addEventListener('keydown',e=>{if(e.key==='Enter')doSignup();});
  document.getElementById('mg-n')?.addEventListener('keydown',e=>{if(e.key==='Enter')mgVerify();});
  document.getElementById('mg-op')?.addEventListener('keydown',e=>{if(e.key==='Enter')mgVerify();});
  document.getElementById('mg-e')?.addEventListener('keydown',e=>{if(e.key==='Enter')mgFinish();});
  document.getElementById('mg-np')?.addEventListener('keydown',e=>{if(e.key==='Enter')mgFinish();});
  document.getElementById('t-title')?.addEventListener('keydown',e=>{if(e.key==='Enter')addTask();});
  document.getElementById('studyNewName')?.addEventListener('keydown',e=>{
    if(e.key==='Enter')confirmAddSubject();
    if(e.key==='Escape')cancelAddSubject();
  });
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',_boot);}else{_boot();}

// ══════════════════════════════════════
//  ONE-TIME LEGACY ACCOUNT MIGRATION
//  (old name+password_hash accounts → real email login)
// ══════════════════════════════════════
let _mgLegacyId=null;
async function mgVerify(){
  const n=document.getElementById('mg-n').value.trim();
  const op=document.getElementById('mg-op').value;
  if(!n||!op){showErr('mg-err','Enter your old name and password.');return;}
  showLoader('Checking your old account…');
  const hashed=await hashPass(op);
  const {data,error}=await supa.rpc('verify_legacy_login',{p_name:n,p_password_hash:hashed});
  hideLoader();
  if(error){showErr('mg-err','Error: '+error.message);return;}
  const row=Array.isArray(data)?data[0]:data;
  if(!row){showErr('mg-err','Wrong old name or password.');return;}
  if(row.already_claimed){showErr('mg-err','This account is already upgraded — just sign in with its email.');return;}
  _mgLegacyId=row.id;
  document.getElementById('mg-step1').style.display='none';
  document.getElementById('mg-step2').style.display='block';
}
async function mgFinish(){
  const email=document.getElementById('mg-e').value.trim();
  const np=document.getElementById('mg-np').value;
  if(!email){showErr('mg-err2','Enter an email.');return;}
  if(np.length<6){showErr('mg-err2','Password needs min 6 chars.');return;}
  if(!_mgLegacyId){showErr('mg-err2','Something went wrong — please restart this step.');return;}
  showLoader('Upgrading your account…');
  const {data:authData,error:authErr}=await supa.auth.signUp({email,password:np});
  if(authErr){hideLoader();showErr('mg-err2','Error: '+authErr.message);return;}
  if(!authData.session){
    hideLoader();
    // No active session yet (email confirmation required) — finish the claim on first login instead
    try{localStorage.setItem('tb_pending_claim_id',String(_mgLegacyId));}catch(e){}
    showOk('mg-ok','✓ Check your email to confirm, then sign in to finish the upgrade.');
    return;
  }
  const {error:claimErr}=await supa.rpc('claim_legacy_account',{p_legacy_id:_mgLegacyId});
  hideLoader();
  if(claimErr){showErr('mg-err2','Error linking account: '+claimErr.message);return;}
  showOk('mg-ok','✓ Account upgraded! Signing you in…');
  setTimeout(()=>launchApp(),600);
}

// ══════════════════════════════════════
//  AUTH UI
// ══════════════════════════════════════
function swTab(t){
  document.getElementById('li-form').style.display=t==='li'?'block':'none';
  document.getElementById('su-form').style.display=t==='su'?'block':'none';
  document.getElementById('mg-form').style.display=t==='mg'?'block':'none';
  document.querySelectorAll('.tab').forEach((b,i)=>b.classList.toggle('on',(t==='li'&&i===0)||(t==='su'&&i===1)));
}
function showErr(id,msg){const e=document.getElementById(id);e.textContent=msg;e.style.display='block';setTimeout(()=>e.style.display='none',4000);}
function showOk(id,msg){const e=document.getElementById(id);e.textContent=msg;e.style.display='block';setTimeout(()=>e.style.display='none',4000);}

// ══════════════════════════════════════
//  PAGE NAV
// ══════════════════════════════════════
function showPage(p,btn){
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('on'));
  document.querySelectorAll('.ntab').forEach(x=>x.classList.remove('on'));
  const pg=document.getElementById('page-'+p);if(pg)pg.classList.add('on');
  if(btn)btn.classList.add('on');
  _setDrawerActive(p);
  if(p==='tasks'){updateDateNav();render();}
  if(p==='graphs')buildGraphs();
  if(p==='calendar')renderCal();
  if(p==='analytics')renderAnalytics();
  if(p==='profile')renderProfile();
  if(p==='leaderboard')renderLeaderboard();
  if(p==='insights'){ saveStudyHistory(); renderInsights(); }
}

// DATE NAV
function changeDate(d){viewDate=new Date(viewDate);viewDate.setDate(viewDate.getDate()+d);updateDateNav();render();}
function goToday(){viewDate=new Date();updateDateNav();render();}
function updateDateNav(){
  const dk=dKey(viewDate),tk=tKey();
  document.getElementById('dn-lbl').textContent=viewDate.toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  document.getElementById('dn-sub').textContent=dk===tk?'Today':dk<tk?'Past':'Upcoming';
  document.getElementById('today-lbl').textContent=dk===tk?`Here's your board for today.`:`Viewing: ${viewDate.toLocaleDateString('en-IN',{month:'short',day:'numeric',year:'numeric'})}`;
}

// TASKS CRUD
async function addTask(){
  const title=document.getElementById('t-title').value.trim();
  if(!title){toast('⚠️','Enter a task title!','err');return;}
  const dk=document.getElementById('t-date').value||tKey();
  const rawDesc=document.getElementById('t-desc').value.trim();
  const lines=rawDesc.split('\n');
  const subtasks=lines.filter(l=>l.trim().startsWith('-')).map(l=>({text:l.trim().slice(1).trim(),done:false}));
  const plainDesc=lines.filter(l=>!l.trim().startsWith('-')).join('\n').trim();
  const payload={user_id:CU_ID,title,description:plainDesc,category:document.getElementById('t-cat').value,priority:document.getElementById('t-pri').value,date:dk,time:document.getElementById('t-time').value||null,subtasks,done:false,pinned:false};
  const {data:task,error}=await supa.from('tasks').insert(payload).select().single();
  if(error){toast('⚠️','Save failed: '+error.message,'err');return;}
  if(!DB[dk])DB[dk]=[];
  DB[dk].unshift({id:task.id,title,desc:plainDesc,category:payload.category,priority:payload.priority,date:dk,time:payload.time||'',done:false,pinned:false,subtasks,doneAt:null,owner:CU,createdAt:task.created_at});
  document.getElementById('t-title').value='';document.getElementById('t-desc').value='';document.getElementById('t-time').value='';
  render();updateStats();toast('✓','Task saved to cloud!','suc');
}
async function toggleDone(id){
  const dk=dKey(viewDate),tasks=getDay(dk),t=tasks.find(x=>x.id===id);
  if(!t)return;
  const nd=!t.done;
  await supa.from('tasks').update({done:nd,done_at:nd?new Date().toISOString():null}).eq('id',id);
  t.done=nd;t.doneAt=nd?new Date().toISOString():null;
  render();toast(nd?'🎉':'↩',nd?'Done!':'Pending.','suc');
}
async function togglePin(id){
  const dk=dKey(viewDate),tasks=getDay(dk),t=tasks.find(x=>x.id===id);
  if(!t)return;
  const np=!t.pinned;
  await supa.from('tasks').update({pinned:np}).eq('id',id);
  t.pinned=np;render();toast(np?'📌':'—',np?'Pinned':'Unpinned','inf');
}
async function delTask(id){
  if(!confirm('Delete this task?'))return;
  const dk=dKey(viewDate);
  await supa.from('tasks').delete().eq('id',id);
  DB[dk]=getDay(dk).filter(x=>x.id!==id);
  render();toast('🗑','Deleted.','err');
}
async function toggleSub(tid,idx){
  const dk=dKey(viewDate),tasks=getDay(dk),t=tasks.find(x=>x.id===tid);
  if(!t||!t.subtasks)return;
  t.subtasks[idx].done=!t.subtasks[idx].done;
  await supa.from('tasks').update({subtasks:t.subtasks}).eq('id',tid);
  render();
}
function openEdit(id){
  const dk=dKey(viewDate),t=getDay(dk).find(x=>x.id===id);
  if(!t)return;
  editId=id;editDK=dk;
  document.getElementById('e-title').value=t.title;
  document.getElementById('e-desc').value=t.desc||'';
  document.getElementById('e-cat').value=t.category||'other';
  document.getElementById('e-pri').value=t.priority||'normal';
  document.getElementById('editModal').classList.add('open');
}
function closeEdit(){document.getElementById('editModal').classList.remove('open');editId=null;}
async function saveEdit(){
  if(!editId)return;
  const tasks=getDay(editDK),t=tasks.find(x=>x.id===editId);
  if(!t)return;
  const nT=document.getElementById('e-title').value.trim()||t.title;
  const nD=document.getElementById('e-desc').value.trim();
  const nC=document.getElementById('e-cat').value;
  const nP=document.getElementById('e-pri').value;
  await supa.from('tasks').update({title:nT,description:nD,category:nC,priority:nP}).eq('id',editId);
  t.title=nT;t.desc=nD;t.category=nC;t.priority=nP;
  closeEdit();render();toast('✓','Updated!','suc');
}
async function saveQNote(){
  const content=document.getElementById('qNote').value;
  const {data:ex}=await supa.from('quick_notes').select('id').eq('user_id',CU_ID).maybeSingle();
  if(ex){await supa.from('quick_notes').update({content,updated_at:new Date().toISOString()}).eq('user_id',CU_ID);}
  else{await supa.from('quick_notes').insert({user_id:CU_ID,content});}
  toast('✓','Note saved!','suc');
}
async function changePassword(){
  const old=document.getElementById('pw-old').value;
  const nw=document.getElementById('pw-new').value;
  const nw2=document.getElementById('pw-c').value;
  if(nw.length<6){toast('⚠️','Min 6 characters','err');return;}
  if(nw!==nw2){toast('⚠️','Passwords do not match','err');return;}
  const {data:sessionData}=await supa.auth.getSession();
  const email=sessionData?.session?.user?.email;
  if(!email){toast('⚠️','Session expired — please sign in again','err');return;}
  // Re-authenticate with the current password before allowing the change
  const {error:reAuthErr}=await supa.auth.signInWithPassword({email,password:old});
  if(reAuthErr){toast('⚠️','Wrong current password','err');return;}
  const {error}=await supa.auth.updateUser({password:nw});
  if(error){toast('⚠️','Error: '+error.message,'err');return;}
  document.getElementById('pwForm').classList.remove('open');
  ['pw-old','pw-new','pw-c'].forEach(id=>document.getElementById(id).value='');
  toast('✓','Password updated!','suc');
}
function togglePwForm(){document.getElementById('pwForm').classList.toggle('open');}
async function saveProfilePrefs(){
  if(!CU_ID){toast('⚠️','Please sign in first','err');return;}
  const name=(document.getElementById('pf-name')?.value||'').trim()||CU||'User';
  const status=(document.getElementById('pf-status')?.value||'').trim();
  const patch={name,status_message:status,avatar_url:avatarValue()};
  CU=name;
  USER_PROFILE={...(USER_PROFILE||{}),...patch};
  writeProfileCache(patch);
  Object.values(DB).flat().forEach(t=>{if(t.owner!==CU)t.owner=name;});
  applyProfileUI(USER_PROFILE);
  const {error}=await syncUserProfile(patch);
  if(error)toast('⚠️','Saved locally. Cloud sync failed: '+error.message,'err');
  else toast('✓','Profile saved permanently!','suc');
}
function initAvatarChoices(){
  const box=document.getElementById('avatarChoices');
  if(!box||box.dataset.ready)return;
  box.innerHTML=DEFAULT_AVATARS.map(src=>`<button class="avatar-choice" onclick="setAvatar('${src.replace(/'/g,'%27')}')" type="button"><img alt="" src="${src}"></button>`).join('');
  box.dataset.ready='1';
}
function openAvatarModal(ev){
  if(ev){ev.preventDefault();ev.stopPropagation();}
  initAvatarChoices();
  const inp=document.getElementById('avatarUrl');
  if(inp)inp.value=avatarValue()&&!avatarValue().startsWith('data:')?avatarValue():'';
  document.getElementById('avatarModal')?.classList.add('open');
}
function closeAvatarModal(){document.getElementById('avatarModal')?.classList.remove('open');}
async function setAvatar(src){
  if(!src||!CU_ID)return;
  const patch={avatar_url:src};
  USER_PROFILE={...(USER_PROFILE||{}),...patch};
  writeProfileCache(patch);
  applyProfileUI(USER_PROFILE);
  closeAvatarModal();
  const {error}=await syncUserProfile(patch);
  if(error)toast('⚠️','Avatar saved locally. Cloud sync failed.','err');
  else toast('✓','Profile picture saved!','suc');
}
function saveAvatarUrl(){
  const url=(document.getElementById('avatarUrl')?.value||'').trim();
  if(!url){toast('⚠️','Paste an image URL first','err');return;}
  setAvatar(url);
}
function compressAvatarFile(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(reader.error);
    reader.onload=()=>{
      const img=new Image();
      img.onerror=reject;
      img.onload=()=>{
        const max=160,scale=Math.min(max/img.width,max/img.height,1);
        const w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale));
        const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
        const ctx=canvas.getContext('2d',{alpha:false});
        ctx.fillStyle='#111520';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL('image/jpeg',0.82));
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}
async function handleAvatarFile(ev){
  const file=ev.target.files&&ev.target.files[0];
  if(!file)return;
  try{await setAvatar(await compressAvatarFile(file));}
  catch(e){toast('⚠️','Could not process that image','err');}
  ev.target.value='';
}
async function clearMyData(){
  if(!confirm('Delete ALL your tasks? Cannot be undone.'))return;
  await supa.from('tasks').delete().eq('user_id',CU_ID);
  DB={};render();updateStats();toast('🗑','All tasks cleared.','err');
}
function setF(f,btn){tFilter=f;document.querySelectorAll('.fbtn').forEach(b=>b.classList.remove('on'));btn.classList.add('on');render();}
function onSearch(){
  const q=(document.getElementById('gSearch').value||'').toLowerCase().trim();
  if(!q){render();return;}
  const all=Object.values(DB).flat().filter(t=>t.title.toLowerCase().includes(q)||(t.desc||'').toLowerCase().includes(q));
  renderList(all,null);
}
function calcStreak(){let s=0;const d=new Date();for(let i=0;i<365;i++){const dk=dKey(d),tasks=getDay(dk);if(i>0&&tasks.length===0)break;if(tasks.some(t=>t.done))s++;else if(i>0)break;d.setDate(d.getDate()-1);}return s;}
function updateStats(){const td=getDay(tKey());document.getElementById('s-total').textContent=td.length;document.getElementById('s-done').textContent=td.filter(t=>t.done).length;document.getElementById('s-mine').textContent=td.filter(t=>t.owner===CU).length;document.getElementById('s-streak').textContent=calcStreak()+'🔥';updateFocusScore();updateLevelUI();}

// ══════════════════════════════════════
//  GAMIFICATION & FOCUS SCORE
// ══════════════════════════════════════
// Level = floor(totalCompletedTasks / 5) + 1; XP progress is the remainder toward the next level.
function calcLevel(){
  const totalDone=Object.values(DB).flat().filter(t=>t.done).length;
  const level=Math.floor(totalDone/5)+1;
  const into=totalDone%5;
  return {level, into, need:5, totalDone};
}
function updateLevelUI(){
  if(!CU_ID) return;
  const {level,into,need}=calcLevel();
  const pct=Math.round((into/need)*100);
  const dLvl=document.getElementById('dLvl'); if(dLvl) dLvl.textContent=level;
  const dFill=document.getElementById('dXpFill'); if(dFill) dFill.style.width=pct+'%';
  const dTxt=document.getElementById('dXpTxt'); if(dTxt) dTxt.textContent=`${into}/${need}`;
  const pLvl=document.getElementById('pLvl'); if(pLvl) pLvl.textContent=level;
  const pFill=document.getElementById('pXpFill'); if(pFill) pFill.style.width=pct+'%';
  const pTxt=document.getElementById('pXpTxt'); if(pTxt) pTxt.textContent=`${into}/${need}`;
}
// Daily Focus Score: (TasksCompletedToday/TotalTasksToday * 60) + (TotalStudyTimeToday/14400 * 40), capped at 100
function calcFocusScore(){
  const td=getDay(tKey());
  const taskPart=td.length>0 ? (td.filter(t=>t.done).length/td.length)*60 : 0;
  const studySecsToday=studyTotal();
  const studyPart=Math.min(studySecsToday/14400,1)*40;
  return Math.min(Math.round(taskPart+studyPart),100);
}
function updateFocusScore(){
  const el=document.getElementById('focusScoreVal'); if(!el) return; // only present on tasks page
  const score=calcFocusScore();
  el.textContent=score+'%';
  const ringTxt=document.getElementById('focusRingTxt'); if(ringTxt) ringTxt.textContent=score+'%';
  const ringProg=document.getElementById('focusRingProg');
  if(ringProg){ const c=2*Math.PI*30; ringProg.setAttribute('stroke-dasharray', `${(score/100)*c} ${c}`); }
}

function render(){
  updateDateNav();updateStats();
  const dk=dKey(viewDate);let list=getDay(dk);
  if(tFilter==='mine')list=list.filter(t=>t.owner===CU);
  else if(tFilter==='pending')list=list.filter(t=>!t.done);
  else if(tFilter==='done')list=list.filter(t=>t.done);
  else if(tFilter==='pinned')list=list.filter(t=>t.pinned);
  else if(['work','personal','health','study','other'].includes(tFilter))list=list.filter(t=>t.category===tFilter);
  list=list.sort((a,b)=>{if(a.pinned!==b.pinned)return a.pinned?-1:1;if(a.done!==b.done)return a.done?1:-1;const p={high:0,normal:1,low:2};return p[a.priority]-p[b.priority];});
  renderList(list,dk);
}
function renderList(list,dk){
  const cats={work:'💼 Work',personal:'🏠 Personal',health:'💪 Health',study:'📚 Study',other:'🔖 Other'};
  const grid=document.getElementById('tgrid');
  if(!list.length){grid.innerHTML=`<div class="empty"><div style="font-size:3rem;margin-bottom:14px">📋</div><p>No tasks here. Add one!</p></div>`;return;}
  const useDk=dk||dKey(viewDate);
  grid.innerHTML=list.map(t=>{
    const mine=t.owner===CU;
    const ini=t.owner?t.owner.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2):'U';
    const dt=t.createdAt?new Date(t.createdAt).toLocaleDateString('en-IN',{day:'numeric',month:'short'}):'';
    const pc={high:'pri-high',normal:'pri-normal',low:'pri-low'}[t.priority]||'pri-normal';
    const ts=t.subtasks?.length||0;const ds2=t.subtasks?.filter(s=>s.done).length||0;const sp=ts>0?Math.round(ds2/ts*100):0;
    const isOverdue=!t.done&&t.date&&t.date<tKey();
    const subHtml=ts?`<div class="tc-subtasks">${t.subtasks.map((s,i)=>`<div class="sub-item"><div class="sub-cb ${s.done?'chk':''}" onclick="toggleSub('${t.id}',${i})">${s.done?'✓':''}</div><span style="${s.done?'text-decoration:line-through;color:var(--text3)':''}">${esc(s.text)}</span></div>`).join('')}</div><div class="tc-prog"><div class="tc-prog-fill" style="width:${sp}%"></div></div>`:'';
    return `<div class="tc ${t.done?'done-card':''} ${t.pinned?'pinned-card':''}">
      ${t.pinned?`<div class="badge b-pin">📌 Pinned</div>`:(mine?`<div class="badge b-mine">Mine</div>`:'')}
      ${t.done?`<div class="badge b-done" style="${t.pinned?'left:auto;right:10px':''}">✓</div>`:isOverdue?`<div class="badge" style="right:10px;background:var(--accent3);color:#fff">⚠ Overdue</div>`:''}
      <div class="tc-placeholder">📋</div>
      <div class="tc-body">
        <div class="tc-owner"><div class="tc-av">${ini}</div><span class="tc-oname">${esc(t.owner||'')}</span><span class="pri-pill ${pc}">${t.priority}</span></div>
        <div class="tc-meta"><span class="tc-tag">${cats[t.category]||'🔖 Other'}</span>${t.time?`<span class="tc-tag">⏰ ${fmtT(t.time)}</span>`:''}${ts?`<span class="tc-tag">${ds2}/${ts} subtasks</span>`:''}</div>
        <div class="tc-title ${t.done?'dt':''}">${esc(t.title)}</div>
        ${t.desc?`<div class="tc-desc">${esc(t.desc)}</div>`:''}
        ${subHtml}
        <div class="tc-foot">
          <span class="tc-date">📅 ${dt}</span>
          ${mine?`<div class="tacts">
            <button class="ibtn" onclick="togglePin('${t.id}')" title="Pin">📌</button>
            <button class="ibtn" onclick="openEdit('${t.id}')" title="Edit">✏️</button>
            <button class="ibtn db" onclick="toggleDone('${t.id}')" title="${t.done?'Unmark':'Done'}">${t.done?'↩':'✓'}</button>
            <button class="ibtn xb" onclick="delTask('${t.id}')" title="Delete">🗑</button>
          </div>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
}
function closeMod(){document.getElementById('modal').classList.remove('open');}

// CALENDAR
function changeCalMonth(d){calM+=d;if(calM>11){calM=0;calY++}if(calM<0){calM=11;calY--}renderCal();}
function renderCal(){
  document.getElementById('calMonthLbl').textContent=new Date(calY,calM,1).toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  const fd=new Date(calY,calM,1).getDay(),dim=new Date(calY,calM+1,0).getDate(),pd=new Date(calY,calM,0).getDate(),ts=tKey();
  let h='';
  for(let i=fd-1;i>=0;i--)h+=`<div class="cal-day other-m"><div class="cdn">${pd-i}</div></div>`;
  for(let day=1;day<=dim;day++){
    const ds=`${calY}-${String(calM+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dots=getDay(ds).slice(0,5).map(()=>'<div class="dot dot-t"></div>').join('');
    h+=`<div class="cal-day ${ds===ts?'today':''}" onclick="selDay('${ds}',event)"><div class="cdn">${day}</div><div class="dot-row">${dots}</div></div>`;
  }
  const rem=(7-(fd+dim)%7)%7;for(let i=1;i<=rem;i++)h+=`<div class="cal-day other-m"><div class="cdn">${i}</div></div>`;
  document.getElementById('calDays').innerHTML=h;
  document.getElementById('dayDetail').style.display='none';
}
function selDay(ds,e){
  document.querySelectorAll('.cal-day').forEach(d=>d.classList.remove('selected'));
  e.currentTarget.classList.add('selected');
  const tasks=getDay(ds);
  document.getElementById('dayDetail').style.display='block';
  document.getElementById('ddTitle').textContent=new Date(ds+'T12:00').toLocaleDateString('en-IN',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  document.getElementById('ddTasks').innerHTML=tasks.length?tasks.map(t=>`<div style="display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid var(--border)"><div style="width:16px;height:16px;border-radius:4px;${t.done?'background:var(--accent2)':'border:1.5px solid var(--border)'};flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.6rem;color:#050a08;font-weight:700">${t.done?'✓':''}</div><span style="flex:1;${t.done?'text-decoration:line-through;color:var(--text3)':''}">${esc(t.title)}</span></div>`).join(''):'<div style="color:var(--text2);font-size:.85rem">No tasks.</div>';
}

// GRAPHS
function last7(){const d=[];for(let i=6;i>=0;i--){const dt=new Date();dt.setDate(dt.getDate()-i);const dk=dKey(dt),t=getDay(dk);d.push({dk,label:dt.toLocaleDateString('en-IN',{weekday:'short'}),added:t.length,done:t.filter(x=>x.done).length});}return d;}
function buildGraphs(){bDailyBar();bLine();bRings();bCmp();bHmap();}
function bDailyBar(){const d=last7();const mx=Math.max(...d.map(x=>x.done),1);document.getElementById('bar-daily').innerHTML=d.map(x=>{const p=Math.max(Math.round((x.done/mx)*100),x.done>0?5:0);return `<div class="bw"><div style="width:100%;height:${p}%;background:linear-gradient(180deg,var(--accent),var(--accent2));border-radius:5px 5px 0 0;min-height:${x.done>0?8:2}px" class="bar" data-v="${x.done} done"><span class="blbl">${x.label}</span></div></div>`;}).join('');}
function bLine(){const d=last7();const rates=d.map(x=>x.added>0?Math.round((x.done/x.added)*100):0);const svg=document.getElementById('lc-rate');const W=300,H=120,pad=22;const xs=d.map((_,i)=>pad+i*(W-2*pad)/6);const ys=rates.map(r=>H-10-(r/100)*(H-20));let g='';[0,25,50,75,100].forEach(r=>{const y=H-10-(r/100)*(H-20);g+=`<line x1="${pad}" y1="${y}" x2="${W-pad}" y2="${y}" stroke="rgba(255,255,255,.05)" stroke-width="1"/><text x="${pad-4}" y="${y+3}" text-anchor="end" font-size="9" fill="var(--text3)">${r}%</text>`;});let aP=`M ${xs[0]},${H-10} `;xs.forEach((x,i)=>aP+=`L ${x},${ys[i]} `);aP+=`L ${xs[xs.length-1]},${H-10} Z`;let lP=`M ${xs[0]},${ys[0]}`;xs.slice(1).forEach((x,i)=>lP+=` L ${x},${ys[i+1]}`);const dots=d.map((x,i)=>`<circle cx="${xs[i]}" cy="${ys[i]}" r="4" fill="var(--accent)" stroke="var(--bg)" stroke-width="2"/><text x="${xs[i]}" y="${H+12}" text-anchor="middle" font-size="9" fill="var(--text3)">${x.label}</text><text x="${xs[i]}" y="${ys[i]-7}" text-anchor="middle" font-size="9" fill="var(--text)">${rates[i]}%</text>`).join('');svg.innerHTML=`<defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity=".4"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>${g}<path d="${aP}" fill="url(#ag)"/><path d="${lP}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${dots}`;}
function bRings(){const td=getDay(tKey()),mine=td.filter(t=>t.owner===CU);const ring=(lbl,done,total,color)=>{const r=40,c=2*Math.PI*r,pct=total>0?done/total:0,dash=pct*c,num=total>0?Math.round(pct*100):0;return `<div class="ring-item"><svg class="ring" width="100" height="100" viewBox="0 0 100 100"><circle class="ring-track" cx="50" cy="50" r="${r}"/><circle class="ring-prog" cx="50" cy="50" r="${r}" stroke="${color}" stroke-dasharray="${dash} ${c}"/><text class="ring-val" x="50" y="54" text-anchor="middle" transform="rotate(90,50,50)">${num}%</text></svg><div class="ring-lbl">${lbl}</div><div style="font-size:.73rem;color:var(--text2)">${done}/${total}</div></div>`;};document.getElementById('rings').innerHTML=ring('All',td.filter(t=>t.done).length,td.length,'var(--accent)')+ring('Mine',mine.filter(t=>t.done).length,mine.length,'var(--accent2)');}
function bCmp(){const d=last7();const mx=Math.max(...d.flatMap(x=>[x.added,x.done]),1);document.getElementById('bar-cmp').innerHTML=d.map(x=>{const pa=Math.max(Math.round((x.added/mx)*100),x.added>0?4:0);const pd=Math.max(Math.round((x.done/mx)*100),x.done>0?4:0);return `<div class="bw" style="flex-direction:row;gap:2px;align-items:flex-end"><div style="flex:1;height:${pa}%;background:rgba(232,168,56,.7);border-radius:4px 4px 0 0;min-height:${x.added>0?5:2}px" class="bar" data-v="${x.added} added"></div><div style="flex:1;height:${pd}%;background:rgba(56,201,168,.8);border-radius:4px 4px 0 0;min-height:${x.done>0?5:2}px" class="bar" data-v="${x.done} done"></div><span class="blbl">${x.label}</span></div>`;}).join('');}
function bHmap(){const days=[];for(let i=29;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const dk=dKey(d);days.push({dk,done:getDay(dk).filter(t=>t.done).length,label:d.toLocaleDateString('en-IN',{month:'short',day:'numeric'})});}const mx=Math.max(...days.map(d=>d.done),1);const cols=['var(--s2)','rgba(232,168,56,.25)','rgba(232,168,56,.5)','rgba(232,168,56,.75)','var(--accent)'];document.getElementById('heatmap').innerHTML=days.map(d=>{const lv=d.done===0?0:Math.min(Math.ceil((d.done/mx)*4),4);return `<div class="hm-d" style="background:${cols[lv]}" data-tip="${d.label}: ${d.done} done"></div>`;}).join('');}

// ANALYTICS
function renderAnalytics(){
  const all=Object.values(DB).flat();
  let streak=0;const sdays=[];
  for(let i=29;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const ds=dKey(d);const hd=getDay(ds).some(t=>t.done);sdays.push({ds,hd,isT:ds===tKey()});}
  let si=sdays.length-1;while(si>=0&&sdays[si].hd){streak++;si--}
  document.getElementById('streakBig').textContent=streak;
  document.getElementById('streakRow').innerHTML=sdays.slice(-14).map(sd=>`<div class="sd ${sd.isT?'tday':sd.hd?'done':'missed'}" title="${sd.ds}">${new Date(sd.ds+'T12:00').getDate()}</div>`).join('');
  const cats=['work','personal','health','study','other'];
  const cL={work:'💼 Work',personal:'🏠 Personal',health:'💪 Health',study:'📚 Study',other:'🔖 Other'};
  const cC={work:'var(--accent)',personal:'var(--accent2)',health:'var(--accent3)',study:'var(--accent4)',other:'var(--accent5)'};
  document.getElementById('catProgress').innerHTML=cats.map(c=>{const total=all.filter(t=>t.category===c).length;const done=all.filter(t=>t.category===c&&t.done).length;const pct=total?Math.round(done/total*100):0;return `<div class="prog-row"><div class="prog-lbl"><span>${cL[c]}</span><span style="color:var(--text2)">${done}/${total} (${pct}%)</span></div><div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:${cC[c]}"></div></div></div>`;}).join('');
  const wks=[];for(let w=3;w>=0;w--){const wd=[];for(let d=6;d>=0;d--){const dt=new Date();dt.setDate(dt.getDate()-(w*7)-d);wd.push(dKey(dt));}const done=all.filter(t=>t.done&&wd.includes(t.date)).length;const total=all.filter(t=>wd.includes(t.date)).length;wks.push({done,total,label:`W${4-w}`});}
  const mxW=Math.max(...wks.map(w=>w.total),1);document.getElementById('wkAnalytics').innerHTML=wks.map(w=>{const pa=Math.max(Math.round((w.total/mxW)*100),w.total>0?5:0);const pd=Math.max(Math.round((w.done/mxW)*100),w.done>0?5:0);return `<div class="bw" style="flex-direction:row;gap:2px;align-items:flex-end"><div style="flex:1;height:${pa}%;background:rgba(232,168,56,.3);border-radius:4px 4px 0 0;min-height:${w.total>0?6:2}px" class="bar" data-v="${w.total} added"></div><div style="flex:1;height:${pd}%;background:var(--accent2);border-radius:4px 4px 0 0;min-height:${w.done>0?6:2}px" class="bar" data-v="${w.done} done"></div><span class="blbl">${w.label}</span></div>`;}).join('');
  const dm=new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate();const ms=tKey().substring(0,7);let hh='';
  for(let day=1;day<=dm;day++){const ds=ms+'-'+String(day).padStart(2,'0');const cnt=getDay(ds).filter(t=>t.done).length;const al=cnt===0?.05:Math.min(cnt/5,1)*.85+.1;const isT=ds===tKey();hh+=`<div title="${ds}: ${cnt} done" style="width:28px;height:28px;border-radius:6px;background:rgba(232,168,56,${al});display:flex;align-items:center;justify-content:center;font-size:.67rem;color:${cnt>0?'rgba(255,255,255,.85)':'var(--text3)'};border:${isT?'1.5px solid var(--accent)':'1px solid transparent'}">${day}</div>`;}
  document.getElementById('monthHmap').innerHTML=hh;
}

// PROFILE
async function renderProfile(){
  const all=Object.values(DB).flat();
  applyProfileUI(USER_PROFILE||{name:CU,avatar_url:avatarValue()});
  updateLevelUI();
  const {data:u}=await supa.from('users').select('created_at').eq('id',CU_ID).single();
  const since=u?.created_at?new Date(u.created_at).toLocaleDateString('en-IN',{month:'long',year:'numeric'}):'—';
  document.getElementById('pSince').textContent='Member since '+since;
  document.getElementById('pTotal').textContent=all.length;
  document.getElementById('pDone').textContent=all.filter(t=>t.done).length;
  const totalStudySecs=subjects.reduce((a,s)=>a+s.secs,0);
  document.getElementById('pStudy').textContent=Math.floor(totalStudySecs/3600)+'h';
  document.getElementById('pStrk').textContent=calcStreak()+'🔥';
  const done=all.filter(t=>t.done).length;const streak=calcStreak();
  const achs=[
    {e:'🌱',n:'First Task',d:'Add your first task',ok:all.length>=1},
    {e:'✅',n:'Getting Going',d:'Complete 5 tasks',ok:done>=5},
    {e:'🔥',n:'On Fire',d:'3-day streak',ok:streak>=3},
    {e:'💪',n:'Consistent',d:'7-day streak',ok:streak>=7},
    {e:'📚',n:'Scholar',d:'Study 1 hour',ok:totalStudySecs>=3600},
    {e:'🍅',n:'Focused',d:'Complete a Pomodoro',ok:pomSessCount>=1},
    {e:'🏆',n:'Power User',d:'Complete 50 tasks',ok:done>=50},
    {e:'📌',n:'Organiser',d:'Pin a task',ok:all.some(t=>t.pinned)},
    {e:'🌟',n:'Streak Master',d:'30-day streak',ok:streak>=30},
    {e:'🎓',n:'Dedicated',d:'Study 10 hours total',ok:totalStudySecs>=36000},
  ];
  document.getElementById('achGrid').innerHTML=achs.map(a=>`<div class="ach ${a.ok?'earned':'locked'}"><div class="ach-emo">${a.e}</div><div class="ach-name">${a.n}</div><div class="ach-desc">${a.d}</div></div>`).join('');
}

// ══════════════════════════════════════
//  GLOBAL PEER LEADERBOARD
// ══════════════════════════════════════
function fmtLbHours(secs){
  const h=Math.floor((secs||0)/3600), m=Math.floor(((secs||0)%3600)/60);
  return h>0 ? `${h}h ${m}m` : `${m}m`;
}
// Focus score for a peer row, using their own synced today_study_seconds (task data for
// other users isn't fetched — this is a best-effort study-only proxy, capped like the local formula).
function lbFocusScore(todaySecs){
  return Math.min(Math.round(((todaySecs||0)/14400)*40+ (todaySecs>0?40:0)*0.5),100);
}
async function renderLeaderboard(){
  const loading=document.getElementById('lbLoading');
  const podiumEl=document.getElementById('lbPodium');
  const tableEl=document.getElementById('lbTable');
  loading.style.display='block';loading.textContent='Loading rankings…';
  podiumEl.style.display='none';podiumEl.innerHTML='';tableEl.innerHTML='';
  try{
    const {data:rows,error}=await supa.from('leaderboard_view')
      .select('id,name,total_study_seconds,today_study_seconds,study_date')
      .order('total_study_seconds',{ascending:false})
      .limit(50);
    if(error) throw error;
    const ranked=(rows||[]).filter(r=>r.name);
    if(!ranked.length){
      loading.textContent='No peers ranked yet — start a study session to appear here!';
      return;
    }
    loading.style.display='none';
    const medals=['🥇','🥈','🥉'];
    const top3=ranked.slice(0,3);
    if(top3.length){
      podiumEl.style.display='grid';
      // Render in visual podium order (2nd, 1st, 3rd) while keeping true rank in the label
      const order=[1,0,2].filter(i=>top3[i]);
      podiumEl.innerHTML=order.map(i=>{
        const r=top3[i];
        const ini=r.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
        return `<div class="lb-podium-card p${i+1}">
          <div class="lb-medal">${medals[i]}</div>
          <div class="lb-podium-av">${ini}</div>
          <div class="lb-podium-name">${esc(r.name)}${r.id===CU_ID?' (You)':''}</div>
          <div class="lb-podium-stat">${fmtLbHours(r.total_study_seconds)} total</div>
        </div>`;
      }).join('');
    }
    tableEl.innerHTML=ranked.map((r,i)=>{
      const ini=r.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
      const isMe=r.id===CU_ID;
      const isTodayFresh=r.study_date===tKey();
      const todaySecs=isTodayFresh?(r.today_study_seconds||0):0;
      return `<div class="lb-row ${isMe?'me':''}">
        <div class="lb-rank">${i<3?medals[i]:'#'+(i+1)}</div>
        <div class="lb-av">${ini}</div>
        <div class="lb-name">${esc(r.name)}${isMe?' <span style="color:var(--accent)">· You</span>':''}</div>
        <div class="lb-stats">
          <div class="lb-stat"><div class="lb-stat-val">${fmtLbHours(r.total_study_seconds)}</div><div class="lb-stat-lbl">Total</div></div>
          <div class="lb-stat"><div class="lb-stat-val">${lbFocusScore(todaySecs)}%</div><div class="lb-stat-lbl">Focus</div></div>
        </div>
      </div>`;
    }).join('');
  }catch(e){
    console.error(e);
    loading.textContent='Could not load the leaderboard. Make sure total_study_seconds / today_study_seconds / study_date columns exist on the users table.';
  }
}

// THEME
let isDark=true;
function toggleTheme(){
  isDark=!isDark;
  if(isDark){document.documentElement.style.setProperty('--bg','#030706');document.documentElement.style.setProperty('--s1','#0b110e');document.documentElement.style.setProperty('--s2','#121a16');document.documentElement.style.setProperty('--s3','#18221e');document.documentElement.style.setProperty('--text','#f0ede6');document.documentElement.style.setProperty('--text2','#8a9e94');document.documentElement.style.setProperty('--text3','#4a5e54');document.getElementById('themeBtn').textContent='☀️';}
  else{document.documentElement.style.setProperty('--bg','#f5f2eb');document.documentElement.style.setProperty('--s1','#ede9e0');document.documentElement.style.setProperty('--s2','#e2ddd3');document.documentElement.style.setProperty('--s3','#d4cec3');document.documentElement.style.setProperty('--text','#1a1a14');document.documentElement.style.setProperty('--text2','#5a5a4a');document.documentElement.style.setProperty('--text3','#8a8a74');document.getElementById('themeBtn').textContent='🌙';}
  localStorage.setItem('tb_theme',isDark?'dark':'light');
  // Update drawer theme item
  const tdi=document.getElementById('themeDrawerItem');
  const tdl=document.getElementById('themeDrawerLabel');
  if(tdi) tdi.querySelector('.drawer-nav-icon').textContent=isDark?'🌙':'☀️';
  if(tdl) tdl.textContent=isDark?'Dark Mode':'Light Mode';
  toast(isDark?'🌙':'☀️',isDark?'Dark mode':'Light mode','inf');
}
(function(){if(localStorage.getItem('tb_theme')==='light'){isDark=true;setTimeout(toggleTheme,0);}})();

// ══════════════════════════════════════
//  DRAWER / HAMBURGER
// ══════════════════════════════════════
function toggleDrawer(){
  const drawer=document.getElementById('sideDrawer');
  const overlay=document.getElementById('drawerOverlay');
  const btn=document.getElementById('hamburgerBtn');
  const isOpen=drawer.classList.contains('open');
  if(isOpen){ closeDrawer(); }
  else {
    drawer.classList.add('open');
    overlay.classList.add('open');
    btn.classList.add('open');
    document.body.style.overflow='hidden';
  }
}
function closeDrawer(){
  document.getElementById('sideDrawer').classList.remove('open');
  document.getElementById('drawerOverlay').classList.remove('open');
  document.getElementById('hamburgerBtn').classList.remove('open');
  document.body.style.overflow='';
}

// Update drawer active state
function _setDrawerActive(page){
  document.querySelectorAll('.drawer-nav-item').forEach(el=>el.classList.remove('active'));
  const el=document.getElementById('dnav-'+page);
  if(el) el.classList.add('active');
}

// ══════════════════════════════════════
//  INSIGHTS
// ══════════════════════════════════════
function fmtInsTime(secs){
  const h=Math.floor(secs/3600), m=Math.floor((secs%3600)/60);
  if(h>0) return `${h}h ${String(m).padStart(2,'0')}m`;
  return `${m}m`;
}

// Get study history from localStorage (we store daily snapshots)
// Key: tb_study_hist_<CU_ID>  Value: {"YYYY-MM-DD": {subjectId: secs, ...}}
function getStudyHistory(){
  if(!CU_ID) return {};
  try{
    const raw=localStorage.getItem('tb_study_hist_'+CU_ID);
    return raw?JSON.parse(raw):{};
  }catch{return {};}
}
function saveStudyHistory(){
  if(!CU_ID||!subjects.length) return;
  const hist=getStudyHistory();
  const today=dKey(new Date());
  // Save today's snapshot: {subjectId: secs}
  const snap={};
  subjects.forEach(s=>{ if(s.secs>0) snap[s.id]={name:s.name,secs:s.secs,color:s.color}; });
  if(Object.keys(snap).length>0) hist[today]=snap;
  try{ localStorage.setItem('tb_study_hist_'+CU_ID, JSON.stringify(hist)); }catch{}
}

function renderInsights(){
  const today=dKey(new Date());
  const hist=getStudyHistory();

  // ── Hero totals ──
  const todaySnap=hist[today]||{};
  const todaySecs=Object.values(todaySnap).reduce((a,v)=>a+(v.secs||0),0);

  // Week: Mon–Sun containing today
  let weekSecs=0;
  const now=new Date();
  for(let i=6;i>=0;i--){const d=new Date();d.setDate(now.getDate()-i);const ds=dKey(d);const snap=hist[ds]||{};weekSecs+=Object.values(snap).reduce((a,v)=>a+(v.secs||0),0);}

  // Month
  let monthSecs=0;
  const ym=today.substring(0,7);
  Object.keys(hist).filter(k=>k.startsWith(ym)).forEach(k=>{monthSecs+=Object.values(hist[k]).reduce((a,v)=>a+(v.secs||0),0);});

  document.getElementById('ins-today-time').textContent=fmtInsTime(todaySecs)||'0m';
  document.getElementById('ins-week-time').textContent=fmtInsTime(weekSecs)||'0m';
  document.getElementById('ins-month-time').textContent=fmtInsTime(monthSecs)||'0m';

  renderSmartInsights(hist,today,todaySecs,weekSecs);

  // ── Subject Breakdown ──
  const subjList=document.getElementById('insSubjectList');
  // Merge today's live subjects + history
  const liveMap={};
  subjects.forEach(s=>{ if(s.secs>0) liveMap[s.id]={name:s.name,secs:s.secs,color:s.color}; });
  const todayMap={...todaySnap, ...liveMap}; // live overrides
  const todaySubjects=Object.values(todayMap);

  if(!todaySubjects.length){
    subjList.innerHTML='<div class="ins-empty"><div class="ins-empty-icon">📖</div>No subjects tracked today. Start the Study Timer to track your sessions!</div>';
  } else {
    const maxSecs=Math.max(...todaySubjects.map(s=>s.secs),1);
    subjList.innerHTML='<div class="ins-bar-grid">'+todaySubjects.map(s=>{
      const pct=Math.round((s.secs/maxSecs)*100);
      return `<div class="ins-bar-row">
        <div class="ins-bar-label" style="color:${s.color}">${esc(s.name.length>10?s.name.substring(0,10)+'…':s.name)}</div>
        <div class="ins-bar-track"><div class="ins-bar-fill" style="width:${pct}%;background:${s.color}"></div></div>
        <div class="ins-bar-val">${fmtInsTime(s.secs)}</div>
      </div>`;
    }).join('')+'</div>';
  }

  // ── Week Chart ──
  const weekChart=document.getElementById('insWeekChart');
  const weekDays=[];
  for(let i=6;i>=0;i--){const d=new Date();d.setDate(now.getDate()-i);weekDays.push({ds:dKey(d),label:d.toLocaleDateString('en-IN',{weekday:'short'})});}
  const weekSecsArr=weekDays.map(d=>{const snap=hist[d.ds]||{};return Object.values(snap).reduce((a,v)=>a+(v.secs||0),0);});
  const maxWeekSecs=Math.max(...weekSecsArr,1);
  weekChart.innerHTML=weekDays.map((d,i)=>{
    const s=weekSecsArr[i];
    const pct=Math.round((s/maxWeekSecs)*100);
    const isToday=d.ds===today;
    return `<div class="swg-col">
      <div class="swg-bar-wrap">
        <div class="swg-bar" style="height:${Math.max(pct,s>0?8:2)}%;background:${isToday?'var(--accent2)':'rgba(56,201,168,.35)'};width:100%;border-radius:5px 5px 0 0" data-tip="${d.label}: ${fmtInsTime(s)}"></div>
      </div>
      <div class="swg-lbl" style="color:${isToday?'var(--accent2)':'var(--text3)'}">${d.label}</div>
    </div>`;
  }).join('');

  // ── Focus Distribution (simple bar) ──
  const focusDist=document.getElementById('insFocusDist');
  if(!todaySubjects.length){
    focusDist.innerHTML='<div class="ins-empty" style="padding:20px"><div class="ins-empty-icon" style="font-size:1.8rem">📊</div>No data yet</div>';
  } else {
    const total=todaySubjects.reduce((a,s)=>a+s.secs,0)||1;
    focusDist.innerHTML=todaySubjects.map(s=>{
      const pct=Math.round((s.secs/total)*100);
      return `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:.8rem">
          <span style="display:flex;align-items:center;gap:6px;font-weight:600"><span style="width:8px;height:8px;border-radius:50%;background:${s.color};display:inline-block"></span>${esc(s.name)}</span>
          <span style="color:var(--text2)">${pct}%</span>
        </div>
        <div style="height:6px;background:var(--s2);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${s.color};border-radius:3px;transition:width .8s cubic-bezier(.16,1,.3,1)"></div>
        </div>
      </div>`;
    }).join('');
  }

  // ── Monthly Heatmap ──
  const mhmap=document.getElementById('insMonthHeatmap');
  const dm=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  const ms2=today.substring(0,7);
  let mhHtml='';
  for(let day=1;day<=dm;day++){
    const ds=ms2+'-'+String(day).padStart(2,'0');
    const snap=hist[ds]||{};
    const secs=Object.values(snap).reduce((a,v)=>a+(v.secs||0),0);
    const hrs=secs/3600;
    const al=hrs===0?.05:hrs<0.5?.2:hrs<1?.4:hrs<2?.65:hrs<3?.85:1;
    const isT=ds===today;
    const label=new Date(ds+'T12:00').toLocaleDateString('en-IN',{month:'short',day:'numeric'});
    mhHtml+=`<div title="${label}: ${fmtInsTime(secs)}" style="width:28px;height:28px;border-radius:6px;background:rgba(56,201,168,${al});display:flex;align-items:center;justify-content:center;font-size:.67rem;color:${secs>0?'rgba(255,255,255,.85)':'var(--text3)'};border:${isT?'1.5px solid var(--accent2)':'1px solid transparent'};cursor:default">${day}</div>`;
  }
  mhmap.innerHTML=mhHtml||'<div style="color:var(--text3);font-size:.85rem">No data this month yet.</div>';

  // ── Quick Stats ──
  const qStats=document.getElementById('insQuickStats');
  // Best day
  let bestDaySecs=0, bestDayLabel='—';
  Object.keys(hist).filter(k=>k.startsWith(ym)).forEach(k=>{
    const s=Object.values(hist[k]).reduce((a,v)=>a+(v.secs||0),0);
    if(s>bestDaySecs){bestDaySecs=s;bestDayLabel=new Date(k+'T12:00').toLocaleDateString('en-IN',{month:'short',day:'numeric'});}
  });
  const avgDailyThisMonth=monthSecs/Math.max(now.getDate(),1);
  const statRows=[
    ['📅','Best Day This Month',bestDaySecs>0?`${bestDayLabel} · ${fmtInsTime(bestDaySecs)}`:'—'],
    ['📈','Avg Daily (Month)',fmtInsTime(Math.round(avgDailyThisMonth))],
    ['⚡','Subjects Tracked',subjects.length+''],
    ['⏱','Longest Session Today',todaySubjects.length?fmtInsTime(Math.max(...todaySubjects.map(s=>s.secs))):'—'],
  ];
  qStats.innerHTML=statRows.map(([icon,label,val])=>
    `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--s2);border-radius:9px;margin-bottom:7px">
      <span style="font-size:1rem;flex-shrink:0">${icon}</span>
      <span style="flex:1;font-size:.83rem;color:var(--text2)">${label}</span>
      <span style="font-size:.83rem;font-weight:700;color:var(--text)">${val}</span>
    </div>`
  ).join('');

  // ── Top Subjects ──
  const topSubj=document.getElementById('insTopSubjects');
  const sorted=[...todaySubjects].sort((a,b)=>b.secs-a.secs);
  if(!sorted.length){
    topSubj.innerHTML='<div class="ins-empty" style="padding:16px"><div class="ins-empty-icon" style="font-size:1.8rem">🏆</div>No subjects yet</div>';
  } else {
    topSubj.innerHTML=sorted.map((s,i)=>`
      <div class="subj-ins-row">
        <span style="font-family:'Playfair Display',serif;font-weight:900;font-size:1rem;color:${i===0?'var(--accent)':i===1?'var(--text2)':'var(--text3)'};min-width:20px">${i+1}</span>
        <div class="subj-ins-dot" style="background:${s.color}"></div>
        <div class="subj-ins-name">${esc(s.name)}</div>
        <div class="subj-ins-chip highlight">${fmtInsTime(s.secs)}</div>
      </div>`
    ).join('');
  }
}

// Auto-generate a few plain-language observations from the study history
function renderSmartInsights(hist,today,todaySecs,weekSecs){
  const el=document.getElementById('insSmartList');
  if(!el) return;
  const items=[];

  // Most-studied subject overall (last 30 days of history)
  const subjTotals={};
  Object.values(hist).forEach(snap=>{
    Object.values(snap).forEach(v=>{ subjTotals[v.name]=(subjTotals[v.name]||0)+(v.secs||0); });
  });
  const topSubjEntry=Object.entries(subjTotals).sort((a,b)=>b[1]-a[1])[0];
  if(topSubjEntry){
    items.push({e:'📚',html:`Your most-studied subject is <b>${esc(topSubjEntry[0])}</b>, with ${fmtInsTime(topSubjEntry[1])} logged.`});
  }

  // Consistency vs previous week
  let prevWeekSecs=0;
  const now=new Date();
  for(let i=13;i>=7;i--){const d=new Date();d.setDate(now.getDate()-i);const snap=hist[dKey(d)]||{};prevWeekSecs+=Object.values(snap).reduce((a,v)=>a+(v.secs||0),0);}
  if(prevWeekSecs>0||weekSecs>0){
    if(prevWeekSecs===0 && weekSecs>0){
      items.push({e:'🚀',html:`You studied ${fmtInsTime(weekSecs)} this week after a quiet week before — great restart!`});
    } else {
      const diffPct=prevWeekSecs>0?Math.round(((weekSecs-prevWeekSecs)/prevWeekSecs)*100):0;
      if(diffPct>=10) items.push({e:'📈',html:`You're up <b>${diffPct}%</b> vs last week's study time — momentum is building.`});
      else if(diffPct<=-10) items.push({e:'📉',html:`Study time is down <b>${Math.abs(diffPct)}%</b> vs last week. A short session today can turn that around.`});
      else items.push({e:'⚖️',html:`Your study time is holding steady compared to last week — consistent pace.`});
    }
  }

  // Today vs your own recent daily average
  const last7Secs=[];
  for(let i=1;i<=7;i++){const d=new Date();d.setDate(now.getDate()-i);last7Secs.push(Object.values(hist[dKey(d)]||{}).reduce((a,v)=>a+(v.secs||0),0));}
  const avg=last7Secs.reduce((a,b)=>a+b,0)/7;
  if(todaySecs>0 && avg>0){
    if(todaySecs>avg*1.2) items.push({e:'🔥',html:`Today's ${fmtInsTime(todaySecs)} beats your recent daily average of ${fmtInsTime(Math.round(avg))}.`});
    else if(todaySecs<avg*0.5) items.push({e:'☕',html:`Today's session (${fmtInsTime(todaySecs)}) is lighter than your ${fmtInsTime(Math.round(avg))} average — even 20 more minutes helps.`});
  }

  // Streak-style consistency check over last 7 days
  const activeDays=last7Secs.filter(s=>s>0).length + (todaySecs>0?1:0);
  if(activeDays>=6) items.push({e:'🏅',html:`You've studied on <b>${activeDays}/7</b> of the last 7 days — excellent consistency.`});
  else if(activeDays<=2 && (weekSecs>0||prevWeekSecs>0)) items.push({e:'🌱',html:`Only <b>${activeDays}/7</b> active study days this week — try setting a small daily minimum.`});

  if(!items.length){
    el.innerHTML='<div class="ins-empty" style="padding:20px"><div class="ins-empty-icon" style="font-size:1.8rem">🧠</div>Track a few study sessions and insights will appear here.</div>';
    return;
  }
  el.innerHTML=items.map(it=>`<div class="smart-ins-row"><span class="smart-ins-emo">${it.e}</span><span class="smart-ins-txt">${it.html}</span></div>`).join('');
}

// TOAST
let _tt;
function toast(ico,msg,type='suc'){document.getElementById('t-ico').textContent=ico;document.getElementById('t-msg').textContent=msg;const el=document.getElementById('toast');el.className='toast show '+type;clearTimeout(_tt);_tt=setTimeout(()=>el.classList.remove('show'),2800);}

window.addEventListener('resize',()=>{if(document.getElementById('page-graphs').classList.contains('on'))buildGraphs();});

// Auto-save study every 30s if any timer running
setInterval(()=>{
  if(imap.size>0){
    studySave();
    saveStudyHistory(); // also snapshot for insights history
    syncStudyToCloud();
  }
},30000);

// Midnight boundary reset: checked every minute regardless of whether a timer is running,
// so the day rolls over instantly at 00:00 without needing a page refresh.
setInterval(()=>{
  if(!CU_ID||!_SDK) return;
  const storedDate=localStorage.getItem(_SDK);
  const today=dKey(new Date());
  if(storedDate && storedDate!==today){
    // Snapshot yesterday's numbers into history/cloud before wiping today's counters
    saveStudyHistory();
    syncStudyToCloud(true);
    imap.forEach(rec=>clearInterval(rec.handle));
    imap.clear();
    subjects.forEach(s=>s.secs=0);
    studySave();
    renderStudyList();
    studyUpdateTotal();
    if(document.getElementById('page-tasks')?.classList.contains('on')) updateFocusScore();
    toast('🌙','New day started — timers reset.','inf');
  }
},60000);

// Save history on page unload
window.addEventListener('beforeunload',()=>{ studySave(); saveStudyHistory(); syncStudyToCloud(true); });

// Pull changes whenever the user focuses/switches back to this tab
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    hydrateStudyFromCloud();
  }
});

// ESC to close drawer
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeDrawer(); });
