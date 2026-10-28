// Thêm cho luồng 2 và 4: màn Thanh toán và Cá nhân ở khổ 1280 (bản sao webret). Chạy từ gốc worktree.
import { startFlow, warm, sql, ensureClone, fmtTable, DESK } from './flow-lib.mjs';

ensureClone('uat_returning', 'uat_webret', { points: 45400, phone: '0901000103' });
sql(`delete from cart_items where "cartId" in (select id from carts where "userId"='uat_webret')`);
await warm(['/', '/san-pham/nuoc-rua-chen-fuwa3e', '/gio-hang', '/thanh-toan', '/tai-khoan']);
const F = await startFlow({ flow: 'desk-1280', persona: 'webret', viewport: DESK, path: '/san-pham/nuoc-rua-chen-fuwa3e' });
const p = F.page;
await F.firstLoad('PDP ở 1280');
await F.tap('Bấm Thêm vào giỏ', p.getByRole('button', { name: /^Thêm vào giỏ/ }).locator('visible=true').first());
await F.tap('Mở giỏ (Xem giỏ hàng)', p.getByRole('link', { name: /Xem giỏ hàng/ }).first());
await F.look('Giỏ hàng ở 1280');
await F.tap('Bấm Thanh toán', p.getByRole('link', { name: /Thanh toán/ }).first());
await F.look('Màn Thanh toán ở 1280', { note: 'xem bố cục, nút Đặt hàng, tóm tắt đơn' });
await F.tap('Bấm ô tên (N Lại) trên thanh đầu trang', p.locator('a[href="/tai-khoan"]').locator('visible=true').first());
await F.look('Màn Cá nhân ở 1280');
const out = F.save({});
console.log(fmtTable(out));
await F.close();
