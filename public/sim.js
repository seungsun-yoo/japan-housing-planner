// 시뮬레이션 엔진 — 금액 단위는 모두 万円
(function () {
  const PT = {
    new_m: { label: '신축 맨션', mansion: true, isNew: true, life: 60, taxLife: 47, residual: 0.2, landRatio: 0.35, premium: 0.10, costs: 5 },
    used_m: { label: '중고 맨션', mansion: true, isNew: false, life: 60, taxLife: 47, residual: 0.2, landRatio: 0.45, premium: 0, costs: 8 },
    new_h: { label: '신축 단독주택', mansion: false, isNew: true, life: 30, taxLife: 22, residual: 0.05, landRatio: 0.6, premium: 0.12, costs: 6 },
    used_h: { label: '중고 단독주택', mansion: false, isNew: false, life: 30, taxLife: 22, residual: 0.05, landRatio: 0.75, premium: 0, costs: 8 },
  };

  // 급여소득 → 세금/실수령 개산 (사회보험 15% 가정, 2025 세제 근사)
  function tax(I) {
    if (I <= 0) return { takeHome: 0, incomeTax: 0, resident: 0, taxable: 0 };
    const kd = I <= 162.5 ? 55 : I <= 180 ? I * 0.4 - 10 : I <= 360 ? I * 0.3 + 8 : I <= 660 ? I * 0.2 + 44 : I <= 850 ? I * 0.1 + 110 : 195;
    const soc = I * 0.15;
    const taxable = Math.max(0, I - kd - soc - 48);
    const br = [[195, 0.05, 0], [330, 0.1, 9.75], [695, 0.2, 42.75], [900, 0.23, 63.6], [1800, 0.33, 153.6], [4000, 0.4, 279.6], [1e9, 0.45, 479.6]];
    const [, r, d] = br.find(([lim]) => taxable <= lim);
    const incomeTax = Math.max(0, taxable * r - d) * 1.021;
    const resident = Math.max(0, (taxable + 5) * 0.1);
    return { takeHome: I - soc - incomeTax - resident, incomeTax, resident, taxable, marginal: r };
  }

  const pmt = (P, rAnnual, n) => { const r = rAnnual / 100 / 12; return n <= 0 ? P : r === 0 ? P / n : (P * r) / (1 - (1 + r) ** -n); };

  function rateRise(y, s) {
    if (s.rateScenario === 'flat') return 0;
    if (s.rateScenario === 'slow') return Math.min(1.5, 0.25 * Math.floor(y / 2));
    if (s.rateScenario === 'fast') return Math.min(3.0, 0.5 * y);
    return Math.min(s.riseCap, s.riseStep * y);
  }
  function rateAt(y, s) {
    const prem = s.mode === 'invest' ? s.investPremium : 0;
    if (s.loanType === 'flat35') return s.rate + prem;
    if (s.loanType === 'fixed10') return (y < 10 ? s.rate : s.variableBase + rateRise(y, s)) + prem;
    return s.rate + rateRise(y, s) + prem;
  }

  function landGrowth(t, g0, scen) {
    const p = { base: [0.5, 5], bull: [1.5, 10], bear: [-1.0, 3] }[scen] || [0.5, 5];
    return p[0] + (g0 - p[0]) * Math.exp(-t / p[1]);
  }
  function landPath(g0, years, scen) {
    const out = [1]; let v = 1;
    for (let t = 0; t < years; t++) { v *= 1 + landGrowth(t, g0, scen) / 100; out.push(v); }
    return out;
  }

  function deduction(s, pt) {
    const kids = s.kosodate;
    const lim = pt.isNew
      ? { nintei: kids ? 5000 : 4500, zeh: kids ? 4500 : 3500, shoene: kids ? 4000 : 3000, other: 0 }[s.energy]
      : { nintei: 3000, zeh: 3000, shoene: 3000, other: 2000 }[s.energy];
    return { limit: lim, years: pt.isNew ? 13 : 10 };
  }

  function irr(flows) {
    let lo = -0.99, hi = 1;
    const npv = (r) => flows.reduce((a, f, i) => a + f / (1 + r) ** i, 0);
    if (npv(lo) * npv(hi) > 0) return NaN;
    for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; npv(lo) * npv(m) <= 0 ? (hi = m) : (lo = m); }
    return ((lo + hi) / 2) * 100;
  }

  function run(s) {
    const pt = PT[s.ptype];
    const costs = s.price * s.costsPct / 100;
    const loan0 = Math.max(0, s.price + costs - s.down);
    const term = s.term;
    const horizon = s.mode === 'invest' ? s.holdYears : s.horizon;
    const years = Math.max(horizon, 1);
    const lp = landPath(s.landGrowth, years + 1, s.landScenario);
    const land0 = s.price * s.landRatio / 100, bldg0 = s.price - land0;
    const bf = (t) => { const a = (s.bAge + t) / pt.life; return Math.max(pt.residual, 1 - a * (1 - pt.residual)); };
    // 신축 프리미엄: 입주 후 1년차에 시세가 premium 만큼 빠지는 것으로 가정
    const value = (t) => (land0 * lp[t] + bldg0 * bf(t) / bf(0)) * (t >= 1 && pt.isNew ? 1 - pt.premium : 1);
    const ded = deduction(s, pt);
    // 세무상 감가상각 (임대)
    const tl = pt.isNew || s.bAge === 0 ? pt.taxLife : Math.max(2, Math.floor(s.bAge >= pt.taxLife ? pt.taxLife * 0.2 : pt.taxLife - s.bAge + s.bAge * 0.2));
    const depBasis = bldg0 * (1 + s.costsPct / 100);

    let bal = loan0, cashBuy = s.cash - s.down, cashRent = s.cash, accDep = 0;
    const rows = [];
    for (let y = 0; y < years; y++) {
      const age = s.age + y;
      const r = rateAt(y, s);
      const remM = (term - y) * 12;
      let pay = 0, interest = 0, principal = 0;
      if (bal > 0.01 && remM > 0) {
        const m = pmt(bal, r, remM);
        for (let k = 0; k < 12 && bal > 0.01; k++) {
          const i = bal * r / 100 / 12; const p = Math.min(bal, m - i);
          interest += i; principal += p; bal -= p; pay += i + p;
        }
      }
      const infl = (1 + s.inflation / 100) ** y;
      const repair = s.repair * 12 * (1 + s.repairGrowth / 100) ** y;
      const mgmt = s.mgmt * 12 * infl;
      const upkeep = s.upkeep * infl;
      const propTax = s.propTax;
      const v = value(y + 1);
      const retired = age >= s.retireAge;
      const wage = (x) => x * (1 + s.wageGrowth / 100) ** y;
      const gross = retired ? (s.income + s.spouseIncome) * s.pension / 100 : wage(s.income) + wage(s.spouseIncome);
      const net = retired ? gross * 0.85 : tax(wage(s.income)).takeHome + tax(wage(s.spouseIncome)).takeHome;
      const living = s.living * 12 * infl;
      const row = { y: y + 1, age: age + 1, rate: r, pay, interest, principal, bal: Math.max(0, bal), value: v, equity: v - Math.max(0, bal), gross };

      if (s.mode === 'live') {
        let credit = 0;
        if (y < ded.years && !retired) {
          const t = tax(wage(s.income));
          credit = Math.min(Math.min(bal, ded.limit) * 0.007, t.incomeTax + Math.min(t.resident, 9.75));
        }
        const housing = pay + mgmt + repair + propTax + upkeep - credit;
        const rent = s.currentRent * 12 * (1 + s.rentGrowth / 100) ** y * (1 + 1 / 24);
        cashBuy = cashBuy * (1 + s.investReturn / 100) + net - living - housing;
        cashRent = cashRent * (1 + s.investReturn / 100) + net - living - rent;
        Object.assign(row, { credit, housing, rent, cashBuy, cashRent, nwBuy: cashBuy + row.equity, nwRent: cashRent, burden: pay / gross * 100 });
      } else {
        const grossRent = s.monthlyRent * 12 * (1 - s.rentDecline / 100) ** y;
        const eff = grossRent * (1 - s.vacancy / 100);
        const opex = mgmt + repair + propTax + upkeep + eff * s.pmFee / 100;
        const noi = eff - opex;
        const dep = y < tl ? depBasis / tl : 0; accDep += dep;
        const taxable = noi - interest - dep;
        const t = taxable * s.marginalTax / 100;
        const cf = noi - pay - t;
        cashBuy += cf;
        Object.assign(row, { grossRent, eff, opex, noi, dep, taxable, tax: t, cf, cumCf: cashBuy - (s.cash - s.down), dscr: pay ? noi / pay : Infinity });
      }
      rows.push(row);
    }

    const res = { rows, loan0, costs, pt, ded, tl };
    const g = s.income + s.spouseIncome;
    res.pay1 = rows[0].pay;
    res.burden = res.pay1 / g * 100;
    res.multiple = s.price / g;
    res.endAge = s.age + term;
    const screenRate = 3.5, maxRatio = g >= 400 ? 35 : 30, maxTerm = Math.min(35, 80 - s.age);
    const rr = screenRate / 100 / 12, nn = maxTerm * 12;
    res.maxLoan = (g * maxRatio / 100 / 12) * (1 - (1 + rr) ** -nn) / rr;
    res.maxTerm = maxTerm;

    if (s.mode === 'live') {
      const last = rows[rows.length - 1];
      res.nwBuy = last.nwBuy; res.nwRent = last.nwRent;
      res.minCash = Math.min(...rows.map((r) => r.cashBuy));
      res.totalPaid = rows.reduce((a, r) => a + r.pay, 0);
      res.totalInterest = rows.reduce((a, r) => a + r.interest, 0);
      res.totalCredit = rows.reduce((a, r) => a + r.credit, 0);
      res.balAtRetire = (rows.find((r) => r.age === s.retireAge) || {}).bal;
    } else {
      const H = rows.length, last = rows[H - 1];
      const salePrice = last.value * (1 - s.saleCost / 100);
      const basis = s.price + costs - accDep;
      const gain = Math.max(0, salePrice - basis);
      const capTax = gain * (H > 5 ? 20.315 : 39.63) / 100;
      const proceeds = salePrice - last.bal - capTax;
      const equity0 = s.down;
      const flows = [-equity0, ...rows.map((r) => r.cf)]; flows[H] += proceeds;
      Object.assign(res, {
        salePrice, capTax, proceeds, equity0, irr: irr(flows),
        grossYield: s.monthlyRent * 12 / s.price * 100,
        netYield: rows[0].noi / (s.price + costs) * 100,
        ccr: rows[0].cf / equity0 * 100,
        dscr: rows[0].dscr,
        breakEvenOcc: (rows[0].opex - rows[0].eff * s.pmFee / 100 + rows[0].pay) / (rows[0].grossRent * (1 - s.pmFee / 100)) * 100,
        totalCf: rows.reduce((a, r) => a + r.cf, 0),
        profit: rows.reduce((a, r) => a + r.cf, 0) + proceeds - equity0,
      });
    }
    return res;
  }

  window.SIM = { PT, run, tax, landPath, landGrowth, rateAt };
})();
