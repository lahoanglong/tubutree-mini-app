-- W179-B: Hạ trần số yêu cầu đổi rác đang mở của một khách về tối đa 2 (kẹp mọi giá trị đang lưu > 2 về 2).
UPDATE "system_configs"
SET "value" = '2'::jsonb, "updatedAt" = NOW()
WHERE "key" = 'waste.max_open_requests'
  AND jsonb_typeof("value") = 'number'
  AND ("value"::text)::numeric > 2;
