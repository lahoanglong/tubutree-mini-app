// Nạp dữ liệu cho luồng 6: một khách (bản sao webbuy của returning) mua COD và nhập mã giới thiệu UATCTV ở bước thanh toán,
// để persona ctv có hoa hồng "đang chờ" khi xem. Bấm như người dùng; chạy trước web-6.mjs.
import { startFlow, warm, sql, ensureClone, sh, H, LANE } from './flow-lib.mjs';

ensureClone('uat_returning', 'uat_webbuy', { points: 0, phone: '0901000107' });
sql(`delete from cart_items where "cartId" in (select id from carts where "userId"='uat_webbuy')`);
await warm(['/san-pham/hat-dieu-rang-moc-bhnong', '/gio-hang', '/thanh-toan']);
const F = await startFlow({ flow: '_seed-ctv-order', persona: 'webbuy', path: '/san-pham/hat-dieu-rang-moc-bhnong' });
const p = F.page;
await F.firstLoad('PDP hạt điều');
await F.tap('Thêm vào giỏ', F.role('button', 'Thêm vào giỏ'));
await F.tap('Xem giỏ', p.getByRole('link', { name: /Xem giỏ hàng/ }).first());
await F.tap('Thanh toán', p.getByRole('link', { name: /Thanh toán/ }).first());
await F.tap('Mở Mã người giới thiệu', p.getByRole('button', { name: /Mã người giới thiệu/ }).first());
await F.fill('Gõ mã UATCTV', p.getByPlaceholder('Nhập mã người giới thiệu'), 'UATCTV');
await F.tap('Áp dụng mã giới thiệu', p.getByRole('button', { name: 'Áp dụng', exact: true }).first());
await F.look('Sau khi áp dụng mã giới thiệu');
await F.tap('Đặt hàng', p.getByRole('button', { name: /^Đặt hàng/ }));
await F.look('Đặt xong');
const code = ((await p.evaluate(() => document.body.innerText)).match(/TUBU\d{6,}/) || [])[0];
await F.close();
// Giao thành công để hoa hồng chuyển sang "đang giữ" (phía vận chuyển, không phải chạm của khách).
for (const st of ['packed', 'shipped', 'delivered']) sh('node', [`${H}/pancake-webhook.mjs`, String(LANE), code, st]);
console.log('đơn mua qua mã UATCTV:', code);
