// Thư viện chung cho các luồng web (lane 6). Chạy từ gốc worktree, Node 22 trong PATH.
// Mỗi bước: bấm như người dùng, đếm chạm, đo chờ (tới khi request fetch/xhr/document cuối cùng xong), chụp ảnh viewport 375x812.
// FLOW_DEBUG=1 in url + chữ đầu trang sau mỗi bước. Không sửa mã sản phẩm.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openWeb } from '../../../2026-10-20-uat/tools/uat-harness/web-session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const R = path.resolve(HERE, '../..');
export const H = path.resolve(R, '../2026-10-20-uat/tools/uat-harness');
export const LANE = Number(process.env.LANE || 6);
export const WEB = `http://localhost:${3262 + (LANE - 6) * 10}`;
const DEBUG = !!process.env.FLOW_DEBUG;
export const PHONE = { width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
export const DESK = { width: 1280, height: 800, isMobile: false, hasTouch: false, deviceScaleFactor: 1 };

export function sql(q) {
  const r = spawnSync('node', [path.join(H, 'db.mjs'), String(LANE), q], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`db.mjs lỗi: ${r.stderr || r.stdout}`);
  try {
    return JSON.parse(r.stdout);
  } catch {
    return r.stdout;
  }
}

export function params() {
  return JSON.parse(fs.readFileSync(path.join(R, 'tools', `params-l${LANE}.json`), 'utf8'));
}

export function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// Làm nóng route để next dev biên dịch trước, tránh tính thời gian biên dịch vào "chờ" của khách.
export async function warm(routes) {
  for (const r of routes) {
    try {
      await fetch(WEB + r, { signal: AbortSignal.timeout(120_000) });
    } catch {
      /* bỏ qua */
    }
  }
}

export async function startFlow({ flow, persona, viewport = PHONE, path: startPath = '/', share = null, actor = 'khách' }) {
  const dir = path.join(R, 'screens', 'flows', 'web', flow);
  fs.mkdirSync(dir, { recursive: true });
  if (!share || !share.n) for (const f of fs.readdirSync(dir)) if (f.endsWith('.png')) fs.unlinkSync(path.join(dir, f));
  const s = await openWeb(LANE, persona, { viewport, path: startPath });
  const page = s.page;
  let lastNet = Date.now();
  let inflight = 0;
  const relevant = (req) => ['fetch', 'xhr', 'document'].includes(req.resourceType());
  page.on('request', (r) => {
    if (relevant(r)) {
      inflight++;
      lastNet = Date.now();
    }
  });
  const done = (r) => {
    if (relevant(r)) {
      inflight = Math.max(0, inflight - 1);
      lastNet = Date.now();
    }
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);

  // Ẩn nút chỉ báo của next dev (chỉ có ở dev, che nút ở góc dưới trái; production không có).
  const hideDev = "nextjs-portal{display:none!important}";
  await s.context.addInitScript((css) => {
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = css;
      document.head.appendChild(st);
    });
  }, hideDev);
  await page.addStyleTag({ content: hideDev }).catch(() => undefined);

  const F = {
    s,
    page,
    flow,
    persona,
    rows: share ? share.rows : [],
    touches: 0,
    n: 0,
    actor,
    dir,
    seenReq: 0,
    seenErr: 0,
    seenCon: 0,
  };

  F.settle = async (t0, maxMs = 20_000) => {
    const QUIET = 400;
    const start = Date.now();
    await page.waitForTimeout(150);
    while (Date.now() - start < maxMs) {
      if (inflight === 0 && Date.now() - lastNet >= QUIET) break;
      await page.waitForTimeout(50);
    }
    // thời gian chờ thật = tới lúc request cuối xong (không tính 400ms yên lặng)
    return Math.max(0, Math.min(lastNet, Date.now()) - t0);
  };

  F.shot = async (label) => {
    if (share) share.n = (share.n || 0) + 1;
    F.n = share ? share.n : F.n + 1;
    const nn = String(F.n).padStart(2, '0');
    const slug = label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
    const file = `${nn}-${slug}.png`;
    await page.screenshot({ path: path.join(dir, file) });
    return `screens/flows/web/${flow}/${file}`;
  };

  F.row = async (step, { touch = 0, waitMs = 0, note = '', ok = true, extra = {} } = {}) => {
    F.touches += touch;
    await page.waitForTimeout(350);
    const shot = await F.shot(step);
    const newReq = s.requests.slice(F.seenReq);
    F.seenReq = s.requests.length;
    const apiErr = newReq.filter((r) => r.status >= 400 || r.status === 0).map((r) => `${r.method} ${r.path} ${r.status}`);
    const con = s.consoleErrors.slice(F.seenCon);
    F.seenCon = s.consoleErrors.length;
    const u = new URL(page.url());
    const row = { step: actor === 'khách' ? step : `[${actor}] ${step}`, actor, touches: F.touches, route: u.pathname + u.search, waitMs, note, ok, shot, apiErr, consoleErr: con.map((c) => c.slice(0, 160)), ...extra };
    F.rows.push(row);
    if (DEBUG) {
      const txt = (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 260);
      console.log(`[${F.touches}t ${waitMs}ms] ${step} -> ${row.route}${apiErr.length ? ' API-ERR ' + apiErr.join(';') : ''}${ok ? '' : ' KHÔNG-OK'}\n    ${txt}`);
    }
    return row;
  };

  // Bước nhìn (không chạm): chụp ảnh màn hiện tại.
  F.look = async (step, opts = {}) => F.row(step, { ...opts, touch: 0 });

  // Lấy locator "thấy được": nhãn chữ hiển thị. scope = page hoặc locator.
  F.text = (label, { exact = true, scope = page } = {}) => scope.getByText(label, { exact }).locator('visible=true').first();
  F.role = (role, name, { exact = true, scope = page } = {}) => scope.getByRole(role, { name, exact }).locator('visible=true').first();

  // Bấm. loc: Locator hoặc (page)=>Locator. Thất bại (bị che, không thấy) => ok:false, không ném lỗi.
  F.tap = async (step, loc, { note = '', expectUrl = null, timeout = 8000, shotAfter = true } = {}) => {
    const l = typeof loc === 'function' ? loc(page) : loc;
    const t0 = Date.now();
    let ok = true;
    let err = '';
    try {
      await l.click({ timeout });
    } catch (e) {
      ok = false;
      err = String(e.message || e).split('\n')[0].slice(0, 200);
    }
    const waitMs = ok ? await F.settle(t0) : Date.now() - t0;
    if (ok && expectUrl) await page.waitForURL(expectUrl, { timeout: 8000 }).catch(() => undefined);
    return F.row(step, { touch: ok ? 1 : 0, waitMs, note: ok ? note : `KHÔNG BẤM ĐƯỢC: ${err} ${note}`, ok });
  };

  F.press = async (step, key, { note = '' } = {}) => {
    const t0 = Date.now();
    await page.keyboard.press(key);
    const waitMs = await F.settle(t0);
    return F.row(step, { touch: 1, waitMs, note });
  };

  F.fill = async (step, loc, value, { note = '' } = {}) => {
    const l = typeof loc === 'function' ? loc(page) : loc;
    const t0 = Date.now();
    let ok = true;
    let err = '';
    try {
      await l.fill(value, { timeout: 8000 });
    } catch (e) {
      ok = false;
      err = String(e.message || e).split('\n')[0].slice(0, 200);
    }
    const waitMs = await F.settle(t0);
    return F.row(step, { touch: ok ? 1 : 0, waitMs, note: ok ? note : `KHÔNG GÕ ĐƯỢC: ${err} ${note}`, ok });
  };

  // Bước mở trang đầu (không tính chạm: khách mở app là bắt đầu).
  F.firstLoad = async (step, note = '') => {
    await page.waitForTimeout(1200);
    return F.row(step, { touch: 0, waitMs: 0, note });
  };

  F.save = (extra = {}) => {
    const out = { flow, persona, viewport: { w: viewport.width, h: viewport.height }, touches: F.touches, rows: F.rows, ...(share ? { shared: true } : {}), apiErrors: s.requests.filter((r) => r.status >= 400).length, ...extra };
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(out, null, 2));
    return out;
  };

  F.close = async () => {
    await s.close();
  };
  return F;
}

export async function dismissOnboarding(F, { tap = true } = {}) {
  const el = F.page.getByText('Để sau', { exact: true }).locator('visible=true').first();
  if (await el.count()) {
    if (tap) return F.tap('Bấm Để sau ở màn chào', el);
    await el.click();
  }
  return null;
}

export function fmtTable(results) {
  const lines = ['| # | Bước | Chạm | Màn | Chờ | Ghi chú |', '|---|---|---|---|---|---|'];
  results.rows.forEach((r, i) => {
    const w = r.waitMs > 1000 ? `${(r.waitMs / 1000).toFixed(1)}s` : r.waitMs > 0 ? `${r.waitMs}ms` : '-';
    lines.push(`| ${i + 1} | ${r.step} | ${r.actor && r.actor !== 'khách' ? r.actor + ': ' : ''}${r.touches} | \`${r.route}\` | ${w} | ${r.note}${r.apiErr.length ? ' API: ' + r.apiErr.join(', ') : ''} |`);
  });
  return lines.join('\n');
}

// Lane 6 dùng chung với agent khác (cùng persona returning/new bị đổi điểm, giỏ, vườn trong lúc mình chạy).
// Mỗi luồng web dùng bản sao riêng của persona để số chạm và trạng thái không bị lẫn. Chỉ ghi vào DB lane 6.
export function ensureClone(srcId, newId, { points = null, phone } = {}) {
  const exists = sql(`select id from users where id='${newId}'`);
  if (Array.isArray(exists) && exists.length) return newId;
  const cols = sql(`select column_name from information_schema.columns where table_name='users' order by ordinal_position`).map((c) => c.column_name);
  const over = {
    id: `'${newId}'`,
    zaloId: `'uat-zalo-${newId}'`,
    phone: `'${phone}'`,
    referralCode: `'${newId.toUpperCase().replace(/[^A-Z0-9]/g, '')}'`,
    pancakeCustomerId: 'null',
    zaloAccessToken: 'null',
    zaloRefreshToken: 'null',
    createdAt: 'now()',
    updatedAt: 'now()',
  };
  if (points !== null) over.pointsBalance = String(points);
  const list = cols.map((c) => `"${c}"`).join(',');
  const sel = cols.map((c) => (c in over ? over[c] : `"${c}"`)).join(',');
  sql(`insert into users (${list}) select ${sel} from users where id='${srcId}'`);
  // Bản sao luôn là khách thường (persona gốc có thể đã bị agent khác đăng ký CTV).
  sql(`update users set role='CUSTOMER', metadata = coalesce(metadata,'{}'::jsonb) - 'affiliateTerms' where id='${newId}'`);
  sql(
    `insert into addresses (id,"userId",recipient,phone,province,district,ward,street,"isDefault","provinceCode","districtCode","wardCode") select 'addr_${newId}','${newId}',recipient,'${phone}',province,district,ward,street,"isDefault","provinceCode","districtCode","wardCode" from addresses where "userId"='${srcId}' and "isDefault" limit 1`,
  );
  if (points) {
    sql(
      `insert into points_transactions (id,"userId",delta,reason,"expiresAt","createdAt",lot) values ('seed_${newId}','${newId}',${points},'WEB_SEED',now() + interval '1 year',now(),'STANDARD')`,
    );
  }
  return newId;
}
