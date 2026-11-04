// C27: đại lý bấm đúp nút "Ghi công nợ" trên Mini 375 và web 375: chỉ tạo một đơn, màn hình không hiện lỗi kỹ thuật ("Lỗi cơ sở dữ liệu"), nợ tăng đúng một lần.
// Luật: dealer.service.ts createOrder (Idempotency-Key theo lần bấm), copy đợt 8 (không chữ kỹ thuật). Cuối script huỷ đơn thử qua admin và kiểm nợ trở về.
// Chạy sau c23: node c27-dealer-doubleclick-ui.mjs (từ gốc worktree uat-1104).
import fs from 'node:fs';
import path from 'node:path';
import { H, SHOTS, call, short, sql, check, done } from './common.mjs';
const { open } = await import(`${H}/miniapp-session.mjs`);
const { openWeb } = await import(`${H}/web-session.mjs`);

const D = 'uat_dealer';
const T = (title, size, step, expect) => ({ title, persona: 'dealer', size, journey: title, step, expect });
const debt = async () => (await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM dealer_credit_ledgers WHERE "userId"=$1`, D))[0].s;
const sess = (surface) => (surface === 'mini375'
  ? open(6, 'dealer', { path: '/dealer', viewport: { width: 375, height: 812, isMobile: true } })
  : openWeb(6, 'dealer', { path: '/dai-ly', viewport: { width: 375, height: 812, isMobile: true } }));

const made = [];
for (const surface of ['mini375', 'web375']) {
  const debt0 = await debt();
  const [{ t0 }] = await sql(`SELECT now()::text t0`);
  const info = { surface, debt0 };
  const s = await sess(surface);
  try {
    await s.page.waitForTimeout(3500);
    await s.page.getByRole('button', { name: 'Dán đơn' }).first().click({ timeout: 8000 });
    await s.page.waitForTimeout(800);
    await s.page.locator('textarea').first().fill('HEC-SH-300, 33');
    await s.page.getByRole('button', { name: 'Thêm vào đơn' }).first().click({ timeout: 8000 });
    await s.page.waitForTimeout(800);
    await s.page.keyboard.press('Escape');
    await s.page.waitForTimeout(700);
    const btn = s.page.getByRole('button', { name: 'Ghi công nợ' }).last();
    await btn.click({ clickCount: 2, delay: 10, timeout: 8000 });
    await s.page.waitForTimeout(4000);
    info.text = await s.page.evaluate(() => document.body.innerText);
    await s.page.screenshot({ path: path.join(SHOTS, `${surface}-dai-ly-bam-dup.png`) });
  } catch (e) { info.error = String(e.message).replace(/\x1b\[[0-9;]*m/g, '').slice(0, 300); } finally { await s.close(); }
  const orders = await sql(`SELECT id, code, total::int t FROM orders WHERE "userId"=$1 AND type::text='DEALER' AND "createdAt" > $2::timestamptz ORDER BY "createdAt"`, D, t0);
  for (const o of orders) made.push(o);
  info.orders = orders;
  info.debt1 = await debt();
  const size = surface === 'mini375' ? 'Mini 375' : 'web 375';
  const technical = /Lỗi cơ sở dữ liệu|P20\d\d|40001|internal/i.test(info.text ?? '');
  fs.writeFileSync(path.join(SHOTS, `${surface}-dai-ly-bam-dup.json`), JSON.stringify({ ...info, text: undefined }, null, 2));
  check(surface === 'mini375' ? 'L6-U43' : 'L6-U44', T(`Đại lý bấm đúp "Ghi công nợ" trên ${size}: một đơn, nợ tăng một lần, màn không hiện lỗi kỹ thuật`, size, 'dán "HEC-SH-300, 33", bấm đúp nhanh nút Ghi công nợ', 'đúng một đơn DEALER mới; nợ tăng đúng tổng đơn đó; màn không có "Lỗi cơ sở dữ liệu"'),
    !info.error && orders.length === 1 && info.debt1 === debt0 + orders[0].t && !technical, `${info.error ? `lỗi thao tác: ${info.error}; ` : ''}số đơn mới=${orders.length}; nợ ${debt0}→${info.debt1}; chữ kỹ thuật trên màn=${technical}`, `shots/L6-ctv-dai-ly-nhan/${surface}-dai-ly-bam-dup.png + SQL orders/dealer_credit_ledgers`);
}

const cancels = [];
for (const o of made) cancels.push(await call('admin', 'PUT', `/admin/orders/${o.id}/status`, { status: 'CANCELLED', note: 'UAT dọn đơn thử bấm đúp' }));
check('L6-U45', T('Huỷ các đơn thử bấm đúp: nợ về 0', 'API', 'admin PUT /admin/orders/:id/status CANCELLED', 'nợ về như trước khi thử'), cancels.every((r) => r.ok) && (await debt()) === 0, `đơn=${made.length}; huỷ=${cancels.map((r) => r.status).join(',')}; nợ=${await debt()}`, 'SQL dealer_credit_ledgers');
await done();
