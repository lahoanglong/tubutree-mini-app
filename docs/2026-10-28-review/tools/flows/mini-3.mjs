// Luồng 3: theo dõi đơn vừa đặt (luồng 2) và mua lại. Cần chạy mini-2.mjs trước (đọc mã đơn từ order.json).
import fs from 'node:fs';
import path from 'node:path';
import { Flow, run, R, sqlTry } from './_lib.mjs';

const order = JSON.parse(fs.readFileSync(path.join(R, 'screens/flows/mini/2-tim-va-mua/order.json'), 'utf8')).code;
const DELIVERED = JSON.parse(fs.readFileSync(path.join(R, 'tools/params-l6.json'), 'utf8')).orderCode;
console.log(sqlTry(`DELETE FROM cart_items WHERE "cartId" IN (SELECT id FROM carts WHERE "userId"='uat_returning')`));

const f = await Flow.start('3-theo-doi-don-mua-lai', 'returning');
await run(f, async () => {
  const p = f.page;
  await f.step('Trang chủ (có đơn vừa đặt)', null, { note: 'trang chủ có chỗ nào nói về đơn đang giao không' });
  f.note('Chữ về đơn ở trang chủ: ' + ((await p.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '))).match(/[^|]*đơn[^|]*/gi) || []).slice(0, 5).join(' // '));
  await f.step('Chạm tab Cá nhân', () => f.tap(/^Cá nhân/), { note: 'trang chủ không nhắc đơn vừa đặt (chỉ có thẻ đơn đang giao/chờ chuyển khoản)' });
  await f.step('Chạm Xem tất cả đơn hàng', () => f.tap('Xem tất cả đơn hàng'));
  await f.step('Tìm đơn vừa đặt trong danh sách', null, { note: `đơn ${order}: ${(await p.getByText(order).count()) ? 'thấy ngay ở đầu danh sách' : 'KHÔNG thấy'}` });
  await f.step('Mở chi tiết đơn vừa đặt', () => f.tap(`Đơn ${order}`));
  const txt = await p.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));
  f.note(`Chi tiết đơn có chữ "dự kiến": ${/dự kiến/i.test(txt) ? 'CÓ' : 'KHÔNG'}; có "Hành trình đơn hàng": ${/Hành trình/.test(txt) ? 'CÓ' : 'KHÔNG'}; có nút Mua lại: ${/Mua lại/.test(txt) ? 'CÓ' : 'KHÔNG'}`);
  await f.step('Xem dòng thời gian (cuộn xuống)', async () => { await f.scroll(500); }, { note: 'mốc có giờ, mốc dự kiến giao' });
  await f.step('Quay lại danh sách đơn', () => f.tap('Quay lại'));
  await f.step('Chạm Mua lại ở đơn đã giao', async () => {
    const card = p.getByRole('button', { name: `Đơn ${DELIVERED}` });
    await f.tapLoc(p.getByRole('button', { name: 'Mua lại' }).first(), 'Mua lại (thẻ đơn đã giao)');
  }, { note: `đơn đã giao ${DELIVERED}` });
  await f.step('Thêm các món vào giỏ', () => f.tap(/^Thêm vào giỏ \(/));
  const cartTxt = await p.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 300));
  f.note('Sau Thêm vào giỏ: ' + cartTxt);
  if (!/Giỏ hàng/.test(cartTxt)) {
    await f.step('Mở giỏ hàng', () => f.tap('Giỏ hàng', { nth: 0 }));
  }
  await f.step('Giỏ hàng sau mua lại', null);
  // Thử thêm (không tính vào tổng chạm): thẻ "đơn đang giao" ở trang chủ có dẫn tới đơn vừa đặt không.
  const taps = f.taps;
  await f.s.goto('/');
  const card = p.getByRole('button', { name: /đơn đang giao/ }).first();
  const has = await card.count();
  if (has) {
    await card.click();
    await f.step('(Thử thêm, không tính) Thẻ "đơn đang giao" ở trang chủ', null, { note: `đích ${new URL(p.url()).pathname}${new URL(p.url()).search}; có đơn vừa đặt ${order}: ${(await p.getByText(order).count()) ? 'CÓ' : 'KHÔNG (đơn vừa đặt đang Đã xác nhận, chưa giao)'}` });
  } else f.note('Trang chủ không có thẻ đơn đang giao lúc này');
  f.taps = taps;
});
