-- Dấu thu hồi cho khách đã từng bán (CTV/đại lý bị hạ trước khi có cột): chặn tự đăng ký lại CTV và rút hoa hồng còn lại.
-- Tách khỏi migration thêm cột để UPDATE không giữ ACCESS EXCLUSIVE của ALTER TABLE. Idempotent.
UPDATE "users" u
SET "affiliateRevokedAt" = now()
WHERE u."affiliateRevokedAt" IS NULL
  AND (
    (
      u."role" = 'CUSTOMER'
      AND (
        -- Hoa hồng của khách chỉ là dấu vết CTV cũ khi cấu hình KHÔNG cho khách hưởng hoa hồng; có CUSTOMER trong khoá thì khách tích hoa hồng bình thường.
        (
          EXISTS (SELECT 1 FROM "commissions" c WHERE c."affiliateUserId" = u."id")
          AND NOT EXISTS (
            SELECT 1 FROM "system_configs" sc
            WHERE sc."key" = 'affiliate.commission_eligible_roles' AND jsonb_typeof(sc."value") = 'array' AND sc."value" @> '["CUSTOMER"]'::jsonb
          )
        )
        OR EXISTS (SELECT 1 FROM "storefronts" s WHERE s."ownerUserId" = u."id" AND s."type" = 'CTV')
        OR EXISTS (
          SELECT 1 FROM "user_admin_events" e
          WHERE e."userId" = u."id" AND e."kind" = 'ROLE' AND e."fromValue" IN ('AFFILIATE', 'DEALER') AND e."toValue" = 'CUSTOMER'
        )
      )
    )
    -- Đại lý bị hạ về khách rồi về lại DEALER không qua setUserRole (cấp rồi thu hồi nhân viên, hồ sơ đại lý còn APPROVED, hoặc duyệt hồ sơ mới).
    -- Chỉ setUserRole ghi sự kiện ROLE không có lý do; thu hồi nhân viên và áp quyền cấp theo SĐT luôn ghi lý do, duyệt hồ sơ không ghi sự kiện.
    OR (
      u."role" IN ('AFFILIATE', 'DEALER')
      AND EXISTS (
        SELECT 1 FROM "user_admin_events" e
        WHERE e."userId" = u."id" AND e."kind" = 'ROLE' AND e."fromValue" IN ('AFFILIATE', 'DEALER') AND e."toValue" = 'CUSTOMER'
          AND NOT EXISTS (
            SELECT 1 FROM "user_admin_events" r
            WHERE r."userId" = u."id" AND r."kind" = 'ROLE' AND r."reason" IS NULL AND r."toValue" IN ('AFFILIATE', 'DEALER') AND r."createdAt" >= e."createdAt"
          )
      )
    )
  );
