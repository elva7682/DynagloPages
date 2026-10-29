'use strict';
// Browser-only SGP4 ground track. Requires satellite.js and Leaflet (loaded by index.html).
(() => {
  const spacecraft = ['DYNA', 'GLO'];
  const colors = { DYNA: '#ffd21f', GLO: '#2f7cff' };
  const records = { DYNA: null, GLO: null };
  let map, baseLayer, vectorLayer = null, stationLayers = [], footprintLayers = [], layers = [], lastPaths = 0, shadowCanvas = null, shadowContext = null, shadowUpdated = 0;
  const opts = { shadow: true, opacity: 1, tracks: true, labels: true, stations: true, footprints: true, labelSize: 11, DYNA: true, GLO: true };
  const EARTH_RADIUS_KM = 6378.137, SUN_RADIUS_KM = 695700, AU_KM = 149597870.7;
  const byId = id => document.getElementById(id);
  const output = msg => { const el = byId('tleStatus'); if (el) el.textContent = msg; };
  function getTargets(filename) {
    const n = filename.toLowerCase();
    if (n.includes('dynaglo')) return spacecraft;
    return spacecraft.filter(m => n.includes(m.toLowerCase()));
  }
  function parseTle(raw, filename) {
    const rows = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const idx = rows.findIndex((v, i) => /^1 \d{5}/.test(v) && /^2 \d{5}/.test(rows[i + 1] || ''));
    if (idx === -1) throw new Error(`No TLE pair in ${filename}`);
    const a = rows[idx], b = rows[idx + 1];
    if (a.slice(2, 7) !== b.slice(2, 7)) throw new Error(`Mismatched TLE catalog numbers in ${filename}`);
    const satrec = satellite.twoline2satrec(a, b);
    const epochYear = Number(a.slice(18,20));
    const year = epochYear >= 57 ? 1900 + epochYear : 2000 + epochYear;
    const day = Number(a.slice(20,32));
    const epoch = Date.UTC(year, 0, 1) + (day - 1) * 86400000;
    if (!Number.isFinite(epoch) || !Number.isFinite(satrec.no) || satrec.error) throw new Error(`Invalid orbital elements in ${filename}`);
    return { satrec, epoch, filename, catalog: a.slice(2,7), line1:a, line2:b };
  }
  function loadTle(raw, filename) {
    const targets = getTargets(filename);
    if (!targets.length) throw new Error(`TLE filename must contain DYNA or GLO: ${filename}`);
    const parsed = parseTle(raw, filename);
    for (const name of targets) records[name] = parsed;
    lastPaths = 0;
    render(true);
  }
  // satellite.js propagates TEME coordinates using SGP4 and converts to geodetic coordinates.
  function position(record, time) {
    const date = new Date(time);
    const state = satellite.propagate(record.satrec, date);
    if (!state || !state.position || typeof state.position === 'boolean') return null;
    const gmst = satellite.gstime(date);
    const g = satellite.eciToGeodetic(state.position, gmst);
    const lat = satellite.degreesLat(g.latitude), lon = satellite.degreesLong(g.longitude);
    if (![lat, lon, g.height].every(Number.isFinite)) return null;
    return { lat, lon, altitude: g.height };
  }
  // Solar apparent coordinates of date (low-precision Meeus/NOAA algorithm).
  // Rotated to ECEF for the shadow geometry; satellite.js SGP4 supplies TEME positions.
  function sunEcef(time) {
    const jd = time / 86400000 + 2440587.5;
    const T = (jd - 2451545.0) / 36525;
    const rad = Math.PI / 180;
    const L0 = ((280.46646 + T * (36000.76983 + .0003032 * T)) % 360 + 360) % 360;
    const M = (357.52911 + T * (35999.05029 - .0001537 * T)) * rad;
    const e = .016708634 - T * (.000042037 + .0000001267 * T);
    const C = (1.914602 - T * (.004817 + .000014 * T)) * Math.sin(M) +
              (.019993 - .000101 * T) * Math.sin(2 * M) + .000289 * Math.sin(3 * M);
    const trueLong = L0 + C;
    const trueAnomaly = M + C * rad;
    const distance = AU_KM * (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(trueAnomaly));
    const omega = (125.04 - 1934.136 * T) * rad;
    const longitude = (trueLong - .00569 - .00478 * Math.sin(omega)) * rad;
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (.00059 - T * .001813))) / 60) / 60;
    const eps = (eps0 + .00256 * Math.cos(omega)) * rad;
    const ra = Math.atan2(Math.cos(eps) * Math.sin(longitude), Math.cos(longitude));
    const dec = Math.asin(Math.sin(eps) * Math.sin(longitude));
    const theta = ra - satellite.gstime(new Date(time));
    return { x: distance * Math.cos(dec) * Math.cos(theta),
             y: distance * Math.cos(dec) * Math.sin(theta),
             z: distance * Math.sin(dec), distance };
  }
  // Observer on a shell of radius R + altitude.  Earth and Sun are angular
  // disks: fully eclipsed = Sun completely behind Earth; partial = overlapping.
  // This is NOT the ground-level solar terminator.
  function shadowState(nx, ny, nz, shellRadius, sun) {
    const alongSun = nx * sun.x + ny * sun.y + nz * sun.z;
    const sunDistance = Math.sqrt(sun.distance * sun.distance + shellRadius * shellRadius - 2 * shellRadius * alongSun);
    const cosine = (shellRadius - alongSun) / sunDistance; // angular separation Earth/Sun centers
    const earthAngle = Math.asin(Math.min(1, EARTH_RADIUS_KM / shellRadius));
    const solarAngle = Math.asin(Math.min(1, SUN_RADIUS_KM / sunDistance));
    if (earthAngle > solarAngle && cosine >= Math.cos(earthAngle - solarAngle)) return 'UMBRA';
    if (cosine >= Math.cos(earthAngle + solarAngle)) return 'PENUMBRA';
    return 'SUNLIT';
  }
  function eclipseAt(record, now, sun) {
    const state = satellite.propagate(record.satrec, new Date(now));
    if (!state || !state.position || typeof state.position === 'boolean') return null;
    const ecef = satellite.eciToEcf(state.position, satellite.gstime(new Date(now)));
    const r = Math.hypot(ecef.x, ecef.y, ecef.z);
    if (!Number.isFinite(r) || r <= EARTH_RADIUS_KM) return null;
    return shadowState(ecef.x/r, ecef.y/r, ecef.z/r, r, sun);
  }
  function shadeOrbitalShell(now) {
    if (!map || !shadowCanvas) return;
    const active = records[selectedMission];
    const w = map.getSize().x, h = map.getSize().y;
    shadowCanvas.width = Math.round(w * devicePixelRatio);
    shadowCanvas.height = Math.round(h * devicePixelRatio);
    shadowCanvas.style.width = w + 'px'; shadowCanvas.style.height = h + 'px';
    L.DomUtil.setPosition(shadowCanvas, map.containerPointToLayerPoint([0, 0]));
    const ctx = shadowContext;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!active || !opts.shadow) { shadowUpdated = now; return; }
    const p = position(active, now);
    if (!p) return;
    const shellRadius = EARTH_RADIUS_KM + p.altitude;
    const sun = sunEcef(now);
    const step = 4;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const geo = map.containerPointToLatLng([x + step/2, y + step/2]);
        if (geo.lat > 90 || geo.lat < -90 || geo.lng > 180 || geo.lng < -180) continue;
        const lat = geo.lat * Math.PI/180, lon = geo.lng * Math.PI/180;
        const cl = Math.cos(lat);
        const state = shadowState(cl*Math.cos(lon), cl*Math.sin(lon), Math.sin(lat), shellRadius, sun);
        if (state === 'SUNLIT') continue;
        ctx.fillStyle = state === 'UMBRA' ? `rgba(4,8,24,${(.68*opts.opacity).toFixed(3)})` : `rgba(92,79,146,${(.33*opts.opacity).toFixed(3)})`;
        ctx.fillRect(x, y, step, step);
      }
    }
    shadowUpdated = now;
    const label = byId('shadowDescription');
    if (label) label.textContent = `${selectedMission} orbital shell (~${p.altitude.toFixed(0)} km): dark = full Earth umbra, violet = partial eclipse (penumbra).`;
  }
  function splitAtDateLine(points) {
    const paths = []; let segment = [];
    for (const p of points) {
      if (segment.length && Math.abs(p[1] - segment[segment.length-1][1]) > 180) {
        if (segment.length > 1) paths.push(segment);
        segment = [];
      }
      segment.push(p);
    }
    if (segment.length > 1) paths.push(segment);
    return paths;
  }
  function drawOrbit(name, record, now) {
    if (!opts.tracks || !opts[name]) return;
    const col = colors[name];
    for (const phase of [-1, 1]) {
      const points = [];
      for (let minutes = 0; minutes <= 90; minutes += 2) {
        const p = position(record, now + phase * minutes * 60000);
        if (p) points.push([p.lat, p.lon]);
      }
      if (phase === -1) points.reverse();
      for (const line of splitAtDateLine(points)) {
        layers.push(L.polyline(line, {color:col,weight:name===selectedMission?2.6:1.8,opacity:phase===-1?.56:.91,dashArray:phase===-1?'5 7':null,interactive:false}).addTo(map));
      }
    }
  }
  function footprintRadiusDegrees(altKm) {
    const rho = Math.acos(Math.max(-1,Math.min(1,EARTH_RADIUS_KM/(EARTH_RADIUS_KM+altKm))));
    return rho*180/Math.PI;
  }
  function drawFootprints(now) {
    footprintLayers.forEach(layer=>map.removeLayer(layer)); footprintLayers=[];
    if(!opts.footprints)return;
    for(const name of spacecraft){
      if(!records[name] || !opts[name]) continue;
      const pos = position(records[name],now); if(!pos)continue;
      const radius = footprintRadiusDegrees(pos.altitude);
      // The circular footprint is a spherical geodesic, not a circle in screen pixels.
      const lat0=pos.lat*Math.PI/180, lon0=pos.lon*Math.PI/180, delta=radius*Math.PI/180;
      const pts=[];
      for(let bearing=0;bearing<=360;bearing+=3){
        const a=bearing*Math.PI/180;
        const lat=Math.asin(Math.sin(lat0)*Math.cos(delta)+Math.cos(lat0)*Math.sin(delta)*Math.cos(a));
        const lon=lon0+Math.atan2(Math.sin(a)*Math.sin(delta)*Math.cos(lat0),Math.cos(delta)-Math.sin(lat0)*Math.sin(lat));
        const lng=((lon*180/Math.PI+540)%360)-180;
        pts.push([lat*180/Math.PI,lng]);
      }
      // L.polygon's anti-meridian edges need splitting if they jump across the dateline.
      for(const seg of splitAtDateLine(pts)){
        const layer=L.polyline(seg,{color:colors[name],weight:1,opacity:.55,dashArray:'5 5',interactive:false}).addTo(map);
        footprintLayers.push(layer);
      }
    }
  }
  async function loadGroundStations() {
    try {
      const r=await fetch('./ground-stations.json',{cache:'no-store'});
      if(!r.ok)throw new Error('No station file');
      const stations=await r.json();
      for(const s of stations){
        const marker=L.marker([s.lat,s.lon],{icon:L.divIcon({className:'',html:`<div class="gtStation"><span class="stationDot"></span>${s.code}</div>`,iconSize:[110,18],iconAnchor:[8,9]}),zIndexOffset:100});
        marker.bindPopup(`<strong>${s.code}</strong><br>${s.site}<br>${s.lat.toFixed(4)}°, ${s.lon.toFixed(4)}°`);
        stationLayers.push(marker);
      }
      refreshStations();
    }catch(e){console.warn('Ground stations unavailable:',e);}
  }
  function refreshStations(){for(const layer of stationLayers){if(opts.stations && !map.hasLayer(layer))layer.addTo(map);else if(!opts.stations && map.hasLayer(layer))map.removeLayer(layer);}}
  function details(name, record, p, now, eclipse) {
    const el = byId(name.toLowerCase() + 'TleDetails');
    el.classList.toggle('active', name === selectedMission);
    if (!record) { el.textContent = `${name} · No TLE loaded`; return; }
    const age = Math.abs((now-record.epoch)/86400000).toFixed(1);
    const illumination = eclipse === 'UMBRA' ? 'IN ECLIPSE (umbra)' : eclipse === 'PENUMBRA' ? 'PARTIAL ECLIPSE' : eclipse === 'SUNLIT' ? 'SUNLIT' : 'illumination unavailable';
    el.textContent = p ? `${name} · ${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}° · ${p.altitude.toFixed(0)} km altitude · ${illumination} · TLE ${age} days old` : `${name} · Propagation unavailable`;
    el.title = `${record.filename} · NORAD ${record.catalog} · Epoch ${new Date(record.epoch).toISOString()}`;
  }
  function render(force = false) {
    if (!map || !window.satellite) return;
    const now = Date.now();
    if (force || now-lastPaths >= 60000) {
      layers.forEach(layer => map.removeLayer(layer)); layers=[];
      for (const name of spacecraft) if(records[name]) drawOrbit(name,records[name],now);
      lastPaths = now;
    }
    if (force || now - (render.lastFootprints||0) >= 60000){drawFootprints(now);render.lastFootprints=now;}
    if (force || now - shadowUpdated >= 60000) shadeOrbitalShell(now);
    const sun = sunEcef(now);
    // Recreate markers to update positions; markers are not part of the orbit path cache.
    if (render.markers) render.markers.forEach(marker => map.removeLayer(marker));
    render.markers = [];
    for (const name of spacecraft) {
      const record = records[name];
      const p = record && position(record,now);
      const eclipse = record ? eclipseAt(record, now, sun) : null;
      details(name, record, p, now, eclipse);
      if (!p || !opts[name]) continue;
      const icon = L.divIcon({className:'',html:`<div class="gtPin ${name.toLowerCase()} ${selectedMission===name?'active':''} ${opts.labels?'':'labelHidden'}">${opts.labels?name:'●'}</div>`,iconSize:[34,20],iconAnchor:[17,10]});
      const marker = L.marker([p.lat,p.lon],{icon,zIndexOffset:selectedMission===name?1000:500}).addTo(map);
      marker.bindPopup(`${name} · ${p.lat.toFixed(3)}° lat, ${p.lon.toFixed(3)}° lon<br>${p.altitude.toFixed(1)} km altitude<br><strong>${eclipse === 'UMBRA' ? 'In eclipse (umbra)' : eclipse === 'PENUMBRA' ? 'Partial eclipse' : eclipse === 'SUNLIT' ? 'Sunlit' : 'Illumination unavailable'}</strong><br>TLE: ${record.filename}`);
      render.markers.push(marker);
    }
    const clock = byId('mapUtc'); if (clock) clock.textContent = new Date(now).toISOString().slice(11,19);
    if (records.DYNA && records.GLO && records.DYNA.line1 === records.GLO.line1 && records.DYNA.line2 === records.GLO.line2) {
      output('DYNA and GLO have identical TLEs — positions overlap');
    } else output(spacecraft.filter(name=>records[name]).length+' of 2 TLEs loaded');
  }
  async function loadBundledTles() {
    // GitHub Pages cannot enumerate repository files: use conventional filenames or manifest.
    const filenames = ['DYNA_TLE.txt','GLO_TLE.txt','DYNA_TLE.tle','GLO_TLE.tle'];
    try {
      const res = await fetch('./tle-files.json', {cache:'no-store'});
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) for (const name of data) {
          if (typeof name === 'string' && /^(?!.*(?:\/|\\|\.\.))[\w .()-]+\.(?:tle|txt)$/i.test(name)) filenames.push(name);
        }
      }
    } catch (_) { /* optional manifest */ }
    const results = await Promise.all([...new Set(filenames)].map(async filename => {
      try { const res = await fetch('./'+encodeURIComponent(filename), {cache:'no-store'}); if (res.ok) return [filename,await res.text()]; }
      catch(_) { /* optional file absent */ }
      return null;
    }));
    let loaded=0;
    for (const item of results.filter(Boolean)) {
      try { loadTle(item[1],item[0]); loaded++; } catch(err) { console.warn(err); }
    }
    if (!loaded) output('No TLE files found — upload a DYNA/GLO .txt or .tle');
  }
  function initialize() {
    if (!window.L || !window.satellite) { output('Map unavailable: missing ' + (!window.L ? 'Leaflet map library' : 'satellite.js orbit library') + '. Check network access and refresh.'); return; }
    map = L.map('groundtrackMap',{worldCopyJump:false,minZoom:1,maxZoom:7,zoomControl:true}).setView([0,0],1);
    const tiles = {
      dark: ['https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', '&copy; OpenStreetMap &copy; CARTO'],
      light: ['https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', '&copy; OpenStreetMap &copy; CARTO'],
      street: ['https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', '&copy; OpenStreetMap']
    };
    async function enableVectorMap() {
      if (vectorLayer){vectorLayer.addTo(map);return;}
      // World-atlas is the same TopoJSON data source used by the uploaded publisher.
      const res=await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
      if(!res.ok || !window.topojson) throw new Error('World vector data unavailable');
      const topo=await res.json();
      vectorLayer=L.geoJSON(topojson.feature(topo,topo.objects.countries),{
        style:()=>({color:'#435265',weight:.65,fillColor:'#182537',fillOpacity:1,opacity:.9}),interactive:false
      });
      vectorLayer.addTo(map);
      vectorLayer.bringToBack();
    }
    async function setBasemap(kind) {
      if(baseLayer){map.removeLayer(baseLayer);baseLayer=null;}
      if(vectorLayer)map.removeLayer(vectorLayer);
      if(kind==='mission'){
        try{await enableVectorMap();}catch(e){console.warn(e); const spec=tiles.dark;baseLayer=L.tileLayer(spec[0],{attribution:spec[1],maxZoom:7,noWrap:true}).addTo(map);baseLayer.bringToBack();}
      }else{
        const spec=tiles[kind]||tiles.dark;
        baseLayer=L.tileLayer(spec[0], {attribution:spec[1],maxZoom:7,noWrap:true}).addTo(map);
        baseLayer.bringToBack();
      }
    }
    setBasemap('mission');
    byId('mapBasemap').addEventListener('change', e => setBasemap(e.target.value));
    byId('mapSettingsToggle').addEventListener('click', () => {
      const panel = byId('mapSettings'); panel.hidden = !panel.hidden;
      byId('mapSettingsToggle').setAttribute('aria-expanded', String(!panel.hidden));
      map.invalidateSize();
    });
    function refreshVisuals() { lastPaths=0; shadowUpdated=0; render(true); }
    for (const [id,key] of [['showShadow','shadow'],['showStations','stations'],['showFootprints','footprints'],['showTracks','tracks'],['showLabels','labels'],['showDyna','DYNA'],['showGlo','GLO']]) {
      byId(id).addEventListener('change', e => {opts[key] = e.target.checked; refreshStations();refreshVisuals();});
    }
    byId('labelFontSize').addEventListener('input',e=>{opts.labelSize=Number(e.target.value); document.documentElement.style.setProperty('--map-label-size',opts.labelSize+'px');byId('labelFontSizeValue').textContent=opts.labelSize+'px';});
    byId('shadowOpacity').addEventListener('input', e => {
      opts.opacity = Number(e.target.value)/100;
      byId('shadowOpacityValue').textContent = e.target.value + '%';
      shadowUpdated=0; shadeOrbitalShell(Date.now());
    });
    byId('mapReset').addEventListener('click', () => map.setView([0,0], 1));
    // Avoid map repeating infinitely, and keep both poles in frame.
    map.setMaxBounds([[-85,-180],[85,180]]);
    map.createPane('orbitalShadowPane');
    map.getPane('orbitalShadowPane').style.zIndex = '350';
    map.getPane('orbitalShadowPane').style.pointerEvents = 'none';
    shadowCanvas = L.DomUtil.create('canvas', 'orbitalShadowCanvas', map.getPane('orbitalShadowPane'));
    shadowCanvas.style.pointerEvents = 'none';
    shadowContext = shadowCanvas.getContext('2d');
    map.on('moveend zoomend resize', () => shadeOrbitalShell(Date.now()));
    byId('tleInput').addEventListener('change',async e => {
      const failures=[];
      for(const file of Array.from(e.target.files||[])) {
        try { loadTle(await file.text(),file.name); } catch(err) { failures.push(err.message); }
      }
      if (failures.length) output(failures.join(' | '));
      e.target.value='';
    });
    byId('tabDyna').addEventListener('click',()=>{render(true);setTimeout(()=>map.invalidateSize(),30);});
    byId('tabGlo').addEventListener('click',()=>{render(true);setTimeout(()=>map.invalidateSize(),30);});
    byId('reloadBtn').addEventListener('click',()=>{records.DYNA=null;records.GLO=null;loadBundledTles();});
    window.addEventListener('hashchange',()=>render(true));
    loadBundledTles();
    loadGroundStations();
    setInterval(()=>render(),15000);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initialize); else initialize();
})();
