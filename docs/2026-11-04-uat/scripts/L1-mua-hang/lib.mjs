// Thư viện dùng chung cho lane L1-mua-hang (lane 1: API 3211, web 3212, Mini 3213, giả Pancake 3218, DB tubutree_uat_l1, Redis db 1).
// Chạy từ gốc worktree uat-1104:  node <đường dẫn tuyệt đối tới script>
import fs from 'node:fs';
import path from 'node:path';

export const UAT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
export const H = `${UAT}/docs/2026-10-20-uat/tools/uat-harness`;
export const OUT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat';
export const SCRIPTS = `${OUT}/scripts/L1-mua-hang`;
export const SHOTS = `${OUT}/shots/L1-mua-hang`;
export const RESULTS = `${SCRIPTS}/results`;
fs.mkdirSync(RESULTS, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

export const harness = await import(`${H}/lib.mjs`);
export const { api, apiOk, lane, laneEnv, prismaFor, closePrisma, mintAccessFor, sleep, findUser } = harness;
export const L = lane(1);
laneEnv(L);
export const { open: openMini } = await import(`${H}/miniapp-session.mjs`);
export const { openWeb } = await import(`${H}/web-session.mjs`);

export const VP = {
  mini375: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  web375: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  web1280: { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};

/** Mở một khổ: mini375 | web375 | web1280. */
export async function openSurface(surface, persona, p = '/') {
  if (surface === 'mini375') return openMini(1, persona, { viewport: VP.mini375, path: p });
  return openWeb(1, persona, { viewport: VP[surface], path: p });
}

/** Chuyển đường dẫn Mini sang web (route-map.json). */
export const WEB_OF = {
  '/': '/',
  '/browse': '/san-pham',
  '/flash-sale': '/gio-vang',
  '/cart': '/gio-hang',
  '/checkout': '/thanh-toan',
  '/orders': '/tai-khoan/don-hang',
  '/vouchers': '/ma-giam-gia',
  '/addresses': '/tai-khoan/dia-chi',
  '/loyalty': '/tai-khoan/diem-xanh',
};
export function webPath(miniPath) {
  if (WEB_OF[miniPath]) return WEB_OF[miniPath];
  let m;
  if ((m = miniPath.match(/^\/product\/(.+)$/))) return `/san-pham/${m[1]}`;
  if ((m = miniPath.match(/^\/order\/(.+)$/))) return `/tai-khoan/don-hang/${m[1]}`;
  if ((m = miniPath.match(/^\/bank-payment\/(.+)$/))) return `/thanh-toan/chuyen-khoan/${m[1]}`;
  if ((m = miniPath.match(/^\/browse\?(.*)$/))) return `/san-pham?${m[1]}`;
  return miniPath;
}

const DB = prismaFor(L);
export async function sql(text) {
  const rows = await DB.$queryRawUnsafe(text);
  return JSON.parse(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
}
export async function sqlExec(text) {
  return DB.$executeRawUnsafe(text);
}

/** Ghi kết quả một ca: id, persona, surface, journey, step, expected, actual, evidence, status (PASS|FAIL|BLOCKED|CAN_CHU). */
export function rec(file, r) {
  const row = { at: new Date().toISOString(), ...r };
  fs.appendFileSync(path.join(RESULTS, `${file}.jsonl`), `${JSON.stringify(row)}\n`);
  const tag = r.status === 'PASS' ? 'OK  ' : r.status === 'FAIL' ? 'FAIL' : r.status;
  console.log(`[${tag}] ${r.id} ${r.step ?? ''} :: ${String(r.actual ?? '').slice(0, 160)}`);
  return row;
}

export const money = (n) => `${Number(n).toLocaleString('vi-VN')}đ`;

/** Chữ cấm theo luật giọng đợt 8 (brief): "Vui lòng", "chúng tôi", "...". */
export function toneViolations(text) {
  const out = [];
  if (/vui lòng/i.test(text)) out.push('Vui lòng');
  if (/chúng tôi/i.test(text)) out.push('chúng tôi');
  if (/\.\.\.|…/.test(text)) out.push('... hoặc …');
  return out;
}

/** Token + header bypass throttle cho curl/fetch tuỳ ý. */
export async function tokenOf(persona) {
  return (await mintAccessFor(L, persona)).token;
}

export const idem = () => `uat-l1-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}
export async function shotFull(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}
