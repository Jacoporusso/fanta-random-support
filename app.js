(() => {
  'use strict';

  const STORAGE_KEY = 'fanta-random-mvp-v2';
  const OLD_STORAGE_KEY = 'fanta-random-mvp-v1';
  const ROLES = ['P','D','C','A'];
  const TIERS = ['S','A','B','C','D'];
  const LISTONE_SOURCES = [
    'https://cdn.jsdelivr.net/gh/darioschioppi/fantacalcio-2026-27@master/excel_dario_data.js',
    'https://raw.githubusercontent.com/darioschioppi/fantacalcio-2026-27/master/excel_dario_data.js'
  ];

  // Fasce volutamente strette: il gruppo S deve rappresentare davvero i pochi top rimasti.
  // Le classifiche vengono calcolate separatamente per ruolo ordinando per FVM.
  const TIER_SIZES = {
    P: {S:6, A:8, B:14, C:18},
    D: {S:12, A:24, B:40, C:50},
    C: {S:12, A:24, B:40, C:50},
    A: {S:8, A:14, B:20, C:24}
  };

  const DEFAULT_STATE = {
    version: 2,
    settings: { teamName:'La mia squadra', initialCredits:500, minBid:1, slots:{P:3,D:8,C:8,A:6} },
    meta: { source:'', syncedAt:null, activeCount:0 },
    players: [],
    history: []
  };

  let state = loadState();
  let activeRole = 'ALL';
  let query = '';
  let pendingBuyId = null;
  let syncing = false;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const clone = v => JSON.parse(JSON.stringify(v));

  function uid(seed=''){
    if(seed) return `p-${hash(seed)}`;
    return (crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
  }
  function hash(s){
    let h=2166136261;
    for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
    return (h>>>0).toString(36);
  }
  function keyFor(p){ return `${String(p.name).toLowerCase()}|${p.role}`; }
  function esc(s=''){ return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function parseNum(v){
    if(v===null || v===undefined || v==='') return null;
    const n=Number(String(v).replace(',','.').replace(/[^0-9.\-]/g,''));
    return Number.isFinite(n) ? n : null;
  }

  function normalizeState(raw){
    const merged=clone(DEFAULT_STATE);
    if(!raw || typeof raw!=='object') return merged;
    merged.settings={...merged.settings,...(raw.settings||{})};
    merged.settings.slots={...DEFAULT_STATE.settings.slots,...(raw.settings?.slots||{})};
    merged.meta={...merged.meta,...(raw.meta||{})};
    merged.players=Array.isArray(raw.players)?raw.players:[];
    merged.history=Array.isArray(raw.history)?raw.history.slice(-30):[];
    return merged;
  }
  function loadState(){
    try{
      const v2=localStorage.getItem(STORAGE_KEY);
      if(v2) return normalizeState(JSON.parse(v2));
      const v1=localStorage.getItem(OLD_STORAGE_KEY);
      if(v1){
        const old=normalizeState(JSON.parse(v1));
        // Migra solo configurazione e preferiti: il listone v2 viene ricaricato pulito.
        return {...clone(DEFAULT_STATE),settings:old.settings,players:[]};
      }
    }catch{}
    return clone(DEFAULT_STATE);
  }
  function persist(){ localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); }
  function saveState(){ persist(); render(); }
  function toast(msg){
    const el=$('#toast'); el.textContent=msg; el.classList.add('show');
    clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),1800);
  }
  function pushHistory(){
    state.history.push({ts:Date.now(),players:clone(state.players)});
    if(state.history.length>30) state.history.shift();
  }
  function undo(){
    const last=state.history.pop(); if(!last) return;
    state.players=last.players; saveState(); toast('Ultima azione annullata');
  }

  function currentCredits(){
    const spent=state.players.filter(p=>p.status==='mine').reduce((s,p)=>s+(Number(p.price)||0),0);
    return Math.max(0,Number(state.settings.initialCredits)-spent);
  }
  function totalSlots(){ return ROLES.reduce((s,r)=>s+(Number(state.settings.slots[r])||0),0); }
  function myCount(role=null){ return state.players.filter(p=>p.status==='mine'&&(!role||p.role===role)).length; }
  function slotsRemaining(){ return Math.max(0,totalSlots()-myCount()); }
  function roleRemainingSlots(role){ return Math.max(0,(Number(state.settings.slots[role])||0)-myCount(role)); }
  function maxBid(){
    const remaining=slotsRemaining();
    if(remaining<=0) return 0;
    return Math.max(0,currentCredits()-Math.max(0,remaining-1)*Number(state.settings.minBid||1));
  }
  function tierRank(t){ const i=TIERS.indexOf(t); return i<0?99:i; }

  function assignManagedTiers(players){
    ROLES.forEach(role=>{
      const arr=players.filter(p=>p.role===role).sort((a,b)=>(b.fvm??-1)-(a.fvm??-1)||(b.qa??-1)-(a.qa??-1)||a.name.localeCompare(b.name,'it'));
      const sizes=TIER_SIZES[role];
      const cutS=sizes.S, cutA=cutS+sizes.A, cutB=cutA+sizes.B, cutC=cutB+sizes.C;
      arr.forEach((p,i)=>{ p.tier=i<cutS?'S':i<cutA?'A':i<cutB?'B':i<cutC?'C':'D'; });
    });
    return players;
  }

  // La sorgente contiene alcune descrizioni con veri a-capo all'interno di stringhe.
  // Non sono JSON validi, quindi li trasformiamo nell'escape JSON `\\n` senza
  // eseguire il file remoto come JavaScript.
  function normalizeRowForJson(raw){
    let result='', inString=false, escaped=false;
    for(let i=0;i<raw.length;i++){
      const c=raw[i];
      if(inString){
        if(escaped){ result+=c; escaped=false; continue; }
        if(c==='\\'){ result+=c; escaped=true; continue; }
        if(c==='"'){ result+=c; inString=false; continue; }
        if(c==='\r'){
          if(raw[i+1]==='\n') i++;
          result+='\\n';
          continue;
        }
        if(c==='\n'){ result+='\\n'; continue; }
        result+=c;
        continue;
      }
      if(c==='"') inString=true;
      result+=c;
    }
    return result;
  }

  // Estrae in modo sicuro le righe dell'array JS remoto senza eseguirne il codice.
  function parseListoneSource(text){
    const marker='const EXCEL_DARIO_DATA = [';
    const markerAt=text.indexOf(marker);
    if(markerAt<0) throw new Error('Formato sorgente non riconosciuto');
    const rootStart=text.indexOf('[',markerAt);
    const rows=[];
    let depth=0,rowStart=-1,inString=false,escaped=false;
    for(let i=rootStart;i<text.length;i++){
      const c=text[i];
      if(inString){
        if(escaped){escaped=false;continue;}
        if(c==='\\'){escaped=true;continue;}
        if(c==='"') inString=false;
        continue;
      }
      if(c==='"'){inString=true;continue;}
      if(c==='['){
        depth++;
        if(depth===2) rowStart=i;
      }else if(c===']'){
        if(depth===2 && rowStart>=0){
          const raw=text.slice(rowStart,i+1);
          try{ rows.push(JSON.parse(normalizeRowForJson(raw))); }catch{}
          rowStart=-1;
        }
        depth--;
        if(depth===0) break;
      }
    }
    if(rows.length<400) throw new Error(`Listone incompleto (${rows.length} righe)`);
    return rows;
  }

  function rowsToPlayers(rows, previous=[]){
    const oldByKey=new Map(previous.map(p=>[keyFor(p),p]));
    const active=rows.filter(r=>Array.isArray(r)&&ROLES.includes(r[2])&&r[r.length-1]!==true);
    const players=active.map(r=>{
      const name=String(r[0]||'').trim();
      const role=String(r[2]||'').trim().toUpperCase();
      const old=oldByKey.get(`${name.toLowerCase()}|${role}`);
      return {
        id:old?.id||uid(`${name}|${role}`),
        name,
        club:String(r[1]||'').trim(),
        role,
        qa:parseNum(r[5]),
        fvm:parseNum(r[6]),
        tier:'D',
        target:!!old?.target,
        status:old?.status||'available',
        price:old?.price??null
      };
    }).filter(p=>p.name&&ROLES.includes(p.role));
    return assignManagedTiers(players);
  }

  async function fetchSourceText(){
    let lastErr;
    for(const url of LISTONE_SOURCES){
      try{
        const res=await fetch(url,{cache:'no-store',mode:'cors'});
        if(!res.ok) throw new Error(`HTTP ${res.status}`);
        return {text:await res.text(),url};
      }catch(err){ lastErr=err; }
    }
    throw lastErr||new Error('Sorgente non raggiungibile');
  }

  async function syncListone(force=false){
    if(syncing) return;
    if(force && state.players.some(p=>p.status!=='available')){
      const ok=confirm('Aggiornare il listone durante un’asta già iniziata? Gli acquisti e i venduti riconosciuti per nome verranno mantenuti.');
      if(!ok) return;
    }
    syncing=true; renderSourceStatus('Sincronizzazione listone…');
    try{
      const {text,url}=await fetchSourceText();
      const rows=parseListoneSource(text);
      const next=rowsToPlayers(rows,state.players);
      if(next.length<450) throw new Error(`Solo ${next.length} giocatori attivi`);
      state.players=next;
      state.meta={source:url,syncedAt:new Date().toISOString(),activeCount:next.length};
      state.history=[];
      persist(); render(); toast(`${next.length} giocatori caricati`);
    }catch(err){
      console.error(err);
      renderSourceStatus(state.players.length ? 'Listone locale disponibile · aggiornamento non riuscito' : 'Impossibile caricare il listone. Tocca “Aggiorna” quando sei online.',true);
      if(!state.players.length) toast('Serve rete per il primo caricamento');
    }finally{ syncing=false; }
  }

  function renderMetrics(){
    $('#teamTitle').textContent=state.settings.teamName||'Fanta Random';
    $('#creditsMetric').textContent=currentCredits();
    $('#slotsMetric').textContent=slotsRemaining();
    $('#maxBidMetric').textContent=maxBid();
    $('#undoBtn').disabled=!state.history.length;
  }
  function renderRoleChips(){
    const avail=state.players.filter(p=>p.status==='available');
    const chips=[['ALL','Tutti',avail.length],...ROLES.map(r=>[r,r,avail.filter(p=>p.role===r).length])];
    $('#roleChips').innerHTML=chips.map(([r,label,n])=>`<button class="chip ${activeRole===r?'active':''}" data-role="${r}">${label} <span>${n}</span></button>`).join('');
    $$('#roleChips .chip').forEach(b=>b.onclick=()=>{activeRole=b.dataset.role;render();});
  }
  function filteredAvailable(){
    const q=query.trim().toLowerCase();
    return state.players.filter(p=>p.status==='available')
      .filter(p=>activeRole==='ALL'||p.role===activeRole)
      .filter(p=>!q||`${p.name} ${p.club}`.toLowerCase().includes(q))
      .sort((a,b)=>tierRank(a.tier)-tierRank(b.tier)||(b.fvm??-1)-(a.fvm??-1)||a.name.localeCompare(b.name,'it'));
  }
  function playerHtml(p,mineMode=false){
    return `<div class="player" data-id="${esc(p.id)}">
      <button class="star ${p.target?'active':''}" data-action="target" aria-label="Preferito">★</button>
      <div class="player-main">
        <div class="player-name">${esc(p.name)}</div>
        <div class="player-meta">
          <span class="badge role">${esc(p.role)}</span>
          <span class="badge tier tier-${esc(p.tier)}">${esc(p.tier)}</span>
          <span>${esc(p.club)}</span>
          ${p.qa!=null?`<span>Q ${esc(p.qa)}</span>`:''}
          ${mineMode?`<span class="price">· ${esc(p.price)} cr</span>`:''}
        </div>
      </div>
      ${mineMode?`<div class="actions"><button class="small-action" data-action="release">Rimuovi</button></div>`:`<div class="actions"><button class="small-action" data-action="sold">Venduto</button><button class="small-action mine" data-action="mine">Mio</button></div>`}
    </div>`;
  }
  function bindPlayerActions(root){
    root.querySelectorAll('.player').forEach(row=>{
      const id=row.dataset.id;
      row.querySelectorAll('[data-action]').forEach(btn=>btn.onclick=()=>handlePlayerAction(id,btn.dataset.action));
    });
  }
  function renderPlayers(){
    const list=filteredAvailable();
    const totalAvail=state.players.filter(p=>p.status==='available').length;
    $('#availableSubtitle').textContent=state.players.length?`${list.length} mostrati · ${totalAvail} disponibili totali`:'Il primo caricamento del listone richiede internet';
    $('#playerList').innerHTML=list.length?list.slice(0,120).map(p=>playerHtml(p)).join(''):`<div class="empty">${state.players.length?'Nessun giocatore trovato.':'Vai in Impostazioni e tocca “Aggiorna”.'}</div>`;
    bindPlayerActions($('#playerList'));
  }
  function handlePlayerAction(id,action){
    const p=state.players.find(x=>x.id===id); if(!p) return;
    if(action==='target'){ p.target=!p.target; saveState(); return; }
    if(action==='sold'){ pushHistory(); p.status='sold'; p.price=null; saveState(); toast(`${p.name} rimosso`); return; }
    if(action==='mine'){ openBuy(p); return; }
    if(action==='release'){ pushHistory(); p.status='available'; p.price=null; saveState(); toast(`${p.name} rimesso disponibile`); }
  }
  function renderRadar(){
    $('#radarGrid').innerHTML=ROLES.map(role=>{
      const avail=state.players.filter(p=>p.status==='available'&&p.role===role);
      const max=Math.max(1,...TIERS.map(t=>avail.filter(p=>p.tier===t).length));
      return `<div class="radar-card"><div class="radar-title"><span>${role}</span><small>${avail.length} rimasti</small></div>${TIERS.map(t=>{const n=avail.filter(p=>p.tier===t).length;return `<div class="tier-row"><b class="tier-letter tier-${t}">${t}</b><div class="bar"><i style="width:${Math.round(n/max*100)}%"></i></div><strong>${n}</strong></div>`}).join('')}</div>`;
    }).join('');
  }
  function renderTargets(){
    const list=state.players.filter(p=>p.target&&p.status==='available').sort((a,b)=>tierRank(a.tier)-tierRank(b.tier)||(b.fvm??-1)-(a.fvm??-1));
    $('#targetsList').innerHTML=list.length?list.map(p=>playerHtml(p)).join(''):'<div class="empty">Nessun target ancora disponibile.</div>';
    bindPlayerActions($('#targetsList'));
  }
  function renderMine(){
    const list=state.players.filter(p=>p.status==='mine').sort((a,b)=>ROLES.indexOf(a.role)-ROLES.indexOf(b.role)||a.name.localeCompare(b.name,'it'));
    $('#myTeamSubtitle').textContent=`${list.length} giocatori · ${Number(state.settings.initialCredits)-currentCredits()} crediti spesi`;
    $('#myPlayersList').innerHTML=list.length?list.map(p=>playerHtml(p,true)).join(''):'<div class="empty">Ancora nessun acquisto.</div>';
    bindPlayerActions($('#myPlayersList'));
  }
  function renderSettings(){
    $('#teamName').value=state.settings.teamName;
    $('#initialCredits').value=state.settings.initialCredits;
    $('#minBid').value=state.settings.minBid;
    ROLES.forEach(r=>$('#slots'+r).value=state.settings.slots[r]);
  }
  function renderSourceStatus(override='',isError=false){
    const el=$('#sourceStatus'); if(!el) return;
    el.classList.toggle('source-error',!!isError);
    if(override){ el.textContent=override; return; }
    if(state.meta.syncedAt){
      const d=new Date(state.meta.syncedAt);
      el.textContent=`Classic 2026/27 · ${state.meta.activeCount||state.players.length} giocatori · sincronizzato ${d.toLocaleDateString('it-IT')} ${d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}`;
    }else if(state.players.length){ el.textContent=`Listone locale · ${state.players.length} giocatori`; }
    else el.textContent='Caricamento del listone Classic 2026/27…';
  }
  function render(){
    renderMetrics(); renderRoleChips(); renderPlayers(); renderRadar(); renderTargets(); renderMine(); renderSettings(); renderSourceStatus();
  }

  function openBuy(p){
    if(roleRemainingSlots(p.role)<=0){ toast(`Hai già completato gli slot ${p.role}`); return; }
    if(maxBid()<Number(state.settings.minBid||1)){ toast('Crediti insufficienti per acquistare e completare la rosa'); return; }
    pendingBuyId=p.id;
    $('#buyPlayerName').textContent=p.name;
    $('#buyPlayerMeta').textContent=`${p.role} · ${p.club||''} · fascia ${p.tier} · max bid ${maxBid()}`;
    $('#buyPrice').value=''; $('#buyPrice').max=maxBid(); $('#buyPrice').min=state.settings.minBid;
    $('#buyDialog').showModal(); setTimeout(()=>$('#buyPrice').focus(),100);
  }

  $('#buyForm').addEventListener('submit',e=>{
    if(e.submitter?.value==='cancel') return;
    e.preventDefault();
    const p=state.players.find(x=>x.id===pendingBuyId); if(!p) return;
    const price=Number($('#buyPrice').value);
    if(!Number.isFinite(price)||price<Number(state.settings.minBid)){ toast('Prezzo non valido'); return; }
    if(price>maxBid()){ toast(`Max bid attuale: ${maxBid()}`); return; }
    pushHistory(); p.status='mine'; p.price=price; saveState(); $('#buyDialog').close(); toast(`${p.name} acquistato a ${price}`);
  });

  $('#searchInput').addEventListener('input',e=>{query=e.target.value;renderPlayers();});
  $('#clearSearchBtn').onclick=()=>{query='';activeRole='ALL';$('#searchInput').value='';render();};
  $('#undoBtn').onclick=undo;
  $$('.bottom-nav button').forEach(b=>b.onclick=()=>{
    const tab=b.dataset.tab;
    $$('.bottom-nav button').forEach(x=>x.classList.toggle('active',x===b));
    $$('.tab').forEach(x=>x.classList.toggle('active',x.id===`tab-${tab}`));
    if(tab==='asta') setTimeout(()=>$('#searchInput').focus(),50);
  });

  $('#settingsForm').addEventListener('submit',e=>{
    e.preventDefault();
    const spent=Number(state.settings.initialCredits)-currentCredits();
    const newBudget=Math.max(1,Number($('#initialCredits').value)||500);
    if(spent>newBudget){toast(`Budget inferiore ai ${spent} crediti già spesi`);return;}
    state.settings.teamName=$('#teamName').value.trim()||'La mia squadra';
    state.settings.initialCredits=newBudget;
    state.settings.minBid=Math.max(1,Number($('#minBid').value)||1);
    ROLES.forEach(r=>state.settings.slots[r]=Math.max(0,Number($('#slots'+r).value)||0));
    saveState(); toast('Configurazione salvata');
  });

  $('#refreshListBtn').onclick=()=>syncListone(true);
  $('#exportBtn').onclick=()=>{
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`fanta-random-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  $('#backupFile').addEventListener('change',async e=>{
    const f=e.target.files?.[0]; if(!f)return;
    try{state=normalizeState(JSON.parse(await f.text()));assignManagedTiers(state.players);saveState();toast('Backup ripristinato');}
    catch{toast('Backup non valido');}
    e.target.value='';
  });
  $('#resetAuctionBtn').onclick=()=>{
    if(!state.players.length) return;
    if(!confirm(`Reset dell’asta?\n\nTutti i giocatori torneranno disponibili e i crediti torneranno a ${state.settings.initialCredits}. I preferiti ★ resteranno salvati.`)) return;
    state.players.forEach(p=>{p.status='available';p.price=null;});
    state.history=[];
    saveState(); toast('Asta resettata');
  };

  if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}
  render();
  if(!state.players.length) syncListone(false);
})();
