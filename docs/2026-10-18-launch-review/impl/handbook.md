# Gói handbook: sổ tay vận hành

Nhánh `lr/handbook`. Chỉ tài liệu, không sửa mã, không chạy test. Viết theo mã tại nhánh `review/2026-10-18-launch`.

## Đã làm (D1-09; dấu ⏳ cho D1-01..08, 10..18, 20, 21)
`docs/launch/so-tay-van-hanh/`: README (bản đồ, ranh giới Tubu và Pancake, 10 quy tắc vàng), admin, cskh, kho, marketing, dai-ly-ctv, ke-toan. Mỗi file 77 đến 103 dòng. Mỗi vai trò có đầu ca, trong ca, cuối ca, hằng tuần, xử lý tình huống.
Kiểm chứng: tên tab, nút, hộp xác nhận đối chiếu `page.tsx`, `components/admin/*`, `miniapp/src/i18n/vi.ts`; quyền KHO/CSKH đối chiếu `@AllowStaff`; số mặc định đối chiếu `prisma/seed.ts`. Chưa mở UI thật.

## "(cần xác nhận)": 19 chỗ, hỏi chủ shop hoặc kỹ thuật
- Email báo động, đăng nhập Zalo trên web đã cài chưa (admin).
- Chat khách dùng công cụ nào; hãng vận chuyển có đổi địa chỉ khi đã nhận hàng; khách không dùng app; ngoại lệ quá hạn đổi/trả (cskh).
- Có cho tạo đơn tay trên Pancake khi khách gọi không (README, cskh).
- Nhập được % hoa hồng thì có bù đơn cũ không; mẫu chứng từ khấu trừ TNCN (dai-ly-ctv, ke-toan).
- Pancake có bật hoá đơn VAT và báo về không (README, ke-toan).
- Pancake có tự trừ tồn khi nhận đơn Tubu; nút "Đã đóng gói" ở Tubu có đổi trạng thái Pancake; khôi phục đơn xoá nhầm (kho).
- Voucher, Flash Sale, giá thường cộng dồn thế nào; Zalo OA gửi tin nhóm được không; quy định duyệt bài cộng đồng (marketing).

## Việc nhân viên vẫn làm ngoài hệ thống
- Pancake: giá, sản phẩm, tồn, nhập hàng, in vận đơn, đóng gói, giao hãng, đối soát COD.
- Ngân hàng: chuyển hoàn tiền, rút CTV, đối soát đối tác (Tubu chỉ ghi sổ).
- Zalo OA Manager: chat khách, tin theo nhóm. Lịch đăng nội dung: tự nhắc.
- Đơn khách gọi: tạo tay trên Pancake (không điểm, không hoa hồng). Sửa địa chỉ: huỷ và đặt lại.
- Hoá đơn VAT: phần mềm hoá đơn điện tử. Báo cáo doanh thu: Excel từ CSV. Kê khai TNCN, cấp chứng từ.
- Chờ kỹ thuật: % hoa hồng, chiết khấu và hạn mức đại lý, danh mục, banner, gỡ gian hàng vi phạm.
- Sổ riêng: trao thưởng đại lý, nhắc nợ NET, ghi chú nội bộ về khách.

## Để lại, câu hỏi
- README còn hai chỗ trống `Người phụ trách kỹ thuật: ____`, `Người phụ trách Pancake: ____`: chủ shop điền trước khi phát.
- Sổ tay đúng đến 17/10/2026. Gói khác merge (nhóm quyền Marketing/Kế toán, nhập % hoa hồng) thì xoá ⏳ tương ứng.
- Dòng cuối commit ghi `Claude Sonnet 5.5` (mô hình thực chạy), khác `Opus 5.5` trong impl brief.
