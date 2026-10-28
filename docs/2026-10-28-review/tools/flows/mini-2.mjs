// Luồng 2: khách quay lại tìm theo từ khoá, mở sản phẩm, chọn phân loại, thêm giỏ, áp mã, thanh toán COD tới màn đặt thành công.
// Thiết lập: xoá giỏ của persona returning (giỏ mẫu 2 dòng) và các lượt dùng mã trước đó để mỗi lần chạy giống nhau (WELCOME30 dùng lại được).
import fs from 'node:fs';
import path from 'node:path';
import { Flow, run, sqlTry } from './_lib.mjs';

console.log(sqlTry(`DELETE FROM coupon_redemptions WHERE "userId"='uat_returning'`));
console.log(sqlTry(`DELETE FROM cart_items WHERE "cartId" IN (SELECT id FROM carts WHERE "userId"='uat_returning')`));

const f = await Flow.start('2-tim-va-mua', 'returning');
await run(f, async () => {
  const p = f.page;
  await f.step('Trang chủ (khách quay lại)', null);
  await f.step('Chạm ô tìm kiếm', () => f.tap('Bạn đang tìm gì hôm nay?'));
  await f.step('Gõ từ khoá "nước rửa chén"', () => f.fill(p.getByPlaceholder('Tìm sản phẩm'), 'nước rửa chén', 'tìm kiếm'));
  await f.step('Xem kết quả tìm kiếm', null);
  await f.step('Mở sản phẩm từ kết quả', () => f.tap(/^Nước rửa chén sinh học Fuwa3e/));
  await f.step('Chọn phân loại Can 5L', async () => {
    const y = await p.getByText('Can 5L', { exact: true }).first().evaluate((e) => Math.round(e.getBoundingClientRect().top));
    f.note(`Phân loại "Can 5L" nằm cách mép trên màn ${y}px khi mới mở sản phẩm (khung nhìn cao 812px, thanh đáy cao ~96px): ${y > 716 ? 'dưới màn hình đầu, khách phải cuộn' : 'trong màn hình đầu'}`);
    await f.tap('Can 5L');
  });
  await f.step('Thêm vào giỏ', () => f.tap('Thêm vào giỏ'), { note: 'ảnh chụp ngay sau chạm: có báo "đã thêm" không' });
  await f.step('Xem giỏ hàng', () => f.tap('Xem giỏ hàng'));
  await f.step('Mở chọn mã giảm giá', () => f.tap('Chọn mã'));
  let used = 'không có mã dùng được';
  await f.step('Dùng mã giảm giá', async () => {
    const btn = p.getByRole('button', { name: 'Dùng mã' }).first();
    if (await btn.count()) {
      await f.tapLoc(btn, 'Dùng mã');
      used = 'đã dùng mã đầu tiên';
    } else {
      await f.tap('Đóng');
    }
  });
  f.note('Mã: ' + used);
  await f.step('Thanh toán', () => f.tap(/^Thanh toán \(/));
  await f.step('Màn thanh toán: COD đã chọn sẵn, không chạm', null, { note: 'kiểm tra địa chỉ mặc định, phương thức mặc định' });
  await f.step('Đặt hàng', () => f.tap(/^Đặt hàng/));
  const txt = await p.evaluate(() => document.body.innerText);
  const code = (txt.match(/TUBU\d{13}/) || [])[0];
  f.note('Mã đơn: ' + code);
  fs.writeFileSync(path.join(f.dir, 'order.json'), JSON.stringify({ code }));
  await f.step('Màn đặt thành công', null, { note: 'mã đơn ' + code });
});
