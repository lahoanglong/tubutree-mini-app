-- PD-3 (Q-03a, spec mục 3.1 "Đổi khoá config", mục 4): khoá config tính bằng xu → khoá `*_points` mới.
-- Chỉ INSERT ... ON CONFLICT DO NOTHING / UPDATE có điều kiện; khoá xu cũ GIỮ NGUYÊN (code mới không đọc,
-- nằm trong DEAD_CONFIG_KEYS). Chạy lại = không đổi gì; khoá điểm admin đã sửa không bị chép đè.
--
-- BẮT BUỘC CEIL(numeric / 1000): `((n + 999) / 1000)::int` trên numeric ra 5.999 rồi ép kiểu làm tròn
-- thành 6 (thưởng 5.000 xu thành 6 điểm). Chỉ chép giá trị kiểu số: NULL/chuỗi làm INSERT vi phạm
-- NOT NULL hoặc lỗi ép kiểu, dừng cả lần deploy; bỏ qua thì code dùng mặc định trong mã.
--
-- KHÔNG BAO GIỜ DỪNG: migration này chạy sau migration B đã commit, nên một lỗi ép kiểu ở đây làm
-- `migrate deploy` fail và API crash-loop (P3009). Mọi ::int chỉ chạy khi giá trị là số nguyên (regex
-- ^-?[0-9]+$) trong miền INTEGER (abs <= 2147483647). Giá trị không hợp lệ (2.5, 3e9, ...) bị BỎ QUA chứ
-- không làm tròn/cắt: đoán một số tiền là rủi ro hơn việc để code dùng mặc định; khoá xu cũ vẫn còn để admin soát.

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt")
SELECT 'referral.referrer_reward_points', to_jsonb(CEIL(("value" #>> '{}')::numeric / 1000)::int),
       'Điểm Xanh thưởng người giới thiệu khi bạn được mời có đơn thứ 2 (thu hồi nếu trả hàng)', 'referral', now()
  FROM "system_configs" WHERE "key" = 'coins.referrer_reward' AND jsonb_typeof("value") = 'number'
   AND (("value" #>> '{}') ~ '^-?[0-9]+$' AND abs(("value" #>> '{}')::numeric) <= 2147483647)
ON CONFLICT ("key") DO NOTHING;

-- Trường đổi tên bonus → bonusPoints: code mới đọc nhầm bản cũ ra undefined → bỏ qua, không cấp.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt")
SELECT 'referral.milestones_points',
       COALESCE((SELECT jsonb_agg(jsonb_build_object('count', (m->>'count')::int,
                                                     'bonusPoints', CEIL((m->>'bonus')::numeric / 1000)::int)
                                  ORDER BY (m->>'count')::int)
                   FROM jsonb_array_elements(c."value") m
                  WHERE jsonb_typeof(m->'count') = 'number' AND jsonb_typeof(m->'bonus') = 'number'
                    AND ((m->>'count') ~ '^-?[0-9]+$' AND abs((m->>'count')::numeric) <= 2147483647) AND ((m->>'bonus') ~ '^-?[0-9]+$' AND abs((m->>'bonus')::numeric) <= 2147483647)), '[]'::jsonb),
       'Mốc số bạn giới thiệu thành công → thưởng thêm Điểm Xanh (1 lần/mốc)', 'referral', now()
  FROM "system_configs" c WHERE c."key" = 'coins.referral_milestones' AND jsonb_typeof(c."value") = 'array'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt")
SELECT 'game.tree_points_price', to_jsonb(CEIL(("value" #>> '{}')::numeric / 1000)::int),
       'Điểm Xanh cho 1 lượt góp quỹ trồng cây', 'game', now()
  FROM "system_configs" WHERE "key" = 'game.tree_xu_price' AND jsonb_typeof("value") = 'number'
   AND (("value" #>> '{}') ~ '^-?[0-9]+$' AND abs(("value" #>> '{}')::numeric) <= 2147483647)
ON CONFLICT ("key") DO NOTHING;

-- Season Pass: {type:'XU',amount:n} → {type:'POINTS',amount:ceil(n/1000)}; chỉ ghi khi còn phần XU có số.
-- Phần tử không phải object (số, mảng) giữ nguyên: `jsonb || jsonb` trên scalar ra mảng [5,{},{}].
-- Phần XU không có số giữ nguyên (code mới từ chối cấp XU). Ghép bằng `||` từng phần thay vì
-- jsonb_build_object('free', t->'free', ...) để bậc thiếu free/premium không bị thêm khoá null.
UPDATE "system_configs" s
   SET "value" = (
     SELECT jsonb_agg(
              CASE WHEN jsonb_typeof(t) <> 'object' THEN t ELSE t
              || CASE WHEN t->'free'->>'type' = 'XU' AND jsonb_typeof(t->'free'->'amount') = 'number' AND ((t->'free'->>'amount') ~ '^-?[0-9]+$' AND abs((t->'free'->>'amount')::numeric) <= 2147483647)
                      THEN jsonb_build_object('free', jsonb_build_object('type', 'POINTS',
                             'amount', CEIL((t->'free'->>'amount')::numeric / 1000)::int))
                      ELSE '{}'::jsonb END
              || CASE WHEN t->'premium'->>'type' = 'XU' AND jsonb_typeof(t->'premium'->'amount') = 'number' AND ((t->'premium'->>'amount') ~ '^-?[0-9]+$' AND abs((t->'premium'->>'amount')::numeric) <= 2147483647)
                      THEN jsonb_build_object('premium', jsonb_build_object('type', 'POINTS',
                             'amount', CEIL((t->'premium'->>'amount')::numeric / 1000)::int))
                      ELSE '{}'::jsonb END
              END
              ORDER BY ord)
       FROM jsonb_array_elements(s."value") WITH ORDINALITY AS e(t, ord)),
       "updatedAt" = now()
 WHERE s."key" = 'seasonpass.tiers' AND jsonb_typeof(s."value") = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(s."value") t
                WHERE (t->'free'->>'type' = 'XU' AND jsonb_typeof(t->'free'->'amount') = 'number' AND ((t->'free'->>'amount') ~ '^-?[0-9]+$' AND abs((t->'free'->>'amount')::numeric) <= 2147483647))
                   OR (t->'premium'->>'type' = 'XU' AND jsonb_typeof(t->'premium'->'amount') = 'number' AND ((t->'premium'->>'amount') ~ '^-?[0-9]+$' AND abs((t->'premium'->>'amount')::numeric) <= 2147483647)));

-- Trần thưởng cộng đồng/ngày theo OQ-6 (đăng bài ≤ 1, hay nhất ≤ 3). Chỉ đổi khi còn đúng mặc định cũ
-- (3 / 5): giá trị admin đã tự chỉnh giữ nguyên.
UPDATE "system_configs" SET "value" = '1'::jsonb, "updatedAt" = now()
 WHERE "key" = 'community.daily_post_reward_cap' AND "value" = '3'::jsonb;
UPDATE "system_configs" SET "value" = '3'::jsonb, "updatedAt" = now()
 WHERE "key" = 'community.daily_best_answer_cap' AND "value" = '5'::jsonb;
