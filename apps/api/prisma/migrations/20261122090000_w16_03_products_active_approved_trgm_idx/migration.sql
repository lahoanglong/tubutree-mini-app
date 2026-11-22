-- Bước chịu gõ sai (search-fuzzy.ts fuzzyMatchSql) chỉ đọc món đang bán và đã duyệt: `"isActive" = true AND "approvalStatus" = 'APPROVED'`
-- viết literal trong câu lệnh. Chỉ mục trigram một phần đúng điều kiện đó thì planner chứng minh được predicate và luôn chọn nó: món ẩn,
-- món chờ duyệt không nằm trong chỉ mục nên không còn đẩy planner sang chỉ mục btree products_isActive_isFeatured_idx như khi bảng có
-- hàng nghìn dòng isActive=false (search-fuzzy-bench.race-spec.ts). Chỉ mục trigram đầy đủ products_nameSearch_trgm_idx giữ nguyên cho
-- bước khớp chính xác ("nameSearch" LIKE '%x%'). Không có trong schema.prisma (Prisma 5 không khai được chỉ mục một phần).
-- Chỉ thêm chỉ mục, không đổi dữ liệu hay cột: image cũ chạy đúng trên schema sau khi áp. Không CONCURRENTLY vì migration chạy trong
-- transaction: khoá chặn ghi products lúc dựng, bảng PROD khoảng một trăm dòng nên dựng dưới một giây.
-- fastupdate = off: dòng mới vào thẳng cây GIN thay vì danh sách chờ. Danh sách chờ (sau đồng bộ danh mục hàng loạt, trước VACUUM)
-- làm planner ước chi phí chỉ mục cao và quay về btree; tắt nó thì kế hoạch ổn định. Products ghi ít nên chậm thêm lúc chèn không đáng kể.
CREATE INDEX IF NOT EXISTS "products_active_approved_nameSearch_trgm_idx"
  ON "products" USING GIN ("nameSearch" gin_trgm_ops)
  WITH (fastupdate = off)
  WHERE "isActive" = true AND "approvalStatus" = 'APPROVED';
