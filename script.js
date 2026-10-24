/* Healthcare Facilities Web GIS
   API: Overpass API (OpenStreetMap). Data is fetched with fetch(), parsed as JSON
   and drawn on a Leaflet map. No API key is used. */

// ---------- Configuration ----------
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter' // fallback mirror
];

// Bounding box (south, west, north, east) covering Rawalpindi + Islamabad
const BBOX = '33.40,72.80,33.85,73.30';

const QUERY = `
[out:json][timeout:30];
(
  nwr["amenity"~"^(hospital|clinic|pharmacy|doctors)$"](${BBOX});
);
out center tags;`;

const COLORS = {
  hospital: '#d62839',
  clinic: '#1b6ec2',
  pharmacy: '#2a9d5c',
  doctors: '#8e44ad'
};
const LABELS = {
  hospital: 'Hospital',
  clinic: 'Clinic',
  pharmacy: 'Pharmacy',
  doctors: 'Doctor'
};

// Approximate dividing line: Rawalpindi lies south of ~33.62 lat and west of ~73.10 lon.
// This is a simple classification for filtering, not an official boundary.
function guessCity(lat, lon) {
  return (lat < 33.64 && lon < 73.12 && lat > 33.50) ? 'rawalpindi' : 'islamabad';
}

// ---------- DOM ----------
const searchEl = document.getElementById('search');
const categoryEl = document.getElementById('category');
const cityEl = document.getElementById('city');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const loaderEl = document.getElementById('loader');

// ---------- Map ----------
const map = L.map('map').setView([33.63, 73.04], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const markerLayer = L.layerGroup().addTo(map);
let userMarker = null;
let facilities = [];
let userPos = null;

// Legend
document.getElementById('legend').innerHTML = Object.keys(COLORS)
  .map(k => `<div><span class="dot" style="background:${COLORS[k]}"></span>${LABELS[k]}</div>`)
  .join('');

// ---------- Helpers ----------
function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function setLoading(on) {
  loaderEl.classList.toggle('hidden', !on);
}

function setStatus(msg, isError = false) {
  statusEl.className = isError ? 'error' : '';
  statusEl.textContent = msg;
}

// ---------- Fetch + parse ----------
async function fetchOverpass() {
  let lastError;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(QUERY)
      });
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function parseElements(json) {
  if (!json || !Array.isArray(json.elements)) {
    throw new Error('Unexpected response format from API');
  }
  return json.elements
    .map(e => {
      const t = e.tags || {};
      const lat = e.lat ?? e.center?.lat;
      const lon = e.lon ?? e.center?.lon;
      return {
        id: `${e.type}/${e.id}`,
        lat, lon,
        name: t.name || t['name:en'] || 'Unnamed facility',
        type: t.amenity,
        speciality: t.healthcare || t['healthcare:speciality'] || '',
        phone: t.phone || t['contact:phone'] || '',
        hours: t.opening_hours || '',
        street: t['addr:street'] || '',
        website: t.website || t['contact:website'] || '',
        emergency: t.emergency || '',
        city: (lat != null && lon != null) ? guessCity(lat, lon) : 'islamabad'
      };
    })
    .filter(f => f.lat != null && f.lon != null && COLORS[f.type]);
}

async function loadData() {
  setLoading(true);
  setStatus('Loading data from Overpass API...');
  try {
    const json = await fetchOverpass();
    facilities = parseElements(json);
    if (facilities.length === 0) {
      setStatus('The API returned no facilities for this area.', true);
    }
    render();
  } catch (err) {
    setStatus(`Could not load data: ${err.message}. Check your connection and try again.`, true);
    const retry = document.createElement('button');
    retry.textContent = 'Retry';
    retry.onclick = loadData;
    statusEl.appendChild(document.createElement('br'));
    statusEl.appendChild(retry);
  } finally {
    setLoading(false);
  }
}

// ---------- Render ----------
function popupHtml(f) {
  const rows = [
    ['Type', LABELS[f.type]],
    ['Speciality', f.speciality],
    ['Street', f.street],
    ['Phone', f.phone],
    ['Hours', f.hours],
    ['Emergency', f.emergency],
    ['Website', f.website ? `<a href="${esc(f.website)}" target="_blank" rel="noopener">Open</a>` : '']
  ];
  const body = rows
    .map(([k, v]) => `<tr><td>${k}</td><td>${k === 'Website' ? (v || 'Not listed') : esc(v || 'Not listed')}</td></tr>`)
    .join('');
  const dist = userPos
    ? `<div>Distance: ${distanceKm(userPos.lat, userPos.lon, f.lat, f.lon).toFixed(1)} km</div>` : '';
  return `<div class="popup-title"><b>${esc(f.name)}</b></div>
          <table class="popup-table">${body}</table>${dist}`;
}

function getFiltered() {
  const q = searchEl.value.trim().toLowerCase();
  const cat = categoryEl.value;
  const city = cityEl.value;
  let list = facilities.filter(f =>
    (cat === 'all' || f.type === cat) &&
    (city === 'all' || f.city === city) &&
    f.name.toLowerCase().includes(q));
  if (userPos) {
    list = list
      .map(f => ({ ...f, dist: distanceKm(userPos.lat, userPos.lon, f.lat, f.lon) }))
      .sort((a, b) => a.dist - b.dist);
  }
  return list;
}

function render() {
  markerLayer.clearLayers();
  resultsEl.innerHTML = '';
  const list = getFiltered();

  list.forEach(f => {
    const marker = L.circleMarker([f.lat, f.lon], {
      radius: 7, color: '#fff', weight: 1.5,
      fillColor: COLORS[f.type], fillOpacity: 0.9
    }).bindPopup(popupHtml(f));
    marker.addTo(markerLayer);
    f.marker = marker;
  });

  // Sidebar list (first 100 to keep it fast)
  list.slice(0, 100).forEach(f => {
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.innerHTML = `<div class="name"><span class="dot" style="background:${COLORS[f.type]}"></span>${esc(f.name)}</div>
      <div class="meta">${LABELS[f.type]}${f.street ? ' · ' + esc(f.street) : ''}${f.dist != null ? ' · ' + f.dist.toFixed(1) + ' km' : ''}</div>`;
    const select = () => {
      map.setView([f.lat, f.lon], 16);
      f.marker.openPopup();
    };
    li.addEventListener('click', select);
    li.addEventListener('keydown', e => { if (e.key === 'Enter') select(); });
    resultsEl.appendChild(li);
  });

  if (facilities.length) {
    setStatus(`Showing ${list.length} of ${facilities.length} facilities` +
      (list.length > 100 ? ' (list shows first 100)' : ''));
  }
  if (list.length === 0 && facilities.length) {
    resultsEl.innerHTML = '<li>No matches. Try a different search or filter.</li>';
  }
}

// ---------- Events ----------
searchEl.addEventListener('input', render);
categoryEl.addEventListener('change', render);
cityEl.addEventListener('change', () => {
  const view = { all: [[33.63, 73.04], 11], rawalpindi: [[33.60, 73.04], 13], islamabad: [[33.69, 73.05], 12] }[cityEl.value];
  map.setView(view[0], view[1]);
  render();
});

document.getElementById('reset').addEventListener('click', () => {
  searchEl.value = '';
  categoryEl.value = 'all';
  cityEl.value = 'all';
  userPos = null;
  if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
  map.setView([33.63, 73.04], 11);
  render();
});

document.getElementById('locate').addEventListener('click', () => {
  if (!navigator.geolocation) {
    setStatus('Geolocation is not supported by this browser.', true);
    return;
  }
  setStatus('Finding your location...');
  navigator.geolocation.getCurrentPosition(
    pos => {
      userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (userMarker) map.removeLayer(userMarker);
      userMarker = L.marker([userPos.lat, userPos.lon]).addTo(map).bindPopup('You are here');
      map.setView([userPos.lat, userPos.lon], 14);
      render(); // list is now sorted by distance
    },
    err => setStatus('Could not get your location: ' + err.message, true),
    { timeout: 10000 }
  );
});

// ---------- Start ----------
loadData();