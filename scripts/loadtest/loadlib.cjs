// Trình điều khiển tải tối giản (không phụ thuộc k6): N "người dùng ảo" (VU) chạy vòng lặp bất đồng bộ,
// ghi độ trễ từng request theo nhãn, tính p50/p95/p99, RPS, lỗi%. Chỉ dùng cho API cổng 3301 (DB tubutree_perf).
const { execSync } = require('child_process');

const BASE = process.env.PERF_BASE || 'http://127.0.0.1:3301/api';
if (!/(localhost|127.0.0.1):3301/.test(BASE)) throw new Error('TỪ CHỐI: loadtest chỉ được chạy với API cổng 3301, không phải ' + BASE);

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const median = (a) => pct(a, 50);

/** IP giả lập duy nhất cho mỗi VU (API đặt trust proxy=1 nên ThrottlerGuard đọc X-Forwarded-For). */
const fakeIp = (n) => `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;

function apiProc() {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "$p=(Get-NetTCPConnection -LocalPort 3301 -State Listen).OwningProcess; $q=Get-Process -Id $p; ($q.CPU).ToString([cultureinfo]::InvariantCulture)+' '+[int]($q.WorkingSet64/1MB)"`,
      { encoding: 'utf8', timeout: 15000 },
    ).trim().split(' ');
    return { cpuSec: parseFloat(out[0]), rssMB: parseInt(out[1], 10) };
  } catch {
    return { cpuSec: NaN, rssMB: NaN };
  }
}

function dockerCpu() {
  try {
    const out = execSync(`docker stats --no-stream --format "{{.Name}} {{.CPUPerc}} {{.MemUsage}}" tubu_pg tubu_redis`, { encoding: 'utf8', timeout: 20000 });
    return out.trim().replace(/\r?\n/g, ' | ');
  } catch {
    return '?';
  }
}

/**
 * Chạy 1 giai đoạn: `concurrency` VU, `seconds` giây (hoặc `iterationsPerVu` vòng nếu có).
 * `iter(ctx)` gọi ctx.req(...) nhiều lần; trả về void. ctx.vu = chỉ số VU, ctx.i = số vòng của VU.
 */
let ipCounter = 1000 + Math.floor(Math.random() * 60000);

async function runStage({ sameIp = false, name, concurrency, seconds, iterationsPerVu, iter, vuInit, okStatuses = [200, 201, 204], expected = [] }) {
  const lat = {}; // label -> [ms]
  const all = [];
  const flows = [];
  let total = 0;
  let errors = 0;
  let throttled = 0;
  let expectedRej = 0;
  const statusCount = {};
  const errSamples = [];
  const stopAt = seconds ? Date.now() + seconds * 1000 : Infinity;
  const p0 = apiProc();
  const t0 = Date.now();
  let dockerSnap = '';
  if (seconds && process.env.DOCKER_STATS) setTimeout(() => { dockerSnap = dockerCpu(); }, Math.min(seconds * 500, 8000));

  async function vuLoop(vu) {
    const state = vuInit ? await vuInit(vu) : {};
    let i = 0;
    while (Date.now() < stopAt && (iterationsPerVu == null || i < iterationsPerVu)) {
      const f0 = performance.now();
      const ctx = {
        vu, i, state,
        async req(method, path, { token, body, headers, label, ok } = {}) {
          const lbl = label || method + ' ' + path.split('?')[0].replace(/\/[a-z0-9_-]{12,}/gi, '/:id');
          const s = performance.now();
          let status = 0;
          let text = '';
          try {
            const r = await fetch(BASE + path, {
              method,
              headers: {
                'X-Forwarded-For': sameIp ? fakeIp(vu + 1) : fakeIp(++ipCounter),
                ...(token ? { Authorization: 'Bearer ' + token } : {}),
                ...(body ? { 'Content-Type': 'application/json' } : {}),
                ...headers,
              },
              body: body ? JSON.stringify(body) : undefined,
            });
            status = r.status;
            text = await r.text();
          } catch (e) {
            status = -1;
            text = String(e && e.message) + ' ' + String(e && e.cause && (e.cause.code || e.cause.message));
          }
          const ms = performance.now() - s;
          total++;
          statusCount[status] = (statusCount[status] || 0) + 1;
          (lat[lbl] ||= []).push(ms);
          all.push(ms);
          const okList = ok || okStatuses;
          if (status === 429) throttled++;
          else if (okList.includes(status)) {
            /* ok */
          } else if (expected.includes(status) || (ok === 'any')) expectedRej++;
          else {
            errors++;
            if (errSamples.length < 5) errSamples.push(`${lbl} -> ${status} ${text.slice(0, 120)}`);
          }
          let json;
          try { json = JSON.parse(text); } catch { json = undefined; }
          return { status, ms, json, text };
        },
      };
      try {
        await iter(ctx);
      } catch (e) {
        errors++;
        if (errSamples.length < 5) errSamples.push('iter exception: ' + (e && e.message));
      }
      flows.push(performance.now() - f0);
      i++;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, v) => vuLoop(v)));
  const wall = (Date.now() - t0) / 1000;
  const p1 = apiProc();
  const perLabel = {};
  for (const [k, v] of Object.entries(lat)) perLabel[k] = { n: v.length, p50: +pct(v, 50).toFixed(1), p95: +pct(v, 95).toFixed(1), p99: +pct(v, 99).toFixed(1) };
  return {
    name, concurrency, wallSec: +wall.toFixed(1), requests: total, rps: +(total / wall).toFixed(1),
    p50: +pct(all, 50).toFixed(1), p95: +pct(all, 95).toFixed(1), p99: +pct(all, 99).toFixed(1),
    errPct: +((errors / Math.max(1, total)) * 100).toFixed(2), throttledPct: +((throttled / Math.max(1, total)) * 100).toFixed(2),
    expectedRejected: expectedRej, statusCount,
    flowP50: +pct(flows, 50).toFixed(1), flowP95: +pct(flows, 95).toFixed(1), flows: flows.length,
    apiCpuCores: +(((p1.cpuSec - p0.cpuSec) / wall) || 0).toFixed(2), apiRssMB: p1.rssMB,
    docker: dockerSnap, perLabel, errSamples,
  };
}

module.exports = { BASE, runStage, pct, median, fakeIp, apiProc, dockerCpu };
