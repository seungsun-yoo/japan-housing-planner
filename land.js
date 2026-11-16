// 국토교통성 국토수치정보 「地価公示 (L01)」 — API 키 없이 도도부현별로 자동 다운로드·캐시
// 각 지점에 1995년~최신 연도의 가격 이력이 들어 있어 1/3/5/10/20년 대비 상승률을 계산할 수 있음
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DIR = path.join(__dirname, 'data', 'land');
fs.mkdirSync(DIR, { recursive: true });

// 도도부현 코드와 대표 좌표 (도청 소재지 부근)
const PREFS = [[1,'北海道',43.06,141.35],[2,'青森県',40.82,140.74],[3,'岩手県',39.70,141.15],[4,'宮城県',38.27,140.87],[5,'秋田県',39.72,140.10],[6,'山形県',38.24,140.36],[7,'福島県',37.75,140.47],[8,'茨城県',36.34,140.45],[9,'栃木県',36.57,139.88],[10,'群馬県',36.39,139.06],[11,'埼玉県',35.86,139.65],[12,'千葉県',35.61,140.12],[13,'東京都',35.69,139.69],[14,'神奈川県',35.45,139.64],[15,'新潟県',37.90,139.02],[16,'富山県',36.70,137.21],[17,'石川県',36.59,136.63],[18,'福井県',36.07,136.22],[19,'山梨県',35.66,138.57],[20,'長野県',36.65,138.18],[21,'岐阜県',35.39,136.72],[22,'静岡県',34.98,138.38],[23,'愛知県',35.18,136.91],[24,'三重県',34.73,136.51],[25,'滋賀県',35.00,135.87],[26,'京都府',35.02,135.76],[27,'大阪府',34.69,135.52],[28,'兵庫県',34.69,135.18],[29,'奈良県',34.69,135.83],[30,'和歌山県',34.23,135.17],[31,'鳥取県',35.50,134.24],[32,'島根県',35.47,133.05],[33,'岡山県',34.66,133.93],[34,'広島県',34.40,132.46],[35,'山口県',34.19,131.47],[36,'徳島県',34.07,134.56],[37,'香川県',34.34,134.04],[38,'愛媛県',33.84,132.77],[39,'高知県',33.56,133.53],[40,'福岡県',33.61,130.42],[41,'佐賀県',33.25,130.30],[42,'長崎県',32.74,129.87],[43,'熊本県',32.79,130.74],[44,'大分県',33.24,131.61],[45,'宮崎県',31.91,131.42],[46,'鹿児島県',31.56,130.56],[47,'沖縄県',26.21,127.68]]
  .map(([code, name, lat, lng]) => ({ code, name, lat, lng }));

const mem = {};
const loading = {};
const dist = (a, b, c, d) => Math.hypot(a - c, (b - d) * Math.cos((a * Math.PI) / 180));
const nearestPrefs = (lat, lng, n = 2) => [...PREFS].sort((a, b) => dist(lat, lng, a.lat, a.lng) - dist(lat, lng, b.lat, b.lng)).slice(0, n);

function unzipGeojson(zip) {
  return new Promise((ok, ng) => execFile('unzip', ['-p', zip, '*.geojson'], { maxBuffer: 300 * 1024 * 1024 }, (e, out) => (e ? ng(e) : ok(out.toString('utf8')))));
}
function muniName(addr) {
  const rest = addr.replace(/^\S+?[都道府県][\s　]*/, '');
  const m = rest.match(/^(.+?郡)?(.+?市)(.+?区)?/) || rest.match(/^(.+?[区町村])/);
  if (!m) return rest.slice(0, 6);
  return m[0];
}

async function loadPref(code) {
  if (mem[code]) return mem[code];
  if (loading[code]) return loading[code];
  loading[code] = (async () => {
    const f = path.join(DIR, `${code}.json`);
    if (fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < 30 * 864e5) return (mem[code] = JSON.parse(fs.readFileSync(f, 'utf8')));
    const yy = new Date().getFullYear() % 100;
    let res, year;
    for (const y of [yy, yy - 1, yy - 2]) {
      const pc = String(code).padStart(2, '0');
      const url = `https://nlftp.mlit.go.jp/ksj/gml/data/L01/L01-${y}/L01-${y}_${pc}_GML.zip`;
      res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (res.ok) { year = 2000 + y; break; }
    }
    if (!res.ok) throw new Error('지가공시 데이터 다운로드 실패');
    const zip = path.join(DIR, `${code}.zip`);
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    const gj = JSON.parse(await unzipGeojson(zip));
    fs.unlinkSync(zip);
    const points = gj.features.map((ft) => {
      const p = ft.properties;
      const hist = [];
      for (let i = 74; typeof p['L01_' + String(i).padStart(3, '0')] === 'number'; i++) hist.push(p['L01_' + String(i).padStart(3, '0')]);
      const [lng, lat] = ft.geometry.coordinates;
      return { lat, lng, addr: String(p.L01_025 || '').replace(/　/g, ' '), use: p.L01_028, station: p.L01_048, stationDist: p.L01_050,
        price: p.L01_008, yoy: p.L01_009, area: p.L01_027, muni: p.L01_001, hist };
    }).filter((x) => x.price > 0);
    const out = { code, year, startYear: year - (points[0]?.hist.length || 1) + 1, points };
    fs.writeFileSync(f, JSON.stringify(out));
    return (mem[code] = out);
  })().finally(() => delete loading[code]);
  return loading[code];
}

const PERIODS = [1, 3, 5, 10, 20];
function changes(hist) {
  const cur = hist[hist.length - 1], o = {};
  for (const k of PERIODS) { const b = hist[hist.length - 1 - k]; if (b > 0 && cur > 0) o[k] = { total: (cur / b - 1) * 100, cagr: ((cur / b) ** (1 / k) - 1) * 100 }; }
  return o;
}
const median = (a) => { const s = a.filter(isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

function aggregate(pref) {
  const by = {};
  for (const p of pref.points) {
    const k = p.muni;
    (by[k] = by[k] || { code: k, name: muniName(p.addr), pts: [] }).pts.push(p);
  }
  return Object.values(by).map((g) => {
    const res = g.pts.filter((p) => p.use === '住宅');
    const pts = res.length ? res : g.pts;
    const ch = pts.map((p) => changes(p.hist));
    const chg = {};
    for (const k of PERIODS) { const t = median(ch.map((c) => c[k]?.total)); if (t != null) chg[k] = { total: t, cagr: median(ch.map((c) => c[k]?.cagr)) }; }
    // 중앙값 지수 이력 (최신=100)
    const L = pts[0].hist.length, idx = [];
    for (let i = 0; i < L; i++) idx.push(median(pts.map((p) => (p.hist[i] > 0 ? (p.hist[i] / p.hist[L - 1]) * 100 : NaN))));
    return { code: g.code, name: g.name, pref: pref.code, n: pts.length, residential: !!res.length,
      lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lng: pts.reduce((a, p) => a + p.lng, 0) / pts.length,
      price: median(pts.map((p) => p.price)), chg, idx };
  });
}

async function munis(codes) {
  const out = [];
  for (const c of codes) { const p = await loadPref(c); out.push({ code: c, year: p.year, startYear: p.startYear, munis: aggregate(p) }); }
  return out;
}
async function near(lat, lng) {
  const prefs = nearestPrefs(lat, lng, 2);
  const all = [];
  let year;
  for (const pr of prefs) { const p = await loadPref(pr.code); year = p.year; all.push(...p.points); }
  const pts = all.map((p) => ({ ...p, d: dist(lat, lng, p.lat, p.lng) * 111 })).sort((a, b) => a.d - b.d).slice(0, 30)
    .map((p) => ({ ...p, chg: changes(p.hist) }));
  return { year, points: pts };
}
module.exports = { PREFS, munis, near, nearestPrefs, loadPref, aggregate };
