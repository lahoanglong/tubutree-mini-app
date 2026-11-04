# Báo cáo gói ctv, lượt 2 (nhánh gl/1103-ctv)

Commit lượt 2 (chưa push): xem `git log -1` ở worktree gl-1103-ctv ("fix(ctv): dòng gợi ý huy hiệu chỉ chủ shop thấy...").

## P2 (đã sửa): dòng gợi ý trông như huy hiệu công khai, "bậc 2" không có trong giao diện
- Kiểu: `TierBadgeHint` (Mini + web `components/mini`) đổi sang nền trong, viền đứt (outline thin dashed `--color-border-subtle`), chữ `--color-text-secondary`; vẫn bọc `Badge` nên chiều cao hàng không đổi, không thêm px viết tay (px-ratchet giữ 3769/399).
- Chữ: `shop.tierHintNext` "Lên {name} có huy hiệu" (tên bậc kế = `allTiers[1]`, chỉ khi chủ shop đang ở bậc thấp nhất); `shop.tierHint` "Huy hiệu chưa tải" cho ca lỗi/offline/hết hạn chờ (không nêu số bậc). Ngân sách 20 ký tự / `tierHintNext` null (có tham số). Hàm mới `nextTierName` ở `app-core/commerce/shop-page.ts`, nối qua prop `nextTier` ở trình dựng Mini và web (web mặc định null).
- Chữ mới cho khách CTV (chỉ chủ shop thấy): cần phiên điều phối/chủ duyệt giọng.
- Test: vitest app-core (`nextTierName` 5 ca), Mini + web spec cập nhật hai nhánh chữ (Tân binh có tên; lỗi 500 chữ chung), e2e Mini + web kiểm hai nhánh chữ. Đỏ với mã cũ: chữ cũ "Huy hiệu bậc hiện từ bậc 2" khác chữ mới nên các khẳng định chữ đỏ với mã cũ (suy ra theo so chuỗi, không chạy lại mã cũ).

## P3 tier-badge CLS ở 320px (đã sửa)
- Chữ rút ngắn (22 và 20 ký tự). Thêm ca e2e khổ 320 (ctv đã duyệt + Tân binh) vào `builder-tier-cls.miniapp.spec.ts`: dòng gợi ý phải cùng hàng với khung chờ, không tràn ngang.
- Chạy thật: với chữ 24 ký tự ca 320 ĐỎ (hint nằm dưới khung chờ 27,95px, tức bản đầu của tôi cũng xuống dòng); rút còn 20-22 ký tự thì XANH. Đây là bằng chứng nhận định P3 đúng.

## P3 web chạy qua web-gate.sh (không làm được)
- Web e2e (`builder-tier-cls.web`) lượt này KHÔNG chạy: máy tải 55 đến 197, Playwright webServer quá hạn 180s khi tự dựng Vite (Mini dựng Vite tay ở cổng 3951 và dùng lại thì chạy được). Chưa chạy qua `web-gate.sh` hay trên gốc 52fd5cd65. Chữ web chỉ kiểm bằng vitest page.spec (169/169). Việc còn lại khi máy rảnh: `apps/e2e/scripts/web-gate.sh tests/builder-tier-cls.web.spec.ts` (cổng 3930) và một lần ở worktree 52fd5cd65 có chép spec để thấy đỏ.

## P1 ảnh R-140 + ảnh trước/sau (KHÔNG làm được lượt này)
- Lý do: load average 55 đến 197 suốt lượt (lane 4 cần build API + copy DB + chụp 4 persona x 3 phase; webServer Playwright quá hạn). Chưa chụp, nên các mục R-140 khác (trạng thái rỗng, khung chờ CTV, nút thêm SP, chip Tân binh, ô CCCD, nút dính đáy) chưa xác nhận bằng ảnh, và chưa có ảnh web375/web1280 cho dòng gợi ý. Không đánh dấu "khớp" những mục này.
- Lệnh cần chạy khi máy rảnh (từ gl-1103-ctv): `seed-data.mjs --lane 4 all`, `build-routes.mjs --lane 4`, `capture.mjs --lane 4 --phase mini375,web375,web1280 --keys affiliate,storefront,s-slug,dealer --force`, `before-after.mjs`. Ảnh `screens-ctv/*-after.png` cũ đã lỗi thời (chữ gợi ý đã đổi).

## Kiểm (chạy thật, TZ=UTC, Node 22.23.3)
- vitest app-core shop-copy + shop-page: 73/73.
- vitest Mini storefront-builder.spec: 137/137 (`--testTimeout=60000`, máy tải nặng).
- vitest web ctv/gian-hang/page.spec: 169/169.
- Playwright Mini `builder-tier-cls.miniapp` (Vite 3951 dựng tay): 10/10.
- tsc --noEmit: miniapp, web, e2e, app-core sạch. `pnpm lint:parity` xanh.
- Không chạy: bundle-report (chênh chỉ vài chục byte chữ/kiểu), full vitest.
