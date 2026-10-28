// Luồng 6: CTV và đại lý (375). Ba phiên: khách mới đăng ký CTV (bản sao webnew6), persona ctv, persona dealer.
// Cần seed-ctv-order.mjs đã chạy một lần để ctv có hoa hồng. Chạy từ gốc worktree.
import { startFlow, warm, sql, ensureClone, fmtTable } from './flow-lib.mjs';

ensureClone('uat_new', 'uat_webnew6', { phone: '0901000106' });
sql(`update users set role='CUSTOMER', metadata = coalesce(metadata,'{}'::jsonb) - 'affiliateTerms' where id='uat_webnew6'`);
await warm(['/', '/ctv', '/ctv/gian-hang', '/dai-ly', '/tai-khoan', '/tai-khoan/vi-tubu']);

const share = { rows: [], n: 0 };
const res = {};
async function sheetOpen(F, p, label) {
  await F.tap('Bấm Kiếm tiền (lưới lối tắt)', p.getByText('Kiếm tiền', { exact: true }).locator('visible=true').first());
  await p.waitForTimeout(500);
}
async function skipOnboarding(F, p) {
  const el = p.getByText('Để sau', { exact: true }).locator('visible=true').first();
  if (await el.count()) await F.tap('Bấm Để sau ở màn chào', el);
}

// A. Khách mới đăng ký CTV
const A = await startFlow({ flow: '6-ctv-dai-ly', persona: 'webnew6', share, actor: 'khách mới' });
let p = A.page;
await A.firstLoad('Mở trang chủ (khách mới)');
await skipOnboarding(A, p);
await sheetOpen(A, p);
await A.look('Hộp Kiếm tiền cùng Tubu: Cộng tác viên / Học viện / Đại lý');
await A.tap('Bấm Cộng tác viên', A.text('Cộng tác viên'));
await A.look('Màn Trở thành CTV Tubu (điều khoản, ô đồng ý)', { note: 'phải tick ô đồng ý mới bấm được Đăng ký' });
await A.tap('Tick ô đồng ý điều khoản hoa hồng và thuế', p.getByRole('checkbox').first());
await A.tap('Bấm Đăng ký miễn phí ngay', p.getByRole('button', { name: /Đăng ký miễn phí ngay/ }));
await A.look('Sau khi đăng ký: bảng CTV (hoa hồng 0đ, chưa có link)');
await A.tap('Bấm Gian hàng', p.getByRole('link', { name: 'Gian hàng' }).first());
await A.look('Gian hàng của CTV mới');
res.touchesA = A.touches;
await A.close();

// B. CTV đã duyệt
const B = await startFlow({ flow: '6-ctv-dai-ly', persona: 'ctv', share, actor: 'CTV' });
p = B.page;
await B.firstLoad('Mở trang chủ (CTV)');
await skipOnboarding(B, p);
await sheetOpen(B, p);
await B.tap('Bấm Cộng tác viên', B.text('Cộng tác viên'));
await B.look('Bảng CTV: hoa hồng tháng này, đang chờ, bậc', { note: 'có đơn mua qua mã UATCTV, hoa hồng đang chờ' });
await B.tap('Bấm ô Chia sẻ (đầu trang)', p.getByRole('button', { name: 'Chia sẻ', exact: true }).first());
await B.look('Sau khi bấm Chia sẻ', { note: 'trang chỉ cuộn xuống thẻ Mã giới thiệu, ở đó lại có nút Chia sẻ thứ hai' });
const close = p.getByRole('button', { name: /Đóng|Huỷ/ }).first();
if (await close.count()) await B.tap('Đóng hộp chia sẻ', close);
await p.evaluate(() => window.scrollTo(0, 0));
await p.waitForTimeout(300);
const wallet = p.getByRole('button', { name: 'Chuyển vào Ví' }).first();
const dis = await wallet.isDisabled().catch(() => false);
await B.look('Ô Chuyển vào Ví ở đầu trang', { note: dis ? 'ô mờ (disabled): bấm không được, không chữ nào nói vì sao (chỉ có "Có thể chuyển vào Ví 0đ")' : 'ô bấm được' });
if (!dis) await B.tap('Bấm Chuyển vào Ví', wallet);
await B.tap('Bấm Gian hàng', p.getByRole('link', { name: 'Gian hàng' }).first());
await B.look('Gian hàng của tôi (thống kê 30 ngày, hành trình)');
res.touchesB = B.touches;
await B.close();

// B2. CTV tìm Ví Tubu qua tab Cá nhân
const B2 = await startFlow({ flow: '6-ctv-dai-ly', persona: 'ctv', share, actor: 'CTV' });
p = B2.page;
await B2.firstLoad('Mở lại trang chủ để tìm Ví Tubu');
await skipOnboarding(B2, p);
await B2.tap('Bấm tab Cá nhân', p.getByRole('link', { name: 'Cá nhân' }).locator('visible=true').first());
await B2.tap('Bấm Ví Tubu', p.getByText('Ví Tubu', { exact: true }).locator('visible=true').first());
await B2.look('Ví Tubu (số dư, hoa hồng chờ duyệt, lịch sử)');
res.touchesB2 = B2.touches;
await B2.close();

// C. Đại lý
const C = await startFlow({ flow: '6-ctv-dai-ly', persona: 'dealer', share, actor: 'đại lý' });
p = C.page;
await C.firstLoad('Mở trang chủ (đại lý)');
await skipOnboarding(C, p);
await sheetOpen(C, p);
await C.tap('Bấm Đại lý', C.text('Đại lý'));
await C.look('Kênh đại lý: bậc, công nợ, hạn mức, bảng giá');
await C.tap('Bấm tab Đơn hàng', C.text('Đơn hàng'));
await C.look('Tab Đơn hàng');
await C.tap('Bấm tab Công nợ', C.text('Công nợ'));
await C.look('Tab Công nợ');
await C.tap('Bấm tab Báo cáo', C.text('Báo cáo'));
await C.look('Tab Báo cáo');
await C.tap('Bấm tab Bảng giá', C.text('Bảng giá'));
await C.tap('Bấm Dán đơn (ở tab Bảng giá)', p.getByRole('button', { name: 'Dán đơn' }).locator('visible=true').first());
await C.look('Sau khi bấm Dán đơn');
res.touchesC = C.touches;
await C.close();

const out = { flow: '6-ctv-dai-ly', rows: share.rows, ...res };
(await import('node:fs')).writeFileSync((await import('./flow-lib.mjs')).R + '/screens/flows/web/6-ctv-dai-ly/results.json', JSON.stringify(out, null, 2));
console.log(fmtTable(out));
console.log(JSON.stringify(res));
