// ===== 공통 =====
const $ = (id) => document.getElementById(id);
const fmt = (v, d = 0) => (v == null || !isFinite(v)) ? '–' : v.toLocaleString('ja-JP', { maximumFractionDigits: d, minimumFractionDigits: d });
const man = (v) => { if (v == null || !isFinite(v)) return '–'; const s = v < 0 ? '-' : ''; v = Math.abs(v); return s + (v >= 10000 ? `${Math.floor(v / 10000)}억${fmt(v % 10000)}만엔` : `${fmt(v)}만엔`); };
const pct = (v, d = 1) => (v == null || !isFinite(v)) ? '–' : `${v > 0 ? '+' : ''}${fmt(v, d)}%`;
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const C = { a: '#1f5f8b', b: '#c0672c', c: '#2f7d4f', d: '#8a6bb8', e: '#9b9a94', f: '#b23b3b' };
const PERIODS = [1, 3, 5, 10, 20];
let STATUS = null, charts = {};
// ===== 데이터 접근: 로컬 서버(/api) 또는 정적 사이트(data/*.json, GitHub Pages) =====
let STATIC = null;
async function detectMode() {
  if (STATIC !== null) return STATIC;
  try { const r = await fetch('/api/status'); STATIC = !(r.ok && (r.headers.get('content-type') || '').includes('json')); } catch { STATIC = true; }
  if (STATIC) document.body.classList.add('static');
  return STATIC;
}
const getJ = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
const API = {
  status: async () => (await detectMode()) ? getJ('data/status.json?t=' + Date.now()) : getJ('/api/status'),
  prefs: async () => (await detectMode()) ? getJ('data/land/prefs.json') : getJ('/api/land/prefs'),
  munis: async (codes) => (await detectMode()) ? (await Promise.all(codes.map((c) => getJ(`data/land/munis-${c}.json`)))).flat() : getJ('/api/land/munis?prefs=' + codes.join(',')),
  near: async (lat, lng) => {
    if (!(await detectMode())) return getJ(`/api/land/near?lat=${lat}&lng=${lng}`);
    if (!PREFS.length) PREFS = await API.prefs();
    const dist = (a, b, c, d) => Math.hypot(a - c, (b - d) * Math.cos((a * Math.PI) / 180));
    const near2 = [...PREFS].sort((a, b) => dist(lat, lng, a.lat, a.lng) - dist(lat, lng, b.lat, b.lng)).slice(0, 2);
    const all = []; let year;
    for (const p of near2) {
      const j = await getJ(`data/land/points-${p.code}.json`); year = j.year;
      all.push(...j.points.map(([la, ln, addr, use, station, stationDist, price, hist]) => ({ lat: la, lng: ln, addr, use, station, stationDist, price, hist })));
    }
    const pts = all.map((p) => ({ ...p, d: dist(lat, lng, p.lat, p.lng) * 111 })).sort((a, b) => a.d - b.d).slice(0, 8).map((p) => ({ ...p, chg: changesOf(p.hist) }));
    return { year, points: pts };
  },
};
function changesOf(hist) {
  const cur = hist[hist.length - 1], o = {};
  for (const k of [1, 3, 5, 10, 20]) { const b = hist[hist.length - 1 - k]; if (b > 0 && cur > 0) o[k] = { total: (cur / b - 1) * 100, cagr: ((cur / b) ** (1 / k) - 1) * 100 }; }
  return o;
}
let region = store.get('region2', null), iregion = store.get('iregion2', null);
let ptype = store.get('ptype', 'new_m'), iptype = store.get('iptype', 'used_m');

function chart(id, cfg) {
  if (charts[id]) charts[id].destroy();
  const grid = css('--line'), tick = css('--mute'), small = window.innerWidth < 600, font = { size: small ? 10 : 12 };
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: tick, boxWidth: small ? 8 : 12, font } } },
    scales: Object.fromEntries(Object.entries(cfg.scales || { x: {}, y: {} }).map(([k, v]) => [k, Object.assign({ grid: { color: grid }, ticks: { color: tick, font, maxTicksLimit: small ? 6 : 12 } }, v)])) }, cfg.options || {});
  delete cfg.scales;
  charts[id] = new Chart($(id), cfg);
}
function kpi(l, v, s = '', cls = '') { return `<div class="kpi"><div class="l">${l}</div><div class="v ${cls}">${v}</div><div class="s">${s}</div></div>`; }
function alertsHtml(a) { return a.length ? a.map(([c, t]) => `<div class="${c}">${c === 'bad' ? '⛔' : c === 'good' ? '✅' : '⚠️'} ${t}</div>`).join('') : '<div class="good">✅ 주요 위험 신호 없음</div>'; }

// ===== 탭 =====
document.querySelectorAll('nav button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
document.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => showTab(b.dataset.goto)));
function showTab(t) {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x.dataset.tab === t));
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x.id === 'tab-' + t));
  store.set('tab', t);
  if (t === 'map') { initMap(); setTimeout(() => map.invalidateSize(), 50); }
  if (t === 'news') { store.set('newsSeen', new Date().toISOString()); renderNews(); }
  if (t === 'rates') renderRates();
  if (t === 'invest') calcInvest();
  if (t === 'refi') calcRefi();
  if (t === 'home') calcHome();
}

// ===== 입력 저장/복원 =====
const FORM_SEL = '#homeForm input, #homeForm select, #investForm input, #investForm select, #tab-refi input, #tab-refi select';
const saved = store.get('inputs2', {});
document.querySelectorAll(FORM_SEL).forEach((el) => { if (el.id && saved[el.id] != null && el.id !== 'bank') el.value = saved[el.id]; });
function persist() { const o = {}; document.querySelectorAll(FORM_SEL).forEach((el) => el.id && (o[el.id] = el.value)); store.set('inputs2', o); }
document.addEventListener('input', (e) => {
  if (!e.target.closest('#homeForm, #investForm, #tab-refi')) return;
  persist();
  if (e.target.id === 'loanType') fillBanks();
  calcAll();
});
document.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') { persist(); if (e.target.id === 'loanType') fillBanks(); calcAll(); } });
function seg(id, get, set) {
  const el = $(id);
  const sync = () => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === get()));
  el.querySelectorAll('button').forEach((b) => (b.onclick = () => { set(b.dataset.v); sync(); calcAll(); }));
  sync();
}
seg('ptypeSeg', () => ptype, (v) => { ptype = v; store.set('ptype', v); });
seg('iptypeSeg', () => iptype, (v) => { iptype = v; store.set('iptype', v); });
$('resetBtn').onclick = () => { document.querySelectorAll('#homeDetail input[data-auto]').forEach((i) => (i.value = '')); persist(); calcAll(); };
$('homeDetail').open = store.get('detailOpen', false);
$('homeDetail').addEventListener('toggle', () => store.set('detailOpen', $('homeDetail').open));

// 값 읽기: 비어 있으면 자동값 사용, placeholder에 자동값 표시
const val = (id) => { const x = $(id).value; return x === '' ? null : parseFloat(x); };
function pick(id, auto, d = 1) {
  const el = $(id), x = val(id);
  el.placeholder = '자동 ' + (auto == null || !isFinite(auto) ? '–' : fmt(auto, d));
  return x == null || isNaN(x) ? auto : x;
}

// ===== 경제 상황 (자동) =====
function bestRate(kind) { const l = Object.values(STATUS?.rates || {}).filter((r) => r.kind === kind && isFinite(r.value)); return l.length ? l.reduce((a, b) => (a.value < b.value ? a : b)) : null; }
const FALLBACK = { variable: 1.0, fixed10: 2.5, flat35: 3.0 };
function econ() {
  const e = STATUS?.econ || {};
  const cpi = e.cpi_core?.ok !== false ? e.cpi_core?.value : null;
  const cpiAll = e.cpi?.value;
  const base = cpi ?? cpiAll;
  const inflation = base != null ? r1((base + 2) / 2) : 2.0; // 최근 물가와 일본은행 목표(2%)의 평균
  return { cpi, cpiAll, boj: e.boj?.value, jgb: STATUS?.rates?.jgb10?.value, inflation, wage: inflation, investReturn: 3.0,
    variable: bestRate('variable'), fixed10: bestRate('fixed10'), flat35: bestRate('flat35') };
}
function renderEcon(E, s) {
  const row = (l, v, sub) => `<span>${l}</span><b>${v}</b>${sub ? `<span class="s">${sub}</span>` : ''}`;
  const src = $('bank').selectedOptions[0]?.textContent || '';
  $('econBox').innerHTML =
    row('물가상승률 (적용)', fmt(s.inflation, 1) + '%', E.cpi != null ? `コアCPI 전년비 ${pct(E.cpi)} · 일본은행 목표 2%의 평균` : '물가 데이터 수집 전 — 기본 2%') +
    row('임금상승률 (적용)', fmt(s.wageGrowth, 1) + '%', '명목임금이 물가만큼 오른다고 가정') +
    row('일본은행 정책금리', E.boj != null ? fmt(E.boj, 2) + '%' : '–') +
    row('10년 국채 금리', E.jgb != null ? fmt(E.jgb, 3) + '%' : '–') +
    row('적용 대출금리', fmt(s.rate, 3) + '%', src.replace(/\s*\d+\.\d+%$/, '')) +
    row('지가 상승률 (적용)', pct(s.landGrowth), region ? `${region.name} · ${region.manual != null ? '직접 입력' : $('landBasis').value + '년 대비 연평균'}` : '지역 미선택');
}
function fillBanks() {
  if (!STATUS) return;
  const kind = $('loanType').value, sel = $('bank'), prev = store.get('bank', null);
  const list = Object.values(STATUS.rates).filter((r) => r.kind === kind && isFinite(r.value)).sort((a, b) => a.value - b.value);
  sel.innerHTML = list.map((r) => `<option value="${r.id}">${r.name} ${r.value.toFixed(3)}%</option>`).join('') + '<option value="">(직접 입력·기본값)</option>';
  sel.value = prev !== null && [...sel.options].some((o) => o.value === prev) ? prev : sel.options[0].value;
}
$('bank').addEventListener('change', () => store.set('bank', $('bank').value));

// ===== 자가 설계 입력 → 시뮬레이션 입력 =====
function homeInputs() {
  const pt = SIM.PT[ptype], E = econ();
  const age = val('age') || 35, income = val('income') || 0, cash = val('cash') || 0, price = val('price') || 0;
  const spouseIncome = pick('spouseIncome', 0, 0);
  const th = SIM.tax(income).takeHome + SIM.tax(spouseIncome).takeHome;
  const living = pick('living', Math.round((th / 12) * 0.45), 0);
  const costsPct = pick('costsPct', pt.costs);
  const loanType = $('loanType').value;
  const bankRow = STATUS?.rates?.[$('bank').value];
  const autoRate = bankRow?.value ?? FALLBACK[loanType];
  const basis = +$('landBasis').value;
  const s = {
    mode: 'live', age, income, spouseIncome, cash, price, ptype, living,
    retireAge: pick('retireAge', 65, 0), pension: pick('pension', 40, 0),
    inflation: pick('inflation', E.inflation), wageGrowth: pick('wageGrowth', E.wage), investReturn: pick('investReturn', E.investReturn),
    bAge: pick('bAge', pt.isNew ? 0 : pt.mansion ? 15 : 20, 0), landRatio: pick('landRatio', pt.landRatio * 100, 0), costsPct,
    mgmt: pick('mgmt', pt.mansion ? r1(price * 0.00028) : 0), repair: pick('repair', pt.mansion ? r1(price * (pt.isNew ? 0.00018 : 0.0003)) : 0),
    repairGrowth: pick('repairGrowth', pt.mansion ? 3 : 0), propTax: pick('propTax', Math.round(price * 0.0035), 0),
    upkeep: pick('upkeep', pt.mansion ? 5 : pt.isNew ? 15 : 25, 0),
    loanType, rate: pick('rate', autoRate, 3), term: pick('term', Math.max(10, Math.min(35, 80 - age)), 0),
    rateScenario: $('rateScenario').value, riseStep: val('riseStep') ?? 0.2, riseCap: val('riseCap') ?? 2,
    landScenario: $('landScenario').value, landGrowth: pick('landGrowth', r1(growthOf(region, basis) ?? 1.0)),
    currentRent: pick('currentRent', r1((price * (pt.mansion ? 0.04 : 0.035)) / 12)), rentGrowth: pick('rentGrowth', r1(E.inflation * 0.75)),
    horizon: pick('horizon', 30, 0), energy: $('energy').value, kosodate: $('kosodate').value === '1',
    investPremium: 0, monthlyRent: 0, vacancy: 0, pmFee: 0, rentDecline: 0, marginalTax: 0, holdYears: 10, saleCost: 4,
  };
  s.variableBase = pick('variableBase', loanType === 'variable' ? s.rate : (E.variable?.value ?? FALLBACK.variable), 3);
  const costs = (price * costsPct) / 100;
  s.down = pick('down', Math.max(0, Math.round(Math.min(cash - living * 6, costs + price * 0.1))), 0);
  document.querySelectorAll('.custom').forEach((e) => e.classList.toggle('hide', s.rateScenario !== 'custom'));
  return { s, E };
}

// 원리금균등 상환액에서 대출 가능 원금 역산
const pvLoan = (monthly, rate, months) => { const r = rate / 100 / 12; return r ? (monthly * (1 - (1 + r) ** -months)) / r : monthly * months; };

function calcHome() {
  const { s, E } = homeInputs();
  renderEcon(E, s);
  $('regionName').textContent = region ? (region.addr ? `${region.name} (${region.addr})` : region.name) : '미선택';
  const r = SIM.run(s), rows = r.rows, g = s.income + s.spouseIncome, cf = 1 + s.costsPct / 100;
  // ---- 계획 도출 ----
  const loanSafe = pvLoan((g * 0.25) / 12, s.rate + 1, s.term * 12);
  const priceSafe = (loanSafe + s.down) / cf, priceMax = (r.maxLoan + s.down) / cf;
  const verdict = s.price <= priceSafe ? ['good', '✅ 무리 없는 계획입니다'] : s.price <= priceMax ? ['warn', '⚠️ 대출은 가능하지만 여유가 적습니다'] : ['bad', '⛔ 이 가격은 대출 심사 통과가 어렵습니다'];
  const tips = [];
  tips.push(`대출 가능성: 은행 심사 기준(심사금리 3.5%, 返済比率 ${g >= 400 ? 35 : 30}%, ${r.maxTerm}년)으로 최대 약 <b>${man(r.maxLoan)}</b> → 물건 가격 <b>${man(priceMax)}</b>까지`);
  tips.push(`안전 예산: 금리가 1%p 올라도 返済負担率 25% 이내 → 물건 가격 <b>${man(priceSafe)}</b> 이하 권장`);
  const reserve = s.cash - s.down;
  tips.push(`頭金 <b>${man(s.down)}</b> 투입 후 남는 저축 ${man(reserve)} (생활비 ${fmt(reserve / s.living, 0)}개월분)${reserve < s.living * 6 ? ' — <span class="warn">비상금 6개월분 미만</span>' : ''}`);
  if (E.variable && E.flat35) {
    const spread = E.flat35.value - E.variable.value;
    tips.push(`금리 유형: 고정(フラット35 ${fmt(E.flat35.value, 2)}%)과 변동(${fmt(E.variable.value, 3)}%)의 차이는 ${fmt(spread, 2)}%p. ${spread < 1 ? '차이가 작아 <b>고정 검토</b> 가치가 있습니다.' : '변동이 유리하지만, 금리가 ' + fmt(spread, 1) + '%p 이상 오르면 역전됩니다. 상승 시나리오로 확인하세요.'}`);
  }
  if (r.balAtRetire > 0) tips.push(`은퇴(${s.retireAge}세) 시 잔액 ${man(r.balAtRetire)} → 퇴직금 상환 또는 연 ${man(r.balAtRetire / Math.max(1, s.retireAge - s.age))} 정도의 繰上返済 계획 권장`);
  tips.push(`구입 vs 계속 임대 (${rows.length}년 후 순자산): ${r.nwBuy >= r.nwRent ? '구입이' : '임대가'} 약 <b>${man(Math.abs(r.nwBuy - r.nwRent))}</b> 유리 (월세 ${fmt(s.currentRent, 1)}만엔 비교)`);
  tips.push(`물건 가치: ${region ? region.name + ' ' : ''}지가 ${pct(s.landGrowth)}/년 기준 10년 후 약 <b>${man(rows[Math.min(9, rows.length - 1)].value)}</b> (${pct((rows[Math.min(9, rows.length - 1)].value / s.price - 1) * 100, 0)})`);
  $('plan').innerHTML = `<h2>계획 도출</h2><div class="verdict ${verdict[0]}">${verdict[1]}</div><ul>${tips.map((t) => `<li>${t}</li>`).join('')}</ul>`;
  // ---- KPI ----
  const bCls = r.burden > 35 ? 'bad' : r.burden > 25 ? 'warn' : 'good', diff = r.nwBuy - r.nwRent;
  $('kpis').innerHTML = kpi('대출 원금', man(r.loan0), `제비용 ${man(r.costs)} 포함`) +
    kpi('월 상환액 (1년차)', man(r.pay1 / 12), `${fmt(rows[0].rate, 3)}% / ${s.term}년`) +
    kpi('返済負担率', fmt(r.burden, 1) + '%', '세전 연수입 대비', bCls) +
    kpi('年収倍率', fmt(r.multiple, 1) + '배', '가격 ÷ 세대 연수입', r.multiple > 10 ? 'bad' : r.multiple > 7 ? 'warn' : 'good') +
    kpi(`${rows.length}년 후 순자산`, man(r.nwBuy), `임대 시 ${man(r.nwRent)}`, diff >= 0 ? 'good' : 'warn') +
    kpi('총 이자', man(r.totalInterest), `住宅ローン控除 ${man(r.totalCredit)}`) +
    kpi('완제 나이', r.endAge + '세', '', r.endAge > 75 ? 'bad' : r.endAge > s.retireAge ? 'warn' : 'good') +
    kpi('최저 현금 잔고', man(r.minCash), '기간 중 최저', r.minCash < 0 ? 'bad' : r.minCash < 300 ? 'warn' : 'good');
  const al = [];
  if (r.minCash < 0) al.push(['bad', `기간 중 현금 잔고가 마이너스가 됩니다 (최저 ${man(r.minCash)}). 가격·頭金·생활비를 재검토하세요.`]);
  if (r.burden > 35) al.push(['bad', `返済負担率 ${fmt(r.burden, 1)}% — 일반적인 심사 상한(35%)을 넘습니다.`]);
  else if (r.burden > 25) al.push(['warn', `返済負担率 ${fmt(r.burden, 1)}% — 안전 기준(25% 이하)보다 높습니다.`]);
  if (r.endAge > 80) al.push(['bad', `완제 나이가 ${r.endAge}세 — 대부분 은행의 완제 연령 상한(80세)을 넘습니다.`]);
  if (SIM.PT[ptype].isNew && s.energy === 'other') al.push(['warn', '2024년 이후 건축확인된 신축 「기타」 주택은 住宅ローン控除 대상 외입니다.']);
  if (s.down > s.cash) al.push(['bad', '頭金이 현재 저축보다 많습니다.']);
  $('alerts').innerHTML = alertsHtml(al);
  // ---- 차트 ----
  const L = rows.map((x) => x.y + '년');
  chart('c1', { type: 'line', data: { labels: L, datasets: [
    { label: '물건 가치', data: rows.map((x) => x.value), borderColor: C.a, pointRadius: 0, borderWidth: 2 },
    { label: '대출 잔액', data: rows.map((x) => x.bal), borderColor: C.b, pointRadius: 0, borderWidth: 2 },
    { label: '자기 지분', data: rows.map((x) => x.equity), borderColor: C.c, backgroundColor: C.c + '22', fill: true, pointRadius: 0, borderWidth: 1 }] } });
  chart('c2', { type: 'line', data: { labels: L, datasets: [
    { label: '구입 (현금+지분)', data: rows.map((x) => x.nwBuy), borderColor: C.a, pointRadius: 0, borderWidth: 2 },
    { label: '임대 (현금 운용)', data: rows.map((x) => x.nwRent), borderColor: C.b, pointRadius: 0, borderWidth: 2 },
    { label: '구입 시 현금', data: rows.map((x) => x.cashBuy), borderColor: C.e, borderDash: [4, 4], pointRadius: 0, borderWidth: 1 }] } });
  chart('c3', { data: { labels: L, datasets: [
    { type: 'line', label: '금리 %', data: rows.map((x) => x.rate), borderColor: C.f, pointRadius: 0, borderWidth: 2, yAxisID: 'y1' },
    { type: 'bar', label: '연간 상환액(만엔)', data: rows.map((x) => x.pay), backgroundColor: C.a + '88', yAxisID: 'y' }] },
    scales: { x: {}, y: { position: 'left' }, y1: { position: 'right', grid: { drawOnChartArea: false } } } });
  const fixedPart = (x) => s.propTax + s.upkeep * (1 + s.inflation / 100) ** (x.y - 1);
  chart('c4', { type: 'bar', data: { labels: L, datasets: [
    { label: '대출 상환', data: rows.map((x) => x.pay), backgroundColor: C.a },
    { label: '관리·수선', data: rows.map((x) => x.housing - x.pay - fixedPart(x) + x.credit), backgroundColor: C.d },
    { label: '세금·유지', data: rows.map(fixedPart), backgroundColor: C.e },
    { label: '감세(控除)', data: rows.map((x) => -x.credit), backgroundColor: C.c },
    { type: 'line', label: '비교 월세(연)', data: rows.map((x) => x.rent), borderColor: C.b, pointRadius: 0, borderWidth: 2 }] },
    scales: { x: { stacked: true }, y: { stacked: true } } });
  table('tbl', rows, [['년', 'y'], ['나이', 'age'], ['금리%', 'rate', 3], ['연 상환', 'pay'], ['잔액', 'bal'], ['가치', 'value'], ['控除', 'credit', 1], ['주거비', 'housing'], ['비교 월세', 'rent'], ['현금(구입)', 'cashBuy'], ['순자산(구입)', 'nwBuy'], ['순자산(임대)', 'nwRent']]);
}
function table(id, rows, cols) {
  $(id).innerHTML = '<tr>' + cols.map((c) => `<th>${c[0]}</th>`).join('') + '</tr>' +
    rows.map((x) => '<tr>' + cols.map((c) => `<td class="${x[c[1]] < 0 ? 'bad' : ''}">${fmt(x[c[1]], c[2] || 0)}</td>`).join('') + '</tr>').join('');
}

// ===== 투자 시뮬레이션 =====
function calcInvest() {
  const { s: h, E } = homeInputs();
  const pt = SIM.PT[iptype], price = val('i_price') || 0, basis = +$('landBasis').value, reg = iregion || region;
  $('iregionName').textContent = reg ? (reg.addr ? `${reg.name} (${reg.addr})` : reg.name) : '미선택';
  const costsPct = pick('i_costsPct', pt.costs);
  const s = { ...h, mode: 'invest', ptype: iptype, price, monthlyRent: val('i_monthlyRent') || 0, costsPct,
    bAge: pick('i_bAge', pt.isNew ? 0 : pt.mansion ? 15 : 20, 0), landRatio: pick('i_landRatio', pt.landRatio * 100, 0),
    mgmt: pick('i_mgmt', pt.mansion ? r1(Math.max(0.8, price * 0.00028)) : 0), repair: pick('i_repair', pt.mansion ? r1(Math.max(0.6, price * 0.0003)) : 0),
    propTax: pick('i_propTax', Math.round(price * 0.0035), 0), upkeep: pick('i_upkeep', pt.mansion ? 3 : 15, 0),
    vacancy: pick('i_vacancy', 5, 0), pmFee: pick('i_pmFee', 5, 0), rentDecline: pick('i_rentDecline', 0.5),
    loanType: 'variable', rate: pick('i_rate', r2((E.variable?.value ?? FALLBACK.variable) + 1.0), 2), investPremium: 0,
    term: pick('i_term', Math.max(10, Math.min(35, 80 - h.age)), 0),
    marginalTax: pick('i_marginalTax', Math.round(SIM.tax(h.income).marginal * 102.1 + 10), 0),
    holdYears: pick('i_holdYears', 10, 0), saleCost: pick('i_saleCost', 4),
    landGrowth: pick('i_landGrowth', r1(growthOf(reg, basis) ?? 1.0)) };
  s.down = pick('i_down', Math.round(Math.min(h.cash, (price * costsPct) / 100 + price * 0.1)), 0);
  const r = SIM.run(s), rows = r.rows;
  $('ikpis').innerHTML = kpi('表面利回り', fmt(r.grossYield, 2) + '%', '연 임대료 ÷ 가격', r.grossYield < 4 ? 'warn' : 'good') +
    kpi('実質利回り (NOI)', fmt(r.netYield, 2) + '%', '제비용 포함') +
    kpi('대출', man(r.loan0), `${fmt(s.rate, 2)}% / ${s.term}년`) +
    kpi('세후 CF (1년차)', man(rows[0].cf), `월 ${fmt(rows[0].cf / 12, 1)}만엔 · CCR ${fmt(r.ccr, 1)}%`, rows[0].cf < 0 ? 'bad' : 'good') +
    kpi('DSCR', fmt(r.dscr, 2), 'NOI ÷ 상환액', r.dscr < 1.2 ? 'bad' : r.dscr < 1.4 ? 'warn' : 'good') +
    kpi(`IRR (${rows.length}년 보유·매각)`, fmt(r.irr, 1) + '%', `총손익 ${man(r.profit)}`, r.irr < 3 ? 'bad' : r.irr < 6 ? 'warn' : 'good') +
    kpi('매각 수령액', man(r.proceeds), `양도세 ${man(r.capTax)} (${rows.length > 5 ? '장기' : '단기'})`) +
    kpi('손익분기 입주율', fmt(r.breakEvenOcc, 0) + '%', '세전 CF=0', r.breakEvenOcc > 90 ? 'bad' : r.breakEvenOcc > 80 ? 'warn' : 'good');
  const al = [];
  if (rows.length <= 5) al.push(['warn', '보유 5년 이하 매각은 단기양도소득(39.63%)이 적용됩니다.']);
  if (r.grossYield < s.rate + 2) al.push(['warn', `利回り(${fmt(r.grossYield, 2)}%)와 대출금리(${fmt(s.rate, 2)}%)의 차이가 2%p 미만 — 금리 상승에 취약합니다.`]);
  if (r.dscr < 1) al.push(['bad', '임대 수입으로 대출 상환을 감당하지 못합니다 (DSCR < 1). 매달 본인 소득에서 보전이 필요합니다.']);
  if (s.down > h.cash) al.push(['bad', '頭金이 현재 저축보다 많습니다.']);
  $('ialerts').innerHTML = alertsHtml(al);
  const L = rows.map((x) => x.y + '년');
  chart('ic1', { type: 'bar', data: { labels: L, datasets: [
    { label: '연간 세후 CF', data: rows.map((x) => x.cf), backgroundColor: rows.map((x) => (x.cf >= 0 ? C.c : C.f)) },
    { type: 'line', label: '누적 CF', data: rows.map((x) => x.cumCf), borderColor: C.a, pointRadius: 0, borderWidth: 2 }] } });
  chart('ic2', { type: 'line', data: { labels: L, datasets: [
    { label: '물건 가치', data: rows.map((x) => x.value), borderColor: C.a, pointRadius: 0, borderWidth: 2 },
    { label: '대출 잔액', data: rows.map((x) => x.bal), borderColor: C.b, pointRadius: 0, borderWidth: 2 }] } });
  table('itbl', rows, [['년', 'y'], ['금리%', 'rate', 2], ['실효 임대료', 'eff'], ['운영비', 'opex'], ['NOI', 'noi'], ['상환', 'pay'], ['이자', 'interest'], ['감가상각', 'dep'], ['세금', 'tax'], ['세후 CF', 'cf'], ['잔액', 'bal'], ['가치', 'value']]);
}

// ===== 대출 갈아타기 =====
function rise(y, scen) { return scen === 'slow' ? Math.min(1.5, 0.25 * Math.floor(y / 2)) : scen === 'fast' ? Math.min(3, 0.5 * y) : 0; }
function amortize(bal, years, rateOf) {
  let b = bal, total = 0; const byYear = [];
  for (let y = 0; y < years; y++) {
    const r = rateOf(y) / 100 / 12, n = (years - y) * 12, m = r ? (b * r) / (1 - (1 + r) ** -n) : b / n;
    let paid = 0; for (let k = 0; k < 12; k++) { const i = b * r; b -= m - i; paid += m; }
    total += paid; byYear.push({ paid, m });
  }
  return { total, byYear };
}
function calcRefi() {
  if (!STATUS) return;
  const bal = val('r_bal') || 0, years = val('r_years') || 1, cur = val('r_rate') || 0, scen = $('r_scen').value;
  const curKind = $('r_kind').value, cost = (bal * (val('r_feePct') || 0)) / 100 + (val('r_other') || 0);
  const E = econ(), varBase = E.variable?.value ?? FALLBACK.variable;
  const curPath = (y) => cur + (curKind === 'variable' ? rise(y, scen) : 0);
  const base = amortize(bal, years, curPath);
  const cands = Object.values(STATUS.rates).filter((r) => ['variable', 'fixed10', 'flat35'].includes(r.kind) && isFinite(r.value)).map((r) => ({ name: r.name, kind: r.kind, rate: r.value }));
  if ($('r_cname').value && val('r_crate')) cands.unshift({ name: $('r_cname').value + ' (직접 입력)', kind: $('r_ckind').value, rate: val('r_crate'), manual: true });
  const kindL = { variable: '변동', fixed10: '고정10년', flat35: 'フラット35' };
  const res = cands.map((c) => {
    const path = (y) => c.kind === 'flat35' ? c.rate : c.kind === 'fixed10' ? (y < 10 ? c.rate : varBase + rise(y, scen)) : c.rate + rise(y, scen);
    const a = amortize(bal, years, path);
    const mDiff = base.byYear[0].m - a.byYear[0].m;
    let cum = -cost, be = null; const cumArr = [];
    a.byYear.forEach((yr, i) => { const before = cum; cum += base.byYear[i].paid - yr.paid; cumArr.push(cum); if (be == null && cum >= 0 && before < 0) be = i * 12 + Math.ceil(((0 - before) / (cum - before)) * 12); });
    return { ...c, m: a.byYear[0].m, mDiff, saving: base.total - a.total, net: base.total - a.total - cost, be, cumArr };
  }).sort((a, b) => b.net - a.net);
  const best = res[0];
  $('refiPlan').innerHTML = `<h2>갈아타기 메리트 — ${$('r_bank').value} ${fmt(cur, 3)}% · 잔액 ${man(bal)} · ${years}년</h2>` + (best && best.net > 0
    ? `<div class="verdict good">✅ ${best.name}(으)로 갈아타면 비용 차감 후 약 ${man(best.net)} 이득</div><ul><li>월 상환액 ${fmt(base.byYear[0].m, 1)}만엔 → ${fmt(best.m, 1)}만엔 (월 ${fmt(best.mDiff * 10000)}엔 감소)</li><li>갈아타기 비용 약 ${man(cost)} — ${best.be ? `${Math.floor(best.be / 12)}년 ${best.be % 12}개월이면 회수` : '첫해에 회수'}</li><li>금리 시나리오: ${$('r_scen').selectedOptions[0].textContent}${best.kind !== 'variable' ? ' · 고정 전환으로 금리 상승 위험 제거' : ''}</li></ul>`
    : `<div class="verdict warn">⚠️ 현재 조건에서는 비용을 넘는 메리트가 있는 후보가 없습니다</div><ul><li>현재 금리 ${fmt(cur, 3)}% 유지 시 총 상환액 ${man(base.total)}</li><li>금리 상승 시나리오(상세 입력)로 바꾸면 고정 전환의 가치를 확인할 수 있습니다.</li></ul>`);
  $('refiTbl').innerHTML = '<tr><th class="l">후보</th><th>유형</th><th>금리</th><th>월 상환</th><th>월 차이</th><th>총 상환 절감</th><th>비용</th><th>순 메리트</th><th>회수 기간</th></tr>' +
    `<tr><td class="l"><b>${$('r_bank').value} (현재)</b></td><td>${curKind === 'variable' ? '변동' : '고정'}</td><td>${fmt(cur, 3)}%</td><td>${fmt(base.byYear[0].m, 1)}</td><td>–</td><td>–</td><td>–</td><td>–</td><td>–</td></tr>` +
    res.map((c) => `<tr><td class="l">${c.name}</td><td>${kindL[c.kind]}</td><td>${fmt(c.rate, 3)}%</td><td>${fmt(c.m, 1)}</td><td class="${c.mDiff > 0 ? 'good' : 'bad'}">${c.mDiff > 0 ? '-' : '+'}${fmt(Math.abs(c.mDiff), 1)}</td>
      <td>${fmt(c.saving)}</td><td>${fmt(cost)}</td><td class="${c.net > 0 ? 'good' : 'bad'}"><b>${fmt(c.net)}</b></td><td>${c.net > 0 && c.be ? `${Math.floor(c.be / 12)}년 ${c.be % 12}개월` : c.net > 0 ? '1년 이내' : '–'}</td></tr>`).join('');
  const pal = Object.values(C);
  chart('cRefi', { type: 'line', data: { labels: Array.from({ length: years }, (_, i) => i + 1 + '년'), datasets: res.slice(0, 5).map((c, i) => ({ label: c.name.slice(0, 18), data: c.cumArr, borderColor: pal[i], pointRadius: 0, borderWidth: 2 })) } });
}

// ===== 지도·지가 (국토교통성 지가공시) =====
let map, layer, PREFS = [], loaded = {}, MUNIS = [], selected = null, period = store.get('period', 5), metric = store.get('metric', 'cagr'), nearMarker;
const colorOf = (c) => c == null ? '#999' : c >= 8 ? '#7a1f1f' : c >= 5 ? '#b23b3b' : c >= 3 ? '#d9822b' : c >= 1.5 ? '#e0b84a' : c >= 0.5 ? '#5f9e6e' : c >= -0.5 ? '#6b8fae' : '#3b5f8a';
function chips() {
  $('periodChips').innerHTML = PERIODS.map((p) => `<button class="${p === period ? 'on' : ''}" data-p="${p}">${p}년 대비</button>`).join('');
  $('metricChips').innerHTML = [['cagr', '연평균'], ['total', '누적']].map(([k, l]) => `<button class="${k === metric ? 'on' : ''}" data-m="${k}">${l}</button>`).join('');
  $('periodChips').querySelectorAll('button').forEach((b) => (b.onclick = () => { period = +b.dataset.p; store.set('period', period); chips(); drawMunis(); if (selected) selectMuni(selected); }));
  $('metricChips').querySelectorAll('button').forEach((b) => (b.onclick = () => { metric = b.dataset.m; store.set('metric', metric); chips(); drawMunis(); }));
}
async function initMap() {
  if (map) return;
  map = L.map('map').setView([35.68, 139.7], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap · 地価公示 国土交通省' }).addTo(map);
  layer = L.layerGroup().addTo(map);
  const lg = L.control({ position: 'bottomright' });
  lg.onAdd = () => { const d = L.DomUtil.create('div'); d.style.cssText = 'background:#fff;padding:6px 8px;border-radius:6px;font-size:11px;color:#333';
    d.innerHTML = '<b>연평균 상승률</b><br>' + [[8, '8%+'], [5, '5–8%'], [3, '3–5%'], [1.5, '1.5–3%'], [0.5, '0.5–1.5%'], [0, '±0.5%'], [-1, '하락']].map(([v, l]) => `<span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:${colorOf(v)}"></span> ${l}`).join('<br>'); return d; };
  lg.addTo(map);
  chips();
  PREFS = await API.prefs();
  map.on('moveend', loadVisible);
  map.on('click', onMapClick);
  if (region?.lat) map.setView([region.lat, region.lng], 11);
  await loadVisible();
  if (selected) selectMuni(selected);
}
async function loadVisible() {
  if (map.getZoom() < 7) { $('mapLoading').textContent = '확대하면 지가 데이터를 불러옵니다'; return; }
  const b = map.getBounds().pad(0.3), c = map.getCenter();
  const want = PREFS.filter((p) => b.contains([p.lat, p.lng])).map((p) => p.code);
  [...PREFS].sort((a, b2) => Math.hypot(a.lat - c.lat, a.lng - c.lng) - Math.hypot(b2.lat - c.lat, b2.lng - c.lng)).slice(0, 2).forEach((p) => want.includes(p.code) || want.push(p.code));
  const need = want.filter((c2) => !loaded[c2]).slice(0, 4);
  if (!need.length) return;
  $('mapLoading').textContent = `국토교통성 데이터 불러오는 중… (${need.map((c2) => PREFS.find((p) => p.code === c2).name).join(', ')})`;
  try { await ensureMunis(need); $('mapLoading').textContent = `${MUNIS[0]?.year}년 지가공시 · ${MUNIS.length}개 시구정촌`; }
  catch (e) { $('mapLoading').textContent = '불러오기 실패: ' + e.message; }
}
// 도도부현별 시구정촌 데이터를 한 번만 불러와 MUNIS에 추가
async function ensureMunis(codes) {
  const need = codes.filter((c) => typeof loaded[c] !== 'object' && loaded[c] !== 'loading');
  if (!need.length) return;
  need.forEach((c) => (loaded[c] = 'loading'));
  try {
    const res = await API.munis(need);
    res.forEach((p) => { loaded[p.code] = p; MUNIS.push(...p.munis.map((m) => ({ ...m, year: p.year, startYear: p.startYear }))); });
  } catch (e) { need.forEach((c) => delete loaded[c]); throw e; }
  drawMunis();
}

// ===== 주소 검색 (국토지리원 주소검색, 키 불필요) =====
async function geocode(q) {
  const j = await getJ('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q));
  return j.map((f) => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], title: f.properties.title }));
}
async function locate(q) {
  const hits = await geocode(q);
  if (!hits.length) throw new Error('주소를 찾지 못했습니다. 도도부현·시구정촌부터 입력해 보세요 (例: 東京都江東区豊洲3丁目).');
  const h = hits[0];
  if (!PREFS.length) PREFS = await API.prefs();
  const d = (a) => Math.hypot(a.lat - h.lat, (a.lng - h.lng) * Math.cos((h.lat * Math.PI) / 180));
  const codes = [...PREFS].sort((a, b) => d(a) - d(b)).slice(0, 2).map((p) => p.code);
  await ensureMunis(codes);
  const cands = MUNIS.filter((m) => codes.includes(m.pref));
  const muni = cands.filter((m) => h.title.includes(m.name)).sort((a, b) => b.name.length - a.name.length)[0] || cands.sort((a, b) => d(a) - d(b))[0];
  const near = await API.near(h.lat, h.lng);
  return { hit: h, muni, near, more: hits.length - 1 };
}
async function addrSearch(target) {
  const ids = { home: ['addrQ', 'addrMsg'], invest: ['i_addrQ', 'i_addrMsg'] }[target];
  const q = $(ids[0]).value.trim(); if (!q) return;
  $(ids[1]).textContent = '검색 중…';
  try {
    const r = await locate(q);
    const p = r.near.points.find((x) => x.use === '住宅') || r.near.points[0];
    const basis = +$('landBasis').value;
    setRegion(target, { ...toRegion(r.muni), addr: r.hit.title }, `📍 ${r.hit.title} → <b>${r.muni.name}</b> 적용 (${basis}년 대비 연평균 ${pct(r.muni.chg[basis]?.cagr, 2)})` +
      (p ? `<br>가장 가까운 주택지 공시지가: ${fmt(p.price)}円/㎡ · ${fmt(p.d, 2)}km · 5년 ${pct(p.chg[5]?.total)} · 10년 ${pct(p.chg[10]?.total)}` : ''));
  } catch (e) { $(ids[1]).textContent = e.message; }
}
async function mapAddrSearch() {
  const q = $('mapAddrQ').value.trim(); if (!q) return;
  $('mapAddrMsg').textContent = '검색 중…';
  try {
    await initMap();
    const r = await locate(q);
    map.setView([r.hit.lat, r.hit.lng], 14);
    await onMapClick({ latlng: { lat: r.hit.lat, lng: r.hit.lng } });
    selectMuni(r.muni);
    $('mapAddrMsg').textContent = `📍 ${r.hit.title}${r.more ? ` (후보 ${r.more + 1}개 중 첫 번째)` : ''}`;
  } catch (e) { $('mapAddrMsg').textContent = e.message; }
}
$('addrBtn').onclick = () => addrSearch('home');
$('i_addrBtn').onclick = () => addrSearch('invest');
$('mapAddrBtn').onclick = mapAddrSearch;
[['addrQ', () => addrSearch('home')], ['i_addrQ', () => addrSearch('invest')], ['mapAddrQ', mapAddrSearch]].forEach(([id, fn]) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) fn(); }));
function drawMunis() {
  if (!layer) return;
  layer.clearLayers();
  MUNIS.forEach((m) => {
    const c = m.chg[period];
    const circle = L.circleMarker([m.lat, m.lng], { radius: 5 + Math.min(13, Math.sqrt(m.price / 15000)), color: '#fff', weight: 1, fillColor: colorOf(c?.cagr), fillOpacity: 0.85 })
      .bindTooltip(`<b>${m.name}</b><br>${fmt(m.price)}円/㎡ (${m.n}지점 중앙값)<br>${period}년 대비 ${c ? (metric === 'cagr' ? '연평균 ' + pct(c.cagr, 2) : '누적 ' + pct(c.total)) : '데이터 없음'}`);
    circle.on('click', (e) => { L.DomEvent.stopPropagation(e); selectMuni(m); });
    layer.addLayer(circle);
  });
}
function selectMuni(m) {
  selected = m;
  $('mapSelText').innerHTML = `<b>${m.name}</b><br>${period}년 대비 연평균 ${pct(m.chg[period]?.cagr, 2)} · ${fmt(m.price)}円/㎡`;
  $('mapSelApply').textContent = `${RP[mapReturn].name}에 적용`;
  $('mapSel').classList.remove('hide');
  const rows = PERIODS.map((p) => `<tr><td class="l">${p}년 대비${p === period ? ' ◀' : ''}</td><td>${pct(m.chg[p]?.total)}</td><td>${pct(m.chg[p]?.cagr, 2)}</td></tr>`).join('');
  $('areaInfo').innerHTML = `<b style="font-size:15px;color:var(--ink)">${m.name}</b> <span class="muted">${m.residential ? '주택지' : '전체 용도'} ${m.n}지점 중앙값 · ${m.year}년 공시</span><br>
    <b style="color:var(--ink)">${fmt(m.price)}円/㎡</b> <span class="muted">(평당 약 ${fmt((m.price * 3.306) / 10000)}만엔)</span>
    <div class="xscroll"><table style="margin-top:6px"><tr><th class="l">기간</th><th>누적 상승률</th><th>연평균</th></tr>${rows}</table></div>`;
  const g0 = m.chg[period]?.cagr ?? 0, yr = m.year, hist = m.idx || [], start = yr - hist.length + 1;
  const proj = (sc) => SIM.landPath(g0, 30, sc).map((v) => v * 100);
  const labels = [...hist.map((_, i) => start + i), ...Array.from({ length: 30 }, (_, i) => yr + i + 1)].map(String);
  const pad = (arr) => [...Array(hist.length - 1).fill(null), ...arr];
  chart('cLand', { type: 'line', data: { labels, datasets: [
    { label: '실적 (공시지가)', data: hist, borderColor: css('--ink'), pointRadius: 0, borderWidth: 2 },
    { label: '낙관', data: pad(proj('bull')), borderColor: C.c, pointRadius: 0, borderWidth: 1.5, borderDash: [4, 3] },
    { label: '기본', data: pad(proj('base')), borderColor: C.a, pointRadius: 0, borderWidth: 1.5, borderDash: [4, 3] },
    { label: '비관', data: pad(proj('bear')), borderColor: C.f, pointRadius: 0, borderWidth: 1.5, borderDash: [4, 3] }] },
    options: { scales: { x: { ticks: { color: css('--mute'), maxTicksLimit: 10 }, grid: { color: css('--line') } }, y: { ticks: { color: css('--mute') }, grid: { color: css('--line') } } } } });
  $('landNote').textContent = `전망 출발점: ${period}년 대비 연평균 ${pct(g0, 2)}. 장기 수렴값(낙관 +1.5% / 기본 +0.5% / 비관 −1.0%)으로 점차 수렴하는 모델이며, 과거 추세의 외삽일 뿐 예측을 보장하지 않습니다.`;
}
const toRegion = (m) => ({ name: m.name, price: m.price, chg: m.chg, lat: m.lat, lng: m.lng, pref: m.pref, code: m.code });
const growthOf = (reg, basis) => (reg?.manual != null ? reg.manual : reg?.chg?.[basis]?.cagr);

// ===== 지역 선택: 지도 선택 / 리스트 선택 / 직접 입력 =====
const RP = {
  home: { p: '', name: '자가 설계', set: (r) => { region = r; store.set('region2', r); $('landGrowth').value = ''; } },
  invest: { p: 'i_', name: '투자', set: (r) => { iregion = r; store.set('iregion2', r); $('i_landGrowth').value = ''; } },
};
let mapReturn = 'home';
function setRegion(target, reg, msg) {
  RP[target].set(reg); persist();
  if (msg != null) $(RP[target].p + 'addrMsg').innerHTML = msg;
  calcAll();
}
function applySelected(target) {
  if (!selected) { $('areaInfo').innerHTML = '<span class="warn">먼저 지도에서 원(시구정촌)을 눌러 지역을 선택하세요.</span>'; return; }
  const basis = +$('landBasis').value;
  setRegion(target, toRegion(selected), `🗺 지도에서 <b>${selected.name}</b> 적용 (${basis}년 대비 연평균 ${pct(selected.chg[basis]?.cagr, 2)})`);
  showTab(target);
}
$('applyArea').onclick = () => applySelected('home');
$('applyAreaInv').onclick = () => applySelected('invest');
$('mapSelApply').onclick = () => applySelected(mapReturn);
async function fillPrefList(target) {
  const p = RP[target].p, sel = $(p + 'rpPref');
  if (sel.options.length > 1) return;
  if (!PREFS.length) PREFS = await API.prefs();
  sel.innerHTML = '<option value="">도도부현 선택</option>' + PREFS.map((x) => `<option value="${x.code}">${x.name}</option>`).join('');
  const cur = target === 'home' ? region : iregion;
  if (cur?.pref) { sel.value = cur.pref; await fillMuniList(target, cur.code); }
}
async function fillMuniList(target, pick) {
  const p = RP[target].p, code = +$(p + 'rpPref').value, sel = $(p + 'rpMuni');
  if (!code) { sel.innerHTML = '<option value="">시구정촌 선택</option>'; return; }
  sel.innerHTML = '<option value="">불러오는 중…</option>';
  try { await ensureMunis([code]); } catch (e) { sel.innerHTML = '<option value="">불러오기 실패</option>'; return; }
  const basis = +$('landBasis').value;
  const list = MUNIS.filter((m) => m.pref === code).sort((a, b) => String(a.code).localeCompare(String(b.code)));
  sel.innerHTML = '<option value="">시구정촌 선택</option>' + list.map((m) => `<option value="${m.code}">${m.name}  (${basis}년 연평균 ${pct(m.chg[basis]?.cagr, 1)})</option>`).join('');
  if (pick) sel.value = pick;
}
function initPicker(target) {
  const p = RP[target].p, root = $('rp-' + target);
  const setMode = (m) => {
    root.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    root.querySelectorAll('.rp-pane').forEach((x) => x.classList.toggle('hide', x.dataset.m !== m));
    store.set('rpMode-' + target, m);
    if (m === 'list') fillPrefList(target);
  };
  root.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => setMode(b.dataset.m)));
  setMode(store.get('rpMode-' + target, 'map'));
  root.querySelector('[data-openmap]').onclick = () => { mapReturn = target; showTab('map'); };
  $(p + 'rpPref').onchange = (e) => { e.stopPropagation(); fillMuniList(target); };
  $(p + 'rpMuni').onchange = (e) => {
    e.stopPropagation();
    const m = MUNIS.find((x) => String(x.code) === $(p + 'rpMuni').value);
    if (!m) return;
    const basis = +$('landBasis').value;
    setRegion(target, toRegion(m), `📋 <b>${m.name}</b> 적용 · ${fmt(m.price)}円/㎡ · ${basis}년 대비 연평균 ${pct(m.chg[basis]?.cagr, 2)}`);
  };
  $(p + 'rpApply').onclick = () => {
    const g = val(p + 'rpGrowth');
    if (g == null || isNaN(g)) { $(p + 'addrMsg').innerHTML = '<span class="warn">지가 상승률(%/년)을 입력하세요.</span>'; return; }
    const name = $(p + 'rpName').value.trim() || '직접 입력 지역';
    setRegion(target, { name, price: val(p + 'rpPrice'), manual: g, chg: {} }, `✏️ <b>${name}</b> · 지가 상승률 연 ${pct(g)} 적용${val(p + 'rpPrice') ? ` · ${fmt(val(p + 'rpPrice'))}円/㎡` : ''}`);
  };
}
initPicker('home'); initPicker('invest');
async function onMapClick(e) {
  const { lat, lng } = e.latlng;
  if (nearMarker) nearMarker.remove();
  nearMarker = L.marker([lat, lng]).addTo(map);
  $('nearInfo').textContent = '가까운 지점 검색 중…';
  try {
    const j = await API.near(lat, lng);
    window._near = j.points;
    $('nearInfo').innerHTML = `<div class="xscroll"><table><tr><th class="l">주소 · 용도</th><th>円/㎡</th><th>1년</th><th>5년</th><th>10년</th><th></th></tr>` +
      j.points.map((p, i) => `<tr><td class="l" style="white-space:normal">${p.addr.replace(/^\S+\s/, '')}<br><span class="muted">${p.use} · ${fmt(p.d, 2)}km${p.station && p.station !== '_' ? ' · ' + p.station + '역 ' + fmt(p.stationDist) + 'm' : ''}</span></td>
        <td>${fmt(p.price)}</td><td>${pct(p.chg[1]?.total)}</td><td>${pct(p.chg[5]?.total)}</td><td>${pct(p.chg[10]?.total)}</td><td><button class="btn sm" onclick="pickPoint(${i})">선택</button></td></tr>`).join('') + '</table></div>';
  } catch (err) { $('nearInfo').textContent = '검색 실패: ' + err.message; }
}
window.pickPoint = (i) => {
  const p = window._near[i], L0 = p.hist.length;
  selectMuni({ name: p.addr.replace(/^\S+\s/, '').slice(0, 30), price: p.price, chg: p.chg, lat: p.lat, lng: p.lng, n: 1, residential: p.use === '住宅', year: selected?.year || new Date().getFullYear(),
    idx: p.hist.map((v) => (v > 0 ? (v / p.hist[L0 - 1]) * 100 : null)) });
};

// ===== 상태 / 금리 =====
async function loadStatus() {
  try { STATUS = await API.status(); } catch { $('updStatus').textContent = '데이터를 불러오지 못했습니다'; return; }
  const t = STATUS.updatedAt ? new Date(STATUS.updatedAt) : null;
  $('updStatus').textContent = STATUS.running ? '수집 중…' : t ? `최종 갱신 ${t.toLocaleString('ko-KR')} · ${STATUS.refreshHours}시간마다 자동${STATIC ? ' (GitHub Actions)' : ''}` : '아직 수집 전';
  const seen = store.get('newsSeen', '1970'), nNew = (STATUS.news || []).filter((n) => (n.date || '') > seen).length;
  $('newsBadge').textContent = nNew; $('newsBadge').classList.toggle('hide', !nNew);
  fillBanks();
  calcAll();
  if ($('tab-rates').classList.contains('on')) renderRates();
  if ($('tab-news').classList.contains('on')) renderNews();
}
function calcAll() {
  if ($('tab-home').classList.contains('on')) calcHome();
  if ($('tab-invest').classList.contains('on')) calcInvest();
  if ($('tab-refi').classList.contains('on')) calcRefi();
}
function renderRates() {
  if (!STATUS) return;
  const kindL = { jgb10: '지표', variable: '변동', fixed10: '고정10년', flat35: 'フラット35', econ: '경제' };
  const all = [...Object.values(STATUS.rates), ...Object.values(STATUS.econ || {}).map((e) => ({ ...e, kind: 'econ' }))];
  $('rateTbl').innerHTML = '<tr><th class="l">출처</th><th>구분</th><th>값</th><th>상태</th><th>확인 시각</th><th></th></tr>' +
    all.map((r) => `<tr><td class="l"><a href="${r.url}" target="_blank" style="color:var(--accent)">${r.name}</a>${r.note ? `<br><span class="muted">${r.note}</span>` : ''}</td><td>${kindL[r.kind] || r.kind}</td>
      <td><b>${isFinite(r.value) ? r.value.toFixed(r.kind === 'econ' ? 2 : 3) + '%' : '–'}</b></td><td class="${r.ok ? 'good' : 'bad'}">${r.ok ? '정상' : '실패: ' + (r.error || '')}</td>
      <td>${new Date(r.at || r.triedAt).toLocaleString('ko-KR')}</td>
      <td>${['variable', 'fixed10', 'flat35'].includes(r.kind) && isFinite(r.value) ? `<button class="btn sm" onclick="useRate('${r.id}','${r.kind}')">적용</button>` : ''}${r.user ? ` <button class="btn sm" onclick="removeSrc('${r.id}')">삭제</button>` : ''}</td></tr>`).join('');
  $('rateNote').textContent = '은행 사이트 HTML에서 키워드 뒤의 금리를 자동으로 읽습니다. 사이트가 개편되면 「실패」로 표시되고 마지막 성공 값이 유지됩니다.';
  const jh = STATUS.jgbHistory || [];
  chart('cJgb', { type: 'line', data: { labels: jh.map((x) => x.d), datasets: [{ label: '10년 국채 %', data: jh.map((x) => x.v), borderColor: C.a, pointRadius: 0, borderWidth: 1.5 }] }, options: { plugins: { legend: { display: false } } } });
  const h = STATUS.rateHistory || [], ids = Object.keys(STATUS.rates), pal = Object.values(C);
  chart('cHist', { type: 'line', data: { labels: h.map((x) => new Date(x.at).toLocaleDateString('ko-KR')), datasets: ids.map((id, i) => ({ label: STATUS.rates[id].name.slice(0, 14), data: h.map((x) => x[id] ?? null), borderColor: pal[i % pal.length], spanGaps: true, pointRadius: 2, borderWidth: 1.5 })) } });
  const sig = [], recent = (STATUS.news || []).filter((x) => x.date && Date.now() - Date.parse(x.date) < 30 * 864e5);
  const up = recent.filter((x) => x.tags.includes('금리↑')).length, dn = recent.filter((x) => x.tags.includes('금리↓')).length;
  sig.push(`최근 30일 뉴스: 금리 상승 관련 <b>${up}</b>건 / 하락 관련 <b>${dn}</b>건 → ${up > dn * 2 ? '<span class="warn">상승 압력 우세: 변동금리는 「완만/급상승」 시나리오로 점검 권장</span>' : '중립'}`);
  if (jh.length > 12) { const a = jh[jh.length - 1].v, b = jh[jh.length - 13].v; sig.push(`10년 국채 1년간 변화: <b class="${a > b ? 'warn' : 'good'}">${a > b ? '+' : ''}${(a - b).toFixed(2)}%p</b> (${b}% → ${a}%) — 고정금리·フラット35 금리의 선행지표`); }
  const E = econ();
  if (E.variable && E.flat35) sig.push(`고정(フラット35) − 변동 차이: <b>${(E.flat35.value - E.variable.value).toFixed(2)}%p</b>. 변동금리가 이 폭 이상 오르면 고정이 유리해집니다.`);
  if (E.boj != null && E.cpi != null) sig.push(`실질 정책금리: 정책금리 ${fmt(E.boj, 2)}% − コアCPI ${fmt(E.cpi, 1)}% = <b>${fmt(E.boj - E.cpi, 2)}%</b> ${E.boj - E.cpi < 0 ? '(마이너스 → 추가 인상 여지)' : ''}`);
  $('signals').innerHTML = sig.map((x) => `<div style="margin:6px 0">• ${x}</div>`).join('');
}
window.useRate = (id, kind) => { $('loanType').value = kind; store.set('bank', id); fillBanks(); $('bank').value = id; $('rate').value = ''; persist(); showTab('home'); };
window.removeSrc = async (id) => { await fetch('/api/sources', { method: 'POST', body: JSON.stringify({ remove: id }) }); loadStatus(); };
$('addSrc').onclick = async () => {
  $('addMsg').textContent = '확인 중…';
  const body = { name: $('s_name').value.trim(), url: $('s_url').value.trim(), keyword: $('s_kw').value.trim(), pick: val('s_pick') || 0, kind: $('s_kind').value };
  const j = await (await fetch('/api/sources', { method: 'POST', body: JSON.stringify(body) })).json();
  $('addMsg').textContent = j.error || '추가했습니다. 표에서 결과를 확인하세요.';
  if (!j.error) { ['s_name', 's_url', 's_kw'].forEach((i) => ($(i).value = '')); loadStatus(); }
};
$('refreshBtn').onclick = async () => { $('updStatus').textContent = '수집 중… (최대 1분)'; await fetch('/api/refresh', { method: 'POST' }); loadStatus(); };

// ===== 뉴스 =====
let tagFilter = store.get('tagFilter', '전체');
function renderNews() {
  const all = STATUS?.news || [], seen = store.get('newsSeenPrev', '1970');
  const tags = ['전체', '금리↑', '금리↓', '일본은행', '대출', '지가', '맨션', '정책'];
  $('chips').innerHTML = tags.map((t) => `<button class="${t === tagFilter ? 'on' : ''}" data-t="${t}">${t} <span class="muted">${t === '전체' ? all.length : all.filter((n) => n.tags.includes(t)).length}</span></button>`).join('');
  $('chips').querySelectorAll('button').forEach((b) => (b.onclick = () => { tagFilter = b.dataset.t; store.set('tagFilter', tagFilter); renderNews(); }));
  const q = $('q').value.trim();
  const list = all.filter((n) => (tagFilter === '전체' || n.tags.includes(tagFilter)) && (!q || n.title.includes(q))).slice(0, 200);
  $('newsList').innerHTML = list.map((n) => `<li>${(n.date || '') > seen ? '<span class="tag new">NEW</span>' : ''}${n.tags.map((t) => `<span class="tag">${t}</span>`).join('')}
    <a href="${n.link}" target="_blank" rel="noopener">${n.title.replace(/</g, '&lt;')}</a><div class="muted">${n.source} · ${n.date ? new Date(n.date).toLocaleString('ko-KR') : ''}</div></li>`).join('') || '<li class="muted">뉴스 없음</li>';
}
$('q').addEventListener('input', renderNews);
store.set('newsSeenPrev', store.get('newsSeen', '1970'));

// ===== 시작 =====
(async () => {
  // 지역이 없으면 東京都 江東区를 기본값으로 (국토교통성 데이터)
  if (!region) {
    try {
      const j = await API.munis([13]);
      const m = j[0].munis.find((x) => x.name === '江東区') || j[0].munis[0];
      region = toRegion(m); store.set('region2', region);
    } catch {}
  }
  await loadStatus();
  showTab(store.get('tab', 'home'));
  setInterval(loadStatus, 5 * 60 * 1000);
})();

// 화면 크기·방향이 바뀌면 차트 글꼴/지도 크기를 다시 맞춤
let _rz, _lastW = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(_rz);
  _rz = setTimeout(() => {
    if ((window.innerWidth < 600) !== (_lastW < 600)) { calcAll(); if ($('tab-rates').classList.contains('on')) renderRates(); if (selected && map) selectMuni(selected); }
    _lastW = window.innerWidth;
    if (map) map.invalidateSize();
  }, 250);
});
