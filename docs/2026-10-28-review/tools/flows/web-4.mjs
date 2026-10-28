// Luồng 4: Điểm Xanh, hạng, đổi quà, Vườn Xanh, điểm danh (returning, 375).
// Trước khi chạy: đưa điểm danh hôm nay và vườn của returning về trạng thái "chưa làm" (SQL trên DB lane 6).
// Chạy từ gốc worktree: node docs/2026-10-28-review/tools/flows/web-4.mjs
import { startFlow, warm, sql, fmtTable, ensureClone } from './flow-lib.mjs';

ensureClone('uat_returning', 'uat_webret', { points: 45400, phone: '0901000103' });
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
// Đưa returning về trạng thái chưa điểm danh, chưa đổi quà, vườn mới (xoá đúng những dòng do chính luồng này tạo).
sql(`delete from loyalty_check_ins where "userId"='uat_webret' and "dayKey"='${today}'`);
sql(`delete from coupon_claims where "userId"='uat_webret'`);
sql(`delete from points_transactions where "userId"='uat_webret' and (reason like 'DAILY_CHECKIN%' or reason like 'LOYALTY_REDEEM_VOUCHER%' or reason like 'GAME_%') and "createdAt" > '${today}T00:00:00+07:00'`);
sql(`update users set "pointsBalance"=(select coalesce(sum(delta),0) from points_transactions where "userId"='uat_webret') where id='uat_webret'`);
sql(`delete from game_profiles where "userId"='uat_webret'`);
sql(`delete from user_species where "userId"='uat_webret'`);

await warm(['/', '/uu-dai', '/tai-khoan/diem-xanh', '/kho-qua', '/kho-qua/cua-toi', '/vuon-xanh']);
const F = await startFlow({ flow: '4-diem-xanh-vuon', persona: 'webret' });
const p = F.page;
await F.firstLoad('Mở trang chủ (thẻ điểm Lộc Biếc, tiến độ lên Đại Thụ)');
await F.tap('Bấm Điểm danh ở thẻ điểm', F.role('button', 'Điểm danh'));
await F.tap('Bấm thẻ điểm (Chào ... · Lộc Biếc)', p.getByRole('link', { name: /Chào Nguyễn/ }).first());
await F.tap('Bấm "Lộc Biếc - Hạng và lịch sử điểm"', p.getByRole('button', { name: /Hạng và lịch sử điểm/ }).first());
await F.tap('Bấm Kho quà (ở trang Hạng)', p.getByRole('link', { name: /Kho quà/ }).first());
await F.tap('Bấm Đổi ở "Miễn phí vận chuyển" (20.000 điểm)', p.getByRole('button', { name: 'Đổi', exact: true }).last());
await F.tap('Bấm Xác nhận đổi', p.getByRole('button', { name: 'Xác nhận đổi' }));
await F.look('Sau khi đổi quà');
await F.tap('Bấm Xem ví mã (trong hộp Đổi quà thành công)', p.getByRole('link', { name: 'Xem ví mã' }).first());
await F.tap('Bấm tab Vườn Xanh (thanh đáy)', p.getByRole('link', { name: 'Vườn Xanh' }).locator('visible=true').first());
await F.look('Màn Vườn Xanh (đầu trang)');
const tuoi = p.getByRole('button', { name: /Tưới hết/ }).first();
if (await tuoi.count()) await F.tap('Bấm Tưới hết (60 giọt nước)', tuoi);
else await F.look('Không có nút Tưới (vườn đã tưới)', { ok: false });
const tv = p.getByRole('button', { name: 'Tuyệt vời!' }).first();
if (await tv.count()) await F.tap('Bấm Tuyệt vời! (hộp Thu hoạch thành công, +2.000 điểm)', tv);
await F.look('Vườn sau khi tưới cây');
const body = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const out = F.save({ bodyHead: body.slice(0, 500) });
console.log(fmtTable(out));
console.log('tổng chạm', out.touches);
await F.close();
