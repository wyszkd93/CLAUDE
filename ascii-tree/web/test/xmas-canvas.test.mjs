// 브라우저(Playwright + Chromium) 안에서 index.html 을 실제로 열어 검사한다.
// 실행: node --test "test/*.test.mjs"   (Playwright 가 설치돼 있어야 한다: require('playwright'))
// 변이 테스트용: XMAS_HTML=/다른/경로/index.html 로 다른 파일을 검사할 수 있다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { throw new Error("Playwright 를 찾을 수 없습니다. 'npm i -D playwright' 후 'npx playwright install chromium' 이 필요합니다."); }

const HTML = process.env.XMAS_HTML || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const URL_BASE = 'file://' + HTML;
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

/** 새 페이지를 열어 fn(page, errors) 을 실행한다. 페이지 오류·콘솔 오류는 errors 에 모인다. */
async function withPage(fn, { query = '?paused=1', viewport = { width: 1000, height: 800 }, deviceScaleFactor = 1 } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  try {
    await page.goto(URL_BASE + query);
    await page.waitForFunction(() => window.XmasTree && window.XmasTree.app);
    return await fn(page, errors);
  } finally { await ctx.close(); }
}
const core = (page, fn, arg) => page.evaluate(([src, a]) => (0, eval)('(' + src + ')')(window.XmasTree.core, a), [fn.toString(), arg]);

// ============================ 순수 계산 ============================
test('mulberry32: 같은 시드는 같은 수열, 값은 [0,1)', () => withPage(async (page) => {
  const r = await core(page, (c) => {
    const a = c.mulberry32(5), b = c.mulberry32(5), d = c.mulberry32(6);
    const A = Array.from({ length: 200 }, a), B = Array.from({ length: 200 }, b), D = Array.from({ length: 200 }, d);
    return { same: A.every((v, i) => v === B[i]), diff: A.some((v, i) => v !== D[i]), range: A.every((v) => v >= 0 && v < 1), spread: new Set(A).size };
  });
  assert.ok(r.same && r.diff && r.range);
  assert.ok(r.spread > 190);
}));

test('allocate: 합이 정확하고 각 몫은 1 이상, 긴 가지가 더 많이 받고, 모자라면 예외', () => withPage(async (page) => {
  const r = await core(page, (c) => {
    const out = {};
    out.sums = [5, 6, 100, 8500].map((t) => { const a = c.allocate(t, [0.1, 0.5, 0.9, 0.3, 0.7]); return [a.reduce((x, y) => x + y, 0) === t, Math.min(...a) >= 1]; });
    const a = c.allocate(1000, [0.2, 0.4, 0.8]); out.order = a[0] < a[1] && a[1] < a[2];
    try { c.allocate(3, [1, 1, 1, 1, 1]); out.threw = false; } catch (e) { out.threw = e instanceof RangeError; }
    return out;
  });
  assert.deepEqual(r.sums, [[true, true], [true, true], [true, true], [true, true]]);
  assert.ok(r.order && r.threw);
}));

test('층 배치: 아래층일수록 가지가 많고 MIN_LETTERS 는 가지 수의 합', () => withPage(async (page) => {
  const r = await core(page, (c) => { const { perTier, frac } = c.tierLayout(); return { perTier, frac, min: c.MIN_LETTERS, tiers: c.CFG.tiers }; });
  assert.equal(r.perTier.length, r.tiers);
  assert.deepEqual(r.perTier, [...r.perTier].sort((a, b) => a - b));
  assert.ok(r.perTier[0] < r.perTier.at(-1));
  assert.equal(r.min, r.perTier.reduce((a, b) => a + b, 0));
}));

test('buildWorld: 글자 수·글자 집합·성장 순서가 올바르다', () => withPage(async (page) => {
  const r = await core(page, (c) => {
    const w = c.buildWorld();
    const seen = new Set(w.order); const sortedOk = w.sortedKey.every((v, i) => i === 0 || v >= w.sortedKey[i - 1]);
    return { count: w.count, glyphs: w.glyphs, maxChar: Math.max(...w.fchar), perm: seen.size === w.count, sortedOk, branch: w.branchCount, orn: w.ornCount, lights: w.lightCount, small: c.buildWorld({ letters: 1000 }).count, min: c.buildWorld({ letters: c.MIN_LETTERS }).count, minL: c.MIN_LETTERS };
  });
  assert.equal(r.count, 8500);
  assert.deepEqual([...r.glyphs].sort(), [...'MERYCHISTA'].sort());
  assert.ok(r.maxChar < r.glyphs.length);
  assert.ok(r.perm && r.sortedOk);
  assert.equal(r.branch, r.minL);
  assert.equal(r.orn, 26); assert.equal(r.lights, 170);
  assert.equal(r.small, 1000); assert.equal(r.min, r.minL);
}));

test('buildWorld: 같은 시드는 같은 나무, 다른 시드는 다른 나무, 잘못된 인자는 예외', () => withPage(async (page) => {
  const r = await core(page, (c) => {
    const sum = (w) => { let s = 0; for (let i = 0; i < w.count; i++) s += (w.fx[i] + 2 * w.fy[i] + 3 * w.fz[i]) * ((i % 97) + 1); return s; };
    const a = sum(c.buildWorld({ seed: 3 })), b = sum(c.buildWorld({ seed: 3 })), d = sum(c.buildWorld({ seed: 4 }));
    const thr = (f) => { try { f(); return false; } catch (e) { return e instanceof RangeError; } };
    return { same: a === b, diff: a !== d, badLetters: thr(() => c.buildWorld({ letters: c.MIN_LETTERS - 1 })), badText: thr(() => c.buildWorld({ text: '   ' })) };
  });
  assert.deepEqual(r, { same: true, diff: true, badLetters: true, badText: true });
}));

test('가지 모양: 끝쪽일수록 줄기에서 멀고, 모든 층에서 가지 끝이 뿌리보다 처진다', () => withPage(async (page) => {
  const r = await core(page, (c) => {
    const w = c.buildWorld(); const n = w.count;
    const dist = (i) => Math.hypot(w.fx[i], w.fz[i]);
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) { const x = w.fs[i], y = dist(i); sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
    const corr = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    const tiers = [];
    for (let t = 0; t < c.CFG.tiers; t++) {
      let rs = 0, rc = 0, ts = 0, tc = 0;
      for (let i = 0; i < n; i++) if (w.ftier[i] === t) { if (w.fs[i] < 0.2) { rs += w.fy[i]; rc++; } else if (w.fs[i] > 0.8) { ts += w.fy[i]; tc++; } }
      tiers.push([rs / rc, ts / tc]);
    }
    let inner = 0, ic = 0, outer = 0, oc = 0;
    for (let i = 0; i < n; i++) { if (w.fs[i] < 0.2) { inner += w.flight[i]; ic++; } else if (w.fs[i] > 0.8) { outer += w.flight[i]; oc++; } }
    return { corr, tiers, inner: inner / ic, outer: outer / oc };
  });
  assert.ok(r.corr > 0.7, `상관 ${r.corr}`);
  r.tiers.forEach(([root, tip], t) => assert.ok(tip < root - 0.05, `${t}번째 층: 끝 ${tip.toFixed(3)} 이 뿌리 ${root.toFixed(3)} 보다 충분히 낮아야 함`));
  assert.ok(r.inner * 1.5 < r.outer, '안쪽(줄기 쪽)은 가지 끝보다 어두워야 함');
}));

test('성장: t=0 에 453 에서 시작해 단조 증가, 10초에 전부', () => withPage(async (page) => {
  const r = await core(page, (c) => {
    const w = c.buildWorld(); const v = Array.from({ length: 200 }, (_, i) => c.visibleLetters(w, i / 10));
    return { v0: v[0], mono: v.every((x, i) => i === 0 || x >= v[i - 1]), full: c.visibleLetters(w, c.CFG.grow), later: c.visibleLetters(w, 999), small: c.visibleLetters(c.buildWorld({ letters: c.MIN_LETTERS }), 0), minL: c.MIN_LETTERS };
  });
  assert.equal(r.v0, 453); assert.ok(r.mono);
  assert.equal(r.full, 8500); assert.equal(r.later, 8500);
  assert.equal(r.small, r.minL);                       // 453 보다 적으면 처음부터 전부
}));

test('전구: 6초 전엔 0, 하나씩 켜져 단조 증가, 총 개수를 넘지 않는다', () => withPage(async (page) => {
  const r = await core(page, (c) => {
    const w = c.buildWorld({ lights: 170 }); const ls = c.CFG.lightStart;
    const v = Array.from({ length: 400 }, (_, i) => c.litLights(w, i / 10));
    return { before: [c.litLights(w, 0), c.litLights(w, ls - 0.01)], at: c.litLights(w, ls), mono: v.every((x, i) => i === 0 || x >= v[i - 1]), max: Math.max(...v), none: c.litLights(c.buildWorld({ lights: 0 }), 99), cap: c.buildWorld({ lights: 1e6, letters: 2000 }).lightCount };
  });
  assert.deepEqual(r.before, [0, 0]); assert.equal(r.at, 1);
  assert.ok(r.mono); assert.equal(r.max, 170); assert.equal(r.none, 0); assert.equal(r.cap, 2000);
}));

test('황금 줄: 나무가 거의 자란 뒤 위에서부터 점진적으로 감긴다', () => withPage(async (page) => {
  const r = await core(page, (c) => {
    const w = c.buildWorld(); const g = c.CFG.grow, total = w.garland.u.length;
    const counts = Array.from({ length: 250 }, (_, i) => c.garlandCount(w, i / 10));
    const mid = c.garlandCount(w, 0.95 * g);
    return { zero: [c.garlandCount(w, 0), c.garlandCount(w, 0.7 * g)], mono: counts.every((x, i) => i === 0 || x >= counts[i - 1]), full: c.garlandCount(w, g + 4), total, mid,
      topFirst: w.garland.u[mid - 1] < w.garland.u[Math.min(total - 1, mid)] };
  });
  assert.deepEqual(r.zero, [0, 0]); assert.ok(r.mono);
  assert.equal(r.full, r.total);
  assert.ok(r.mid > 0 && r.mid < r.total, `중간 시점에 일부만(${r.mid}/${r.total})`);
  assert.ok(r.topFirst);
}));

test('장식 공: 가지가 자란 뒤에야 보인다(t=0 엔 하나도 없음)', () => withPage(async (page) => {
  const r = await core(page, (c) => { const w = c.buildWorld(); return { n: w.ornCount, min: Math.min(...w.orn.at), max: Math.max(...w.orn.at), count: w.count, branches: w.branchCount, cap: c.buildWorld({ ornaments: 1e6 }).ornCount }; });
  assert.equal(r.n, 26); assert.ok(r.min > 453); assert.ok(r.max <= r.count); assert.equal(r.cap, r.branches);
}));

test('countingOrder: 오름차순·안정·순열', () => withPage(async (page) => {
  const r = await core(page, (c) => {
    const keys = new Int32Array([3, 1, 2, 1, 3, 0, 2]); const o = Array.from(c.countingOrder(keys, keys.length, 4));
    const rng = c.makeRng(1); const big = new Int32Array(5000).map(() => rng.int(96)); const ob = c.countingOrder(big, 5000, 96);
    let sorted = true, stable = true; for (let i = 1; i < 5000; i++) { if (big[ob[i]] < big[ob[i - 1]]) sorted = false; if (big[ob[i]] === big[ob[i - 1]] && ob[i] < ob[i - 1]) stable = false; }
    return { o, sorted, stable, perm: new Set(ob).size === 5000 };
  });
  assert.deepEqual(r.o, [5, 1, 3, 2, 6, 0, 4]);
  assert.ok(r.sorted && r.stable && r.perm);
}));

test('투영: 360도 주기, 정사각 픽셀(가로=세로), 가까울수록 크다', () => withPage(async (page) => {
  const r = await core(page, (c) => {
    const v = c.makeView(1000, 800), a = c.project(v, 0.4, 0.3, 0.2, 37), b = c.project(v, 0.4, 0.3, 0.2, 397);
    const o = c.project(v, 0, v.yc, 0, 0), px = c.project(v, 0.5, v.yc, 0, 0), py = c.project(v, 0, v.yc + 0.5, 0, 0);
    const near = c.project(v, 0.5, v.yc, -0.5, 0), far = c.project(v, 0.5, v.yc, 0.5, 0);
    const q = c.project(v, 1, 0, 0, 90);   // x 축이 90도 돌면 깊이(z)로 간다
    return { per: a.map((x, i) => Math.abs(x - b[i])), dx: px[0] - o[0], dy: o[1] - py[1], nearBigger: near[0] - v.cx > far[0] - v.cx, qz: q[2] };
  });
  r.per.forEach((d) => assert.ok(d < 1e-6));
  assert.ok(Math.abs(r.dx - r.dy) < 1e-6, `가로 ${r.dx} 세로 ${r.dy}`);
  assert.ok(r.nearBigger);
  assert.ok(Math.abs(r.qz - -1) < 1e-9, '90도 회전하면 x 축이 -z 로 간다');
}));

test('모든 글자·장식이 화면 안에: 여러 해상도(세로형 휴대폰 포함)와 모든 각도', () => withPage(async (page) => {
  const bad = await core(page, (c) => {
    const w = c.buildWorld(); const out = [];
    for (const [W, H] of [[1000, 800], [1920, 1080], [390, 844], [800, 1200], [360, 640], [1280, 400]]) {
      const v = c.makeView(W, H);
      for (let ang = 0; ang < 360; ang += 15) {
        const test = (x, y, z, tag) => { const p = c.project(v, x, y, z, ang); if (p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H) out.push(`${W}x${H}@${ang} ${tag} (${p[0] | 0},${p[1] | 0})`); };
        for (let i = 0; i < w.count; i += 7) test(w.fx[i], w.fy[i], w.fz[i], 'leaf');
        for (let i = 0; i < w.ornCount; i++) test(w.orn.x[i], w.orn.y[i], w.orn.z[i], 'orn');
        for (let i = 0; i < w.garland.u.length; i += 9) test(w.garland.x[i], w.garland.y[i], w.garland.z[i], 'garland');
        test(0, c.CFG.top + 0.03, 0, 'star');
      }
    }
    return out.slice(0, 5);
  });
  assert.deepEqual(bad, []);
}));

test('글자 밝기: 가까울수록·가지 끝일수록 밝고, 단계 범위를 벗어나지 않는다', () => withPage(async (page) => {
  const r = await core(page, (c) => {
    const near = c.foliageLevel(-0.8, 1), far = c.foliageLevel(0.8, 1), dim = c.foliageLevel(0, 0.3), bright = c.foliageLevel(0, 1);
    const zs = Array.from({ length: 50 }, (_, i) => -1 + i * 0.04), lv = zs.map((z) => c.foliageLevel(z, 1));
    return { near, far, dim, bright, mono: lv.every((x, i) => i === 0 || x <= lv[i - 1]), lo: c.foliageLevel(0, 0), hi: c.foliageLevel(-5, 9), L: c.LEVELS,
      shade: [c.depthShade(-0.85), c.depthShade(0.85), c.depthShade(-9), c.depthShade(9)] };
  });
  assert.ok(r.near > r.far, `가까운 ${r.near} 이 먼 ${r.far} 보다 밝아야 함`);
  assert.ok(r.near - r.far >= 3, '깊이 음영 폭이 너무 작음');
  assert.ok(r.bright > r.dim, '가지 끝(밝음)이 안쪽(어둠)보다 밝아야 함');
  assert.ok(r.mono);
  assert.equal(r.lo, 0); assert.equal(r.hi, r.L - 1);
  assert.ok(Math.abs(r.shade[0] - 1) < 1e-9 || r.shade[0] > 0.9); assert.equal(r.shade[2], 1); assert.equal(r.shade[3], 0.35);
}));

test('depthBucket: 단조 증가·범위 고정', () => withPage(async (page) => {
  const r = await core(page, (c) => { const zs = Array.from({ length: 200 }, (_, i) => -3 + i * 0.03); const b = zs.map(c.depthBucket); return { mono: b.every((x, i) => i === 0 || x >= b[i - 1]), lo: b[0], hi: b.at(-1), B: c.CFG.bucketCount }; });
  assert.ok(r.mono); assert.equal(r.lo, 0); assert.equal(r.hi, r.B - 1);
}));

test('눈: 아래로 떨어지고(위로 가면 안 됨) 항상 화면 안, 모든 눈송이가 실제로 내려온다', () => withPage(async (page) => {
  const r = await core(page, (c) => {
    const W = 1000, H = 800, rng = c.makeRng(2), n = 60;
    const snow = { x: [], y: [], speed: [], phase: [] }; for (let i = 0; i < n; i++) { snow.x.push(rng.next()); snow.y.push(rng.next()); snow.speed.push(0.6 + rng.next() * 1.6); snow.phase.push(rng.next() * 6.28); }
    let worst = 0, inside = true; const fall = new Array(n).fill(0);
    for (let t = 0; t < 5; t += 0.1) for (let i = 0; i < n; i++) {
      const [x0, y0] = c.snowAt(snow, i, t, W, H), [x1, y1] = c.snowAt(snow, i, t + 0.1, W, H);
      if (x1 < 0 || x1 >= W || y1 < 0 || y1 >= H) inside = false;
      const step = ((y1 - y0) % H + H) % H; worst = Math.max(worst, step); fall[i] += step;
    }
    return { worst, inside, minFall: Math.min(...fall) };
  });
  assert.ok(r.inside);
  assert.ok(r.worst < 40, `한 번에 ${r.worst}px 이동(아래로 천천히여야 함)`);
  assert.ok(r.minFall > 0);
}));

// ============================ 화면 ============================
test('로드: 오류 없음, 캔버스가 뷰포트×DPR 크기, 윈도 API 노출', () => withPage(async (page, errors) => {
  const r = await page.evaluate(() => { const c = document.getElementById('c'); return { w: c.width, h: c.height, api: typeof XmasTree.app.renderAt, title: document.title }; });
  assert.deepEqual(errors, []);
  assert.equal(r.w, 1000 * 2); assert.equal(r.h, 800 * 2);
  assert.equal(r.api, 'function');
}, { deviceScaleFactor: 2 }));

const PIXELS = () => {
  const cv = document.getElementById('c'), g = cv.getContext('2d'), { width: W, height: H } = cv;
  const d = g.getImageData(0, 0, W, H).data, cx = W / 2, out = { green: 0, gold: 0, red: 0, star: 0, hash: 0 };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, al = d[i + 3] / 255, r = d[i] * al, gg = d[i + 1] * al, b = d[i + 2] * al;   // 메인 캔버스는 투명하다: 어두운 배경 위에 합성된 색으로 잰다
    if (gg > r * 1.5 && gg > b * 1.25 && gg > 70) out.green++;
    if (r > 200 && gg > 140 && b < 130 && r > b * 1.8) out.gold++;
    if (r > 190 && gg < 90 && b < 90) out.red++;
    if (Math.abs(x - cx) < W * 0.1 && y < H * 0.3 && r > 235 && gg > 215 && b > 150) out.star++;
    out.hash = (out.hash * 31 + r + gg * 3 + b * 7) % 1000000007;
  }
  return out;
};

test('같은 시각은 항상 같은 그림(결정적), 시각이 다르면 다른 그림', () => withPage(async (page) => {
  const shot = async (t) => { await page.evaluate((t) => XmasTree.app.renderAt(t), t); return page.evaluate(PIXELS); };
  const a = await shot(14), b = await shot(14), c = await shot(14.4);
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.hash, c.hash);
}));

test('나무가 자란다: 초록 픽셀이 t=0 < 5 < 10 으로 늘어난다', () => withPage(async (page) => {
  const g = [];
  for (const t of [0, 5, 10]) { await page.evaluate((t) => XmasTree.app.renderAt(t), t); g.push((await page.evaluate(PIXELS)).green); }
  assert.ok(g[0] < g[1] && g[1] < g[2], g.join(' < '));
  assert.ok(g[0] * 4 < g[2], `성장 폭이 너무 작음: ${g.join(', ')}`);
}));

test('장식은 다 자란 뒤에만: 황금·빨강·별 빛이 t=0 엔 없고 t=14 엔 있다', () => withPage(async (page) => {
  await page.evaluate(() => { XmasTree.app.state.hud = false; });      // HUD 글자(빨간 타이머) 의 안티앨리어싱이 '빨강'으로 잡히지 않게
  await page.evaluate(() => XmasTree.app.renderAt(0)); const a = await page.evaluate(PIXELS);
  await page.evaluate(() => XmasTree.app.renderAt(14)); const b = await page.evaluate(PIXELS);
  assert.equal(a.gold, 0); assert.equal(a.red, 0); assert.equal(a.star, 0);
  assert.ok(b.gold > 300, `황금 ${b.gold}`); assert.ok(b.red > 100, `빨강 ${b.red}`); assert.ok(b.star > 20, `별 ${b.star}`);
}));

test('그리는 순서: 먼 것부터 가까운 것 순(깊이 버킷이 줄어드는 방향)', () => withPage(async (page) => {
  await page.evaluate(() => XmasTree.app.renderAt(14));
  const r = await page.evaluate(() => { const z = XmasTree.app.drawOrderZ(), b = z.map(XmasTree.core.depthBucket); return { n: z.length, ok: b.every((x, i) => i === 0 || x <= b[i - 1]), first: z[0], last: z.at(-1) }; });
  assert.ok(r.n > 8500, `항목 수 ${r.n}`);
  assert.ok(r.ok, '먼 것이 먼저 그려져야 가까운 글자가 위에 덮인다');
  assert.ok(r.first > r.last);
}));

test('성능: 프레임 그리기 평균 시간(헤드리스·소프트웨어 렌더링이라 실제 GPU 보다 느리다)', () => withPage(async (page) => {
  const ms = await page.evaluate(() => { const a = XmasTree.app; a.renderAt(14); const t0 = performance.now(); for (let i = 0; i < 20; i++) a.draw(14 + i / 60); return (performance.now() - t0) / 20; });
  console.log(`  ↳ 프레임당 평균 ${ms.toFixed(1)}ms (1000x800, 8,500글자, 헤드리스 Chromium)`);
  assert.ok(ms < 150, `프레임당 ${ms.toFixed(1)}ms: 글자 스프라이트 대신 fillText 로 되돌아가는 식의 퇴행을 잡는 기준`);
}));

test('HUD 문구: 시각·회전각(15°/초)·글자 수(천 단위 쉼표)', () => withPage(async (page) => {
  const r = await page.evaluate(() => { const a = XmasTree.app; return [a.hudText(0, 0, 453, 0), a.hudText(75, 90, 8500, 170), a.hudText(5, 360 % 360, 8500, 3)]; });
  assert.equal(r[0].top, 't 00:00s'); assert.equal(r[0].lines[0], 'rotation 000.00°     lights 0'); assert.equal(r[0].lines[1], 'letters 453');
  assert.equal(r[1].top, 't 01:15s'); assert.equal(r[1].lines[0], 'rotation 090.00°     lights 170'); assert.equal(r[1].lines[1], 'letters 8,500');
  const ang = await page.evaluate(() => [XmasTree.core.angleDeg(15, 6), XmasTree.core.angleDeg(15, 24), XmasTree.core.angleDeg(-15, 6)]);
  assert.deepEqual(ang, [90, 0, 270]);
}));

test('URL 인자: text, letters, seed, spin 이 반영된다(잘못된 값은 안전하게)', () => withPage(async (page, errors) => {
  const r = await page.evaluate(() => { const w = XmasTree.app.state.world; return { glyphs: w.glyphs, count: w.count, seed: w.opts.seed, spin: XmasTree.app.state.spin }; });
  assert.deepEqual(r.glyphs.sort(), ['E', 'H', 'L', 'O']); assert.equal(r.count, 3000); assert.equal(r.seed, 9); assert.equal(r.spin, 40);
  assert.deepEqual(errors, []);
}, { query: '?paused=1&text=HELLO&letters=3000&seed=9&spin=40' }));

test('URL 인자가 이상해도 죽지 않는다(빈 글자·너무 적은 글자 수·숫자가 아닌 값)', () => withPage(async (page, errors) => {
  const r = await page.evaluate(() => ({ count: XmasTree.app.state.world.count, min: XmasTree.core.MIN_LETTERS, glyphs: XmasTree.app.state.world.glyphs.length, spin: XmasTree.app.state.spin }));
  assert.equal(r.count, r.min); assert.ok(r.glyphs > 0); assert.equal(r.spin, 15);
  assert.deepEqual(errors, []);
}, { query: '?paused=1&text=%20%20&letters=5&spin=abc' }));

test('컨트롤: 설정 패널, 글자·글자 수 변경, 일시정지·처음부터, 단축키', () => withPage(async (page, errors) => {
  assert.equal(await page.isVisible('#panel'), false);
  assert.equal(await page.textContent('#btn-pause'), '재생');          // ?paused=1 로 열었으니 버튼은 '재생'
  await page.click('#gear'); assert.equal(await page.isVisible('#panel'), true);
  assert.equal(await page.getAttribute('#gear', 'aria-expanded'), 'true');
  await page.fill('#in-text', 'AB'); await page.fill('#in-letters', '3000');
  await page.waitForFunction(() => XmasTree.app.state.world.count === 3000);
  assert.deepEqual(await page.evaluate(() => XmasTree.app.state.world.glyphs), ['A', 'B']);
  assert.equal(await page.textContent('#out-letters'), '3,000');
  await page.evaluate(() => { XmasTree.app.state.t = 7; });
  await page.click('#btn-replay'); assert.equal(await page.evaluate(() => XmasTree.app.state.t), 0);
  await page.click('#btn-pause'); assert.equal(await page.evaluate(() => XmasTree.app.state.paused), false);
  assert.equal(await page.textContent('#btn-pause'), '일시정지');
  await page.keyboard.press('h'); assert.equal(await page.evaluate(() => XmasTree.app.state.hud), false);
  await page.keyboard.press('Space'); assert.equal(await page.evaluate(() => XmasTree.app.state.paused), true);
  assert.equal(await page.textContent('#btn-pause'), '재생');
  await page.focus('#in-text'); await page.keyboard.type('h'); assert.equal(await page.evaluate(() => XmasTree.app.state.hud), false); // 입력칸에서는 단축키가 먹히지 않는다
  assert.deepEqual(errors, []);
}));

test('창 크기가 바뀌어도 캔버스가 따라가고 오류가 없다', () => withPage(async (page, errors) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.getElementById('c').width === 390);
  await page.evaluate(() => XmasTree.app.renderAt(14));
  const r = await page.evaluate(() => ({ w: document.getElementById('c').width, h: document.getElementById('c').height, v: XmasTree.app.state.view.w }));
  assert.deepEqual(r, { w: 390, h: 844, v: 390 });
  assert.deepEqual(errors, []);
}));

test('실행 루프: 일시정지 해제 후 시간이 흐르고 fps 가 측정된다', () => withPage(async (page, errors) => {
  await page.evaluate(() => { XmasTree.app.state.t = 0; XmasTree.app.setPaused(false); XmasTree.app.start(); });
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => ({ t: XmasTree.app.state.t, fps: XmasTree.app.state.fps }));
  assert.ok(r.t > 0.3 && r.t < 1.5, `t=${r.t}`);
  assert.ok(r.fps > 3 && r.fps < 400, `fps=${r.fps}`);
  assert.deepEqual(errors, []);
}));

test('정지로 열었다가 재생을 누르면 실제로 시간이 흐른다(루프가 시작된다)', () => withPage(async (page, errors) => {
  assert.equal(await page.evaluate(() => XmasTree.app.state.t), 0);
  await page.click('#gear'); await page.click('#btn-pause');
  await page.waitForTimeout(600);
  const t = await page.evaluate(() => XmasTree.app.state.t);
  assert.ok(t > 0.2, `재생을 눌렀는데 t=${t}`);
  await page.click('#btn-pause');                                      // 다시 정지
  const t1 = await page.evaluate(() => XmasTree.app.state.t); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => XmasTree.app.state.t), t1);
  assert.deepEqual(errors, []);
}));

test('정지로 열어도 첫 장면이 그려져 있고, 크기·설정을 바꾸면 다시 그려진다', () => withPage(async (page) => {
  const nonBlank = () => page.evaluate(() => { const c = document.getElementById('c'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 200) n++; return n; });
  assert.ok(await nonBlank() > 100, '정지로 열었는데 캔버스가 비어 있음');
  const before = await page.evaluate(PIXELS);
  await page.setViewportSize({ width: 700, height: 600 });
  await page.waitForFunction(() => document.getElementById('c').width === 700);
  const after = await page.evaluate(PIXELS);
  assert.notEqual(before.hash, after.hash);
  assert.ok(await nonBlank() > 100, '크기를 바꾼 뒤 캔버스가 비어 있음');
}));

// ===================== 성능 구조(느려지지 않게 지키는 성질) =====================
test('frameGate: 60Hz 는 매 틱, 144/240Hz 는 평균 60fps 로 상한, 30Hz 는 매 틱, 오래 멈췄다 와도 바로 그린다', () => withPage(async (page) => {
  const r = await core(page, (c) => {
    const sim = (hz, ms) => { let due = 0, n = 0; const dt = 1000 / hz; for (let now = 0; now < ms; now += dt) { const g = c.frameGate(now, due); due = g.due; if (g.render) n++; } return n; };
    let due = c.frameGate(0, 0).due; const afterStall = c.frameGate(10000, due);   // 10초 멈췄다가
    const early = c.frameGate(5, 16.7), onTime = c.frameGate(14, 16.7), late = c.frameGate(30, 16.7);
    return { hz60: sim(60, 10000), hz144: sim(144, 10000), hz240: sim(240, 10000), hz30: sim(30, 10000), hz75: sim(75, 10000),
      stall: afterStall.render, stallDue: afterStall.due - 10000, early: early.render, onTime: onTime.render, late: late.render };
  });
  assert.ok(Math.abs(r.hz60 - 600) <= 2, `60Hz: ${r.hz60}`);
  assert.ok(Math.abs(r.hz144 - 600) <= 12, `144Hz 에서 10초에 ${r.hz144}번(≈600 이어야 함)`);
  assert.ok(Math.abs(r.hz240 - 600) <= 12, `240Hz: ${r.hz240}`);
  assert.ok(Math.abs(r.hz30 - 300) <= 2, `30Hz 는 매 틱 그려야 함: ${r.hz30}`);
  assert.ok(r.hz75 < 640, `75Hz: ${r.hz75}`);
  assert.ok(r.stall && r.stallDue > 0 && r.stallDue < 20);
  assert.equal(r.early, false); assert.equal(r.onTime, true); assert.equal(r.late, true);
}));

test('qualityStep: 계속 느리면 한 단계씩 낮추고, 충분히 오래 빠르면 올리고, 이상한 간격은 무시한다', () => withPage(async (page) => {
  const r = await core(page, (c) => {
    const feed = (ctl, ms, n, t0) => { let ch = []; for (let i = 0; i < n; i++) { const v = c.qualityStep(ctl, ms, t0 + i * ms); if (v !== null) ch.push(v); } return ch; };
    const a = c.newQualityCtl(); const slow = feed(a, 30, 200, 0);              // 33fps 가 계속
    const b = c.newQualityCtl(); const ok = feed(b, 16.7, 2000, 0);             // 60fps 가 계속 → 변화 없음
    const d = c.newQualityCtl(); const spikes = feed(d, 200, 500, 0).concat(feed(d, 0, 100, 0), feed(d, -5, 100, 0), feed(d, NaN, 100, 0));
    const e = c.newQualityCtl(); const floor = feed(e, 40, 5000, 0);            // 아무리 느려도 마지막 단계에서 멈춘다
    const f = c.newQualityCtl(); f.level = 3; f.lastChange = 0; const up = feed(f, 16.7, 400, 20000);   // 20초 뒤 빠르면 올림
    const g = c.newQualityCtl(); g.level = 3; g.lastChange = 0; const tooSoon = feed(g, 16.7, 400, 5000); // 변경 5초 뒤엔 아직 안 올림
    const h = c.newQualityCtl(); h.level = 3; h.ups = 2; h.lastChange = 0; const capped = feed(h, 16.7, 400, 99000);
    const borderline = c.newQualityCtl(); const mid = feed(borderline, 20, 3000, 0);   // 50fps: 느림도 빠름도 아님
    const vs = c.newQualityCtl(); const verySlow = feed(vs, 60, 400, 0);           // 16fps 가 계속 → 두 단계씩
    return { slow, verySlow, ok, spikes, floor, floorMax: c.LADDER.length - 1, up, tooSoon, capped, mid };
  });
  assert.deepEqual(r.slow.slice(0, 2), [1, 2]);          // 40프레임(+재구성 후 12프레임 대기)마다 한 단계씩
  assert.deepEqual(r.verySlow.slice(0, 2), [2, 4]);      // 25fps 미만이면 20프레임 뒤 두 단계씩
  assert.deepEqual(r.ok, []);
  assert.deepEqual(r.spikes, []);
  assert.equal(r.floor.at(-1), r.floorMax); assert.deepEqual(r.floor, [1, 2, 3, 4]);   // 40ms(25fps) 는 아주 느림의 경계: 한 단계씩
  assert.deepEqual(r.up, [2]); assert.deepEqual(r.tooSoon, []); assert.deepEqual(r.capped, []);
  assert.deepEqual(r.mid, []);
}));

test('품질 단계표: 내려갈수록 해상도·그리는 글자는 줄고 컬링은 세진다', () => withPage(async (page) => {
  const L = await core(page, (c) => c.LADDER.map((x) => ({ ...x })));
  assert.ok(L.length >= 4);
  assert.deepEqual(L[0], { scale: 2, keep: 1, halo: true, cap: 3 });
  for (let i = 1; i < L.length; i++) {
    assert.ok(L[i].scale <= L[i - 1].scale && L[i].keep <= L[i - 1].keep && L[i].cap >= 1 && L[i].cap <= L[i - 1].cap, `${i}단계가 ${i - 1}단계보다 가벼워야 함`);
    if (!L[i - 1].halo) assert.equal(L[i].halo, false);
  }
}));

test('packShelves: 칸이 서로 겹치지 않고 모두 아틀라스 안에 들어간다', () => withPage(async (page) => {
  const r = await core(page, (c) => {
    const rng = c.makeRng(4), sizes = Array.from({ length: 800 }, () => 6 + rng.int(36)); const pk = c.packShelves(sizes, 512, 1);
    let overlap = 0, outside = 0;
    for (let i = 0; i < sizes.length; i++) {
      if (pk.x[i] < 0 || pk.y[i] < 0 || pk.x[i] + sizes[i] > 512 || pk.y[i] + sizes[i] > pk.height) outside++;
      for (let j = i + 1; j < sizes.length; j++) if (pk.x[i] < pk.x[j] + sizes[j] && pk.x[j] < pk.x[i] + sizes[i] && pk.y[i] < pk.y[j] + sizes[j] && pk.y[j] < pk.y[i] + sizes[i]) overlap++;
    }
    let thr = false; try { c.packShelves([600], 512, 1); } catch (e) { thr = e instanceof RangeError; }
    return { overlap, outside, height: pk.height, area: sizes.reduce((a, s) => a + s * s, 0), thr, pad: (() => { const q = c.packShelves([10, 10], 100, 3); return q.x[1] - q.x[0]; })() };
  });
  assert.equal(r.overlap, 0); assert.equal(r.outside, 0); assert.ok(r.thr);
  assert.equal(r.pad, 13);                                    // 한 변 10 + 여백 3
  assert.ok(r.height * 512 < r.area * 2.2, `배치가 너무 낭비됨: 높이 ${r.height}`);
}));

test('classIndex·stableHash·countingOrderInto', () => withPage(async (page) => {
  const r = await core(page, (c) => {
    const cls = [c.classIndex(0, 10, 2, 5), c.classIndex(10, 10, 2, 5), c.classIndex(13.2, 10, 2, 5), c.classIndex(18, 10, 2, 5), c.classIndex(99, 10, 2, 5)];
    const h = Array.from({ length: 5000 }, (_, i) => c.stableHash(i)); const below = h.filter((x) => x < 0.5).length; let adj = 0;
    for (let i = 1; i < h.length; i++) if (Math.abs(h[i] - h[i - 1]) < 0.02) adj++;
    const rng = c.makeRng(9), B = 96, n = 3000, order = new Int32Array(n + 50), counts = new Int32Array(B + 1); let same = true;
    for (let round = 0; round < 3; round++) {                 // 같은 버퍼를 재사용해도 이전 호출 흔적이 남지 않아야 한다
      const keys = new Int32Array(n).map(() => rng.int(B)); const ref = c.countingOrder(keys, n, B); c.countingOrderInto(keys, n, B, order, counts);
      for (let i = 0; i < n; i++) if (order[i] !== ref[i]) same = false;
    }
    return { cls, below, inRange: h.every((x) => x >= 0 && x < 1), det: c.stableHash(7) === c.stableHash(7), adj, same };
  });
  assert.deepEqual(r.cls, [0, 0, 2, 4, 4]);
  assert.ok(r.inRange && r.det);
  assert.ok(r.below > 2350 && r.below < 2650, `분포가 치우침: ${r.below}`);
  assert.ok(r.adj < 400, `이웃 값이 너무 비슷함: ${r.adj}`);
  assert.ok(r.same);
}));

/** draw() 한 번 동안의 drawImage 호출을 가로채 분류한다. */
const TRACE = (cap) => {
  const app = XmasTree.app, proto = CanvasRenderingContext2D.prototype, orig = proto.drawImage, calls = [];
  proto.drawImage = function (...a) { calls.push(a); return orig.apply(this, a); };
  try { if (cap !== undefined) app.state.cullCap = cap; app.state.hud = false; app.draw(14); } finally { proto.drawImage = orig; }
  const unscaled = calls.filter((a) => a.length === 9 && a[3] === a[7] && a[4] === a[8] && Number.isInteger(a[5]) && Number.isInteger(a[6]));
  return { total: calls.length, unscaled: unscaled.length, nine: calls.filter((a) => a.length === 9).length, sources: new Set(unscaled.map((a) => a[0])).size,
    blits: app.state.blits, items: app.state.lastItems, five: calls.filter((a) => a.length === 5).length };
};

test('핵심 성질: 모든 글자·장식 스프라이트를 단일 아틀라스에서 확대·축소 없이 정수 좌표로 찍는다', () => withPage(async (page) => {
  const r = await page.evaluate(TRACE);
  assert.equal(r.sources, 1, `원본 이미지가 ${r.sources}개 — 하나(아틀라스)여야 그리기 호출이 묶인다`);
  assert.equal(r.unscaled, r.blits, '아틀라스 호출은 전부 크기 변환 없이(sw==dw, sh==dh), 정수 좌표(dx, dy)여야 한다');
  assert.equal(r.nine, r.unscaled);
  assert.ok(r.blits > 3000, `찍은 항목 ${r.blits}`);
  assert.ok(r.five > 0 && r.five < 400, `번짐은 확대 그리기(5인자) ${r.five}번`);
}));

test('가려진 글자 컬링: 겹침 허용이 작을수록 덜 그리고, 장식·전구·줄은 절대 건너뛰지 않는다', () => withPage(async (page) => {
  const off = await page.evaluate(TRACE, 0), c255 = await page.evaluate(TRACE, 255), c3 = await page.evaluate(TRACE, 3), c2 = await page.evaluate(TRACE, 2), c1 = await page.evaluate(TRACE, 1);
  assert.equal(off.blits, off.items); assert.equal(c255.blits, c255.items);          // 켜지 않았거나 허용이 크면 하나도 안 건너뛴다
  assert.ok(c3.blits < off.items * 0.8, `기본(3)에서 ${c3.blits}/${off.items}`);
  assert.ok(c1.blits < c2.blits && c2.blits < c3.blits && c3.blits < off.blits);
  const nonLetters = await page.evaluate(() => { const w = XmasTree.app.state.world, c = XmasTree.core, t = 14;
    return w.trunk.length + w.orn.at.filter((a) => a <= c.visibleLetters(w, t)).length + c.garlandCount(w, t) + c.litLights(w, t); });
  assert.ok(c1.blits >= nonLetters, `가장 센 컬링(1)에서도 비글자 ${nonLetters}개는 다 그려야 함(${c1.blits})`);
  // 장식이 실제로 보이는지: 컬링 중에도 빨강·황금 픽셀이 남는다
  await page.evaluate(() => { XmasTree.app.state.cullCap = 1; XmasTree.app.state.hud = false; XmasTree.app.renderAt(14); });
  const px = await page.evaluate(PIXELS); assert.ok(px.red > 100 && px.gold > 300, `컬링 1 에서 장식이 사라짐: red ${px.red} gold ${px.gold}`);
}));

test('컬링이 모습을 크게 바꾸지 않는다: 기본(3)과 끔(0)의 초록 픽셀·덮인 면적 차이가 작다', () => withPage(async (page) => {
  const m = {};
  for (const cap of [0, 3, 1]) {
    m[cap] = await page.evaluate((cap) => { XmasTree.app.state.cullCap = cap; XmasTree.app.state.hud = false; XmasTree.app.renderAt(14);
      const c = document.getElementById('c'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let cover = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) cover++;
      return { green: 0, cover }; }, cap);
    m[cap].green = (await page.evaluate(PIXELS)).green;
  }
  // 측정값: 허용 3 은 초록 -8.9%, 덮인 면적 -1.1%. 허용 1 은 -42%, -9.2%(낮은 품질 단계 전용)
  assert.ok(Math.abs(m[3].green - m[0].green) / m[0].green < 0.12, `초록 ${m[3].green} vs ${m[0].green}`);
  assert.ok(Math.abs(m[3].cover - m[0].cover) / m[0].cover < 0.03, `덮인 면적 ${m[3].cover} vs ${m[0].cover}`);
  assert.ok(m[1].green < m[3].green * 0.85, '허용 1 은 눈에 띄게 더 성겨야 함(낮은 품질용)');
}));

test('정적 레이어: 배경은 별도 캔버스, 메인 캔버스는 투명(매 프레임 전체 화면을 칠하지 않는다), 바닥 빛은 CSS 투명도', () => withPage(async (page) => {
  const r = await page.evaluate(() => {
    const a = XmasTree.app; a.state.hud = false; a.renderAt(0);
    const bg = document.getElementById('bg'), c = document.getElementById('c'), cg = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, bgd = bg.getContext('2d').getImageData(0, bg.height - 2, 1, 1).data;
    let clear = 0; for (let i = 3; i < cg.length; i += 4) if (cg[i] === 0) clear++;
    const glow = document.getElementById('glow'), o0 = glow.style.opacity; a.renderAt(14);
    return { sameSize: bg.width === c.width && bg.height === c.height, clearFrac: clear / (cg.length / 4), bgPixel: Array.from(bgd), o0: Number(o0), o14: Number(glow.style.opacity),
      glowBox: [glow.style.left, glow.style.top, glow.style.width, glow.style.height], order: [bg, glow, c].map((e) => e.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : 0), floorY: a.state.floorY, h: a.state.view.h };
  });
  assert.ok(r.sameSize);
  assert.ok(r.clearFrac > 0.8, `메인 캔버스의 투명 픽셀 비율 ${r.clearFrac}`);
  assert.ok(r.bgPixel[0] + r.bgPixel[1] + r.bgPixel[2] > 10 && r.bgPixel[3] === 255, `배경 캔버스에 하늘이 그려져 있어야 함: ${r.bgPixel}`);
  assert.equal(r.o0, 0); assert.ok(r.o14 > 0.99, `다 자란 뒤 바닥 빛 투명도 ${r.o14}`);
  assert.ok(r.glowBox.every((v) => /px$/.test(v)), `바닥 빛 위치·크기: ${r.glowBox}`);
  assert.deepEqual(r.order, [1, 1, 0]);
  assert.ok(r.floorY > 0 && r.floorY < r.h);
}));

test('아틀라스: 크기 단계가 유효하고 4096 안에 들어가며 만드는 데 오래 걸리지 않는다', () => withPage(async (page) => {
  const r = await page.evaluate(() => XmasTree.app.atlasInfo());
  assert.ok(r.height > 0 && r.height <= 4096, `높이 ${r.height}`);
  for (const k of ['L', 'O', 'Li', 'Ga']) assert.ok(r[k].min >= 4 && r[k].max > r[k].min && r[k].nc >= 2 && r[k].nc <= 8, `${k} ${JSON.stringify(r[k])}`);
  assert.ok(r.ms < 600, `아틀라스 생성 ${r.ms.toFixed(0)}ms`);
}, { deviceScaleFactor: 2 }));

test('아틀라스 크기는 DPR 에 따라 커진다(고해상도 화면에서 흐려지지 않는다)', async () => {
  const sizes = [];
  for (const dsf of [1, 2]) sizes.push(await withPage((page) => page.evaluate(() => XmasTree.app.atlasInfo().L.min), { deviceScaleFactor: dsf }));
  assert.ok(sizes[1] >= sizes[0] * 1.8, `DPR 1: ${sizes[0]}px, DPR 2: ${sizes[1]}px`);
});

test('창 크기 이벤트가 연달아 와도 아틀라스는 한 번만 다시 만든다(디바운스)', () => withPage(async (page) => {
  const before = await page.evaluate(() => XmasTree.app.state.atlasBuilds);
  await page.evaluate(() => { for (let i = 0; i < 25; i++) window.dispatchEvent(new Event('resize')); });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => XmasTree.app.state.atlasBuilds);
  assert.equal(after - before, 1, `재생성 ${after - before}번`);
}));

test('품질 선택: 단계별 해상도 배율·HUD 표시·UI 와 URL 인자 연동', () => withPage(async (page) => {
  const w = () => page.evaluate(() => document.getElementById('c').width);
  assert.equal(await w(), 2000);                                                      // DPR 2, 최고 품질
  assert.equal(await page.evaluate(() => XmasTree.app.hudText(0, 0, 453, 0).lines[2].includes(' q')), false);
  await page.click('#gear'); await page.selectOption('#in-quality', '4');
  assert.deepEqual(await page.evaluate(() => [XmasTree.app.state.qLevel, XmasTree.app.state.qAuto]), [4, false]);
  assert.equal(await w(), 750);                                                       // 4단계: 배율 0.75
  assert.ok(await page.evaluate(() => XmasTree.app.hudText(0, 0, 453, 0).lines[2].endsWith('\u00b7 q4')));
  assert.equal(await page.evaluate(() => document.getElementById('bg').width), 750);   // 정적 배경도 같이 다시 만든다
  await page.selectOption('#in-quality', '0'); assert.equal(await w(), 2000);
  await page.selectOption('#in-quality', '2'); assert.equal(await w(), 1000);          // 2단계: 배율 1
  await page.selectOption('#in-quality', 'auto'); assert.equal(await page.evaluate(() => XmasTree.app.state.qAuto), true);
}, { deviceScaleFactor: 2 }));

test('URL quality 인자: 숫자는 고정 단계(자동 끔), 이상한 값도 안전하게', async () => {
  await withPage(async (page, errors) => {
    assert.deepEqual(await page.evaluate(() => [XmasTree.app.state.qLevel, XmasTree.app.state.qAuto, document.getElementById('in-quality').value]), [3, false, '3']);
    assert.deepEqual(errors, []);
  }, { query: '?paused=1&quality=3' });
  await withPage(async (page, errors) => {
    const s = await page.evaluate(() => [XmasTree.app.state.qLevel, XmasTree.app.state.qAuto]);
    assert.ok(s[0] >= 0 && s[0] <= 4); assert.deepEqual(errors, []);
  }, { query: '?paused=1&quality=zzz' });
  await withPage(async (page) => {
    assert.deepEqual(await page.evaluate(() => [XmasTree.app.state.qLevel, XmasTree.app.state.qAuto]), [0, true]);
  }, { query: '?paused=1&quality=auto' });
});

test('자동 품질: 실제로 느리면 스스로 품질을 낮추고, 고정 품질이면 그대로 둔다', async () => {
  // 글자 4만 개 + 큰 화면 + DPR 2 로 일부러 무겁게 만든다
  const heavy = { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 };
  await withPage(async (page, errors) => {
    const before = await page.evaluate(() => XmasTree.app.state.qLevel);
    await page.evaluate(() => { XmasTree.app.state.t = 16; XmasTree.app.setPaused(false); });
    await page.waitForFunction(() => XmasTree.app.state.qLevel >= 1, null, { timeout: 25000 });
    const after = await page.evaluate(() => ({ lv: XmasTree.app.state.qLevel, w: document.getElementById('c').width }));
    assert.equal(before, 0); assert.ok(after.lv >= 1, `품질 ${after.lv}`);
    assert.ok(after.w < 3200, `해상도도 내려가야 함(${after.w})`);
    assert.deepEqual(errors, []);
  }, { query: '?letters=40000&lights=400', ...heavy });
  await withPage(async (page) => {
    await page.evaluate(() => { XmasTree.app.state.t = 16; XmasTree.app.setPaused(false); XmasTree.app.start(); });
    await page.waitForTimeout(4000);
    assert.deepEqual(await page.evaluate(() => [XmasTree.app.state.qLevel, XmasTree.app.state.qAuto]), [0, false]);
  }, { query: '?quality=0&letters=40000&lights=400', ...heavy });
});

test('성능 기준선: 이전 구조(DPR1 약 42ms, DPR2 약 99ms)로 되돌아가지 않는다', async () => {
  for (const [dsf, limit] of [[1, 28], [2, 40]]) {
    const ms = await withPage((page) => page.evaluate(() => { const a = XmasTree.app; a.setQuality(0); for (let i = 0; i < 3; i++) a.draw(16 + i / 60); const t0 = performance.now(); for (let i = 0; i < 20; i++) a.draw(16 + i / 60); return (performance.now() - t0) / 20; }), { viewport: { width: 1400, height: 900 }, deviceScaleFactor: dsf });
    console.log(`  ↳ DPR ${dsf}: 프레임당 평균 ${ms.toFixed(1)}ms (1400x900, 8,500글자, 헤드리스 Chromium, 한계 ${limit}ms)`);
    assert.ok(ms < limit, `DPR ${dsf}: ${ms.toFixed(1)}ms ≥ ${limit}ms`);
  }
});
