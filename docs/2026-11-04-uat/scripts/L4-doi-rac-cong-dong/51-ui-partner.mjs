// Quầy của ĐIỂM ĐẠI LÝ trên giao diện Mini 375: món chỉ kho nhận (hộp sữa, vỏ chai Tubu) bị khoá, đại lý chỉ cộng carton + nilon.
// Yêu cầu chứa hộp sữa được dựng bằng SQL (API chặn từ lúc tạo, như ca D-34). Chạy sau 50-ui.mjs trên cùng lane. Chạy: node 51-ui-partner.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { H, SHOTS, sql, call, idem, pointsState, check, short, msg, readParams, closeDb } from './l4lib.mjs';

fs.mkdirSync(SHOTS, { recursive: true });
const mini = await import(pathToFileURL(`${H}/miniapp-session.mjs`).href);
const P = readParams();
const mk = (persona, journey, step, expected) => ({ persona, viewport: 'mini375', journey, step, expected });
const VP = { width: 375, height: 812, isMobile: true, hasTouch: true };

const c = await call('brand', 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', pointId: P.whId, lines: [{ itemId: 'wi-carton', declaredQty: 3 }, { itemId: 'wi-milk-carton', declaredQty: 5 }] }, idem('partner-ui'));
await sql(`UPDATE waste_requests SET "pointId"='${P.partnerId}' WHERE id='${c.body?.id}'`);
const code = c.body?.code;
const id = 'U-F-desk-partner-mini375';
const meta = mk('ctv', 'Quầy điểm đại lý', 'Chủ điểm mở quầy, tra yêu cầu có carton 3 + hộp sữa 5, xác nhận', 'Dòng hộp sữa bị khoá (Không nhận / 0), carton mặc định 3; xác nhận chỉ cộng 3.000 điểm; dòng hộp sữa receivedQty 0 lý do NOT_ACCEPTED; số dư = tổng sổ');
try {
  const bef = await pointsState('uat_brand');
  const s = await mini.open(4, 'ctv', { viewport: VP, path: '/recycle/desk' });
  try {
    await s.page.waitForTimeout(1500);
    await s.page.getByPlaceholder(/TR-/).fill(code);
    await s.page.getByRole('button', { name: 'Tra mã' }).click();
    await s.page.waitForTimeout(2000);
    const f1 = path.join(SHOTS, 'mini375-ctv-desk-partner-1-lookup.png');
    await s.page.screenshot({ path: f1 });
    const preview = await s.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    const steppers = await s.page.getByRole('button', { name: 'Tăng số lượng' }).count();
    const disabled = await s.page.evaluate(() => [...document.querySelectorAll('button[aria-label="Tăng số lượng"]')].map((b) => b.disabled || b.getAttribute('aria-disabled') === 'true'));
    await s.page.getByRole('button', { name: 'Xác nhận đã nhận' }).click();
    await s.page.waitForTimeout(2500);
    const f2 = path.join(SHOTS, 'mini375-ctv-desk-partner-2-confirmed.png');
    await s.page.screenshot({ path: f2 });
    const aft = await pointsState('uat_brand');
    const row = (await sql(`SELECT status::text AS st, "pointsAwarded" AS pts FROM waste_requests WHERE code='${code}'`))[0];
    const lines = await sql(`SELECT "itemId", "receivedQty", "shortfallReason"::text AS why FROM waste_request_lines l JOIN waste_requests r ON r.id=l."requestId" WHERE r.code='${code}' ORDER BY "itemId"`);
    const milk = lines.find((l) => l.itemId === 'wi-milk-carton');
    const carton = lines.find((l) => l.itemId === 'wi-carton');
    const lockedShown = /Không nhận|Chỉ kho/.test(preview);
    check(id, meta, row?.st === 'COMPLETED' && row.pts === 3000 && aft.balance - bef.balance === 3000 && carton?.receivedQty === 3 && milk?.receivedQty === 0 && milk?.why === 'NOT_ACCEPTED' && aft.balance === aft.ledgerSum && lockedShown,
      `xem trước: ${preview.slice(preview.indexOf(code), preview.indexOf(code) + 260)}; nút tăng ${steppers} (vô hiệu ${JSON.stringify(disabled)}); DB ${short(row, 80)} dòng ${short(lines, 220)}; ${bef.balance}→${aft.balance} sổ ${aft.ledgerSum}`,
      `${path.relative(path.resolve(SHOTS, '../..'), f1)}, ${path.relative(path.resolve(SHOTS, '../..'), f2)}`);
  } finally {
    await s.close();
  }
} catch (e) {
  check(id, meta, 'BLOCKED', `không chạy hết: ${String(e).split('\n')[0].slice(0, 220)}`);
}
await closeDb();
