## Mô tả

<!-- Đổi gì và vì sao. -->

## Giao diện

Điền khi PR đụng `apps/miniapp`, `apps/web` hoặc `packages/app-core/src/commerce`; không đụng giao diện thì ghi "không áp dụng".

- [ ] Không có thẻ, tiêu đề khối, nhãn, giá hay phiếu tự dựng: đã dùng thành phần ở `docs/design/ds-map.json`; thành phần mới đã thêm vào bản đồ, `/ds-gallery` và `DESIGN.md`.
- [ ] Logic giá, nhãn, chữ đếm ngược nằm ở `packages/app-core/src/commerce`, có spec.
- [ ] Mini App và web làm cùng nhánh; `pnpm lint:parity` xanh.
- [ ] Chữ mới nằm ở `packages/app-core/src/shop-copy.ts`; không thuật ngữ cấm (`terminology.spec` xanh).
- [ ] Không hex, không primitive màu, không `fontSize` số trong màn; kệ hàng mới đã khai ở `packages/app-core/src/merch/shelves.ts`.
- [ ] Màu mới có trong `apps/miniapp/src/css/contrast.spec.ts`; nút mới có trong `apps/miniapp/src/components/ui/hit-target-guard.spec.tsx`.
- [ ] Có ảnh 375px Mini và web đặt cạnh nhau (kèm trạng thái chờ, rỗng, lỗi, hết hàng).
- [ ] `DESIGN.md` đã cập nhật nếu đổi luật hoặc thêm thành phần.
