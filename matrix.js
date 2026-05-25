const SUPABASE_URL = 'https://fzlwkbhpsklsgkinwljt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6bHdrYmhwc2tsc2draW53bGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwNTE0MzEsImV4cCI6MjA4NzYyNzQzMX0.lc6A8RCUySU0Hn9MjPcR9rH1c8DjSj_A7MV8JuLvwik';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let allMarkets = [], currentMarketId = null;
let allSubdivisions = [], allParcels = [];
let selectedSubId = null, selectedParcelId = null;
let currentFilter = 'all', searchTerm = '', currentView = 'map';
let map, parcelLayers = {}, subLayers = {};
let dashboardInitialized = false;

const STATUS_COLORS = {
  unknown:'#555566',not_contacted:'#666680',contacted:'#00d4ff',mailed:'#b388ff',
  responded:'#ffd600',off_market:'#00e676',considering:'#ff9100',listed_blk:'#ff1744',
  listed_other:'#ff4081',sold_blk:'#00e5ff',sold_other:'#4db6ac',not_interested:'#616161',
  do_not_contact:'#d32f2f'
};

// ===================== AUTH =====================
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginError');
  btn.disabled = true; btn.textContent = 'Authenticating...'; err.textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { err.textContent = error.message; btn.disabled = false; btn.textContent = 'Access Brain'; return; }
  currentUser = data.user;
  showDashboard();
}

async function handleLogout() {
  await sb.auth.signOut();
  currentUser = null; dashboardInitialized = false;
  document.getElementById('dashboard').classList.remove('visible');
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').textContent = '';
  document.getElementById('loginBtn').textContent = 'Access Brain';
  document.getElementById('loginBtn').disabled = false;
}

function showDashboard() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('dashboard').classList.add('visible');
  document.getElementById('userName').textContent = currentUser.user_metadata?.full_name || currentUser.email;
  init();
}

async function checkSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session && session.user) { currentUser = session.user; showDashboard(); }
  else { document.getElementById('loginEmail').focus(); }
}

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    currentUser = null;
    document.getElementById('dashboard').classList.remove('visible');
    document.getElementById('loginScreen').classList.remove('hidden');
  }
});

// ===================== INIT =====================
async function init() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;
  await loadMarkets();
  initMap(); initSearch(); initFilters();
  // Load ALL markets at once
  await loadMarketData();
}

async function loadMarkets() {
  const { data } = await sb.from('markets').select('*').order('name');
  allMarkets = data || [];
  const sel = document.getElementById('marketSelect');
  sel.innerHTML = allMarkets.map(m => `<option value="${m.id}">${m.display_name}${m.is_active?' (Active)':''}</option>`).join('');
  sel.onchange = async () => { currentMarketId = sel.value; selectedSubId = null; selectedParcelId = null; closePanel(); await loadMarketData(); };
}

function initMap() {
  map = L.map('map', { center:[34.75,-92.45], zoom:7, zoomControl:true, preferCanvas:true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom:19, attribution:'CARTO' }).addTo(map);
}

function initSearch() {
  const input = document.getElementById('searchInput');
  let timer;
  input.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { searchTerm = input.value.toLowerCase().trim(); renderSubList(); renderMap(); }, 250); };
}

function initFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.onclick = () => { document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); currentFilter = btn.dataset.filter; renderSubList(); renderMap(); };
  });
}

// ===================== DATA =====================
async function loadMarketData() {
  document.getElementById('subList').innerHTML = '<div class="loading"><div class="spinner"></div>Loading ALL Markets...</div>';
  // Load ALL subdivisions from ALL markets
  const { data: subs } = await sb.from('subdivisions').select('*').order('name');
  allSubdivisions = subs || [];
  allParcels = [];
  let from = 0, pageSize = 1000;
  console.log('Loading all parcels from all markets...');
  while (true) {
    const { data: batch } = await sb.from('parcels')
      .select('id,pin,address,city,zip,owner_full_name,owner_first_name,owner_last_name,subdivision_id,status,off_market_willing,notes,phone,email,skiptraced,last_mailed_at,times_mailed,center_lat,center_lng,parcel_geojson,mail_history,tags')
      .range(from, from + pageSize - 1);
    if (!batch || batch.length === 0) break;
    allParcels.push(...batch);
    console.log(`Loaded ${allParcels.length} parcels...`);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  console.log(`Total parcels loaded: ${allParcels.length}`);
  updateStats(); renderSubList(); renderMap();
}

// ===================== STATS =====================
function updateStats() {
  const total = allParcels.length, counts = {};
  allParcels.forEach(p => { counts[p.status] = (counts[p.status]||0)+1; });
  document.getElementById('statsBar').innerHTML = [
    {l:'Total',v:total,c:'#fff'},{l:'Off-Market',v:counts.off_market||0,c:STATUS_COLORS.off_market},
    {l:'Contacted',v:counts.contacted||0,c:STATUS_COLORS.contacted},{l:'Mailed',v:counts.mailed||0,c:STATUS_COLORS.mailed},
    {l:'Responded',v:counts.responded||0,c:STATUS_COLORS.responded},{l:'Listed',v:counts.listed_blk||0,c:STATUS_COLORS.listed_blk},
    {l:'Sold',v:counts.sold_blk||0,c:STATUS_COLORS.sold_blk}
  ].map(s => `<div class="stat-item"><div class="dot" style="background:${s.c}"></div><span>${s.l}:</span><span class="val">${s.v.toLocaleString()}</span></div>`).join('');
}

// ===================== SUBDIVISIONS =====================
function renderSubList() {
  const container = document.getElementById('subList');
  const subStats = {}, filtered = getFilteredParcels();
  filtered.forEach(p => { const sid = p.subdivision_id||'none'; if(!subStats[sid]) subStats[sid]={count:0,statuses:{}}; subStats[sid].count++; subStats[sid].statuses[p.status]=(subStats[sid].statuses[p.status]||0)+1; });
  let html = `<div class="sub-item ${!selectedSubId?'active':''}" onclick="selectSub(null)"><div class="sub-name">All Parcels</div><div class="sub-count">${filtered.length}</div></div>`;
  const sorted = [...allSubdivisions].sort((a,b) => (subStats[b.id]?.count||0)-(subStats[a.id]?.count||0));
  for (const sub of sorted) {
    const stats = subStats[sub.id]; if(!stats||stats.count===0) continue;
    const dots = Object.entries(stats.statuses).filter(([s])=>s!=='not_contacted'&&s!=='unknown').slice(0,4).map(([s])=>`<div class="mini-dot" style="background:${STATUS_COLORS[s]}"></div>`).join('');
    html += `<div class="sub-item ${selectedSubId===sub.id?'active':''}" onclick="selectSub('${sub.id}')"><div class="sub-name">${sub.display_name||sub.name}</div><div class="sub-stats">${dots}</div><div class="sub-count">${stats.count}</div></div>`;
  }
  container.innerHTML = html;
}

function selectSub(subId) {
  selectedSubId = subId; selectedParcelId = null;
  renderSubList(); renderMap();
  if (currentView==='list') renderParcelTable();
  closePanel();
  if (subId) {
    renderParcelSideList();
    document.getElementById('subList').style.display = 'none';
    document.getElementById('parcelSideList').style.display = '';
    document.getElementById('sidebarActions').style.display = '';
    const sub = allSubdivisions.find(s=>s.id===subId);
    if (sub&&sub.center_lat&&sub.center_lng) map.setView([sub.center_lat,sub.center_lng],16);
  } else {
    document.getElementById('subList').style.display = '';
    document.getElementById('parcelSideList').style.display = 'none';
    document.getElementById('sidebarActions').style.display = 'none';
  }
}

function renderParcelSideList() {
  const container = document.getElementById('parcelSideList');
  const filtered = getFilteredParcels();
  const sub = allSubdivisions.find(s=>s.id===selectedSubId);
  const subName = sub?(sub.display_name||sub.name):'Parcels';
  let html = `<div class="sub-item" onclick="selectSub(null)" style="background:var(--surface2);border-bottom:2px solid var(--accent)"><div class="sub-name" style="color:var(--accent)">&larr; Back</div></div>`;
  html += `<div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:14px;font-weight:600">${subName} <span style="color:var(--text-dim);font-weight:400;font-size:12px">(${filtered.length})</span></div>`;
  for (const p of filtered) {
    const color = STATUS_COLORS[p.status]||STATUS_COLORS.unknown;
    html += `<div class="sub-item ${selectedParcelId===p.id?'active':''}" onclick="selectParcel('${p.id}')"><div class="mini-dot" style="background:${color};width:8px;height:8px"></div><div style="flex:1;overflow:hidden"><div class="sub-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.address||'No address'}</div><div style="font-size:11px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.owner_full_name||'Unknown'}</div></div><span class="status-badge status-${p.status}" style="font-size:9px;padding:2px 6px">${p.status.replace(/_/g,' ')}</span></div>`;
  }
  container.innerHTML = html;
}

// ===================== FILTERING =====================
function getFilteredParcels() {
  return allParcels.filter(p => {
    if (currentFilter!=='all' && p.status!==currentFilter) return false;
    if (selectedSubId && p.subdivision_id!==selectedSubId) return false;
    if (searchTerm) { const h = `${p.address} ${p.owner_full_name} ${p.pin} ${p.phone} ${p.email}`.toLowerCase(); if(!h.includes(searchTerm)) return false; }
    return true;
  });
}

// ===================== MAP =====================
function renderMap() {
  Object.values(parcelLayers).forEach(l=>map.removeLayer(l));
  Object.values(subLayers).forEach(l=>map.removeLayer(l));
  parcelLayers = {}; subLayers = {};
  const filtered = getFilteredParcels(), bounds = [];
  if (!selectedSubId) {
    allSubdivisions.forEach(sub => {
      if(!sub.boundary_geojson) return;
      try { const layer = L.geoJSON(sub.boundary_geojson,{style:{color:'#334',weight:1,fillOpacity:0.05,fillColor:'#00d4ff'}}).addTo(map); layer.on('click',()=>selectSub(sub.id)); layer.bindTooltip(sub.display_name||sub.name,{sticky:true}); subLayers[sub.id]=layer; } catch(e){}
    });
  }
  for (const p of filtered) {
    if(!p.center_lat||!p.center_lng) continue;
    const color = STATUS_COLORS[p.status]||STATUS_COLORS.unknown;
    const circle = L.circleMarker([p.center_lat,p.center_lng],{radius:selectedSubId?8:4,fillColor:color,fillOpacity:0.7,color:color,weight:1,opacity:0.9}).addTo(map);
    circle.on('click',()=>selectParcel(p.id));
    circle.bindTooltip(`${p.address||'No address'}<br>${p.owner_full_name||''}`);
    parcelLayers[p.id] = circle;
    bounds.push([p.center_lat,p.center_lng]);
  }
  if (bounds.length>0 && !selectedSubId) map.fitBounds(bounds,{padding:[20,20]});
}

// ===================== LIST VIEW =====================
function renderParcelTable() {
  const filtered = getFilteredParcels(), subMap = {};
  allSubdivisions.forEach(s=>{subMap[s.id]=s.display_name||s.name;});
  document.getElementById('parcelTableBody').innerHTML = filtered.map(p => `<tr class="parcel-row" onclick="selectParcel('${p.id}')" style="cursor:pointer"><td style="padding:8px 16px">${p.address||'N/A'}</td><td style="padding:8px 16px;color:var(--text-dim);font-size:12px">${p.owner_full_name||'N/A'}</td><td style="padding:8px 16px;color:var(--text-dim);font-size:12px">${subMap[p.subdivision_id]||'N/A'}</td><td style="padding:8px 16px"><span class="status-badge status-${p.status}">${p.status.replace(/_/g,' ')}</span></td><td style="padding:8px 16px;color:var(--text-dim);font-size:11px">${p.pin||''}</td></tr>`).join('');
}

function setView(view) {
  currentView = view;
  document.getElementById('btnMapView').classList.toggle('active',view==='map');
  document.getElementById('btnListView').classList.toggle('active',view==='list');
  document.getElementById('mapArea').style.display = view==='map'?'':'none';
  document.getElementById('parcelListArea').style.display = view==='list'?'':'none';
  if(view==='list') renderParcelTable();
  if(view==='map') setTimeout(()=>map.invalidateSize(),100);
}

// ===================== PARCEL DETAIL =====================
async function selectParcel(parcelId) {
  selectedParcelId = parcelId;
  const p = allParcels.find(x=>x.id===parcelId);
  if(!p) return;
  if(selectedSubId) renderParcelSideList();
  const panel = document.getElementById('rightPanel');
  panel.classList.remove('collapsed');
  setTimeout(()=>map.invalidateSize(),350);
  const sub = allSubdivisions.find(s=>s.id===p.subdivision_id);
  document.getElementById('panelTitle').textContent = p.address||'Parcel Details';
  document.getElementById('parcelDetail').innerHTML = `
    <div class="detail-section"><h4>Property</h4>
      <div class="detail-row"><span class="label">Address</span><span class="value">${p.address||'N/A'}</span></div>
      <div class="detail-row"><span class="label">City/Zip</span><span class="value">${p.city||''}, AR ${p.zip||''}</span></div>
      <div class="detail-row"><span class="label">PIN</span><span class="value">${p.pin||'N/A'}</span></div>
      <div class="detail-row"><span class="label">Subdivision</span><span class="value">${sub?(sub.display_name||sub.name):'N/A'}</span></div>
    </div>
    <div class="detail-section"><h4>Owner</h4>
      <div class="detail-row"><span class="label">Name</span><span class="value">${p.owner_full_name||'N/A'}</span></div>
      <div class="detail-row"><span class="label">Phone</span><span class="value">${p.phone||'<span style="color:var(--text-dim)">Not skiptraced</span>'}</span></div>
      <div class="detail-row"><span class="label">Email</span><span class="value">${p.email||'<span style="color:var(--text-dim)">None</span>'}</span></div>
      <div class="detail-row"><span class="label">Skiptraced</span><span class="value">${p.skiptraced?'<span style="color:var(--green)">Yes</span>':'<span style="color:var(--text-dim)">No</span>'}</span></div>
    </div>
    <div class="detail-section"><h4>Status</h4>
      <select class="status-select" id="statusSelect" onchange="updateParcelStatus('${p.id}',this.value)">
        ${Object.keys(STATUS_COLORS).map(s=>`<option value="${s}" ${p.status===s?'selected':''}>${s.replace(/_/g,' ').toUpperCase()}</option>`).join('')}
      </select>
      <div style="margin-top:8px"><label style="font-size:12px;display:flex;align-items:center;gap:6px;color:var(--text-dim)"><input type="checkbox" id="offMarketCheck" ${p.off_market_willing?'checked':''} onchange="updateParcelField('${p.id}','off_market_willing',this.checked)"> Willing to sell off-market</label></div>
    </div>
    <div class="detail-section"><h4>Mailing</h4>
      <div class="detail-row"><span class="label">Times Mailed</span><span class="value">${p.times_mailed||0}</span></div>
      <div class="detail-row"><span class="label">Last Mailed</span><span class="value">${p.last_mailed_at?new Date(p.last_mailed_at).toLocaleDateString():'Never'}</span></div>
    </div>
    <div class="detail-section"><h4>Notes</h4>
      <textarea class="notes-area" id="notesArea" placeholder="Add notes...">${p.notes||''}</textarea>
      <button class="btn btn-secondary" style="margin-top:6px;width:100%" onclick="saveNotes('${p.id}')">Save Notes</button>
    </div>
    <div class="detail-section"><h4>Contact</h4>
      <div style="display:flex;gap:8px;margin-bottom:6px">
        <input type="text" id="phoneInput" value="${p.phone||''}" placeholder="Phone" style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:12px">
        <input type="text" id="emailInput" value="${p.email||''}" placeholder="Email" style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:12px">
      </div>
      <button class="btn btn-secondary" style="width:100%" onclick="saveContact('${p.id}')">Save Contact Info</button>
    </div>`;
  Object.values(parcelLayers).forEach(l=>{l.setStyle({weight:1})});
  if(parcelLayers[parcelId]){parcelLayers[parcelId].setStyle({weight:3,color:'#fff'});map.panTo(parcelLayers[parcelId].getLatLng());}
  document.getElementById('actionBar').innerHTML = `<button class="btn btn-secondary" onclick="openExportModal()">Export CSV</button><button class="btn btn-danger" onclick="updateParcelStatus('${p.id}','do_not_contact')">DNC</button>`;
}

function closePanel() {
  document.getElementById('rightPanel').classList.add('collapsed');
  selectedParcelId = null;
  Object.values(parcelLayers).forEach(l=>{l.setStyle({weight:1})});
  setTimeout(()=>map.invalidateSize(),350);
}

// ===================== UPDATES =====================
async function updateParcelStatus(id,status) {
  const{error}=await sb.from('parcels').update({status}).eq('id',id);
  if(error){showToast('Error: '+error.message,true);return;}
  const p=allParcels.find(x=>x.id===id); if(p) p.status=status;
  updateStats(); renderSubList();
  if(parcelLayers[id]) parcelLayers[id].setStyle({fillColor:STATUS_COLORS[status],color:STATUS_COLORS[status]});
  showToast('Status updated');
}

async function updateParcelField(id,field,value) {
  const{error}=await sb.from('parcels').update({[field]:value}).eq('id',id);
  if(error){showToast('Error: '+error.message,true);return;}
  const p=allParcels.find(x=>x.id===id); if(p) p[field]=value;
  showToast('Updated');
}

async function saveNotes(id) { await updateParcelField(id,'notes',document.getElementById('notesArea').value); }

async function saveContact(id) {
  const phone=document.getElementById('phoneInput').value, email=document.getElementById('emailInput').value;
  const{error}=await sb.from('parcels').update({phone,email,skiptraced:!!phone}).eq('id',id);
  if(error){showToast('Error: '+error.message,true);return;}
  const p=allParcels.find(x=>x.id===id); if(p){p.phone=phone;p.email=email;p.skiptraced=!!phone;}
  showToast('Contact info saved');
}

function markAllMailedPrompt(){const c=prompt('Campaign name:');if(c)markAllMailed(c);}

async function markAllMailed(campaign) {
  const filtered=getFilteredParcels(), now=new Date().toISOString(), ids=filtered.map(p=>p.id);
  for(let i=0;i<ids.length;i+=100){await sb.from('parcels').update({status:'mailed',last_mailed_at:now}).in('id',ids.slice(i,i+100));}
  filtered.forEach(p=>{p.status='mailed';p.last_mailed_at=now;p.times_mailed=(p.times_mailed||0)+1;});
  updateStats();renderSubList();if(selectedSubId)renderParcelSideList();renderMap();
  showToast(`Marked ${filtered.length} parcels as mailed (${campaign})`);
}

// ===================== EXPORT =====================
function openExportModal(){document.getElementById('exportModal').classList.add('show');}
function closeExportModal(){document.getElementById('exportModal').classList.remove('show');}

function doExport() {
  const campaign=document.getElementById('exportCampaign').value||'export';
  const markMailed=document.getElementById('exportMarkMailed').checked;
  const parcels=getFilteredParcels();
  if(!parcels.length){showToast('No parcels',true);closeExportModal();return;}
  const rows=[['First Name','Last Name','Address','City','State','Zip']];
  parcels.forEach(p=>rows.push([(p.owner_first_name||'').replace(/"/g,'""'),(p.owner_last_name||'').replace(/"/g,'""'),(p.address||'').replace(/"/g,'""'),(p.city||'Little Rock').replace(/"/g,'""'),'AR',(p.zip||'').replace(/"/g,'""')]));
  const csv=rows.map(r=>r.map(c=>`"${c}"`).join(',')).join('\r\n');
  const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download=`${campaign}-wise-pelican.csv`;a.click();
  if(markMailed) doMarkMailed(parcels,campaign); else showToast(`Exported ${parcels.length} parcels`);
  closeExportModal();
}

async function doMarkMailed(parcels,campaign) {
  const now=new Date().toISOString(),ids=parcels.map(p=>p.id);
  for(let i=0;i<ids.length;i+=100){await sb.from('parcels').update({status:'mailed',last_mailed_at:now}).in('id',ids.slice(i,i+100));}
  parcels.forEach(p=>{p.status='mailed';p.last_mailed_at=now;p.times_mailed=(p.times_mailed||0)+1;});
  updateStats();renderSubList();if(selectedSubId)renderParcelSideList();renderMap();
  showToast(`Exported & mailed ${parcels.length} parcels (${campaign})`);
}

// ===================== TOAST =====================
function showToast(msg,isError) {
  const el=document.getElementById('toast');el.textContent=msg;
  el.style.background=isError?'var(--red)':'var(--green)';
  el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2500);
}

// ===================== BOOT =====================
checkSession();

// ===================== JARVIS CHAT WIDGET =====================
let jarvisChatOpen = false;
let jarvisMessages = [];
let jarvisStreaming = false;
let jarvisSessionId = null;
let jarvisRealtimeSub = null;

function getJarvisUserEmail() {
  if (currentUser && currentUser.email) return currentUser.email;
  return 'unknown-user';
}

function getJarvisSessionId() {
  const email = getJarvisUserEmail();
  const key = 'jarvis_session_' + email;
  if (jarvisSessionId) return jarvisSessionId;
  let stored = localStorage.getItem(key);
  if (!stored) { stored = 'brain:' + email + ':' + Date.now(); localStorage.setItem(key, stored); }
  jarvisSessionId = stored;
  return stored;
}

function toggleJarvisChat() {
  jarvisChatOpen = !jarvisChatOpen;
  document.getElementById('jarvisChatPanel').classList.toggle('open', jarvisChatOpen);
  document.getElementById('jarvisChatBtn').classList.toggle('hidden', jarvisChatOpen);
  if (jarvisChatOpen) {
    setTimeout(() => document.getElementById('jarvisInput').focus(), 300);
    scrollJarvisToBottom();
    subscribeJarvisRealtime();
    loadJarvisChatHistory();
  }
}

function clearJarvisChat() {
  jarvisMessages = [];
  const email = getJarvisUserEmail();
  jarvisSessionId = null;
  localStorage.removeItem('jarvis_session_' + email);
  const container = document.getElementById('jarvisMessages');
  container.innerHTML = '<div class="jarvis-msg jarvis-msg-ai"><div class="jarvis-msg-bubble">Fresh start. What do you need?</div></div>';
}

async function loadJarvisChatHistory() {
  const sid = getJarvisSessionId();
  const { data } = await sb.from('jarvis_chat').select('*').eq('session_id', sid).order('created_at', { ascending: true }).limit(50);
  if (!data || data.length === 0) return;
  const container = document.getElementById('jarvisMessages');
  container.innerHTML = '';
  jarvisMessages = [];
  for (const msg of data) {
    jarvisMessages.push({ role: msg.role, content: msg.content });
    addJarvisMessage(msg.role, msg.content);
  }
  scrollJarvisToBottom();
}

function subscribeJarvisRealtime() {
  if (jarvisRealtimeSub) return;
  const sid = getJarvisSessionId();
  jarvisRealtimeSub = sb.channel('jarvis-chat-' + sid)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jarvis_chat', filter: 'session_id=eq.' + sid }, (payload) => {
      const msg = payload.new;
      if (msg.role === 'assistant') {
        removeJarvisTyping();
        jarvisMessages.push({ role: 'assistant', content: msg.content });
        addJarvisMessage('assistant', msg.content);
        jarvisStreaming = false;
        document.getElementById('jarvisSendBtn').disabled = false;
        document.getElementById('jarvisInput').focus();
      }
    })
    .subscribe();
}

function addJarvisMessage(role, content) {
  const container = document.getElementById('jarvisMessages');
  const isUser = role === 'user';
  const div = document.createElement('div');
  div.className = `jarvis-msg ${isUser ? 'jarvis-msg-user' : 'jarvis-msg-ai'}`;
  const bubble = document.createElement('div');
  bubble.className = 'jarvis-msg-bubble';
  bubble.textContent = content;
  div.appendChild(bubble);
  container.appendChild(div);
  scrollJarvisToBottom();
  return bubble;
}

function addJarvisTyping() {
  const container = document.getElementById('jarvisMessages');
  const div = document.createElement('div');
  div.className = 'jarvis-msg jarvis-msg-typing';
  div.id = 'jarvisTypingIndicator';
  div.innerHTML = '<div class="jarvis-msg-bubble"><div class="jarvis-typing-dot"></div><div class="jarvis-typing-dot"></div><div class="jarvis-typing-dot"></div></div>';
  container.appendChild(div);
  scrollJarvisToBottom();
}

function removeJarvisTyping() {
  const el = document.getElementById('jarvisTypingIndicator');
  if (el) el.remove();
}

function scrollJarvisToBottom() {
  const container = document.getElementById('jarvisMessages');
  requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
}

function autoResizeJarvisInput() {
  const el = document.getElementById('jarvisInput');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function handleJarvisKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendJarvisMessage(); }
}

async function sendJarvisMessage() {
  const input = document.getElementById('jarvisInput');
  const text = input.value.trim();
  if (!text || jarvisStreaming) return;

  input.value = '';
  input.style.height = 'auto';
  jarvisStreaming = true;
  document.getElementById('jarvisSendBtn').disabled = true;

  const email = getJarvisUserEmail();
  const sid = getJarvisSessionId();

  // Add user message to UI
  jarvisMessages.push({ role: 'user', content: text });
  addJarvisMessage('user', text);
  addJarvisTyping();

  // Write to Supabase - Jarvis will pick it up
  const { error } = await sb.from('jarvis_chat').insert({
    session_id: sid,
    user_email: email,
    role: 'user',
    content: text
  });

  if (error) {
    removeJarvisTyping();
    addJarvisMessage('assistant', 'Failed to send. Try again.');
    jarvisStreaming = false;
    document.getElementById('jarvisSendBtn').disabled = false;
    return;
  }

  // Fallback: if no response via realtime within 60s, poll
  setTimeout(async () => {
    if (jarvisStreaming) {
      const { data } = await sb.from('jarvis_chat').select('*').eq('session_id', sid).eq('role', 'assistant').order('created_at', { ascending: false }).limit(1);
      if (data && data.length > 0) {
        const latest = data[0];
        const lastUserMsg = jarvisMessages.filter(m => m.role === 'user').pop();
        if (latest.created_at > new Date(Date.now() - 65000).toISOString()) {
          removeJarvisTyping();
          jarvisMessages.push({ role: 'assistant', content: latest.content });
          addJarvisMessage('assistant', latest.content);
          jarvisStreaming = false;
          document.getElementById('jarvisSendBtn').disabled = false;
        }
      }
    }
  }, 60000);
}
// THE MATRIX: Drag-and-Drop Icon System
// Append this to matrix.js

let draggingIcon = null;
let dragGhost = null;
let placedIcons = []; // Store all placed icons

// Initialize drag-and-drop on toolbar icons
function initIconDragDrop() {
  const toolbarIcons = document.querySelectorAll('.toolbar-icon');
  
  toolbarIcons.forEach(icon => {
    icon.addEventListener('dragstart', (e) => {
      draggingIcon = {
        type: icon.dataset.iconType,
        emoji: icon.textContent.trim()
      };
      
      // Create ghost element
      dragGhost = document.createElement('div');
      dragGhost.className = 'dragging-icon toolbar-icon';
      dragGhost.textContent = icon.textContent;
      dragGhost.style.width = '64px';
      dragGhost.style.height = '64px';
      document.body.appendChild(dragGhost);
      
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setDragImage(dragGhost, 32, 32);
    });
    
    icon.addEventListener('dragend', () => {
      if (dragGhost) {
        dragGhost.remove();
        dragGhost = null;
      }
      draggingIcon = null;
    });
  });
}

// Setup map drop zone
function initMapDropZone() {
  const mapElement = document.getElementById('map');
  
  mapElement.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  
  mapElement.addEventListener('drop', (e) => {
    e.preventDefault();
    
    if (!draggingIcon || !map) return;
    
    // Get map coordinates from drop position
    const mapContainer = map.getContainer();
    const rect = mapContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert pixel coordinates to lat/lng
    const latlng = map.containerPointToLatLng([x, y]);
    
    // Place icon on map
    placeIconOnMap(draggingIcon.type, draggingIcon.emoji, latlng);
    
    console.log('Icon dropped:', draggingIcon.type, 'at', latlng);
  });
}

// Place icon on the map
function placeIconOnMap(iconType, emoji, latlng) {
  // Create custom icon
  const iconHtml = `
    <div style="
      width: 48px;
      height: 48px;
      background: rgba(18,18,26,0.95);
      border: 2px solid #00d4ff;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      cursor: move;
      box-shadow: 0 0 20px rgba(0,212,255,0.3);
    ">${emoji}</div>
  `;
  
  const icon = L.divIcon({
    html: iconHtml,
    className: 'matrix-placed-icon',
    iconSize: [48, 48],
    iconAnchor: [24, 24]
  });
  
  // Create marker
  const marker = L.marker(latlng, {
    icon: icon,
    draggable: true
  }).addTo(map);
  
  // Store icon data
  const iconData = {
    id: Date.now(), // Temporary ID
    type: iconType,
    emoji: emoji,
    lat: latlng.lat,
    lng: latlng.lng,
    marker: marker,
    cost: 0,
    start_date: null,
    end_date: null,
    notes: '',
    graphic_url: ''
  };
  
  placedIcons.push(iconData);
  
  // Click handler to edit icon
  marker.on('click', () => {
    openIconEditor(iconData);
  });
  
  // Update position when dragged
  marker.on('dragend', () => {
    const newLatLng = marker.getLatLng();
    iconData.lat = newLatLng.lat;
    iconData.lng = newLatLng.lng;
    console.log('Icon moved to:', newLatLng);
    // TODO: Save to database
  });
  
  console.log('Icon placed on map:', iconData);
}

// Open icon editor popup
function openIconEditor(iconData) {
  // Create modal overlay
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal" style="max-width: 500px; width: 90%;">
      <h3 style="margin-bottom: 16px;">Edit Icon</h3>
      <div style="margin-bottom: 12px;">
        <label style="font-size: 12px; color: var(--text-dim); display: block; margin-bottom: 4px;">Icon Type</label>
        <input type="text" value="${iconData.type}" disabled style="width: 100%; padding: 8px 12px; background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px;">
      </div>
      <div style="margin-bottom: 12px;">
        <label style="font-size: 12px; color: var(--text-dim); display: block; margin-bottom: 4px;">Cost ($)</label>
        <input type="number" id="iconCost" value="${iconData.cost || ''}" placeholder="0.00" style="width: 100%; padding: 8px 12px; background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px;">
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
        <div>
          <label style="font-size: 12px; color: var(--text-dim); display: block; margin-bottom: 4px;">Start Date</label>
          <input type="date" id="iconStartDate" value="${iconData.start_date || ''}" style="width: 100%; padding: 8px 12px; background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px;">
        </div>
        <div>
          <label style="font-size: 12px; color: var(--text-dim); display: block; margin-bottom: 4px;">End Date</label>
          <input type="date" id="iconEndDate" value="${iconData.end_date || ''}" style="width: 100%; padding: 8px 12px; background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px;">
        </div>
      </div>
      <div style="margin-bottom: 12px;">
        <label style="font-size: 12px; color: var(--text-dim); display: block; margin-bottom: 4px;">Notes</label>
        <textarea id="iconNotes" rows="3" style="width: 100%; padding: 8px 12px; background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; resize: vertical;">${iconData.notes || ''}</textarea>
      </div>
      <div class="btn-row" style="display: flex; gap: 8px;">
        <button class="btn btn-danger" onclick="deleteMatrixIcon(${iconData.id}); this.closest('.modal-overlay').remove();">Delete</button>
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove();">Cancel</button>
        <button class="btn btn-primary" onclick="saveIconData(${iconData.id}); this.closest('.modal-overlay').remove();">Save</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// Save icon data
function saveIconData(iconId) {
  const iconData = placedIcons.find(i => i.id === iconId);
  if (!iconData) return;
  
  iconData.cost = parseFloat(document.getElementById('iconCost').value) || 0;
  iconData.start_date = document.getElementById('iconStartDate').value || null;
  iconData.end_date = document.getElementById('iconEndDate').value || null;
  iconData.notes = document.getElementById('iconNotes').value || '';
  
  console.log('Icon data saved:', iconData);
  
  // TODO: Save to Supabase matrix_icons table
  showToast('Icon updated!');
}

// Delete icon
function deleteMatrixIcon(iconId) {
  const iconIndex = placedIcons.findIndex(i => i.id === iconId);
  if (iconIndex === -1) return;
  
  const iconData = placedIcons[iconIndex];
  
  // Remove marker from map
  if (iconData.marker) {
    map.removeLayer(iconData.marker);
  }
  
  // Remove from array
  placedIcons.splice(iconIndex, 1);
  
  console.log('Icon deleted:', iconId);
  
  // TODO: Delete from Supabase
  showToast('Icon deleted');
}

// Initialize when map is ready
function initMatrix() {
  console.log('Initializing Matrix drag-and-drop system...');
  initIconDragDrop();
  initMapDropZone();
  console.log('Matrix system ready!');
}

// Call this after map initialization
setTimeout(() => {
  if (map) {
    initMatrix();
  }
}, 1000);
