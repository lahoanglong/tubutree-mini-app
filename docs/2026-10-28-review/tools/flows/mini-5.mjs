// Luồng 5: đổi rác lấy quà. Ba phiên liên tiếp: (A) khách new đăng ký gửi 5 thùng carton tới điểm nhận,
// (B) nhân viên quầy (persona staff) tra mã/quét mã và xác nhận đã nhận, (C) khách new xem lại trạng thái và điểm cộng.
// Thiết lập (SQL lane 6): xoá yêu cầu đổi rác và dòng điểm RECYCLE của uat_new để chạy lại được.
import fs from 'node:fs';
import path from 'node:path';
import { Flow, run, sql, sqlTry, R, resetOnboarding } from './_lib.mjs';

const U = `'uat_new'`;
resetOnboarding('uat_new');
sqlTry(`DELETE FROM waste_events WHERE "requestId" IN (SELECT id FROM waste_requests WHERE "userId"=${U})`);
console.log(sqlTry(`DELETE FROM waste_requests WHERE "userId"=${U}`));
sqlTry(`DELETE FROM points_transactions WHERE "userId"=${U} AND reason LIKE 'RECYCLE:%'`);
sqlTry(`UPDATE users SET "pointsBalance"=(SELECT COALESCE(SUM(delta),0) FROM points_transactions WHERE "userId"=${U}) WHERE id=${U}`);
const bal = () => sql(`SELECT "pointsBalance"::int AS b FROM users WHERE id=${U}`)[0].b;
const before = bal();
let code = null;

// ---------- A. khách ----------
{
  const f = await Flow.start('5a-doi-rac-khach-dang-ky', 'new');
  await run(f, async () => {
    const p = f.page;
    await f.step('Mở app (khách mới, màn chào)', null);
    await f.step('Bỏ qua màn chào (Để sau)', () => f.tap('Để sau'), { note: 'chỉ khách mới lần đầu mới gặp' });
    await f.step('Chạm Đổi rác ở trang chủ', () => f.tap('Đổi rác lấy quà'));
    await f.step('Màn Đổi rác lấy quà', null);
    await f.step('Chạm Đổi rác ngay', () => f.tap('Đổi rác ngay'));
    await f.step('Thêm 5 thùng carton', () => f.tapLoc(p.getByRole('button', { name: 'Thêm 5' }).first(), '+5 thùng carton'));
    await f.step('Chạm Tiếp tục', () => f.tap('Tiếp tục'));
    await f.step('Chọn cách giao: Mang tới điểm nhận', () => f.tap(/^Mang tới điểm nhận/));
    await f.step('Chạm Chọn điểm nhận', () => f.tap('Chọn điểm nhận'));
    await f.step('Chọn điểm Tubu Quận 1', () => f.tap(/^Điểm nhận Tubu Quận 1/));
    await f.step('Chạm Chọn điểm này', () => f.tap('Chọn điểm này'));
    await f.step('Tick đồng ý Thể lệ', () => f.tapLoc(p.getByText('Tôi đồng ý với Thể lệ', { exact: false }).first(), 'đồng ý Thể lệ'));
    await f.step('Chạm Tạo yêu cầu', () => f.tap('Tạo yêu cầu'));
    code = (await p.evaluate(() => document.body.innerText)).match(/TR-[A-Z0-9]{5}/)?.[0] ?? null;
    f.note('Mã yêu cầu: ' + code);
    fs.writeFileSync(path.join(f.dir, 'request.json'), JSON.stringify({ code }));
    await f.step('Màn chi tiết yêu cầu vừa tạo', null, { note: `mã ${code}` });
    await f.step('Chạm Xem mã QR', () => f.tap('Xem mã QR'));
    await f.step('Màn mã QR để đưa cho nhân viên', null);
  });
}

// ---------- B. nhân viên ----------
if (code) {
  const f = await Flow.start('5b-doi-rac-nhan-vien-xac-nhan', 'staff');
  await run(f, async () => {
    const p = f.page;
    await f.step('Trang chủ của nhân viên', null, { note: 'trang chủ không có lối vào quầy; phải qua Đổi rác lấy quà' });
    if (await p.getByRole('button', { name: 'Để sau' }).count()) await p.getByRole('button', { name: 'Để sau' }).click();
    await f.step('Chạm Đổi rác ở trang chủ', () => f.tap('Đổi rác lấy quà'));
    await f.step('Chạm Nhận hàng tại điểm', () => f.tap(/^Nhận hàng tại điểm/));
    await f.step('Màn quầy nhận hàng', null);
    await f.s.setQr(code);
    await f.step('Chạm Quét mã của khách (mã giả lập từ QR của khách)', () => f.tap('Quét mã của khách'));
    let shown = await p.getByText(code).count();
    if (!shown) {
      f.note('Quét mã không ra yêu cầu; thử gõ mã tay');
      await f.step('Gõ mã yêu cầu', () => f.fill(p.getByPlaceholder(/TR-/), code, 'mã yêu cầu'));
      await f.step('Chạm Tra mã', () => f.tap('Tra mã'));
    }
    await f.step('Kết quả tra mã: món khách khai', null);
    await f.step('Chạm Xác nhận đã nhận', () => f.tap('Xác nhận đã nhận'));
    await f.step('Sau khi xác nhận', null);
    const dlg = p.getByRole('button', { name: /^(Xác nhận|Đồng ý|Cộng điểm)/ });
    if (await dlg.count()) {
      f.note('Có hộp xác nhận thứ hai: ' + (await dlg.first().textContent()));
      await f.step('Xác nhận lần hai', () => f.tapLoc(dlg.first(), 'Xác nhận lần hai'));
    }
  });
}

// ---------- C. khách xem điểm ----------
if (code) {
  const f = await Flow.start('5c-doi-rac-khach-thay-diem', 'new');
  await run(f, async () => {
    const p = f.page;
    if (await p.getByRole('button', { name: 'Để sau' }).count()) await p.getByRole('button', { name: 'Để sau' }).click();
    await f.step('Trang chủ (khách mở lại app)', null, { note: 'màn chào đã đóng bằng Để sau, không tính chạm vì trình duyệt mới' });
    await f.step('Chạm Đổi rác ở trang chủ', () => f.tap('Đổi rác lấy quà'));
    await f.step('Màn Đổi rác: điểm và yêu cầu', null, { note: 'điểm cộng có hiện ngay không' });
    f.note('Yêu cầu đã xong biến mất khỏi mục "Yêu cầu đang xử lý" ở màn này: ' + ((await p.getByText(code).count()) ? 'vẫn còn' : 'đúng, không còn'));
    await f.step('Chạm biểu tượng đồng hồ (Yêu cầu của tôi)', () => f.tap('Yêu cầu của tôi'));
    await f.step('Danh sách yêu cầu của tôi (tab Đang xử lý trống)', null, { note: 'tab mặc định Đang xử lý 0: màn trống, không có câu giải thích' });
    await f.step('Chạm tab Đã đóng', () => f.tapLoc(p.getByText(/^Đã đóng/).first(), 'tab Đã đóng'));
    await f.step('Mở yêu cầu vừa được xác nhận', () => f.tapLoc(p.getByText(code).first(), `yêu cầu ${code}`));
    await f.step('Chi tiết yêu cầu: đã đếm, điểm cộng', null);
    await f.step('Chạm chuông Thông báo (từ trang chủ)', async () => { await f.s.goto('/'); await f.tap('Thông báo'); });
    await f.step('Thông báo: có báo điểm đổi rác?', null);
  });
}
console.log('Điểm Xanh của khách: trước', before, '-> sau', bal());
fs.writeFileSync(path.join(R, 'screens/flows/mini/5-points.json'), JSON.stringify({ code, before, after: bal() }));
