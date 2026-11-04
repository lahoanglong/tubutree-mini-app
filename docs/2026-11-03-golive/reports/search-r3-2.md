# search r3-2 (nhánh gl/1103-search)

Commit mới: 3616b50d9 (test race dùng từ khoá riêng). Chưa push.

## P2: cổng web (đã chạy)
- `next build` apps/web, HEAD vs gốc 52fd5cd65 (First Load, gzip -9 tổng chunk JS của route, đo bằng build-manifest):
  - `/layout` +1425 B, `/` +1334 B, `/san-pham` +1396 B (đều dưới trần +2 KB). Bảng của next: `/` 259 -> 261 kB, `/san-pham` 221 -> 222 kB, shared 103 -> 104 kB.
  - Ghi chú: rootMainFiles lệch +963 B (cùng khối chung); gốc build trong worktree tạm, đã dọn.
- Playwright web qua `apps/e2e/scripts/web-gate.sh --workers=1` khối cổng 3970-3972, spec `shop.web` + `web-customer`: 111 passed, 1 skipped (2,1 phút). Container tạm tự xoá, không còn tiến trình nghe 3970-3972.

## P3 race spec: ĐÃ SỬA (3616b50d9)
- Ca "nhiều từ khớp rời" nay dùng từ khoá riêng `xq<random>` cho mỗi lần chạy (tên `${t} rửa chén...`, `Bộ ${t} chén...`, `${t} chén dừa`; tìm/gợi ý theo `${t} chen`).
- Chứng minh trên một DB dùng lại (Postgres tạm 5593, `tubutree_it`, `--runInBand`): spec cũ chạy 6 lần liên tiếp: lần 1-2 xanh, lần 3-6 đỏ (đúng như reviewer). Spec mới 6 lần liên tiếp: 9/9 xanh mỗi lần. DB tạm đã xoá.

## P3 matchCache trang 1 ghi đè: KHÔNG SỬA (backlog)
- Không rẻ: "ghi đè khi tập id khác" không bắt được đúng ca (cùng tập, đổi thứ tự do soldCount); "bỏ bán chạy khỏi thứ tự Liên quan" đổi quy tắc xếp hạng đã chốt. Chỉ còn khi hai người tìm cùng từ khoá trong 60 giây và số đã bán vừa đổi; Mini lọc trùng bằng uniqueById. Không chặn go-live.

## Số test
- race catalog-search-index: 9/9 x6 (mới). Web gate: 111 passed / 1 skipped. Không đổi mã web/api nên không chạy lại vitest/jest.
