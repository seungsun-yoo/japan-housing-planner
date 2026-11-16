// 일본 주택구입 시뮬레이터 — 로컬 서버 (의존성 없음, Node 18+)
// - 금리(국채/Flat35/은행)와 뉴스 RSS를 주기적으로 수집해 data/cache.json에 저장
// - 국토교통성 不動産情報ライブラリ API 키가 있으면 지도 클릭 지점의 공시지가를 조회
const http = require('http');
const land = require('./land');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5173);
const DATA_DIR = path.join(ROOT, 'data');
const CACHE = path.join(DATA_DIR, 'cache.json');
const SOURCES = path.join(ROOT, 'sources.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

fs.mkdirSync(DATA_DIR, { recursive: true });
const loadJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
let cache = loadJSON(CACHE, { rates: {}, rateHistory: [], news: [], updatedAt: null, log: [] });
const save = () => fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
const sources = () => loadJSON(SOURCES, { rates: [], news: [], refreshHours: 6 });

// ---------- fetch helpers ----------
async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.8' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  let cs = (res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1];
  if (!cs) cs = buf.subarray(0, 3000).toString('latin1').match(/charset=["']?([\w-]+)/i)?.[1];
  if (!cs && /\.csv$/i.test(url)) cs = 'shift_jis';
  cs = (cs || 'utf-8').toLowerCase().replace(/^(x-sjis|sjis|windows-31j|cp932)$/, 'shift_jis');
  try { return new TextDecoder(cs).decode(buf); } catch { return buf.toString('utf8'); }
}
const stripHtml = (h) => h.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const decodeEntities = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();

// ---------- rate collectors ----------
async function collectRate(src) {
  const text = await fetchText(src.url);
  if (src.type === 'mof_csv') {
    const lines = text.trim().split(/\r?\n/);
    const header = lines.find((l) => l.startsWith('基準日')).split(',');
    const col = header.indexOf('10年');
    const last = lines.filter((l) => /^[SHR]\d/.test(l)).pop().split(',');
    const v = parseFloat(last[col]);
    if (!isFinite(v)) throw new Error('10년 열을 읽지 못함');
    return { value: v, asOf: last[0], snippet: `基準日 ${last[0]} 10年 ${v}%` };
  }
  // keyword: 키워드 이후 등장하는 n번째 "x.xx%" 값을 추출
  const t = stripHtml(text);
  if (src.regex) { // 숫자가 아닌 문장 정보 (예: 다음 금융정책결정회합 일정)
    const m = t.match(new RegExp(src.regex));
    if (!m) throw new Error('텍스트를 찾지 못함');
    return { value: null, text: m[1].trim(), snippet: m[0].slice(0, 160) };
  }
  let idx = t.indexOf(src.keyword);
  if (idx < 0) throw new Error(`키워드 "${src.keyword}" 없음 (페이지 구조 변경 가능성)`);
  const win = t.slice(idx, idx + 600);
  const nums = [...win.matchAll(/(\d{1,2}\.\d{1,3})\s*[%％](?=(.{0,6}))/g)]
    .map((m) => parseFloat(m[1]) * (/下落|低下|減少|マイナス/.test(m[2]) ? -1 : 1));
  const v = nums[src.pick || 0];
  if (!isFinite(v) || Math.abs(v) > 15 || (src.kind !== 'econ' && v <= 0)) throw new Error('숫자를 찾지 못함');
  return { value: v, snippet: win.slice(0, 160) };
}

async function refreshRates() {
  const now = new Date().toISOString();
  const snap = { at: now };
  for (const src of sources().rates) {
    try {
      const r = await collectRate(src);
      cache.rates[src.id] = { ...src, ...r, ok: true, at: now, error: null };
      snap[src.id] = r.value;
    } catch (e) {
      const prev = cache.rates[src.id] || {};
      cache.rates[src.id] = { ...prev, ...src, ok: false, error: String(e.message || e), triedAt: now };
    }
  }
  cache.econ = cache.econ || {};
  for (const src of sources().econ || []) {
    try { cache.econ[src.id] = { ...src, kind: 'econ', ...(await collectRate({ ...src, kind: 'econ' })), ok: true, at: now, error: null }; }
    catch (e) { cache.econ[src.id] = { ...(cache.econ[src.id] || {}), ...src, ok: false, error: String(e.message || e), triedAt: now }; }
  }
  const last = cache.rateHistory[cache.rateHistory.length - 1];
  const changed = !last || Object.keys(snap).some((k) => k !== 'at' && last[k] !== snap[k]);
  if (changed || (last && Date.parse(now) - Date.parse(last.at) > 20 * 3600e3)) cache.rateHistory.push(snap);
  cache.rateHistory = cache.rateHistory.slice(-1500);
  // 과거 금리 이력이 비어 있으면 MOF 연도별 CSV로 10년 국채 장기추이를 채움
  if (!cache.jgbHistory) await loadJgbHistory().catch((e) => log('JGB 이력 실패: ' + e.message));
}

async function loadJgbHistory() {
  const text = await fetchText('https://www.mof.go.jp/jgbs/reference/interest_rate/data/jgbcm_all.csv');
  const lines = text.trim().split(/\r?\n/);
  const hIdx = lines.findIndex((l) => l.startsWith('基準日'));
  const col = lines[hIdx].split(',').indexOf('10年');
  const era = { S: 1925, H: 1988, R: 2018 };
  const monthly = {};
  for (const l of lines.slice(hIdx + 1)) {
    const c = l.split(',');
    const m = c[0].match(/^([SHR])(\d+)\.(\d+)\.(\d+)/);
    const v = parseFloat(c[col]);
    if (!m || !isFinite(v)) continue;
    const ym = `${era[m[1]] + +m[2]}-${String(m[3]).padStart(2, '0')}`;
    monthly[ym] = v; // 월말 값
  }
  cache.jgbHistory = Object.entries(monthly).filter(([k]) => k >= '2000-01').map(([d, v]) => ({ d, v }));
}

// ---------- news collectors ----------
const TAGS = [
  ['금리↑', /利上げ|金利上昇|引き上げ|上昇|引上げ/],
  ['금리↓', /利下げ|金利低下|引き下げ|引下げ/],
  ['일본은행', /日銀|日本銀行|植田/],
  ['지가', /地価|公示|路線価|基準地価/],
  ['맨션', /マンション/],
  ['대출', /住宅ローン|フラット35|変動金利|固定金利/],
  ['정책', /住宅ローン控除|減税|補助金|税制/],
];
async function refreshNews() {
  const items = [];
  for (const s of sources().news) {
    try {
      const xml = await fetchText(s.url);
      for (const it of xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) || []) {
        const g = (tag) => decodeEntities(it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] || '');
        const link = g('link') || it.match(/<link[^>]*href="([^"]+)"/)?.[1] || '';
        const title = g('title');
        const date = g('pubDate') || g('dc:date') || g('updated') || g('published');
        if (!title) continue;
        items.push({ title, link, source: g('source') || s.name, feed: s.name, date: date ? new Date(date).toISOString() : null,
          tags: TAGS.filter(([, re]) => re.test(title)).map(([t]) => t) });
      }
    } catch (e) { log(`뉴스 실패 ${s.name}: ${e.message}`); }
  }
  const seen = new Set();
  const merged = [...items, ...cache.news].filter((n) => { const k = n.title.replace(/ - [^-]+$/, ''); if (seen.has(k)) return false; seen.add(k); return true; });
  merged.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  cache.news = merged.slice(0, 400);
}

function log(msg) { cache.log = [...(cache.log || []), `${new Date().toISOString()} ${msg}`].slice(-100); console.log(msg); }

let running = null;
async function refreshAll() {
  if (running) return running;
  running = (async () => {
    log('수집 시작');
    await refreshRates().catch((e) => log('금리 수집 오류 ' + e.message));
    await refreshNews().catch((e) => log('뉴스 수집 오류 ' + e.message));
    cache.updatedAt = new Date().toISOString();
    save();
    log('수집 완료');
  })().finally(() => { running = null; });
  return running;
}

// ---------- 不動産情報ライブラリ (국토교통성) 지가 조회 ----------
function tileOf(lat, lng, z) {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return { x: Math.floor(((lng + 180) / 360) * n), y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n) };
}
async function landPrice(lat, lng) {
  const key = process.env.REINFOLIB_API_KEY || loadJSON(path.join(DATA_DIR, 'settings.json'), {}).reinfolibKey;
  if (!key) return { error: 'NO_KEY' };
  const z = 13, { x, y } = tileOf(lat, lng, z);
  const year = new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0);
  const url = `https://www.reinfolib.mlit.go.jp/ex-api/external/XPT002?response_format=geojson&z=${z}&x=${x}&y=${y}&year=${year}&priceClassification=0`;
  const res = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': key }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return { error: 'HTTP ' + res.status };
  const gj = await res.json();
  const pts = (gj.features || []).map((f) => {
    const [plng, plat] = f.geometry.coordinates;
    return { lat: plat, lng: plng, d: Math.hypot(plat - lat, (plng - lng) * Math.cos((lat * Math.PI) / 180)), p: f.properties };
  }).sort((a, b) => a.d - b.d);
  return { year, points: pts.slice(0, 12) };
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/api/status') {
      const s = loadJSON(path.join(DATA_DIR, 'settings.json'), {});
      return send(res, 200, { ...cache, refreshHours: sources().refreshHours, hasLandKey: !!(process.env.REINFOLIB_API_KEY || s.reinfolibKey), running: !!running });
    }
    if (u.pathname === '/api/refresh' && req.method === 'POST') { await refreshAll(); return send(res, 200, { ok: true }); }
    if (u.pathname === '/api/land/prefs') return send(res, 200, land.PREFS);
    if (u.pathname === '/api/land/munis') return send(res, 200, await land.munis(u.searchParams.get('prefs').split(',').map(Number).filter((n) => n >= 1 && n <= 47).slice(0, 6)));
    if (u.pathname === '/api/land/near') return send(res, 200, await land.near(+u.searchParams.get('lat'), +u.searchParams.get('lng')));
    if (u.pathname === '/api/sources' && req.method === 'POST') {
      // 사용자가 추가하는 은행 금리 소스
      const b = JSON.parse((await readBody(req)) || '{}');
      const src = sources();
      if (b.remove) src.rates = src.rates.filter((r) => r.id !== b.remove), delete cache.rates[b.remove];
      else {
        if (!/^https?:\/\//.test(b.url || '') || !b.keyword || !b.name) return send(res, 400, { error: '이름·URL·키워드가 필요합니다' });
        const id = 'u_' + Date.now().toString(36);
        const r = { id, name: b.name, kind: b.kind || 'variable', type: 'keyword', url: b.url, keyword: b.keyword, pick: +b.pick || 0, user: true };
        try { const v = await collectRate(r); cache.rates[id] = { ...r, ...v, ok: true, at: new Date().toISOString() }; }
        catch (e) { cache.rates[id] = { ...r, ok: false, error: String(e.message || e), triedAt: new Date().toISOString() }; }
        src.rates.push(r);
      }
      fs.writeFileSync(SOURCES, JSON.stringify(src, null, 2)); save();
      return send(res, 200, { ok: true });
    }
    if (u.pathname === '/api/settings' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const f = path.join(DATA_DIR, 'settings.json');
      fs.writeFileSync(f, JSON.stringify({ ...loadJSON(f, {}), ...body }));
      return send(res, 200, { ok: true });
    }
    let p = path.normalize(path.join(ROOT, 'public', u.pathname === '/' ? 'index.html' : u.pathname));
    if (!p.startsWith(path.join(ROOT, 'public'))) return send(res, 403, 'forbidden', 'text/plain');
    fs.readFile(p, (err, data) => err ? send(res, 404, 'not found', 'text/plain') : send(res, 200, data, MIME[path.extname(p)] || 'application/octet-stream'));
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
});
if (require.main === module) server.listen(PORT, '127.0.0.1', () => {
  console.log(`▶ http://localhost:${PORT}`);
  const stale = !cache.updatedAt || Date.now() - Date.parse(cache.updatedAt) > 3600e3;
  if (stale) refreshAll();
  setInterval(refreshAll, Math.max(1, sources().refreshHours) * 3600e3);
});

module.exports = { refreshAll, getCache: () => cache, sources };
