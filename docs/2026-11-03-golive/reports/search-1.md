# Gói search, lượt 1

Nhánh `gl/1103-search` (gốc 52fd5cd65), commit `c1426b2a2` "fix(search): tìm nhiều từ khớp rời, xếp theo liên quan; gọn các lỗi nhỏ ô tìm (KHAMPHA-02/05/07/14/15)". Chưa push.

## Đã làm
- KHAMPHA-02 (P1): `textMatchSql` nối AND một điều kiện `LIKE %từ%` cho mỗi từ (bỏ từ trùng, trần 6 từ, thoát `%`/`_`, giữ không dấu, giữ trần 100 ký tự ở DTO). Xếp hạng: khớp đầu tên, khớp cả cụm, nổi bật, bán chạy, id. Tab "Liên quan" (không `sort`, có `q`) đi qua `listRanked` theo đúng thứ tự SQL. `suggest` lấy 8 id đầu theo thứ tự đó. Tag khớp nguyên văn vẫn như cũ (OR).
  - Jest đỏ trước (6 ca đỏ với mã cũ: 3 ca `likeTermPatterns/likePrefixPattern`, 1 ca `suggest`, 2 ca `textMatchSql`/Liên quan), xanh sau.
  - Race (Postgres thật, DB tạm `tubutree_it` copy từ mẫu lane 5): `catalog-search-index`, `buy-flow-4b`, `catalog-merch-api`, `catalog-flash-card-price`, `catalog-slugs`, `ai-advisor-public-products` xanh 6/6 (35 ca). Ca EXPLAIN cũ vẫn thấy `BitmapOr` + `products_nameSearch_trgm_idx` + `products_tags_gin`, không `Seq Scan`: chỉ mục vẫn dùng được.
  - Số câu SQL: danh sách có `q` không `sort` vẫn 3 (raw, id đã xếp, thẻ trang; id xếp được nhớ 60 giây), gợi ý vẫn 2.
  - Đổi hành vi có chủ ý: ca race cũ "bh nong không ra BH..Nong" thành "ra cả hai" (khớp rời từng từ).
- KHAMPHA-05: `EmptyState` heading thêm `overflowWrap: 'anywhere'` (Mini). Web đã có `break-words` ở `EmptyResults`.
- KHAMPHA-07: `clipQuery` (cắt theo điểm mã) ở `packages/app-core/src/browse/query.ts`, dùng trong `parseSearchState` Mini + web và `normalizeSearchQuery` web; `maxLength` cho `SearchField` (Mini và bản web `components/mini`), Mini browse truyền `MAX_QUERY_LENGTH`.
- KHAMPHA-14: `orderedPriceBounds` đổi chỗ min/max trong `parseSearchState` cả hai app (khớp API).
- KHAMPHA-15: Mini: `scopeRecentSearchesToUser` (khoá chủ `tubu_recent_searches_owner`), gọi ở `browse.tsx`; đổi tài khoản thì xoá lịch sử người trước; lịch sử cũ chưa có chủ được tài khoản đầu tiên nhận; không so khi chưa biết user (tránh xoá nhầm lúc khôi phục phiên). Web: `clearRecentSearches()` trong `logout` của `auth-context`. Không đụng `store/auth.ts`.
  - Đã thử gọi dọn ở `app.tsx` (setLogoutCleanup): entry Mini +207 B raw/+56 B gz, nên bỏ, chuyển sang cách trên.

## Kiểm (số thật)
- tsc sạch: api, miniapp, web, app-core.
- jest api toàn bộ: 544/545 suite, 12701/12703 test; 2 ca đỏ ở `app-throttler.guard.spec.ts` do tải máy (load 80-180); chạy riêng: 13/13 xanh. Catalog riêng: 408/408.
- vitest app-core: 167 file, 2603/2603.
- vitest miniapp (`TZ=UTC`): lần toàn bộ 6515/6532 (17 ca timeout do tải); chạy lại riêng 13 file liên quan với timeout 60 giây: 344/344. `browse.spec` riêng 71/71.
- vitest web: lần toàn bộ 9552/9577 (25 ca timeout/tải ở 4 file: best-sellers-view, home-view-feed, suggest-feed, shop-products-tab); chạy lại riêng timeout 60 giây: 46/46. `auth-context`, `search-state`, `catalog-filter`: 48/48.
- `pnpm lint:parity`: xanh (ds-ratchet px 3769/399 file, max-md 1014/103 file, không đổi baseline). Khoá `maxLength` của SearchField đã thêm cả hai phía nên ds-map-parity xanh.
- eslint ở các file đã sửa: không báo gì.
- Bundle Mini (cùng phép đo `bundle-report.mjs --build-miniapp`; gốc đọc từ bản build 52fd5cd65 của gói khác trong scratchpad): entry 675199 B raw/209221 B gz thành 675239/209232 (+40 B/+11 B, làm tròn 659/205 KB vẫn bằng gốc); tổng 212 file, 2214 thành 2215 KB raw, gz 862 KB không đổi.

## Chưa làm / rủi ro
- Chưa chạy Playwright và chưa chụp ảnh trước/sau 375: lane 5 đang do một tiến trình khác giữ (cwd ở worktree gl-1103-docs); lệnh `lane-down.sh 5` bị bộ phân quyền chặn nên không bật lại lane từ worktree gói. Máy tải 80-180 nữa. Thay đổi giao diện chỉ gồm `overflowWrap` ở tiêu đề rỗng và `maxLength`; cần phiên điều phối chụp "Không tìm thấy" với 130 ký tự `a`.
- Ngưỡng "trần 6 từ": từ thứ 7 trở đi không còn là điều kiện lọc (chỉ còn trong xếp hạng cả cụm).
- Tìm nhiều từ rộng hơn trước (khớp rời), có thể ra nhiều kết quả hơn với từ chung; vẫn trần `TEXT_MATCH_LIMIT` 2000.
- Đã tạo rồi xoá DB tạm `tubutree_gl_search` và `tubutree_it` ở Postgres 25432 (DB `tubutree_it` do tôi tạo cho race, trước đó không có).
- Không đụng `setSoldExternal` hay vùng của phiên db trong `catalog.service.ts`; diff ở đó nằm ở `textMatchSql`, `list`, `listPage`, `textWhere`, `suggest`, `listWhere` (thêm hàm `listByRelevance`).
