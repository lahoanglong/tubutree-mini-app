// Luồng 2: tìm và mua (returning, 375): tìm từ khoá, mở SP, chọn phân loại, thêm giỏ, áp mã, thanh toán COD.
// Chạy: node docs/2026-10-28-review/tools/flows/web-2.mjs   (từ gốc worktree, lane 6 đang chạy)
import { startFlow, warm, sql, fmtTable, ensureClone } from './flow-lib.mjs';

await warm(['/', '/san-pham', '/san-pham/nuoc-rua-chen-fuwa3e', '/gio-hang', '/thanh-toan', '/tai-khoan/don-hang']);
// Lane 6 dùng chung với agent khác: dùng bản sao webret của persona returning (Lộc Biếc, 45.400 điểm, địa chỉ mặc định).
ensureClone('uat_returning', 'uat_webret', { points: 45400, phone: '0901000103' });
// Giỏ rỗng để chạy lại được (giỏ lưu ở server).
sql(`delete from cart_items where "cartId" in (select id from carts where "userId"='uat_webret')`);

const F = await startFlow({ flow: '2-tim-mua', persona: 'webret' });
const p = F.page;
await F.firstLoad('Mở trang chủ (đã đăng nhập, Lộc Biếc)');
await F.tap('Chạm ô tìm kiếm "Bạn đang tìm gì hôm nay?"', F.text('Bạn đang tìm gì hôm nay?'));
await F.fill('Gõ "nước rửa chén"', p.locator('input:visible').first(), 'nước rửa chén', { note: 'chưa có gợi ý, chữ báo "nhấn Tìm để xem kết quả"' });
await F.press('Bấm Enter (Tìm trên bàn phím)', 'Enter', { note: 'trang không có nút Tìm' });
await F.tap('Mở "Nước rửa chén sinh học Fuwa3e"', F.text('Nước rửa chén sinh học Fuwa3e'));
await F.tap('Chọn phân loại "Can 5L"', F.text('Can 5L · 430.000đ'));
await F.tap('Bấm Thêm vào giỏ', F.role('button', 'Thêm vào giỏ'));
await F.tap('Bấm "Xem giỏ hàng →" trong thông báo', p.getByRole('link', { name: /Xem giỏ hàng/ }).first());
await F.tap('Mở ô Mã giảm giá', p.getByRole('button', { name: /Mã giảm giá/ }).first());
await F.tap('Chọn mã XANH10 (Dùng mã)', p.getByRole('button', { name: 'Dùng mã' }).first());
await F.tap('Bấm Thanh toán', p.getByRole('link', { name: /Thanh toán/ }).first());

const cod = p.getByRole('radio').first();
const codChecked = await cod.isChecked().catch(() => false);
await F.look('Màn thanh toán (xem phương thức mặc định)', { note: codChecked ? 'COD đã chọn sẵn' : 'COD chưa chọn sẵn' });
if (!codChecked) await F.tap('Chọn COD', p.getByText('Thanh toán khi nhận hàng (COD)', { exact: true }).locator('visible=true').first());
await F.tap('Bấm Đặt hàng', p.getByRole('button', { name: /^Đặt hàng/ }));
await p.waitForURL(/thanh-cong|dat-hang|don-hang|thanh-toan\/.+/, { timeout: 8000 }).catch(() => undefined);
await F.look('Màn đặt thành công');
const body = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const code = (body.match(/TUBU\d{6,}/) || [])[0] || null;
const touchesAtSuccess = F.touches;
// Ngoài luồng: thử nút "Theo dõi đơn" ở màn thành công (dùng cho luồng 3).
await F.tap('(ngoài luồng) Bấm Theo dõi đơn ở màn thành công', F.role('button', 'Theo dõi đơn'));
const out = F.save({ orderCode: code, touchesAtSuccess, bodyHead: body.slice(0, 400) });
console.log(fmtTable(out));
console.log('orderCode', code, 'chạm tới thành công', touchesAtSuccess);
await F.close();
