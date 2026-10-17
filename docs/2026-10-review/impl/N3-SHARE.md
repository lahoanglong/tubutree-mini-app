# N3-SHARE: nút Chia sẻ ở trang chi tiết sản phẩm nuốt lỗi

## Làm gì
`handleShare` trong `apps/miniapp/src/pages/product-detail.tsx` đổi từ `shareLink(...).catch(() => {})` sang hook `useShareWithFallback`. Giữ nguyên title, description, thumbnail, path. `fallbackText` là `${WEB_BASE_URL}/product/<slug>`, cùng cách dựng với share-sheet, affiliate, group-buy. Nơi khác không gắn mã giới thiệu vào liên kết sản phẩm nên không thêm.

Test mới `product-detail-share.spec.tsx` (mock `../components/share-sheet`): bấm Chia sẻ thì gọi `shareWithFallback` đúng tham số và không gọi `shareLink`. Trước khi sửa test đỏ: `shareLink` bị gọi 1 lần, kèm lỗi `Cannot read properties of undefined (reading 'catch')`. Sau khi sửa test xanh.

## Quét mục 2
Còn đúng một chỗ khác gọi `shareLink` trực tiếp: `pages/wallet.tsx` (~dòng 97). Chỗ này không nuốt lỗi: catch hiện snackbar "Mã giới thiệu của bạn: ...". Giữ nguyên. Điểm lệch nhỏ: nó cũng hiện snackbar khi người dùng huỷ (-2003). Chỉ ghi nhận, không sửa vì ngoài phạm vi. Không có `openShareSheet(` nào khác ngoài `zmp-bridge.ts`.

## Không sửa
`share-sheet.tsx` và các file ngoài nhóm không đụng.

## Kiểm (trong apps/miniapp)
- `npx vitest run src/pages/product-detail`: 8 file, 36 test xanh.
- `npx tsc --noEmit -p .`: exit 0.
- `npx eslint --max-warnings=0` trên 2 file đã sửa: exit 0.

## Chưa verify
Không chạy full suite và e2e. Hành vi thật của Zalo (từ chối quyền) chưa thử trên thiết bị.

## Rủi ro
Thấp. Khi Zalo từ chối, người dùng giờ thấy snackbar và liên kết được chép vào clipboard.
