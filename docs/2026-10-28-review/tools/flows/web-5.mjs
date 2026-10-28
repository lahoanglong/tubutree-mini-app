// Luồng 5: đổi rác lấy quà (webrec = bản sao returning, 375) + nhân viên xác nhận ở quầy (persona staff, 375).
// Chạy từ gốc worktree: node docs/2026-10-28-review/tools/flows/web-5.mjs
import fs from 'node:fs';
import path from 'node:path';
import { startFlow, warm, sql, ensureClone, fmtTable } from './flow-lib.mjs';

ensureClone('uat_returning', 'uat_webrec', { points: 20000, phone: '0901000105' });
// Chạy lại được: xoá yêu cầu, điểm cộng và giỏ cũ của CHÍNH bản sao webrec (không đụng persona khác).
const reqs = sql(`select id from waste_requests where "userId"='uat_webrec'`);
if (Array.isArray(reqs)) {
  for (const r of reqs) {
    sql(`delete from waste_events where "requestId"='${r.id}'`);
    sql(`delete from waste_request_lines where "requestId"='${r.id}'`);
    sql(`delete from waste_requests where id='${r.id}'`);
  }
}
sql(`delete from points_transactions where "userId"='uat_webrec' and reason like 'RECYCLE%'`);
sql(`update users set "pointsBalance"=(select coalesce(sum(delta),0) from points_transactions where "userId"='uat_webrec') where id='uat_webrec'`);
await warm(['/', '/doi-rac', '/doi-rac/tao', '/doi-rac/diem-nhan', '/doi-rac/quay', '/doi-rac/yeu-cau', '/doi-rac/yeu-cau/x', '/doi-rac/xong/x']);

const share = { rows: [], n: 0 };
const F = await startFlow({ flow: '5-doi-rac', persona: 'webrec', share });
const p = F.page;
await F.firstLoad('Mở trang chủ (khách có 20.000 điểm)');
await F.tap('Bấm ô Đổi rác ở lưới lối tắt', p.getByText('Đổi rác', { exact: true }).locator('visible=true').first());
await F.tap('Bấm Đổi rác ngay', F.role('link', 'Đổi rác ngay'));
await F.tap('Bấm +5 ở Thùng carton cũ', F.text('+5'));
await F.tap('Bấm Tiếp tục', F.role('button', 'Tiếp tục'));
await F.tap('Chọn cách giao: Mang tới điểm nhận', p.getByRole('button', { name: 'Chọn Mang tới điểm nhận' }).first());
await F.tap('Bấm Chọn điểm nhận', p.getByRole('button', { name: 'Chọn điểm nhận' }).first());
await F.tap('Bấm thẻ Điểm nhận Tubu Quận 1', F.text('Điểm nhận Tubu Quận 1'));
await F.tap('Bấm Chọn điểm này', p.getByRole('button', { name: 'Chọn điểm này' }).first());
await F.tap('Tick đồng ý Thể lệ', p.getByRole('checkbox').first());
await F.tap('Bấm Tạo yêu cầu', p.getByRole('button', { name: 'Tạo yêu cầu' }).first());
const body0 = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const code = (body0.match(/TR-[A-Z0-9]{5}/) || [])[0];
await F.look(`Yêu cầu ${code}: trạng thái "Chờ bạn mang tới"`, { note: 'có Xem mã QR, Sửa món, Huỷ yêu cầu, Chat' });
const touchesCustomer = F.touches;

// Nhân viên ở điểm nhận Tubu Quận 1 (persona staff) xác nhận tại quầy.
const S = await startFlow({ flow: '5-doi-rac', persona: 'staff', path: '/doi-rac/quay', share, actor: 'nhân viên' });
const sp = S.page;
await S.firstLoad('Mở màn quầy nhận hàng');
await S.fill(`Gõ mã ${code}`, sp.getByPlaceholder('VD: TR-6NY3J'), code);
await S.tap('Bấm Tra mã', sp.getByRole('button', { name: 'Tra mã' }));
await S.tap('Bấm Xác nhận đã nhận (đủ 5 thùng)', sp.getByRole('button', { name: 'Xác nhận đã nhận' }));
await S.look('Kết quả xác nhận ở quầy');
const staffTouches = S.touches;
await S.close();

// Khách vẫn mở trang yêu cầu: chờ 12 giây xem trang có tự cập nhật không (không bấm gì).
await p.waitForTimeout(12000);
const auto = /Đã cộng/.test(await p.evaluate(() => document.body.innerText));
await F.look('Chờ 12 giây, không bấm gì: trang tự cập nhật?', { note: auto ? 'trang tự cập nhật sang Đã cộng điểm' : 'trang KHÔNG tự cập nhật, vẫn "Chờ bạn mang tới" (cần tải lại)', ok: auto });
// Khách quay lại xem: tải lại trang yêu cầu (khách không bấm), rồi về trang chủ xem điểm.
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
await F.look('Khách mở lại trang yêu cầu sau khi quầy xác nhận (tải lại)', { note: 'xem trạng thái và điểm cộng' });
await F.tap('Bấm Xem kết quả cộng điểm', p.getByRole('link', { name: /Xem kết quả/ }).first());
await F.look('Màn kết quả cộng điểm', { note: 'khách thấy điểm cộng' });
await F.tap('Bấm Quay lại (về yêu cầu)', p.getByRole('button', { name: 'Quay lại' }).first());
await F.tap('Bấm Quay lại (về Đổi rác lấy quà)', p.getByRole('button', { name: 'Quay lại' }).first());
await F.look('Trang Đổi rác lấy quà: số điểm hiện tại', { note: 'xem Điểm Xanh của bạn' });
const body = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const out = F.save({ requestCode: code, touchesCustomer, staffTouches, finalTouches: F.touches, bodyHead: body.slice(0, 300) });
console.log(fmtTable(out));
console.log('mã', code, 'chạm khách tới lúc tạo xong', touchesCustomer, 'chạm NV', staffTouches, 'chạm khách tổng', F.touches);
await F.close();
