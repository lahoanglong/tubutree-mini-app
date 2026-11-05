-- Gói w7: gỡ chỉ mục một phần "notification_logs_zns_failed_sentAt_idx" ("sentAt") WHERE channel='ZNS' AND status='FAILED'.
-- Từ migration 20261105180000_hg_zns_stuck_logs_index, chỉ mục thường (channel, status, sentAt) phục vụ cùng điều kiện (planner chọn nó
-- trong perf-indexes-1104.race-spec), nên chỉ mục một phần chỉ tốn ghi. Bảng nhỏ (PROD 61 dòng) nên không cần CONCURRENTLY.
-- Image cũ vẫn chạy đúng: các truy vấn sức khoẻ ZNS FAILED 24 giờ tự rơi về chỉ mục thường, chậm hơn một chút chứ không lỗi.
DROP INDEX IF EXISTS "notification_logs_zns_failed_sentAt_idx";
