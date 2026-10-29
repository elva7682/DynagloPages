'use strict';
const $ = id => document.getElementById(id);
const UTC = 'UTC', MT = 'America/Denver';
let events = [], sourceName = 'dyna_ats_26_301.prc', scheduleBounds = null, lastNext = -2;
const missions = { DYNA: null, GLO: null };
let selectedMission = location.hash.toUpperCase() === '#GLO' ? 'GLO' : 'DYNA';
function displayName(name) { const n=name.replace(/_(?:START|CONT)$/i,''); return ({ HDR_ATT:'XBAND DOWNLINK', UHF_ATT:'UHF POINTING' })[n.toUpperCase()] || n.replace(/_/g,' '); }
function targets(name) {
  const n=name.toLowerCase();
  if (n.includes('dynaglo_')) return ['DYNA','GLO'];
  if (n.includes('dyna_')) return ['DYNA'];
  if (n.includes('glo_')) return ['GLO'];
  return [];
}
function selectMission(mission) {
  selectedMission=mission;
  location.hash=mission.toLowerCase();
  $('missionTitle').textContent=mission;
  document.title=`${mission} | Spacecraft Schedule`;
  for (const m of ['DYNA','GLO']) { $('tab'+m[0]+m.slice(1).toLowerCase()).classList.toggle('active',m===mission); $('tab'+m[0]+m.slice(1).toLowerCase()).setAttribute('aria-pressed',String(m===mission)); }
  const data=missions[mission]; events=data?.events||[]; scheduleBounds=data?.bounds||null; sourceName=data?.name||'No schedule uploaded'; lastNext=-2;
  $('scheduleName').textContent=sourceName;
  $('scheduleRange').textContent=scheduleBounds?.start!=null && scheduleBounds?.end!=null ? `${fmt(scheduleBounds.start,UTC)} → ${fmt(scheduleBounds.end,UTC)}`:'—';
  $('eventCount').textContent=`${events.length} events parsed`;
  $('sourceStatus').textContent=data?'Schedule loaded':'No schedule for '+mission;
  showError('');drawTimeline();tick();
}


// Parse YYYY/DDD-HH:MM:SS timestamps as UTC (DDD = day of year).
function parseDoy(value) {
  const match = /^(\d{4})\/(\d{3})-(\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, ys, ds, hs, ms, ss] = match;
  const y = Number(ys), d = Number(ds), h = Number(hs), m = Number(ms), s = Number(ss);
  const daysInYear = ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365;
  if (d < 1 || d > daysInYear || h > 23 || m > 59 || s > 59) return null;
  return Date.UTC(y, 0, d, h, m, s);
}

function parseSchedule(text) {
  const lines = text.split(/\r?\n/);
  const found = [];
  let header = null, timestamp = null, hasSuspend = false;
  let lowerBound = null, upperBound = null;
  const overview = text.match(/ATS runs from\s+(\d{4}\/\d{3}-\d{2}:\d{2}:\d{2})\s*UTC\s+to\s+(\d{4}\/\d{3}-\d{2}:\d{2}:\d{2})\s*UTC/i);
  if (overview) { lowerBound = parseDoy(overview[1]); upperBound = parseDoy(overview[2]); }
  function closeBlock() {
    header = null; timestamp = null; hasSuspend = false;
  }
  for (const line of lines) {
    const head = line.match(/^\s*;\s*(NVM_SMALL\d+)\s*-\s*([^\r\n;]+?)\s*$/i);
    const genericHead = line.match(/^\s*;\s*NONE\s*-\s*(ATS_START|ATS_END)\s*$/i);
    if (head || genericHead) {
      closeBlock();
      header = head ? { buffer: head[1].toUpperCase(), name: head[2].trim() } : { buffer: 'NONE', name: genericHead[1] };
      continue;
    }
    if (!header) continue;
    const comment = line.match(/^\s*;\s*absolute\s+suspend\s+until\s+(\d{4}\/\d{3}-\d{2}:\d{2}:\d{2})/i);
    if (comment) timestamp = parseDoy(comment[1]);
    if (/^\s*CMD\s+\w+\s+SEQ_SUSPEND_ABS\b/i.test(line)) hasSuspend = true;
    const call = line.match(/^\s*CMD\s+\w+\s+SEQ_CALL\b.*?\bBUFFID\s+(NVM_SMALL\d+)\b/i);
    if (call) {
      if (hasSuspend && timestamp !== null && header.buffer.toUpperCase() === call[1].toUpperCase()) {
        found.push({ ...header, label: displayName(header.name), start: timestamp, id: found.length + 1 });
      }
      // Require a distinct header/suspend/call for each event.
      header = null; timestamp = null; hasSuspend = false;
    }
  }
  found.sort((a, b) => a.start - b.start || a.id - b.id);
  found.forEach((e,i) => { e.id = i+1; e.durationMs = i+1 < found.length ? Math.max(0, found[i+1].start - e.start) : null; });
  return { events: found, bounds: { start: lowerBound ?? (found[0]?.start ?? null), end: upperBound ?? (found.at(-1)?.start ?? null) } };
}

const formatters = new Map();
function fmt(t, tz, dateOnly=false) {
  const key = tz + String(dateOnly);
  if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat('en-US', {
    timeZone: tz, month: 'short', day: 'numeric', year: 'numeric',
    ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short' })
  }));
  return formatters.get(key).format(new Date(t));
}
function clock(t, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).format(new Date(t));
}
function duration(ms) {
  let s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); s %= 60;
  const padded = [h,m,s].map(n => String(n).padStart(2,'0')).join(':');
  return d ? `${d}d ${padded}` : padded;
}
function eventDuration(e) { return e.durationMs === null ? '—' : duration(e.durationMs); }
function nextIndex(now) {
  let lo = 0, hi = events.length;
  while (lo < hi) { const mid = (lo+hi) >> 1; if (events[mid].start <= now) lo = mid + 1; else hi = mid; }
  return lo;
}
function kind(e) { const n=e.name.toUpperCase(); return n.includes('DAYGLOW') ? 'type-dayglow' : n.includes('AURORA') ? 'type-aurora' : n.includes('ECLIPSE') ? 'type-eclipse' : n.includes('IDLE') ? 'type-idle' : n==='HDR_ATT' ? 'type-xband' : n==='UHF_ATT' ? 'type-uhf' : ''; }
function create(tag, cls, text) { const el = document.createElement(tag); if (cls) el.className=cls; if (text !== undefined) el.textContent=text; return el; }
function showError(message) { $('error').textContent = message; $('error').hidden = !message; }

function renderTable(now) {
  const next = nextIndex(now), mode = $('viewFilter').value, q = $('search').value.trim().toLowerCase();
  const tbody = $('eventsBody'); tbody.replaceChildren();
  const frag = document.createDocumentFragment();
  let shown = 0;
  for (let i=0;i<events.length;i++) {
    const e = events[i];
    if (mode === 'upcoming' && i < next || mode === 'past' && i >= next) continue;
    if (q && !(`${e.name} ${e.label} ${e.buffer} ${e.id}`).toLowerCase().includes(q)) continue;
    const tr = create('tr', [kind(e),i===next-1?'isCurrent':i<next?'isPast':''].join(' ').trim());
    if (i===next-1) tr.id='currentRow'; if(i===next)tr.id='nextRow';
    const fields = [`${e.id}`,e.label,e.buffer,fmt(e.start,UTC),fmt(e.start,MT),eventDuration(e),i===next-1?'CURRENT':i<next?'PASSED':'UPCOMING'];
    fields.forEach((value,j) => tr.appendChild(create('td',j===1?'eventCell':j===6?'statusText':'',value)));
    frag.appendChild(tr); shown++;
  }
  tbody.appendChild(frag);
  $('tableSummary').textContent = `Showing ${shown} of ${events.length} events`;
}
// Fixed 24-hour UTC day view. Dates stay in UTC; Mountain labels use IANA timezone rules.
let timelineDay = Math.floor(Date.now() / 86400000) * 86400000;
let timelineAutoToday = true;
const laneSpecs = [['dayglow','laneDayglow'],['aurora','laneAurora'],['eclipse','laneEclipse'],['idle','laneIdle'],['xband','laneXband'],['uhf','laneUhf']];
function eventLane(e) { const k = kind(e); return k.startsWith('type-') ? k.slice(5) : null; }
function showEventInTable(e) {
  $('viewFilter').value='all'; $('search').value='';
  renderTable(Date.now());
  const trs = $('eventsBody').children;
  const tr = trs[e.id-1];
  if(tr) { tr.scrollIntoView({behavior:'smooth',block:'center'}); tr.classList.add('timelineSelected'); setTimeout(()=>tr.classList.remove('timelineSelected'),2500); }
}
function drawTimeline() {
  const dayEnd=timelineDay+86400000;
  $('timelineDay').textContent=new Intl.DateTimeFormat('en-US',{timeZone:UTC,weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(new Date(timelineDay))+' · UTC';
  $('timelineMtRange').textContent=`Mountain: ${fmt(timelineDay,MT)} → ${fmt(dayEnd,MT)}`;
  for (const axisId of ['timelineAxis','timelineBottomAxis']) {
    const axis=$(axisId); axis.replaceChildren();
    for(let hour=0;hour<=24;hour+=3){
      const tick=create('div','timelineTick');tick.style.left=`${hour/24*100}%`;
      const label=create('span','',String(hour).padStart(2,'0')+':00');
      if(hour===0)label.style.transform='none';
      if(hour===24)label.style.transform='translateX(-100%)';
      tick.append(label);axis.append(tick);
    }
  }
  let total=0;
  for(const [type,laneId] of laneSpecs){
    const lane=$(laneId);lane.replaceChildren();
    const matches=events.filter(e=>e.start>=timelineDay && e.start<dayEnd && eventLane(e)===type);
    total+=matches.length;
    // Merge event markers closer than 0.9% of 24 hours to keep the graph usable.
    const groups=[];
    for(const e of matches){
      const group=groups.at(-1);
      if(group && e.start-group.at(-1).start<0.009*86400000)group.push(e);
      else groups.push([e]);
    }
    for(const group of groups){
      const first=group[0], avg=group.reduce((acc,e)=>acc+e.start,0)/group.length;
      const marker=create('button',`timelineMarker ${type}${group.length>1?' multi':''}`,group.length>1?String(group.length):'');
      marker.type='button';marker.style.left=`${(avg-timelineDay)/86400000*100}%`;
      const detail=group.slice(0,6).map(e=>`${fmt(e.start,UTC)} · ${e.label} (${e.buffer})`).join('\n');
      marker.title=detail+(group.length>6?`\n+${group.length-6} more`:'');
      marker.setAttribute('aria-label',`${group.length} ${type} event${group.length===1?'':'s'}: ${detail}`);
      marker.addEventListener('click',()=>showEventInTable(first));lane.append(marker);
    }
    if(!matches.length)lane.append(create('span','timelineEmpty','No events'));
  }
  $('timelineCount').textContent=`${total} event starts in selected UTC day`;
  moveNowLine();
}
function moveNowLine(){
  const now=Date.now(),visible=now>=timelineDay && now<timelineDay+86400000;
  for(const [,laneId] of laneSpecs){
    const lane=$(laneId);let line=lane.querySelector('.nowLine');
    if(!visible){if(line)line.remove();continue;}
    if(!line){line=create('div','nowLine');line.setAttribute('aria-hidden','true');lane.append(line);}
    line.style.left=`${(now-timelineDay)/86400000*100}%`;
  }
}
function shiftDay(days){timelineAutoToday=false;timelineDay+=days*86400000;drawTimeline();}
$('dayPrev').addEventListener('click',()=>shiftDay(-1));
$('dayNext').addEventListener('click',()=>shiftDay(1));
$('dayToday').addEventListener('click',()=>{timelineAutoToday=true;timelineDay=Math.floor(Date.now()/86400000)*86400000;drawTimeline();});
function tick() {
  const now = Date.now(), idx = nextIndex(now), next = events[idx], previous = events[idx-1];
  $('utcClock').textContent=clock(now,UTC); $('utcDate').textContent=fmt(now,UTC,true);
  $('mtClock').textContent=clock(now,MT); $('mtDate').textContent=fmt(now,MT,true);
  $('totalEvents').textContent=events.length.toLocaleString();
  $('completedEvents').textContent=idx.toLocaleString(); $('remainingEvents').textContent=(events.length-idx).toLocaleString();
  const start = scheduleBounds?.start, end = scheduleBounds?.end;
  const before = start !== null && now < start;
  const after = end !== null && now >= end;
  $('missionPhase').textContent=!events.length?'NO EVENTS':before?'BEFORE START':after?'SCHEDULE COMPLETE':'SCHEDULE IN PROGRESS';
  $('activeLabel').textContent=previous ? `Current: ${previous.label}` : 'No event started yet';
  if (previous) {
    $('nextName').textContent=previous.label; $('nextBuffer').textContent=previous.buffer;
    $('nextUtc').textContent=`UTC · ${fmt(previous.start,UTC)}`;
    $('nextMt').textContent=`MT · ${fmt(previous.start,MT)}`;
    $('countdown').textContent=duration(now-previous.start);
    $('countdownNote').textContent=next?'elapsed since current event started':'elapsed since last scheduled event';
  } else {
    $('nextName').textContent=events.length?'Awaiting first event':'No events loaded';
    $('nextBuffer').textContent='—'; $('nextUtc').textContent=''; $('nextMt').textContent='';
    $('countdown').textContent='--:--:--'; $('countdownNote').textContent='No scheduled event has started yet';
  }
  let progress = 0;
  if (start !== null && end !== null && end > start) progress = Math.min(100,Math.max(0,(now-start)/(end-start)*100));
  $('progressFill').style.width=`${progress.toFixed(2)}%`;
  $('progressLabel').textContent=`${progress.toFixed(1)}% of scheduled time elapsed`;
  const upcoming = $('upcomingList'); upcoming.replaceChildren();
  for (const e of events.slice(idx, idx+3)) {
    const item=create('div','upcomingRow'); item.append(create('div','eventNum',String(e.id).padStart(3,'0')));
    const details=create('div'); details.append(create('div','eventTitle',e.label),create('div','eventTime',`${fmt(e.start,UTC)} · ${fmt(e.start,MT)}`),create('div','eventTime',`Duration: ${eventDuration(e)}`));
    item.append(details,create('div','eventRemaining',duration(e.start-now))); upcoming.append(item);
  }
  if (!upcoming.children.length) upcoming.append(create('div','note','No upcoming events.'));
  if (timelineAutoToday && Math.floor(now/86400000)*86400000 !== timelineDay) { timelineDay=Math.floor(now/86400000)*86400000; drawTimeline(); }
  else moveNowLine();
  if (idx !== lastNext) { lastNext=idx; renderTable(now); }
}
function load(text,name) {
  const parsed = parseSchedule(text);
  if (!parsed.events.length) throw new Error('No valid schedule events found. Expected NVM_SMALL## - NAME, an absolute suspend timestamp, SEQ_SUSPEND_ABS, and SEQ_CALL.');
  const forMissions=targets(name);
  if (!forMissions.length) throw new Error(`Filename must contain dyna_, glo_, or dynaglo_: ${name}`);
  for (const mission of forMissions) missions[mission]={...parsed,name};
  selectMission(selectedMission);

}
async function loadBundled() {
  // A 404 is expected when only one spacecraft has a bundled schedule.
  for (const filename of ['dyna_ats_26_301.prc','glo_schedule.prc','dynaglo_schedule.prc']) {
    try { const res=await fetch('./'+filename,{cache:'no-store'}); if(res.ok)load(await res.text(),filename); }
    catch (err) { console.warn(`Could not load ${filename}:`,err); }
  }
  selectMission(selectedMission);
}
$('tabDyna').addEventListener('click',()=>selectMission('DYNA'));
$('tabGlo').addEventListener('click',()=>selectMission('GLO'));
window.addEventListener('hashchange',()=>{const m=location.hash.toUpperCase()==='#GLO'?'GLO':'DYNA';if(m!==selectedMission)selectMission(m);});
$('fileInput').addEventListener('change',async e => {
  const files=Array.from(e.target.files||[]);if(!files.length)return;
  const failures=[];
  for(const f of files){try{load(await f.text(),f.name)}catch(err){failures.push(`${f.name}: ${err.message}`)}}
  if (failures.length)showError(failures.join(' | '));
  e.target.value='';
});
$('reloadBtn').addEventListener('click',()=>{missions.DYNA=null;missions.GLO=null;loadBundled();});
$('search').addEventListener('input',()=>renderTable(Date.now()));
$('viewFilter').addEventListener('change',()=>renderTable(Date.now()));
$('jumpNext').addEventListener('click',()=>{if($('viewFilter').value==='past')$('viewFilter').value='all';$('search').value='';renderTable(Date.now());const row=$('nextRow');if(row)row.scrollIntoView({behavior:'smooth',block:'center'});});
selectMission(selectedMission);loadBundled();setInterval(tick,1000);
