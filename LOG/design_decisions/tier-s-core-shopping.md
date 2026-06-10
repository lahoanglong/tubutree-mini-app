# LOG — Tier S Core Shopping (đêm 2026-06-10)

Ghi lại các tranh luận Engineer ↔ Designer ↔ Reviewer đáng đọc lại.

## 1. Palette: migrate cam logo ngay hay để sau?
- **Engineer:** đổi token giữa đêm là rủi ro — mọi page đang xanh `#2E7D4F`.
- **Designer:** spec §7.1 ghi rõ token cũ là SAI so với logo. Càng để lâu càng nhiều
  code mới viết trên màu sai. Đây là sửa bug brand, không phải redesign.
- **Reviewer (chốt):** migrate ngay nhưng giữ alias `--green-*` → scale lá mới
  để game/profile chưa migrate vẫn cùng tông. Mọi code mới cấm dùng alias. → AD-001.

## 2. Checkout: 3 màn theo design brief hay 1 trang?
- **Designer:** brief vẽ 3 màn (18-20), step indicator đẹp.
- **Engineer:** đơn Tubu chỉ có 1 rule ship duy nhất (ngưỡng 200k) → màn "Shipping"
  gần như rỗng; mỗi lần chuyển màn là 1 điểm rớt funnel + state phải truyền qua 3 màn.
- **Reviewer (chốt):** 1 trang cuộn, section rõ, sticky CTA hiện tổng tiền.
  Mẹ Linh test PASS (ít tap hơn). Nếu sau này thêm chọn hãng ship → tách màn lúc đó. → DI #2.

## 3. Xóa item giỏ: confirm trước hay undo sau?
- **Designer:** confirm modal an toàn nhưng phiền với thao tác 1 tay.
- **Engineer:** undo sau cần xử lý race (undo bắn khi request xóa còn đang bay
  → add-lại có thể đến server TRƯỚC lệnh xóa → mất hàng).
- **Reviewer (chốt):** optimistic xóa ngay, nhưng undo bar chỉ mở sau khi server
  xác nhận xóa xong. Trade-off: undo xuất hiện trễ ~200ms — không ai nhận ra,
  còn race biến mất hoàn toàn. → DI #3.

## 4. Idempotency key: sinh lúc nào, refresh lúc nào?
- **Engineer:** sinh mỗi lần bấm nút → vô nghĩa (retry tạo key mới = đơn mới).
- **Reviewer (chốt):** sinh 1 lần khi vào trang (useRef), giữ qua mọi retry,
  CHỈ refresh sau khi đặt thành công (đơn kế tiếp là đơn mới thật). → AD-004.

## 5. Code-split: manualChunks hay React.lazy?
- **Engineer:** manualChunks kiểm soát tốt hơn nhưng phải maintain danh sách.
- **Reviewer (chốt):** React.lazy theo route — tự nhiên với router, Home eager
  (first paint), 8 trang còn lại lazy. Kết quả đo được: initial 597KB → 438KB
  (gzip 186KB → 138KB), mỗi trang 3-15KB chunk riêng. → AD-007.

## 6. Variation hết hàng: ẩn, disable, hay vẫn bấm được?
- **Designer:** ẩn đi là "biến mất bí ẩn" — user không hiểu vì sao thiếu size 1L.
- **Reviewer (chốt):** vẫn hiển thị + bấm được để xem giá, nhưng gạch ngang + mờ 55%
  + label "Tạm hết — sẽ về sớm". CTA add-to-cart disable khi chọn nó. → DI #7.

## 7. Freeship threshold: hard-code 200k ở FE?
- **Engineer:** nhanh nhất là hard-code — nhưng vi phạm quy tắc §15 (config-driven).
- **Reviewer (chốt):** backend expose `freeshipThreshold` trong cart response
  (đọc SystemConfig). FE không biết con số nào cả. Đổi config → progress bar tự đúng.
