# mv-uat8 — Lô 8

- % bậc thưởng quý đại lý: `apps/web/src/lib/bonus-pct.ts` (`bonusPctText`, cùng thân hàm Mini App), dùng ở 3 chỗ trong `components/dealer/report-tab.tsx`. Không còn chỗ web khách nào khác in % bậc thưởng đại lý.
- Mã chưa áp dụng: `components/coupon-box.tsx` báo `Mã chưa được áp dụng cho đơn này: {reason}` (role=status, tự tắt 5 giây) khi xem trước eligible:false + reason và giỏ discount 0. Không thêm request (dùng xem trước sẵn có), không đổi endpoint/body/Idempotency-Key. Trường hợp couponNotice giữ mã web đã có sẵn qua prop `notice`.
- Spec: `app/dai-ly/page.spec.tsx`, `components/coupon-box.spec.tsx`. Không chạy Playwright.
