// 정적 사이트(GitHub Pages)용 데이터 생성: 금리·경제지표·뉴스와 국토교통성 지가공시를 public/data/ 에 JSON으로 저장
// GitHub Actions가 6시간마다 실행합니다. 로컬에서도 `node collect.js`로 실행 가능.
const fs = require('fs');
const path = require('path');
const { refreshAll, getCache, sources } = require('./server');
const land = require('./land');

const OUT = path.join(__dirname, 'public', 'data');
const LAND = path.join(OUT, 'land');
fs.mkdirSync(LAND, { recursive: true });
const write = (f, o) => fs.writeFileSync(f, JSON.stringify(o));

(async () => {
  await refreshAll();
  const c = getCache();
  write(path.join(OUT, 'status.json'), { ...c, log: undefined, refreshHours: sources().refreshHours, static: true, running: false });
  write(path.join(LAND, 'prefs.json'), land.PREFS);

  // 지가공시는 연 1회 갱신 → 30일 이상 지난 경우에만 다시 생성
  const metaF = path.join(LAND, 'meta.json');
  const meta = fs.existsSync(metaF) ? JSON.parse(fs.readFileSync(metaF, 'utf8')) : {};
  const only = process.env.PREFS ? process.env.PREFS.split(',').map(Number) : land.PREFS.map((p) => p.code);
  for (const code of only) {
    if (meta[code] && Date.now() - Date.parse(meta[code]) < 30 * 864e5 && fs.existsSync(path.join(LAND, `munis-${code}.json`))) continue;
    try {
      const p = await land.loadPref(code);
      write(path.join(LAND, `munis-${code}.json`), [{ code, year: p.year, startYear: p.startYear, munis: land.aggregate(p) }]);
      write(path.join(LAND, `points-${code}.json`), { year: p.year, points: p.points.map((x) => [r(x.lat, 5), r(x.lng, 5), x.addr, x.use, x.station, x.stationDist, x.price, x.hist]) });
      meta[code] = new Date().toISOString();
      console.log('land', code, p.points.length);
    } catch (e) { console.error('land fail', code, e.message); }
  }
  write(metaF, meta);
  console.log('done');
})();
function r(v, d) { return Math.round(v * 10 ** d) / 10 ** d; }
