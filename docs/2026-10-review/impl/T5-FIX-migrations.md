# T5-FIX migrations PD-3 (nhánh hz12/migrations)

Checksum migration `20261012120000_pd3_points_config_keys` ĐỔI (sửa tại chỗ vì PD-3 chưa lên PROD, PROD ở cb92dc8). DB dev/staging đã áp bản cũ phải dựng lại (hoặc `migrate resolve` sau khi đối chiếu), nếu không `migrate deploy` báo checksum lệch.

| Mục | Commit | Đỏ (thật) | Xanh (thật) |
|---|---|---|---|
| 1 migration config không bao giờ dừng | fix(migration): PD-3 đổi khoá config... | 4 ca mới đỏ: `ERROR: invalid input syntax for type integer: "2.5"`, `integer out of range`; Tests: 4 failed, 9 passed | `pd3-points-config-keys`: 13 passed. Ca mới: count 2.5, count 3e9, bonus 3e9, bonus 1500.5, referrer_reward/tree_xu_price quá lớn, phần tử scalar/mảng trong seasonpass.tiers, chạy hai lần |
| 2 hoàn tác xoá thông báo XU_CONVERTED | fix(rollback): ... | ca T21 mở rộng đỏ: còn 3 dòng `nlog_xu2pts_*` sau hoàn tác | `pd3-xu-migration`: 16 passed (chỉ còn hai dòng không do migration tạo; chạy 2 lần rc=0) |
| 3 truy vấn đo trước deploy (g)-(j) | chore(manual): ... | không áp dụng (SQL chỉ đọc) | chạy qua psql trên DB trống (0 dòng, không lỗi) và trên dữ liệu xấu (string "1000", count 2.5, tier số 5, tree_xu_price chuỗi đều lộ ra) |
| 4 SPEC mục 10 "Khi migration dừng giữa chừng" | docs(PD-3): ... | không áp dụng | đã thêm |

Quyết định: giá trị không hợp lệ BỊ BỎ QUA (không làm tròn/cắt) vì đoán số tiền rủi ro hơn dùng mặc định; khoá xu cũ giữ để admin soát (đo bằng mục (g)-(j)). Rollback chỉ xoá dòng id `nlog_xu2pts_<userId>` + templateCode XU_CONVERTED + channel INAPP; mẫu tin `nt-xu-converted` giữ nguyên.

Kiểm cuối (DB trống, container riêng 5640):
```
migrate deploy: All migrations have been successfully applied.
migrate diff --exit-code: No difference detected. (rc=0)
pd3-points-config-keys 13 passed | pd3-xu-migration 16 passed | pd3-xu-converted-notice 4 passed
pd3-migration-a-rerun 3 passed | pd3-points-lots 6 passed
```
