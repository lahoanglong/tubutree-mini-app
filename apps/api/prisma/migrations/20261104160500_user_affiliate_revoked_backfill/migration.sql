-- Dấu thu hồi cho khách đã từng bán (CTV/đại lý bị hạ trước khi có cột): chặn tự đăng ký lại CTV và rút hoa hồng còn lại.
-- Tách khỏi migration thêm cột để UPDATE không giữ ACCESS EXCLUSIVE của ALTER TABLE. Idempotent.
UPDATE "users" u
SET "affiliateRevokedAt" = now()
WHERE u."role" = 'CUSTOMER'
  AND u."affiliateRevokedAt" IS NULL
  AND (
    EXISTS (SELECT 1 FROM "commissions" c WHERE c."affiliateUserId" = u."id")
    OR EXISTS (SELECT 1 FROM "storefronts" s WHERE s."ownerUserId" = u."id" AND s."type" = 'CTV')
    OR EXISTS (
      SELECT 1 FROM "user_admin_events" e
      WHERE e."userId" = u."id" AND e."kind" = 'ROLE' AND e."fromValue" IN ('AFFILIATE', 'DEALER') AND e."toValue" = 'CUSTOMER'
    )
  );
