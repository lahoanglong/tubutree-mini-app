// Thư viện chung cho các luồng khách thật trên Mini App (lane 6, khổ 375x812).
// Đếm "chạm": mỗi tap()/fill()/choose() cộng 1. Ghi thời gian chờ sau mỗi bước, chụp ảnh, ghi steps.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { open } from '../../../2026-10-20-uat/tools/uat-harness/miniapp-session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const R = path.resolve(HERE, '../..');
export const H = path.resolve(R, '../2026-10-20-uat/tools/uat-harness');
export const LANE = 6;
export const VIEWPORT = { width: 375, height: 812 };

export function sql(q) {
  const out = execFileSync(process.execPath, [path.join(H, 'db.mjs'), String(LANE), q], { encoding: 'utf8' });
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
}
export const sqlTry = (q) => {
  try {
    return sql(q);
  } catch (e) {
    return `LỖI SQL: ${String(e.message).split('\n')[0]}`;
  }
};

const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

export class Flow {
  constructor(name, s, persona) {
    this.name = name;
    this.s = s;
    this.page = s.page;
    this.persona = persona;
    this.dir = path.join(R, 'screens/flows/mini', name);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.taps = 0;
    this.cum = 0;
    this.rows = [];
    this.notes = [];
    this.apiMark = 0;
    this.errMark = 0;
    this.tapLog = [];
    this.inflight = 0;
    const api = s.lane.apiUrl;
    s.context.on('request', (r) => {
      if (r.url().startsWith(api)) this.inflight += 1;
    });
    this.lastApiEnd = 0;
    const done = (r) => {
      if (r.url().startsWith(api)) {
        this.inflight = Math.max(0, this.inflight - 1);
        this.lastApiEnd = Date.now();
      }
    };
    s.context.on('requestfinished', done);
    s.context.on('requestfailed', done);
  }

  static async start(name, persona, opts = {}) {
    const s = await open(LANE, persona, { viewport: VIEWPORT, ...opts });
    return new Flow(name, s, persona);
  }

  /** Tìm phần tử theo chữ hiển thị / vai trò: nút hoặc liên kết đúng tên, rồi chữ đúng, rồi chữ chứa. */
  loc(label, { nth = 0, scope = null } = {}) {
    const root = scope ?? this.page;
    if (label instanceof RegExp) {
      return root.getByRole('button', { name: label }).or(root.getByRole('link', { name: label })).or(root.getByText(label)).nth(nth);
    }
    const exact = root.getByRole('button', { name: label, exact: true }).or(root.getByRole('link', { name: label, exact: true }));
    return { exact, root, label, nth };
  }

  async resolve(label, nth = 0, scope = null) {
    const root = scope ?? this.page;
    if (label instanceof RegExp) {
      const btn = root.getByRole('button', { name: label });
      if (await btn.count()) return btn.nth(nth);
      return this.loc(label, { nth, scope });
    }
    const a = root.getByRole('button', { name: label, exact: true }).or(root.getByRole('link', { name: label, exact: true }));
    if (await a.count()) return a.nth(nth);
    const b = root.getByText(label, { exact: true });
    if (await b.count()) return b.nth(nth);
    return root.getByRole('button', { name: label }).or(root.getByText(label)).nth(nth);
  }

  /** Chạm một phần tử (1 chạm). */
  async tap(label, opts = {}) {
    // Trang cũ vẫn nằm trong DOM khi đi sâu: nút "Quay lại" cố định bị trùng, lấy cái ở trang trên cùng (cuối DOM).
    let l = await this.resolve(label, opts.nth ?? 0, opts.scope ?? null);
    if (label === 'Quay lại' && opts.nth === undefined) {
      const all = this.page.getByRole('button', { name: 'Quay lại', exact: true });
      l = all.nth((await all.count()) - 1);
    }
    await l.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
    await l.click({ timeout: opts.timeout ?? 8000 });
    this.taps += 1;
    this.tapLog.push(String(label));
  }

  /** Chạm bằng locator Playwright dựng sẵn (1 chạm). */
  async tapLoc(locator, desc) {
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
    await locator.click({ timeout: 8000 });
    this.taps += 1;
    this.tapLog.push(desc);
  }

  /** Gõ một ô chữ (tính 1 chạm). */
  async fill(locator, text, desc = 'ô chữ') {
    await locator.click({ timeout: 8000 });
    await locator.fill(text);
    this.taps += 1;
    this.tapLog.push(`${desc}="${text}"`);
  }

  /** Cuộn màn hình (không tính chạm; ghi riêng để biết khách phải vuốt). */
  async scroll(dy = 600) {
    await this.page.mouse.move(180, 400);
    await this.page.mouse.wheel(0, dy);
    await this.page.waitForTimeout(250);
    this.scrolls = (this.scrolls ?? 0) + 1;
  }

  note(t) {
    this.notes.push(t);
  }

  arm() {
    return this.page
      .evaluate(() => {
        if (!window.__mo) {
          window.__lastMut = 0;
          window.__mo = new MutationObserver(() => (window.__lastMut = Date.now()));
          window.__mo.observe(document.documentElement, { subtree: true, childList: true });
        }
      })
      .catch(() => undefined);
  }

  /** Chờ tới khi: không còn request API bay, không còn khung chờ nhìn thấy, DOM không thêm/bớt nút 350ms liên tiếp.
   *  Trả về ms chờ thật (đã trừ 350ms im lặng) và cờ capped nếu quá 12s vẫn chưa yên. */
  async settle() {
    const t0 = Date.now();
    const arm = () => this.arm();
    await arm();
    this.capped = false;
    while (true) {
      if (Date.now() - t0 > 12000) {
        this.capped = true;
        break;
      }
      const st = await this.page
        .evaluate(() => {
          const vis = (e) => {
            const r = e.getBoundingClientRect();
            const cs = getComputedStyle(e);
            return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && r.top < innerHeight && r.bottom > 0;
          };
          const sk = [...document.querySelectorAll('[class*="skeleton" i], [class*="spinner" i], .zaui-spinner')].some(vis);
          return { sk, quiet: Date.now() - (window.__lastMut ?? 0) };
        })
        .catch(() => ({ sk: false, quiet: 0 }));
      if (!this.page.url().includes('?') || true) await arm();
      if (this.inflight === 0 && !st.sk && st.quiet >= 350) break;
      await this.page.waitForTimeout(50);
    }
    return Math.max(0, Date.now() - t0 - 350);
  }

  /** Một bước: chạy fn (các chạm), chờ ổn định, chụp ảnh, ghi dòng. */
  async step(label, fn, { note = '', shot = true, soft = false } = {}) {
    const t0 = Date.now();
    await this.arm();
    const before = this.taps;
    const logBefore = this.tapLog.length;
    let err = null;
    try {
      await fn?.();
    } catch (e) {
      err = e;
    }
    const tAct = Date.now();
    await this.page.waitForTimeout(250);
    await this.settle();
    const capped = this.capped;
    const lastMut = await this.page.evaluate(() => window.__lastMut ?? 0).catch(() => 0);
    // chờ thật = từ lúc chạm xong tới lần cuối màn hình đổi hoặc API trả về (không tính 350ms im lặng dùng để chắc là đã yên)
    const waitMs = capped ? 12000 : Math.max(0, Math.max(lastMut, this.lastApiEnd) - tAct);
    const n = this.rows.length + 1;
    const file = `${String(n).padStart(2, '0')}-${slug(label)}.png`;
    if (shot) await this.page.screenshot({ path: path.join(this.dir, file) });
    const newReq = this.s.requests.slice(this.apiMark).filter((r) => (r.status >= 400 || r.status === 0) && !/^\/events/.test(r.path));
    this.apiMark = this.s.requests.length;
    const newErr = this.s.consoleErrors.slice(this.errMark);
    this.errMark = this.s.consoleErrors.length;
    const row = {
      n,
      step: label,
      taps: this.taps - before,
      cum: this.taps,
      path: this.tapLog.slice(logBefore).join(' > '),
      route: new URL(this.page.url()).pathname + new URL(this.page.url()).search,
      waitMs: Math.round(waitMs),
      slow: waitMs > 1000,
      note: [note, capped ? 'chưa yên sau 12s (còn request/khung chờ/DOM đổi)' : '', err ? `LỖI BƯỚC: ${String(err.message).split('\n')[0].slice(0, 160)}` : ''].filter(Boolean).join(' | '),
      apiErrors: newReq.map((r) => `${r.method} ${r.path} ${r.status}`),
      consoleErrors: newErr.map((e) => e.slice(0, 140)),
      shot: shot ? path.relative(R, path.join(this.dir, file)) : null,
      failed: !!err,
    };
    this.rows.push(row);
    console.log(`[${this.name}] #${n} ${label}: +${row.taps} chạm (cộng dồn ${row.cum}) · ${row.route} · chờ ${row.waitMs}ms${row.failed ? ' · LỖI ' + row.note : ''}${row.apiErrors.length ? ' · API ' + row.apiErrors.join(';') : ''}`);
    if (err && !soft) throw Object.assign(err, { flowStepLogged: true });
    return row;
  }

  async finish(extra = {}) {
    const out = { name: this.name, persona: this.persona, totalTaps: this.taps, rows: this.rows, notes: this.notes, ...extra };
    fs.writeFileSync(path.join(this.dir, 'steps.json'), JSON.stringify(out, null, 1));
    await this.s.close();
    console.log(`[${this.name}] XONG: ${this.taps} chạm, ${this.rows.length} bước -> ${path.relative(R, path.join(this.dir, 'steps.json'))}`);
    return out;
  }

  async abort(e) {
    const out = { name: this.name, persona: this.persona, totalTaps: this.taps, rows: this.rows, notes: this.notes, stoppedAt: String(e?.message ?? e).split('\n')[0] };
    fs.writeFileSync(path.join(this.dir, 'steps.json'), JSON.stringify(out, null, 1));
    await this.s.close().catch(() => undefined);
    console.log(`[${this.name}] DỪNG: ${out.stoppedAt}`);
  }
}

export async function run(flow, fn) {
  try {
    await fn();
    return await flow.finish();
  } catch (e) {
    await flow.abort(e);
    process.exitCode = 1;
  }
}

/** Cho khách hiện lại màn chào mừng/khảo sát: bỏ cờ onboardedAt và segments trong users.metadata. */
export function resetOnboarding(userId) {
  return sqlTry(`UPDATE users SET metadata = COALESCE(metadata::jsonb,'{}'::jsonb) - 'onboardedAt' - 'segments' WHERE id='${userId}'`);
}
