-- points-1d: 1 Điểm Xanh = 1đ (trước đó 1.000đ). Mọi số điểm đã lưu nhân 1.000 để giá trị tiền không đổi; hạng thành
-- viên xét theo chi tiêu (Lộc Biếc 1,5 triệu, minPoints = minSpending / 50 chỉ để bản app cũ hiển thị).
--
-- Trọn trong MỘT khối DO $$ (một giao dịch): hoặc nhân hết hoặc không gì cả. Không đổi schema, không đụng cột updatedAt.
-- Dấu "đã chạy" là dòng system_configs 'loyalty.vnd_per_point_redeem' = 1: có dòng đó thì khối kết thúc ngay (chạy lại an toàn).
-- Vì vậy BẮT BUỘC chạy `migrate deploy` TRƯỚC `seed-reference` (seed gieo dòng này = 1 và sẽ làm khối bỏ qua việc nhân).
-- Dừng (RAISE) khi: tỉ giá đã lưu khác 1.000 và khác 1 (đối soát tay rồi `prisma migrate resolve --rolled-back
-- 20261018210000_points_1d`), hoặc có cột nhân xong sẽ tràn INTEGER (liệt kê bảng + cột).
-- KHÔNG quay lại image API cũ sau migration này: code cũ đọc điểm theo 1 điểm = 1.000đ. Hoàn tác dữ liệu chỉ qua
-- prisma/manual/points_1d_rollback.sql khi chưa có đơn/ghi mới theo đơn vị mới (xem đầu file đó).
--
-- Không đổi: xu_points_conversions (ảnh chụp tại thời điểm quy đổi xu), coin_transactions, coinsBalance, ví,
-- order_items.pointsDiscount, orders.pointsDiscount/total (đồng), chữ lịch sử (game_spins.prizeName, notification_logs),
-- system_config_history cũ, game_quizzes.rewardPts (không code nào đọc).

DO $$
DECLARE
  redeem  JSONB;
  rec     RECORD;
  n       BIGINT;
BEGIN
  LOCK TABLE "users", "points_transactions", "orders", "return_requests", "reviews", "loyalty_check_ins",
             "pos_point_credits", "community_events", "ctv_milestone_claims", "game_spins", "missions",
             "membership_tiers", "system_configs", "system_config_history" IN SHARE ROW EXCLUSIVE MODE;

  SELECT "value" INTO redeem FROM "system_configs" WHERE "key" = 'loyalty.vnd_per_point_redeem';
  IF FOUND THEN
    IF jsonb_typeof(redeem) = 'number' AND (redeem #>> '{}')::numeric = 1 THEN
      RAISE NOTICE 'points_1d: loyalty.vnd_per_point_redeem đã là 1, bỏ qua (đã chạy).';
      RETURN;
    END IF;
    IF NOT (jsonb_typeof(redeem) = 'number' AND (redeem #>> '{}')::numeric = 1000) THEN
      RAISE EXCEPTION 'points_1d: loyalty.vnd_per_point_redeem = % (phải là 1000 hoặc 1); đối soát tay rồi prisma migrate resolve --rolled-back 20261018210000_points_1d', redeem;
    END IF;
  END IF;

  -- Chặn tràn INTEGER trước khi ghi gì: nhân 1.000 một giá trị vượt 2.147.483 làm cả migration lỗi giữa chừng.
  FOR rec IN
    SELECT * FROM (VALUES
      ('users', 'pointsBalance', 'true'),
      ('users', 'pointsConvertedBalance', 'true'),
      ('points_transactions', 'delta', 'true'),
      ('orders', 'pointsEarned', 'true'),
      ('orders', 'pointsUsed', 'true'),
      ('orders', 'pointsUsedConverted', 'true'),
      ('return_requests', 'pointsRefunded', 'true'),
      ('return_requests', 'convertedPointsRefunded', 'true'),
      ('return_requests', 'pointsReversed', 'true'),
      ('reviews', 'pointsEarned', 'true'),
      ('loyalty_check_ins', 'points', 'true'),
      ('pos_point_credits', 'points', 'true'),
      ('community_events', 'rewardPoints', 'true'),
      ('ctv_milestone_claims', 'rewardPoints', 'true'),
      ('game_spins', 'prizeValue', '"rewardType" = ''POINTS'''),
      ('missions', 'rewardPoints', 'true')
    ) AS t("tbl", "col", "cond")
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE (%s) AND abs(%I::bigint) * 1000 > 2147483647', rec."tbl", rec."cond", rec."col") INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'points_1d: % dòng %.% sẽ tràn INTEGER sau khi nhân 1.000; đối soát tay trước', n, rec."tbl", rec."col";
    END IF;
  END LOOP;

  -- Nhân 1.000 mọi cột điểm (bỏ qua 0 và NULL).
  FOR rec IN
    SELECT * FROM (VALUES
      ('users', 'pointsBalance', 'true'),
      ('users', 'pointsConvertedBalance', 'true'),
      ('points_transactions', 'delta', 'true'),
      ('orders', 'pointsEarned', 'true'),
      ('orders', 'pointsUsed', 'true'),
      ('orders', 'pointsUsedConverted', 'true'),
      ('return_requests', 'pointsRefunded', 'true'),
      ('return_requests', 'convertedPointsRefunded', 'true'),
      ('return_requests', 'pointsReversed', 'true'),
      ('reviews', 'pointsEarned', 'true'),
      ('loyalty_check_ins', 'points', 'true'),
      ('pos_point_credits', 'points', 'true'),
      ('community_events', 'rewardPoints', 'true'),
      ('ctv_milestone_claims', 'rewardPoints', 'true'),
      ('game_spins', 'prizeValue', '"rewardType" = ''POINTS'''),
      ('missions', 'rewardPoints', 'true')
    ) AS t("tbl", "col", "cond")
  LOOP
    EXECUTE format('UPDATE %I SET %I = %I * 1000 WHERE (%s) AND %I <> 0', rec."tbl", rec."col", rec."col", rec."cond", rec."col");
  END LOOP;

  -- Hạng theo chi tiêu: Lộc Biếc 5 triệu → 1,5 triệu (chỉ khi còn giá trị cũ, admin đã sửa thì giữ).
  UPDATE "membership_tiers" SET "minSpending" = 1500000 WHERE "id" = 'LOC_BIEC' AND "minSpending" = 5000000;
  UPDATE "membership_tiers" SET "minPoints" = "minSpending" / 50 WHERE "minSpending" IS NOT NULL;

  -- Khoá cấu hình tính bằng điểm. Chỉ nhân khi giá trị còn trong trần cũ (ngoài trần = đã ở đơn vị mới hoặc hỏng, giữ nguyên);
  -- mảng/giải chỉ đổi khi MỌI phần tử hợp lệ, tránh nhân nửa vời.
  CREATE TEMP TABLE "_pts1d_cfg" ("key" TEXT PRIMARY KEY, "oldValue" JSONB NOT NULL, "newValue" JSONB) ON COMMIT DROP;

  INSERT INTO "_pts1d_cfg"
  SELECT c."key", c."value",
         CASE WHEN jsonb_typeof(c."value") = 'number' AND (c."value" #>> '{}') ~ '^[0-9]+$' AND (c."value" #>> '{}')::numeric <= l."lim"
              THEN to_jsonb((c."value" #>> '{}')::bigint * 1000) END
    FROM "system_configs" c
    JOIN (VALUES
      ('referral.referrer_reward_points', 100),
      ('community.post_reward_points', 20),
      ('community.answer_reward_points', 20),
      ('community.best_answer_reward_points', 20),
      ('game.tree_points_price', 500),
      ('game.spin_buy_cost_points', 1000)
    ) AS l("key", "lim") ON l."key" = c."key";

  -- Trần POS không có giá trị "đã ở đơn vị mới" để nhận ra, nên luôn nhân; kẹp 1 tỷ cho vừa INTEGER.
  INSERT INTO "_pts1d_cfg"
  SELECT c."key", c."value",
         CASE WHEN jsonb_typeof(c."value") = 'number' AND (c."value" #>> '{}') ~ '^[0-9]+$'
              THEN to_jsonb(LEAST((c."value" #>> '{}')::numeric * 1000, 1000000000)::bigint) END
    FROM "system_configs" c
   WHERE c."key" IN ('loyalty.pos_staff_daily_points_cap', 'loyalty.pos_member_daily_points_cap');

  INSERT INTO "_pts1d_cfg"
  SELECT c."key", c."value",
         CASE WHEN jsonb_typeof(c."value") = 'array' AND jsonb_array_length(c."value") = 7
                   AND NOT EXISTS (
                     SELECT 1 FROM jsonb_array_elements(c."value") e("v")
                      WHERE CASE WHEN jsonb_typeof(e."v") = 'number' AND (e."v" #>> '{}') ~ '^[0-9]+$' THEN (e."v" #>> '{}')::numeric > 100 ELSE true END)
              THEN (SELECT jsonb_agg(to_jsonb((e."v" #>> '{}')::bigint * 1000) ORDER BY e."ord") FROM jsonb_array_elements(c."value") WITH ORDINALITY e("v", "ord")) END
    FROM "system_configs" c WHERE c."key" = 'loyalty.checkin_points';

  INSERT INTO "_pts1d_cfg"
  SELECT c."key", c."value",
         CASE WHEN jsonb_typeof(c."value") = 'array' AND jsonb_array_length(c."value") > 0
                   AND NOT EXISTS (
                     SELECT 1 FROM jsonb_array_elements(c."value") e("v")
                      WHERE CASE WHEN jsonb_typeof(e."v") = 'object' AND jsonb_typeof(e."v" -> 'bonusPoints') = 'number' AND (e."v" ->> 'bonusPoints') ~ '^[0-9]+$'
                                 THEN (e."v" ->> 'bonusPoints')::numeric > 500 ELSE true END)
              THEN (SELECT jsonb_agg(e."v" || jsonb_build_object('bonusPoints', (e."v" ->> 'bonusPoints')::bigint * 1000) ORDER BY e."ord")
                      FROM jsonb_array_elements(c."value") WITH ORDINALITY e("v", "ord")) END
    FROM "system_configs" c WHERE c."key" = 'referral.milestones_points';

  -- Giải vòng quay: giải POINTS ×1.000 và đổi tên "N điểm Xanh" cho khớp (tên do admin viết khác thì giữ).
  INSERT INTO "_pts1d_cfg"
  SELECT c."key", c."value",
         CASE WHEN jsonb_typeof(c."value") = 'array' AND jsonb_array_length(c."value") > 0
                   AND NOT EXISTS (
                     SELECT 1 FROM jsonb_array_elements(c."value") e("v")
                      WHERE jsonb_typeof(e."v") <> 'object'
                         OR (e."v" ->> 'rewardType' = 'POINTS'
                             AND CASE WHEN jsonb_typeof(e."v" -> 'value') = 'number' AND (e."v" ->> 'value') ~ '^[0-9]+$'
                                      THEN (e."v" ->> 'value')::numeric > 100 ELSE true END))
              THEN (SELECT jsonb_agg(
                             CASE WHEN e."v" ->> 'rewardType' = 'POINTS'
                                  THEN e."v" || jsonb_build_object('value', (e."v" ->> 'value')::bigint * 1000)
                                       || CASE WHEN e."v" ->> 'name' ~ '^[0-9]+ điểm Xanh$'
                                               THEN jsonb_build_object('name', replace(to_char((e."v" ->> 'value')::bigint * 1000, 'FM999,999,999'), ',', '.') || ' điểm Xanh')
                                               ELSE '{}'::jsonb END
                                  ELSE e."v" END
                             ORDER BY e."ord")
                      FROM jsonb_array_elements(c."value") WITH ORDINALITY e("v", "ord")) END
    FROM "system_configs" c WHERE c."key" = 'game.spin_prizes';

  -- Season Pass: phần thưởng POINTS ×1.000 (phần SEEDS giữ nguyên, phần tử không phải object giữ nguyên).
  INSERT INTO "_pts1d_cfg"
  SELECT c."key", c."value",
         CASE WHEN jsonb_typeof(c."value") = 'array' AND jsonb_array_length(c."value") > 0
                   AND NOT EXISTS (
                     SELECT 1 FROM jsonb_array_elements(c."value") e("v"), unnest(ARRAY['free', 'premium']) AS s("side")
                      WHERE e."v" -> s."side" ->> 'type' = 'POINTS'
                        AND CASE WHEN jsonb_typeof(e."v" -> s."side" -> 'amount') = 'number' AND (e."v" -> s."side" ->> 'amount') ~ '^[0-9]+$'
                                 THEN (e."v" -> s."side" ->> 'amount')::numeric > 100 ELSE true END)
              THEN (SELECT jsonb_agg(
                             CASE WHEN jsonb_typeof(e."v") <> 'object' THEN e."v"
                                  ELSE e."v"
                                       || CASE WHEN e."v" -> 'free' ->> 'type' = 'POINTS'
                                               THEN jsonb_build_object('free', (e."v" -> 'free') || jsonb_build_object('amount', (e."v" -> 'free' ->> 'amount')::bigint * 1000))
                                               ELSE '{}'::jsonb END
                                       || CASE WHEN e."v" -> 'premium' ->> 'type' = 'POINTS'
                                               THEN jsonb_build_object('premium', (e."v" -> 'premium') || jsonb_build_object('amount', (e."v" -> 'premium' ->> 'amount')::bigint * 1000))
                                               ELSE '{}'::jsonb END
                             END
                             ORDER BY e."ord")
                      FROM jsonb_array_elements(c."value") WITH ORDINALITY e("v", "ord")) END
    FROM "system_configs" c WHERE c."key" = 'seasonpass.tiers';

  INSERT INTO "system_config_history" ("id", "key", "oldValue", "newValue", "changedBy")
  SELECT 'sch_pts1d_' || md5(t."key"), t."key", t."oldValue", t."newValue", 'migration:points_1d'
    FROM "_pts1d_cfg" t
   WHERE t."newValue" IS NOT NULL AND t."newValue" <> t."oldValue"
  ON CONFLICT ("id") DO NOTHING;

  UPDATE "system_configs" s SET "value" = t."newValue"
    FROM "_pts1d_cfg" t
   WHERE s."key" = t."key" AND t."newValue" IS NOT NULL AND t."newValue" <> t."oldValue";

  -- Dấu "đã chạy" + tỉ giá khoá cứng 1. Không có dòng trước đó thì mặc định cũ của code là 1.000.
  INSERT INTO "system_config_history" ("id", "key", "oldValue", "newValue", "changedBy")
  VALUES ('sch_pts1d_' || md5('loyalty.vnd_per_point_redeem'), 'loyalty.vnd_per_point_redeem', COALESCE(redeem, to_jsonb(1000)), to_jsonb(1), 'migration:points_1d')
  ON CONFLICT ("id") DO NOTHING;

  INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt")
  VALUES ('loyalty.vnd_per_point_redeem', to_jsonb(1), '1 điểm = 1đ khi áp', 'loyalty', now())
  ON CONFLICT ("key") DO UPDATE SET "value" = to_jsonb(1), "description" = '1 điểm = 1đ khi áp';
END $$;
