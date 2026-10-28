'use strict';
const $ = id => document.getElementById(id);
const UTC = 'UTC', MT = 'America/Denver';
let events = [], sourceName = 'schedule.prc', scheduleBounds = null, lastNext = -2;

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
    if (header && timestamp !== null && hasSuspend && header.buffer !== 'NONE') {
      found.push({ ...header, start: timestamp, id: found.length + 1 });
    }
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
        found.push({ ...header, start: timestamp, id: found.length + 1 });
      }
      // Require a distinct header/suspend/call for each event.
      header = null; timestamp = null; hasSuspend = false;
    }
  }
  found.sort((a, b) => a.start - b.start || a.id - b.id);
  found.forEach((e,i) => e.id = i+1);
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
function nextIndex(now) {
  let lo = 0, hi = events.length;
  while (lo < hi) { const mid = (lo+hi) >> 1; if (events[mid].start <= now) lo = mid + 1; else hi = mid; }
  return lo;
}
function kind(e) { return e.name.toUpperCase().includes('DAYGLOW') ? 'type-dayglow' : e.name.toUpperCase().includes('AURORA') ? 'type-aurora' : e.name.toUpperCase().includes('ECLIPSE') ? 'type-eclipse' : ''; }
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
    if (q && !(`${e.name} ${e.buffer} ${e.id}`).toLowerCase().includes(q)) continue;
    const tr = create('tr', [kind(e),i===next?'isNext':i<next?'isPast':''].join(' ').trim());
    if (i===next) tr.id='nextRow';
    const fields = [`${e.id}`,e.name,e.buffer,fmt(e.start,UTC),fmt(e.start,MT),i===next?'NEXT':i<next?'PASSED':'UPCOMING'];
    fields.forEach((value,j) => tr.appendChild(create('td',j===1?'eventCell':j===5?'statusText':'',value)));
    frag.appendChild(tr); shown++;
  }
  tbody.appendChild(frag);
  $('tableSummary').textContent = `Showing ${shown} of ${events.length} events`;
}
// Fixed 24-hour UTC day view. Dates stay in UTC; Mountain labels use IANA timezone rules.
let timelineDay = Math.floor(Date.now() / 86400000) * 86400000;
let timelineAutoToday = true;
const laneSpecs = [['dayglow','laneDayglow'],['aurora','laneAurora'],['eclipse','laneEclipse']];
function eventLane(e) { const k = kind(e); return k === 'type-dayglow' ? 'dayglow' : k === 'type-aurora' ? 'aurora' : k === 'type-eclipse' ? 'eclipse' : null; }
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
      const detail=group.slice(0,6).map(e=>`${fmt(e.start,UTC)} · ${e.name} (${e.buffer})`).join('\n');
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
  $('missionPhase').textContent=before?'BEFORE START':after?'SCHEDULE COMPLETE':events.length?'SCHEDULE IN PROGRESS':'NO EVENTS';
  $('activeLabel').textContent=previous ? `Most recent: ${previous.name}` : 'No prior events';
  if (next) {
    $('nextName').textContent=next.name; $('nextBuffer').textContent=next.buffer;
    $('nextUtc').textContent=`UTC · ${fmt(next.start,UTC)}`;
    $('nextMt').textContent=`MT · ${fmt(next.start,MT)}`;
    $('countdown').textContent=duration(next.start-now);
    $('countdownNote').textContent='until next scheduled start';
  } else {
    $('nextName').textContent=events.length?'All scheduled events started':'No events loaded';
    $('nextBuffer').textContent='—'; $('nextUtc').textContent=''; $('nextMt').textContent='';
    $('countdown').textContent='--:--:--'; $('countdownNote').textContent='No more upcoming events';
  }
  let progress = 0;
  if (start !== null && end !== null && end > start) progress = Math.min(100,Math.max(0,(now-start)/(end-start)*100));
  $('progressFill').style.width=`${progress.toFixed(2)}%`;
  $('progressLabel').textContent=`${progress.toFixed(1)}% of scheduled time elapsed`;
  const upcoming = $('upcomingList'); upcoming.replaceChildren();
  for (const e of events.slice(idx, idx+3)) {
    const item=create('div','upcomingRow'); item.append(create('div','eventNum',String(e.id).padStart(3,'0')));
    const details=create('div'); details.append(create('div','eventTitle',e.name),create('div','eventTime',`${fmt(e.start,UTC)} · ${fmt(e.start,MT)}`));
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
  events=parsed.events; scheduleBounds=parsed.bounds; sourceName=name; lastNext=-2;
  $('scheduleName').textContent=sourceName;
  $('scheduleRange').textContent=`${fmt(scheduleBounds.start,UTC)} → ${fmt(scheduleBounds.end,UTC)}`;
  $('eventCount').textContent=`${events.length} events parsed`;
  $('sourceStatus').textContent='Schedule loaded';
  showError(''); drawTimeline(); tick();
}
async function loadBundled() {
  try {
    $('sourceStatus').textContent='Loading schedule';
    const res=await fetch('./schedule.prc',{cache:'no-store'});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    load(await res.text(),'schedule.prc');
  } catch (err) {
    $('sourceStatus').textContent='Load failed';
    showError(`Could not load schedule.prc (${err.message}). On GitHub Pages, ensure schedule.prc is in the same directory as index.html. Alternatively, choose Upload .prc.`);
  }
}
$('fileInput').addEventListener('change',async e => {const f=e.target.files?.[0];if(!f)return;try{load(await f.text(),f.name)}catch(err){showError(err.message)}e.target.value='';});
$('reloadBtn').addEventListener('click',loadBundled);
$('search').addEventListener('input',()=>renderTable(Date.now()));
$('viewFilter').addEventListener('change',()=>renderTable(Date.now()));
$('jumpNext').addEventListener('click',()=>{if($('viewFilter').value==='past'){$('viewFilter').value='all'} if($('search').value)$('search').value='';renderTable(Date.now());const row=$('nextRow');if(row)row.scrollIntoView({behavior:'smooth',block:'center'});});
drawTimeline();loadBundled();tick();setInterval(tick,1000);
