// Simple leaderboard: username-only login, localStorage persistence with history
const STORAGE_KEY = 'ski_leaderboard_v1';

function $(s){return document.querySelector(s)}

// Track timestamps of recent saves to avoid echoing snapshots back to server
const lastSavedAt = {};
// Pending deletes map key -> {timer, backup}
const pendingDeletes = new Map();

function loadData(){
  const raw = localStorage.getItem(STORAGE_KEY);
  let data = raw ? JSON.parse(raw) : {};
  // Migrate old flat format {user: {speed: num, bac: num}} -> {user: {speeds: [{v,t}], bacs: [{v,t}]}}
  Object.keys(data).forEach(name=>{
    const u = data[name];
    if(u && (typeof u.speed === 'number' || typeof u.bac === 'number')){
      const speeds = [];
      const bacs = [];
      if(typeof u.speed === 'number') speeds.push({v: u.speed, t: Date.now()});
      if(typeof u.bac === 'number') bacs.push({v: u.bac, t: Date.now()});
      data[name] = {speeds, bacs};
    }
    if(u && (!Array.isArray(data[name].speeds) || !Array.isArray(data[name].bacs))){
      data[name].speeds = data[name].speeds || [];
      data[name].bacs = data[name].bacs || [];
    }
  });
  return data;
}

function saveData(data){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function login(username){
  localStorage.setItem('ski_user', username);
  renderApp();
}

function logout(){
  localStorage.removeItem('ski_user');
  renderApp();
}

function currentUser(){
  return localStorage.getItem('ski_user') || sessionStorage.getItem('ski_user');
}

function escapeHtml(str){ return (str+'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]); }

function renderApp(){
  const user = currentUser();
  const loginEl = $('#login');
  const appEl = $('#app');
  if(!user){
    loginEl.classList.remove('hidden');
    appEl.classList.add('hidden');
    $('#user-area').innerHTML = '';
  } else {
    loginEl.classList.add('hidden');
    appEl.classList.remove('hidden');
    $('#user-area').innerHTML = `<div>Signed in as <strong>${escapeHtml(user)}</strong> — <button id="signout" class="signout-button" type="button">Sign out</button></div>`;
    $('#signout').onclick = (e)=>{e.preventDefault(); logout();};
    renderLeaderboards();
  }
}

function addEntry(user, type, value){
  const data = loadData();
  data[user] = data[user] || {speeds: [], bacs: []};
  const entry = {v: value, t: Date.now()};
  if(type === 'speed') data[user].speeds.push(entry);
  else if(type === 'bac') data[user].bacs.push(entry);
  saveData(data);

  if(window.FB && typeof window.FB.saveUser === 'function'){
    try{
      lastSavedAt[user] = Date.now();
      window.FB.saveUser(user, data[user]).then(()=>{
        lastSavedAt[user] = Date.now();
        showToast('Saved to cloud');
      }).catch(err=>{
        console.warn('Remote save failed', err);
        showToast('Cloud save failed', {error:true});
      });
    }catch(e){ console.warn('Remote save failed', e); showToast('Cloud save failed', {error:true}); }
  }
}

function renderLeaderboards(){
  const data = loadData();
  const users = Object.keys(data);
  const speedList = [];
  const bacList = [];
  users.forEach(name=>{
    const u = data[name];
    const bestSpeed = (u.speeds && u.speeds.length) ? Math.max(...u.speeds.map(x=>x.v)) : 0;
    const bestBac = (u.bacs && u.bacs.length) ? Math.max(...u.bacs.map(x=>x.v)) : 0;
    if(bestSpeed>0) speedList.push({name, v: bestSpeed});
    if(bestBac>0) bacList.push({name, v: bestBac});
  });

  const speedSorted = speedList.sort((a,b)=>b.v - a.v).slice(0,50);
  const bacSorted = bacList.sort((a,b)=>b.v - a.v).slice(0,50);

  const speedBody = $('#speed-table tbody'); speedBody.innerHTML = '';
  speedSorted.forEach((row,i)=>{ const tr = document.createElement('tr'); tr.innerHTML = `<td>${i+1}</td><td>${escapeHtml(row.name)}</td><td>${Number(row.v).toFixed(1)}</td>`; speedBody.appendChild(tr); });

  const bacBody = $('#bac-table tbody'); bacBody.innerHTML = '';
  bacSorted.forEach((row,i)=>{ const tr = document.createElement('tr'); tr.innerHTML = `<td>${i+1}</td><td>${escapeHtml(row.name)}</td><td>${(Number(row.v)*100).toFixed(2)}</td>`; bacBody.appendChild(tr); });

  renderHistory('speed'); renderHistory('bac');
}

function formatDate(ts){ try{ return new Date(ts).toLocaleString(); }catch(e){ return String(ts); } }

function renderHistory(type){
  const data = loadData();
  const items = [];
  Object.keys(data).forEach(name=>{
    const arr = type === 'speed' ? data[name].speeds || [] : data[name].bacs || [];
    arr.forEach(entry=>items.push({name, v: entry.v, t: entry.t}));
  });
  items.sort((a,b)=>b.t - a.t);
  const el = type === 'speed' ? $('#speed-history') : $('#bac-history');
  el.innerHTML = '';
  if(items.length===0){ el.innerHTML = '<div class="muted">No history yet</div>'; return; }
  items.slice(0,200).forEach(it=>{
    const d = document.createElement('div'); d.className = 'history-item';
    const left = document.createElement('div'); left.innerHTML = `<strong>${escapeHtml(it.name)}</strong> ${type==='speed'?'- '+Number(it.v).toFixed(1)+' km/h':'- '+(Number(it.v)*100).toFixed(2)+'%'}`;
    const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = formatDate(it.t);
    d.appendChild(left);
    if(it.name === currentUser()){
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'history-delete'; btn.title = 'Delete this entry'; btn.textContent = 'Delete';
      btn.onclick = (e)=>{ e.preventDefault(); e.stopPropagation(); deleteEntry(it.name, type, it.t); };
      const right = document.createElement('div'); right.style.display='flex'; right.style.gap='8px'; right.appendChild(meta); right.appendChild(btn); d.appendChild(right);
    } else { d.appendChild(meta); }
    el.appendChild(d);
  });
}

function deleteEntry(name, type, ts){
  const data = loadData(); if(!data[name]) return;
  const arrName = type === 'speed' ? 'speeds' : 'bacs';
  const arr = data[name][arrName] || [];
  const idx = arr.findIndex(e=>e.t === ts); if(idx === -1) return;
  const backup = Object.assign({}, arr[idx]);
  data[name][arrName] = arr.filter(e=>e.t !== ts);
  saveData(data); renderLeaderboards();

  // push deletion immediately
  if(window.FB && typeof window.FB.saveUser === 'function'){
    try{ lastSavedAt[name] = Date.now(); window.FB.saveUser(name, data[name]).then(()=>{ lastSavedAt[name]=Date.now(); showToast('Deletion synced'); }).catch(err=>{ console.warn('Remote save failed', err); showToast('Cloud sync failed', {error:true}); }); }catch(e){ console.warn('Remote save failed', e); showToast('Cloud sync failed', {error:true}); }
  }

  const key = `${name}|${type}|${ts}`;
  if(pendingDeletes.has(key)){ clearTimeout(pendingDeletes.get(key).timer); pendingDeletes.delete(key); }
  const undo = ()=>{
    const cur = loadData(); cur[name] = cur[name] || {speeds:[], bacs:[]}; cur[name][arrName] = (cur[name][arrName]||[]).concat([backup]).sort((a,b)=>a.t - b.t); saveData(cur); renderLeaderboards();
    if(window.FB && typeof window.FB.saveUser === 'function'){ window.FB.saveUser(name, cur[name]).then(()=>{ showToast('Restore synced'); }).catch(err=>{ console.warn('Remote save failed', err); showToast('Cloud sync failed', {error:true}); }); }
    const p = pendingDeletes.get(key); if(p){ clearTimeout(p.timer); pendingDeletes.delete(key); }
  };
  showToast('Entry deleted', {actionText:'Undo', action:undo, timeout:6000});
  const timer = setTimeout(()=>{ pendingDeletes.delete(key); }, 6000);
  pendingDeletes.set(key, {timer, backup});
}

// Toast helper
function showToast(message, opts){
  opts = opts || {}; const container = document.getElementById('toast-container'); if(!container) return;
  const toast = document.createElement('div'); toast.className = 'toast' + (opts.error ? ' error' : '');
  const msg = document.createElement('div'); msg.className = 'msg'; msg.textContent = message; toast.appendChild(msg);
  if(opts.actionText && typeof opts.action === 'function'){ const a = document.createElement('button'); a.className='action'; a.textContent = opts.actionText; a.onclick = (e)=>{ e.preventDefault(); opts.action(); try{ container.removeChild(toast); }catch(e){} }; toast.appendChild(a); }
  container.appendChild(toast); const t = opts.timeout || 4000; setTimeout(()=>{ try{ if(container.contains(toast)) container.removeChild(toast); }catch(e){} }, t);
}

// Tab switching
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-tab]'); if(!btn) return; const tab = btn.dataset.tab; document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active', b===btn)); document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('hidden', p.id!==tab));
});

// Login form
document.getElementById('login-form').addEventListener('submit', (e)=>{ e.preventDefault(); const name = document.getElementById('username').value.trim(); if(!name) return; login(name.toLowerCase()); });

// Speed submit
document.getElementById('speed-form').addEventListener('submit', (e)=>{ e.preventDefault(); const user = currentUser(); if(!user) return alert('Sign in first'); const v = parseFloat(document.getElementById('speed-input').value); if(isNaN(v) || v<0) return alert('Enter a valid speed'); addEntry(user, 'speed', v); renderLeaderboards(); document.getElementById('speed-input').value=''; });

// BAC submit
document.getElementById('bac-form').addEventListener('submit', (e)=>{ e.preventDefault(); const user = currentUser(); if(!user) return alert('Sign in first'); let v = parseFloat(document.getElementById('bac-input').value); if(isNaN(v) || v<0) return alert('Enter a valid BAC'); if(v > 1.0){ v = v/100; } if(v < 0 || v > 1.5) return alert('BAC out of expected range (0 - 1.5)'); addEntry(user, 'bac', v); renderLeaderboards(); document.getElementById('bac-input').value=''; });

// Remote sync
function startRemoteSyncIfAvailable(){
  if(window.FB && typeof window.FB.startSync === 'function'){
    let first = true;
    window.FB.startSync(remoteData => {
      if(remoteData && typeof remoteData === 'object'){
        try{
          const local = loadData(); const merged = {}; const users = new Set([...Object.keys(remoteData), ...Object.keys(local)]);
          users.forEach(name => {
            const r = remoteData[name] || { speeds: [], bacs: [] };
            const l = local[name] || { speeds: [], bacs: [] };
            function mergeArr(a,b){ const map = new Map(); (a||[]).forEach(it=>{ if(it && it.t) map.set(it.t, it); }); (b||[]).forEach(it=>{ if(it && it.t) map.set(it.t, it); }); return Array.from(map.values()).sort((x,y)=>x.t - y.t); }
            const me = name === currentUser();
            if(me){ merged[name] = { speeds: (l.speeds||[]).slice().sort((a,b)=>a.t-b.t), bacs: (l.bacs||[]).slice().sort((a,b)=>a.t-b.t) }; }
            else { merged[name] = { speeds: mergeArr(r.speeds, l.speeds), bacs: mergeArr(r.bacs, l.bacs) }; }
          });
          saveData(merged);
          users.forEach(name =>{
            const r = remoteData[name] || { speeds: [], bacs: [] }; const m = merged[name];
            const needsPush = (m.speeds.length !== (r.speeds||[]).length) || (m.bacs.length !== (r.bacs||[]).length);
            const cooldown = 2000; const last = lastSavedAt[name] || 0;
            if(needsPush && (Date.now() - last) > cooldown){ try{ lastSavedAt[name] = Date.now(); window.FB.saveUser(name, m).then(()=>{ lastSavedAt[name]=Date.now(); }).catch(()=>{}); }catch(e){ console.warn('Failed to push merged user', name, e); } }
          });
        }catch(e){ console.error('Failed merging remote/local data', e); }
        renderApp(); if(first){ first=false; const el=document.getElementById('fb-status'); if(el) el.textContent='Firebase: connected'; }
      } else { const el=document.getElementById('fb-status'); if(el) el.textContent='Firebase: no data'; }
    }, err=>{ console.error('startSync error', err); const el=document.getElementById('fb-status'); if(el) el.textContent='Firebase: error'; });
  }
}

startRemoteSyncIfAvailable();
window.addEventListener('firebase-ready', ()=>{ startRemoteSyncIfAvailable(); });

renderApp();
// Simple leaderboard: username-only login, localStorage persistence with history
const STORAGE_KEY = 'ski_leaderboard_v1';

function $(s){return document.querySelector(s)}

function loadData(){
  const raw = localStorage.getItem(STORAGE_KEY);
  let data = raw ? JSON.parse(raw) : {};
  // Migrate old flat format {user: {speed: num, bac: num}} -> {user: {speeds: [{v,t}], bacs: [{v,t}]}}
  Object.keys(data).forEach(name=>{
    const u = data[name];
    if(u && (typeof u.speed === 'number' || typeof u.bac === 'number')){
      const speeds = [];
      const bacs = [];
      if(typeof u.speed === 'number') speeds.push({v: u.speed, t: Date.now()});
      if(typeof u.bac === 'number') bacs.push({v: u.bac, t: Date.now()});
      data[name] = {speeds, bacs};
    }
    // If already in desired shape, ensure arrays exist
    if(u && (!Array.isArray(data[name].speeds) || !Array.isArray(data[name].bacs))){
      data[name].speeds = data[name].speeds || [];
      data[name].bacs = data[name].bacs || [];
    }
  });
  return data;
}

function saveData(data){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function login(username){
  // persist username in localStorage so it remains across tabs/sessions
  localStorage.setItem('ski_user', username);
  renderApp();
}

function logout(){
  localStorage.removeItem('ski_user');
  renderApp();
}

function currentUser(){
  // Prefer localStorage; support sessionStorage legacy if present
  return localStorage.getItem('ski_user') || sessionStorage.getItem('ski_user');
}

function renderApp(){
  const user = currentUser();
  const loginEl = $('#login');
  const appEl = $('#app');
  if(!user){
    loginEl.classList.remove('hidden');
    appEl.classList.add('hidden');
    $('#user-area').innerHTML = '';
  } else {
    loginEl.classList.add('hidden');
    appEl.classList.remove('hidden');
    $('#user-area').innerHTML = `<div>Signed in as <strong>${escapeHtml(user)}</strong> — <button id="signout" class="signout-button" type="button">Sign out</button></div>`;
    $('#signout').onclick = (e)=>{e.preventDefault(); logout();};
    renderLeaderboards();
  }
}

function escapeHtml(str){ return (str+'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]); }

function addEntry(user, type, value){
  const data = loadData();
  data[user] = data[user] || {speeds: [], bacs: []};
  const entry = {v: value, t: Date.now()};
  if(type === 'speed') data[user].speeds.push(entry);
  else if(type === 'bac') data[user].bacs.push(entry);
  // Track timestamps of recent saves to avoid echoing snaps back to server
  const lastSavedAt = {};
  saveData(data);
  // If Firebase is available, push this user's updated record remotely too and show toast on result
  if(window.FB && typeof window.FB.saveUser === 'function'){
    try{
      window.FB.saveUser(user, data[user]).then(()=>{
        showToast('Saved to cloud');
      }).catch(err=>{
        console.warn('Remote save failed', err);
        showToast('Cloud save failed', {error:true});
      });
    }catch(e){ console.warn('Remote save failed', e); showToast('Cloud save failed', {error:true}); }
        lastSavedAt[user] = Date.now();
        window.FB.saveUser(user, data[user]).then(()=>{
          lastSavedAt[user] = Date.now();
          showToast('Saved to cloud');
        }).catch(err=>{
          console.warn('Remote save failed', err);
          showToast('Cloud save failed', {error:true});
        });

  // Build best-per-user lists
  const speedList = [];
  const bacList = [];
  users.forEach(name=>{
    const u = data[name];
    const bestSpeed = (u.speeds && u.speeds.length) ? Math.max(...u.speeds.map(x=>x.v)) : 0;
    const bestBac = (u.bacs && u.bacs.length) ? Math.max(...u.bacs.map(x=>x.v)) : 0;
    if(bestSpeed>0) speedList.push({name, v: bestSpeed});
    if(bestBac>0) bacList.push({name, v: bestBac});
  });

  const speedSorted = speedList.sort((a,b)=>b.v - a.v).slice(0,50);
  const bacSorted = bacList.sort((a,b)=>b.v - a.v).slice(0,50);

  const speedBody = $('#speed-table tbody');
  speedBody.innerHTML = '';
  speedSorted.forEach((row,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td>${escapeHtml(row.name)}</td><td>${Number(row.v).toFixed(1)}</td>`;
    speedBody.appendChild(tr);
  });

  const bacBody = $('#bac-table tbody');
  bacBody.innerHTML = '';
  bacSorted.forEach((row,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td>${escapeHtml(row.name)}</td><td>${(Number(row.v)*100).toFixed(2)}</td>`;
    bacBody.appendChild(tr);
  });

  // Render histories (latest first)
  renderHistory('speed');
  renderHistory('bac');
}

function formatDate(ts){
  try{ return new Date(ts).toLocaleString(); }catch(e){ return String(ts); }
}

function renderHistory(type){
  const data = loadData();
  const items = [];
  Object.keys(data).forEach(name=>{
    const arr = type === 'speed' ? data[name].speeds || [] : data[name].bacs || [];
    arr.forEach(entry=>items.push({name, v: entry.v, t: entry.t}));
  });
  items.sort((a,b)=>b.t - a.t);
  const el = type === 'speed' ? $('#speed-history') : $('#bac-history');
  el.innerHTML = '';
  if(items.length===0){ el.innerHTML = '<div class="muted">No history yet</div>'; return; }
  items.slice(0,200).forEach(it=>{
    const d = document.createElement('div');
    d.className = 'history-item';
    const left = document.createElement('div');
    left.innerHTML = `<strong>${escapeHtml(it.name)}</strong> ${type==='speed'?'- '+Number(it.v).toFixed(1)+' km/h':'- '+(Number(it.v)*100).toFixed(2)+'%'}`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = formatDate(it.t);
    d.appendChild(left);
    // If the entry belongs to the signed-in user, show delete button
    if(it.name === currentUser()){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'history-delete';
      btn.title = 'Delete this entry';
      btn.textContent = 'Delete';
      btn.onclick = (e)=>{
        e.preventDefault();
        e.stopPropagation();
        // delete without confirm (undo available)
        deleteEntry(it.name, type, it.t);
      };
      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.gap = '8px';
      right.appendChild(meta);
      right.appendChild(btn);
      d.appendChild(right);
    } else {
      d.appendChild(meta);
    }
    el.appendChild(d);
  });
}

// Pending deletes map key -> {timer, backup}
const pendingDeletes = new Map();

function deleteEntry(name, type, ts){
  const data = loadData();
  if(!data[name]) return;
  const arrName = type === 'speed' ? 'speeds' : 'bacs';
  const arr = data[name][arrName] || [];
  const idx = arr.findIndex(e=>e.t === ts);
  if(idx === -1) return;

  // Backup the entry so we can restore on undo
  const backup = Object.assign({}, arr[idx]);
  // Remove locally and save immediately for quick UI feedback
  data[name][arrName] = arr.filter(e=>e.t !== ts);
  saveData(data);
  renderLeaderboards();
  // Immediately push deletion to remote (if available) to avoid race with incoming snapshots
  const key = `${name}|${type}|${ts}`;
  if(window.FB && typeof window.FB.saveUser === 'function'){
    const cur = loadData();
    const userData = cur[name] || {speeds:[], bacs:[]};
    window.FB.saveUser(name, userData).then(()=>{
      showToast('Deletion synced');
    }).catch(err=>{
      console.warn('Remote save failed', err);
      showToast('Cloud sync failed', {error:true});
    });
  }

  // Setup undo window: remote has deletion now; if undo, restore locally and push again
  if(pendingDeletes.has(key)){
    clearTimeout(pendingDeletes.get(key).timer);
    pendingDeletes.delete(key);
  }
  const undo = ()=>{
    const cur = loadData();
    cur[name] = cur[name] || {speeds:[], bacs:[]};
    cur[name][arrName] = (cur[name][arrName] || []).concat([backup]).sort((a,b)=>a.t - b.t);
    saveData(cur);
    renderLeaderboards();
    // push restored entry
    if(window.FB && typeof window.FB.saveUser === 'function'){
      window.FB.saveUser(name, cur[name]).then(()=>{
        showToast('Restore synced');
      }).catch(err=>{
        console.warn('Remote save failed', err);
        showToast('Cloud sync failed', {error:true});
      });
    }
    const p = pendingDeletes.get(key);
    if(p){ clearTimeout(p.timer); pendingDeletes.delete(key); }
  };

  showToast('Entry deleted', {actionText:'Undo', action:undo, timeout:6000});

  const timer = setTimeout(()=>{ pendingDeletes.delete(key); }, 6000);
  pendingDeletes.set(key, {timer, backup});
}

// Tab switching
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-tab]');
  if(!btn) return;
  const tab = btn.dataset.tab;
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active', b===btn));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('hidden', p.id!==tab));
});

// Toast helper
function showToast(message, opts){
  opts = opts || {};
  const container = document.getElementById('toast-container');
  if(!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast' + (opts.error ? ' error' : '');
  const msg = document.createElement('div'); msg.className = 'msg'; msg.textContent = message;
  toast.appendChild(msg);
  if(opts.actionText && typeof opts.action === 'function'){
    const a = document.createElement('button'); a.className = 'action'; a.textContent = opts.actionText;
    a.onclick = (e)=>{ e.preventDefault(); opts.action(); container.removeChild(toast); };
    toast.appendChild(a);
  }
  container.appendChild(toast);
  const t = opts.timeout || 4000;
  setTimeout(()=>{ try{ if(container.contains(toast)) container.removeChild(toast); }catch(e){} }, t);
}

// Login form
document.getElementById('login-form').addEventListener('submit', (e)=>{
  e.preventDefault();
  const name = document.getElementById('username').value.trim();
  if(!name) return;
  login(name.toLowerCase());
});

// Speed submit: add entry (keep history)
document.getElementById('speed-form').addEventListener('submit', (e)=>{
  e.preventDefault();
  const user = currentUser(); if(!user) return alert('Sign in first');
  const v = parseFloat(document.getElementById('speed-input').value);
  if(isNaN(v) || v<0) return alert('Enter a valid speed');
  addEntry(user, 'speed', v);
  renderLeaderboards();
  document.getElementById('speed-input').value='';
});

// BAC submit: add entry (keep history)
document.getElementById('bac-form').addEventListener('submit', (e)=>{
  e.preventDefault();
  const user = currentUser(); if(!user) return alert('Sign in first');
  let v = parseFloat(document.getElementById('bac-input').value);
  if(isNaN(v) || v<0) return alert('Enter a valid BAC');
  // Accept both decimal (e.g. 0.085) and percent-like input (e.g. 1.5 meaning 1.5%)
  if(v > 1.0){
    // treat as percent (1.5 -> 0.015)
    v = v / 100;
  }
  if(v < 0 || v > 1.5) return alert('BAC out of expected range (0 - 1.5)');
  addEntry(user, 'bac', v);
  renderLeaderboards();
  document.getElementById('bac-input').value='';
});

// Init
function startRemoteSyncIfAvailable(){
  if(window.FB && typeof window.FB.startSync === 'function'){
    let first = true;
    window.FB.startSync(remoteData => {
      if(remoteData && typeof remoteData === 'object'){
        try{
          // Merge remote and local so no one loses entries: union by timestamp
          const local = loadData();
          const merged = {};
          const users = new Set([...Object.keys(remoteData), ...Object.keys(local)]);
          users.forEach(name => {
            const r = remoteData[name] || { speeds: [], bacs: [] };
            const l = local[name] || { speeds: [], bacs: [] };

            function mergeArr(a, b){
              const map = new Map();
              (a || []).forEach(it => { if(it && it.t) map.set(it.t, it); });
              (b || []).forEach(it => { if(it && it.t) map.set(it.t, it); });
              const vals = Array.from(map.values()).sort((x,y)=>x.t - y.t);
              return vals;
            }

            // If this user is the currently signed-in user, prefer local data
            const me = name === currentUser();
            if(me){
              merged[name] = {
                speeds: (l.speeds || []).slice().sort((a,b)=>a.t - b.t),
                bacs: (l.bacs || []).slice().sort((a,b)=>a.t - b.t)
              };
            } else {
              merged[name] = {
                speeds: mergeArr(r.speeds, l.speeds),
                bacs: mergeArr(r.bacs, l.bacs)
              };
            }
          });

          // save merged to local
          saveData(merged);

          // if local had entries that remote lacked, push them up
          users.forEach(name => {
            const r = remoteData[name] || { speeds: [], bacs: [] };
            const m = merged[name];
            // if merged is longer than remote, push merged
            const needsPush = (m.speeds.length !== (r.speeds || []).length) || (m.bacs.length !== (r.bacs || []).length);
            if(needsPush){
              try{ window.FB.saveUser(name, m); }catch(e){ console.warn('Failed to push merged user', name, e); }
            }
          });

        }catch(e){ console.error('Failed merging remote/local data', e); }
        renderApp();
        if(first){
          first = false;
          const el = document.getElementById('fb-status'); if(el) el.textContent = 'Firebase: connected';
        }
      } else {
        const el = document.getElementById('fb-status'); if(el) el.textContent = 'Firebase: no data';
      }
    }, err => {
      console.error('startSync error', err);
      const el = document.getElementById('fb-status'); if(el) el.textContent = 'Firebase: error';
    });
  }
}

// Start sync now if Firebase already initialized
startRemoteSyncIfAvailable();

// Also listen for firebase-ready event in case Firebase initializes after script load
window.addEventListener('firebase-ready', ()=>{
  startRemoteSyncIfAvailable();
});

renderApp();
