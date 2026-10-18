# points-1d: Điểm Xanh 1 điểm = 1đ

Nhánh `lr2/points1d`, dựa trên `review/2026-10-18-launch`. Kế hoạch: `points-1d-plan.md`.

## Quyết định chủ dự án
- 1 điểm = 1đ. Đơn đặt trong Mini App tích 2% tiền hàng sau giảm giá (không tính phí giao) nhân hệ số hạng (×1, ×1,2, ×1,5, ×2). Sàn: chỉ hook 1% (`loyalty.marketplace_earn_pct`), chưa có đường chạy.
- Mọi số điểm khác nhân 1.000.
- Hạng xét theo tiền mua 12 tháng: Lộc Biếc 1,5 triệu, Đại Thụ 20 triệu, Cổ Thụ 50 triệu.

## Commit
| Commit | Nội dung |
|---|---|
| a509e74e C1 | Công thức nguyên `floor(floor(goods) * pct100 * mult100 / 1e6)`, khoá `loyalty.earn_pct`, `vnd_per_point` vào DEAD_CONFIG_KEYS, `vnd_per_point_redeem` khoá cứng 1, mọi hằng/khoá điểm ×1.000 (code, seed, RANGES, web admin) và spec đơn vị. |
| c1977418 C2 | Migration `20261018210000_points_1d`, spec race 21 ca, chặn rollback PD-3, spec race cũ chuyển đơn vị. |
| e1466a1a C3 | `recalcTier` xét theo tiền mua (`spending12m` dùng chung), `getOverview` trả `spent12m` và `nextTier.spendingToGo`, mini app đo tiến độ theo tiền. |
| 2f066f83 C4 | Chữ hiển thị "Tích 2% tiền hàng...", câu thưởng đánh giá, sổ tay CSKH/marketing, bảng duyệt refseed. |

## Migration
- Một khối `DO $$` trong một giao dịch, khoá SHARE ROW EXCLUSIVE 14 bảng.
- Dấu đã chạy: `system_configs.loyalty.vnd_per_point_redeem = 1`. Có dấu thì no-op. Dòng có mà khác 1 và khác 1000 thì RAISE, không ghi gì.
- Kiểm tràn INT4 trước khi ghi, RAISE nêu bảng.cột.
- Nhân 1.000 các cột điểm của 14 bảng, khoá cấu hình có trần chống nhân đôi, ghi lịch sử `system_config_history` (changedBy `migration:points_1d`). Không đụng `updatedAt`.
- Thứ tự vận hành: dừng API, `prisma migrate deploy`, `seed-reference`, bật API. Chạy seed-reference trước migrate sẽ ghi dấu = 1 và bỏ qua việc nhân.
- Rollback: `prisma/manual/pd3_xu_to_points_rollback.sql` từ chối chạy khi dấu đã có. Chưa có script rollback riêng cho points-1d (cần sao lưu DB trước migrate).

## Kiểm chứng (DB tạm `lr2p1d-pg`, cổng 5565)
- Jest đơn vị API đầy đủ: 345 suite đạt, 2 suite đỏ (5 ca) không thuộc gói này.
- Race: 152 file có điểm; sau sửa, chỉ còn 4 file đỏ không thuộc gói này.
- `prisma migrate deploy` áp migration, `migrate diff --exit-code`: không lệch.
- Vitest miniapp đầy đủ 3756 đạt; vitest web đỏ một ca `no-raw-date-format`.

## Chưa đạt, không do gói này
- `checkout.service.spec.ts`: 4 ca "freeship đơn đầu" (đỏ cả khi khôi phục file pricing của HEAD).
- `home.service.spec.ts`: `homeNewCustomerLayout` mặc định đổi true.
- Race `reference-seed` (DB C: 13 khoá thay vì 16, seed.ts đã tạo sẵn 3 khoá), `staff-coupons` (ForbiddenException thay vì BadRequest), `storefront-moderation` và `demo-cleanup` (cờ duyệt gian hàng, mã demo giữ).
- Web `no-raw-date-format`.

## Lệch so với kế hoạch
- Spec race `pd3-checkout-points`, `pf6-locked-window-outside-tx`, `partner-goods-rules`, `checkout-*` vẫn ghim `vnd_per_point_redeem = 1000` (logic lô điểm không phụ thuộc tỉ giá); `buyer-totals-regression` ghim `earn_pct 10` để giữ số cũ và nạp `storefront.require_approval=false`, fixture chỉ đổi số điểm tích.
- Giả lập migration B trong spec giới thiệu đổi sang 1 xu = 1 điểm.
- Dòng "Mua trong Mini App được tích gấp đôi": bỏ, khoá `loyalty.marketplace_claim_enabled` chưa tồn tại.
- C5 (chấm ngăn nghìn trong tin nhắn điểm): chưa làm.

## Chạm file do phiên song song giữ
`apps/miniapp/src/pages/loyalty.tsx` (dòng "Còn X mua hàng"), `apps/web/.../engagement-tab.tsx` (+spec), `prisma/seed.ts` (số điểm, hạng), `modules/game/game.service.ts` (mặc định giá), `apps/miniapp/src/components/home/new-customer-gift.tsx`. Không xoá `DEFAULT_REWARD_CATALOG`, không đổi cấu trúc `redeemReward`.
