// Luồng 6: CTV/đại lý. (A) khách new đăng ký CTV; (B) persona ctv xem gian hàng, chia sẻ, hoa hồng, Ví Tubu; (C) persona dealer vào trang đại lý.
// Thiết lập (SQL lane 6): đưa uat_new về CUSTOMER và xoá gian hàng/link CTV của uat_new; hiện lại màn chào.
import { Flow, run, sqlTry, resetOnboarding } from './_lib.mjs';

const U = `'uat_new'`;
resetOnboarding('uat_new');
sqlTry(`DELETE FROM affiliate_links WHERE "userId"=${U}`);
sqlTry(`DELETE FROM storefront_items WHERE "storefrontId" IN (SELECT id FROM storefronts WHERE "ownerUserId"=${U})`);
sqlTry(`DELETE FROM storefront_collections WHERE "storefrontId" IN (SELECT id FROM storefronts WHERE "ownerUserId"=${U})`);
console.log(sqlTry(`DELETE FROM storefronts WHERE "ownerUserId"=${U}`));
console.log(sqlTry(`UPDATE users SET role='CUSTOMER' WHERE id=${U}`));

// ---------- A. khách đăng ký CTV ----------
{
  const f = await Flow.start('6a-ctv-khach-dang-ky', 'new');
  await run(f, async () => {
    const p = f.page;
    await f.step('Mở app (khách mới, màn chào)', null);
    await f.step('Bỏ qua màn chào (Để sau)', () => f.tap('Để sau'));
    await f.step('Chạm Kiếm tiền ở trang chủ', () => f.tap('Kiếm tiền cùng Tubu'));
    await f.step('Chạm Cộng tác viên', () => f.tap('Cộng tác viên'));
    await f.step('Trang giới thiệu CTV (cuộn tới điều khoản)', async () => { await f.scroll(1400); }, { note: 'điều khoản dài, nút đăng ký nằm dưới cùng' });
    await f.step('Tick đồng ý điều khoản', () => f.tapLoc(p.getByText(/^Tôi đã đọc và đồng ý/).first(), 'đồng ý điều khoản'));
    await f.step('Chạm Đăng ký miễn phí ngay', () => f.tap('Đăng ký miễn phí ngay'));
    await f.step('Sau khi đăng ký: trang tổng quan CTV', null, { note: 'khách vừa thành CTV thấy gì tiếp theo' });
    f.note('Ngay sau đăng ký, trang có lối Học viện CTV: ' + ((await p.getByRole('button', { name: 'Học viện CTV' }).count()) ? 'CÓ' : 'KHÔNG (GET /academy/courses trả 403 vì phiên chưa nhận vai trò mới; nạp lại trang thì có)'));
    await f.step('Chạm Gian hàng (CTV mới)', () => f.tap('Gian hàng của tôi'), { note: 'CTV mới mở gian hàng lần đầu thấy gì' });
    f.note('Gian hàng đã được tạo cùng lúc? ' + JSON.stringify(sqlTry(`SELECT slug FROM storefronts WHERE "ownerUserId"=${U}`)));
  });
}

// ---------- B. CTV ----------
{
  const f = await Flow.start('6b-ctv-gian-hang-chia-se-hoa-hong', 'ctv');
  await run(f, async () => {
    const p = f.page;
    await f.step('Trang chủ của CTV', null);
    await f.step('Chạm Kiếm tiền', () => f.tap('Kiếm tiền cùng Tubu'));
    await f.step('Chạm Cộng tác viên', () => f.tap('Cộng tác viên'));
    await f.step('Tổng quan CTV: hoa hồng, bậc, nút nhanh', null);
    await f.step('Chạm Gian hàng', () => f.tap('Gian hàng của tôi'));
    await f.step('Gian hàng của tôi', null, { note: 'sửa, ghim, ẩn, xoá sản phẩm; ba biểu tượng không chữ trên mỗi sản phẩm' });
    await f.step('Chạm Chia sẻ gian hàng', () => f.tap('Chia sẻ gian hàng'));
    await f.step('Sheet Chia sẻ gian hàng: QR, link, lời đăng gợi ý', null);
    await f.step('Chạm Chia sẻ qua Zalo', () => f.tap('Chia sẻ qua Zalo'));
    f.note('Lệnh zmp-sdk đã gọi: ' + JSON.stringify((await f.s.zmpCalls()).map((c) => c.name)));
    await f.step('Sau khi Chia sẻ qua Zalo', null, { note: 'openShareSheet được giả' });
    await f.step('Đóng sheet chia sẻ', () => f.tap('Đóng'));
    await f.step('Quay lại tổng quan CTV', () => f.tap('Quay lại'));
    await f.step('Chạm Chia sẻ link và mã giới thiệu', () => f.tap('Chia sẻ link và mã giới thiệu'));
    await f.step('Sau khi chạm Chia sẻ link', null);
    await f.step('Cuộn xem lịch sử hoa hồng', async () => { await f.scroll(1200); });
    await f.scroll(-3000);
    const toWallet = p.getByRole('button', { name: 'Chuyển vào Ví Tubu' });
    const disabled = await toWallet.first().isDisabled().catch(() => null);
    f.note(`Nút Chuyển vào Ví Tubu khi hoa hồng có thể chuyển = 0đ: ${disabled ? 'bị khoá (disabled)' : 'bấm được'}`);
    await f.step('Chạm Chuyển vào Ví Tubu (0đ có thể chuyển)', async () => {
      if (disabled) { await toWallet.first().click({ force: true, timeout: 3000 }).catch(() => undefined); f.taps += 1; f.tapLog.push('Chuyển vào Ví Tubu (nút khoá)'); }
      else await f.tapLoc(toWallet.first(), 'Chuyển vào Ví Tubu');
    }, { note: disabled ? 'nút khoá, chạm không có phản hồi; không có chữ giải thích' : '' });
    await f.step('Mở Ví Tubu qua Cá nhân', async () => { await f.s.goto('/'); await f.tap(/^Cá nhân/); await f.tapLoc(p.getByText(/^Ví Tubu/).first(), 'Ví Tubu'); });
    await f.step('Màn Ví Tubu', null, { note: 'hoa hồng vào Ví, không có rút về ngân hàng (đã chốt)' });
  });
}

// ---------- C. đại lý ----------
{
  const f = await Flow.start('6c-dai-ly-trang-dai-ly', 'dealer');
  await run(f, async () => {
    const p = f.page;
    await f.step('Trang chủ của đại lý', null);
    await f.step('Chạm Kiếm tiền', () => f.tap('Kiếm tiền cùng Tubu'));
    await f.step('Sheet Kiếm tiền cùng Tubu: lối vào đại lý', null, { note: 'sheet có mục Đại lý hay Kênh đại lý' });
    await f.step('Chạm Kênh đại lý/Đại lý', async () => {
      const k = p.getByText(/^(Kênh đại lý|Đại lý)$/).first();
      await f.tapLoc(k, 'Đại lý');
    });
    await f.step('Trang Kênh đại lý: bảng giá sỉ', null);
    await f.step('Chạm tab Công nợ', () => f.tap('Công nợ'));
    await f.step('Tab Công nợ', null);
    await f.step('Chạm tab Đơn hàng', () => f.tap('Đơn hàng'));
    await f.step('Tab Đơn hàng', null);
    await f.step('Chạm tab Báo cáo', () => f.tap('Báo cáo'));
    await f.step('Tab Báo cáo', null);
  });
}
