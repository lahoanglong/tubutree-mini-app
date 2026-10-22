# mv-uat8 — Lô 8

- % bậc thưởng quý đại lý: `bonusPctText` trong `apps/web/src/lib/dealer-view.ts` = `formatRatePct(pct / 100)`, như Mini App (fb9bd099), không gọi toLocaleString trực tiếp; dòng bonus-pct.ts đã bỏ khỏi `no-raw-date-format.spec.ts`. Dùng ở 3 chỗ trong `components/dealer/report-tab.tsx`. Không còn chỗ web khách nào khác in % bậc thưởng đại lý.
- Mã chưa áp dụng: `components/coupon-box.tsx` báo `Mã chưa được áp dụng cho đơn này: {reason}` (role=status, tự tắt 5 giây) khi xem trước eligible:false + reason và giỏ discount 0. Không thêm request (dùng xem trước sẵn có), không đổi endpoint/body/Idempotency-Key. Trường hợp `heldOnly` (couponNotice, discount 0, không freeship, xem trước không eligible) không hiện cảnh báo này, và cảnh báo cũng ẩn khi prop `notice` đang hiển thị (`coupon-box.tsx`).
- Spec: `app/dai-ly/page.spec.tsx`, `components/coupon-box.spec.tsx` (ca báo lý do, heldOnly, ẩn khi có notice), `lib/dealer-view.spec.ts` (bonusPctText). Không chạy Playwright.
