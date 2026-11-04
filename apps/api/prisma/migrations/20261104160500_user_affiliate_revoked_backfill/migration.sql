-- Dấu thu hồi cho người đã bị hạ khỏi CTV/đại lý trước khi có cột: phát lại điều AdminService.setUserRole sẽ làm, bất kể vai trò hiện tại.
-- Tách khỏi migration thêm cột để UPDATE không giữ ACCESS EXCLUSIVE của ALTER TABLE. Idempotent (chỉ dòng chưa có dấu).
--
-- Sổ user_admin_events (từ 20261014150100) ghi mọi đổi vai trò. Chỉ setUserRole ghi sự kiện ROLE không có "reason"; áp quyền cấp theo SĐT
-- và thu hồi nhân viên luôn có lý do, còn duyệt hồ sơ đại lý và tự đăng ký CTV không ghi sự kiện ROLE. Nên chỉ sự kiện không lý do mới đặt/xoá dấu:
--   đặt: về CUSTOMER từ CTV/đại lý, hoặc từ nhân viên/admin khi người đó còn dấu vết CTV (hoa hồng, gian hàng CTV; không xét cấu hình, như affiliateRevocationPatch);
--   xoá: sang CTV/đại lý.
-- Có dấu khi sự kiện đặt/xoá GẦN NHẤT là sự kiện đặt.
UPDATE "users" u
SET "affiliateRevokedAt" = now()
WHERE u."affiliateRevokedAt" IS NULL
  AND (
    (
      SELECT e."toValue" = 'CUSTOMER'
      FROM "user_admin_events" e
      WHERE e."userId" = u."id" AND e."kind" = 'ROLE' AND e."reason" IS NULL
        AND (
          e."toValue" IN ('AFFILIATE', 'DEALER')
          OR (
            e."toValue" = 'CUSTOMER'
            AND (
              e."fromValue" IN ('AFFILIATE', 'DEALER')
              OR (
                e."fromValue" IN ('STAFF', 'ADMIN')
                AND (
                  EXISTS (SELECT 1 FROM "commissions" c WHERE c."affiliateUserId" = u."id")
                  OR EXISTS (SELECT 1 FROM "storefronts" s WHERE s."ownerUserId" = u."id" AND s."type" = 'CTV')
                )
              )
            )
          )
        )
      ORDER BY e."createdAt" DESC, e."id" DESC
      LIMIT 1
    ) IS TRUE
    -- Hạ từ trước khi có sổ: khách không có sự kiện ROLE nào mà còn dấu vết CTV. Hoa hồng của khách chỉ là dấu vết cũ khi cấu hình KHÔNG cho
    -- khách hưởng hoa hồng; có CUSTOMER trong khoá thì khách tích hoa hồng bình thường.
    OR (
      u."role" = 'CUSTOMER'
      AND NOT EXISTS (SELECT 1 FROM "user_admin_events" a WHERE a."userId" = u."id" AND a."kind" = 'ROLE')
      AND (
        EXISTS (SELECT 1 FROM "storefronts" s WHERE s."ownerUserId" = u."id" AND s."type" = 'CTV')
        OR (
          EXISTS (SELECT 1 FROM "commissions" c WHERE c."affiliateUserId" = u."id")
          AND NOT EXISTS (
            SELECT 1 FROM "system_configs" sc
            WHERE sc."key" = 'affiliate.commission_eligible_roles' AND jsonb_typeof(sc."value") = 'array' AND sc."value" @> '["CUSTOMER"]'::jsonb
          )
        )
      )
    )
  );
