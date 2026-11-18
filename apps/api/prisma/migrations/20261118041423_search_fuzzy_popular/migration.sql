-- Ô tìm chịu gõ sai + từ khoá phổ biến. Chỉ CỘNG: một bảng mới, các dòng cấu hình (ON CONFLICT DO NOTHING, không đổi giá trị admin đã đặt)
-- và từ đồng nghĩa nạp sẵn. Ảnh cũ chạy được với DB mới: không đọc bảng hay khoá mới.
CREATE TABLE "search_synonyms" (
    "id" TEXT NOT NULL,
    "term" VARCHAR(60) NOT NULL,
    "canonical" VARCHAR(60) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_synonyms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "search_synonyms_term_key" ON "search_synonyms"("term");

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('catalog.search_fuzzy_enabled', 'false'::jsonb, 'Ô tìm chịu gõ sai: từ đồng nghĩa (bảng search_synonyms) và bước tìm gần đúng khi tìm chính xác ra dưới 3 món. Tắt thì kết quả tìm như cũ.', 'catalog', NOW()),
  ('catalog.search_popular_enabled', 'false'::jsonb, 'Ô tìm trống hiện hàng "Tìm phổ biến": cụm khách tìm ra hàng trong 14 ngày (từ 3 người trở lên), thiếu thì bù bằng catalog.search_popular_terms.', 'catalog', NOW()),
  ('catalog.search_popular_terms', '["nước giặt", "nước rửa chén", "nước lau sàn", "rửa tay", "cho bé", "granola", "cà phê", "đông trùng hạ thảo"]'::jsonb, 'Từ khoá dự phòng cho hàng "Tìm phổ biến" (tối đa 12 cụm, mỗi cụm 2–40 ký tự), dùng khi dữ liệu tìm kiếm chưa đủ 4 cụm.', 'catalog', NOW())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "search_synonyms" ("id", "term", "canonical", "isActive", "updatedAt") VALUES
  ('syn_seed_01', 'nuoc rua bat', 'nuoc rua chen', true, NOW()),
  ('syn_seed_02', 'rua bat', 'rua chen', true, NOW()),
  ('syn_seed_03', 'muoi rua bat', 'muoi rua chen', true, NOW()),
  ('syn_seed_04', 'nuoc rua chen may', 'rua chen cho may', true, NOW()),
  ('syn_seed_05', 'xa phong giat', 'nuoc giat', true, NOW()),
  ('syn_seed_06', 'bot giat', 'nuoc giat', true, NOW()),
  ('syn_seed_07', 'nuoc giat em be', 'nuoc giat cho be', true, NOW()),
  ('syn_seed_08', 'em be', 'cho be', true, NOW()),
  ('syn_seed_09', 'tre em', 'cho be', true, NOW()),
  ('syn_seed_10', 'tre so sinh', 'cho be', true, NOW()),
  ('syn_seed_11', 'quan lot', 'do lot', true, NOW()),
  ('syn_seed_12', 'lau nha', 'lau san', true, NOW()),
  ('syn_seed_13', 'nuoc lau nha', 'nuoc lau san', true, NOW()),
  ('syn_seed_14', 'lau gach', 'lau san', true, NOW()),
  ('syn_seed_15', 'lau kinh', 'lau da nang', true, NOW()),
  ('syn_seed_16', 'binh sua', 'rua binh sua', true, NOW()),
  ('syn_seed_17', 'toilet', 'bon cau', true, NOW()),
  ('syn_seed_18', 'nha ve sinh', 'nha tam', true, NOW()),
  ('syn_seed_19', 'nuoc rua rau', 'ngam rua thuc pham', true, NOW()),
  ('syn_seed_20', 'rua rau', 'ngam rua thuc pham', true, NOW()),
  ('syn_seed_21', 'rua trai cay', 'ngam rua thuc pham', true, NOW()),
  ('syn_seed_22', 'rua hoa qua', 'ngam rua thuc pham', true, NOW()),
  ('syn_seed_23', 'sua tam be', 'tam goi cho be', true, NOW()),
  ('syn_seed_24', 'dau goi be', 'tam goi cho be', true, NOW()),
  ('syn_seed_25', 'son moi', 'son duong', true, NOW()),
  ('syn_seed_26', 'kem duong moi', 'son duong', true, NOW()),
  ('syn_seed_27', 'tay da chet', 'tay te bao chet', true, NOW()),
  ('syn_seed_28', 'xit phong', 'xit thom', true, NOW()),
  ('syn_seed_29', 'khu mui xe', 'khu mui o to', true, NOW()),
  ('syn_seed_30', 'xe hoi', 'o to', true, NOW()),
  ('syn_seed_31', 'oto', 'o to', true, NOW()),
  ('syn_seed_32', 'cafe', 'ca phe', true, NOW()),
  ('syn_seed_33', 'caphe', 'ca phe', true, NOW()),
  ('syn_seed_34', 'chocolate', 'socola', true, NOW()),
  ('syn_seed_35', 'ngu coc', 'granola', true, NOW()),
  ('syn_seed_36', 'muesli', 'granola', true, NOW()),
  ('syn_seed_37', 'xi dau', 'nuoc tuong', true, NOW()),
  ('syn_seed_38', 'duong dua', 'duong hoa dua', true, NOW()),
  ('syn_seed_39', 'mat dua', 'mat hoa dua', true, NOW()),
  ('syn_seed_40', 'sua gao lut', 'sua hat gao lut', true, NOW()),
  ('syn_seed_41', 'trung thao', 'dong trung ha thao', true, NOW()),
  ('syn_seed_42', 'polang', 'po lang', true, NOW()),
  ('syn_seed_43', 'bhnong', 'bh nong', true, NOW()),
  ('syn_seed_44', 'pine boo', 'pineboo', true, NOW())
ON CONFLICT ("term") DO NOTHING;
