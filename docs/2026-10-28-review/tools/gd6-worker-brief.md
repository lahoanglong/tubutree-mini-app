# Đợt 3 (1028c): luật riêng cho worker

Đọc `docs/2026-10-28-review/tools/gd3-worker-brief.md` trước: mọi luật chung ở đó vẫn áp dụng (môi trường, cấm, cách làm, bộ kiểm, báo cáo). File này chỉ ghi chỗ khác.

## Gốc và nhánh
- Gốc: `origin/main` d489574bf (đã có đợt P3, PR #75, và đã deploy). Riêng gói `goi-dau` dựng trên nhánh `review/1028b-trangchu`, gói `hieunang3` dựng trên `review/1028b-hieunang2` (hai nhánh đợt 2 đã gộp main d489574bf); prompt ghi rõ gốc diff của gói.
- Mỗi gói một worktree `.claude/worktrees/r1028c-<gói>`, nhánh `review/1028c-<gói>`, đã `pnpm install`, `prisma generate`, build `@tubutree/shared-types`.
- Đợt P3 đã merge nên không còn danh sách file cấm. Các nhánh đợt 2 (`review/1028b-*`) chưa merge: không sửa lại phần chúng đã làm, trừ gói dựng chồng lên nhánh đó.
- Mục của đợt này nằm trong backlog trước khi P3 merge. P3 có thể đã sửa một phần: đọc mã ở gốc trước, mục nào đã xong thì ghi "đã có ở main" kèm file:dòng và test chứng minh, không làm lại.

## Ảnh trước/sau
- Như đợt 2: ảnh TRƯỚC chụp ở chính worktree của gói trước commit đầu tiên, chép sang `<thư mục ảnh của gói>/before`; ảnh SAU chụp lại rồi so bằng `before-after.mjs`. Gói không đổi giao diện thì không cần ảnh.

## Lane và cổng
| Gói | Lane (API / web / Mini App) | Khối cổng e2e | Race Postgres |
|---|---|---|---|
| diem-hang | 1 (3211 / 3212 / 3213) | 3940–3949 (e2e API 3941, web 3942, Mini App 3943, gate PG 3944, gate Redis 3945) | 46040 |
| ctv-vi | 2 (3221 / 3222 / 3223) | 3950–3959 (3951, 3952, 3953, 3954, 3955) | 46050 |
| khach | 3 (3231 / 3232 / 3233) | 3960–3969 (3961, 3962, 3963, 3964, 3965) | 46060 |
| goi-dau | 4 (3241 / 3242 / 3243) | 3970–3979 (3971, 3972, 3973, 3974, 3975) | 46070 |
| hieunang3 | 9 (3291 / 3292 / 3293; Redis db 15, DB tubutree_uat_l9; không chạy build-template.sh) | 3980–3989 (3981, 3982, 3983, 3984, 3985) | 46080 |

- Postgres 25432 và Redis 26379 dùng chung đã bật. Không dừng chúng.
- Lane bật từ CHÍNH worktree của gói; chạy `npx prisma migrate deploy` cho DB lane trước khi nạp dữ liệu (main có 6 migration mới 239→245).
- Lane 5–8 và cổng 3791–3795, 3800–3939, 45800–46039 là của việc khác: không đụng.

## Khác
- Commit kết thúc bằng `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Không push.
- Không chạy `tools/perf/run-all.mjs`. Đếm SQL bằng `tools/perf/prisma-query-log.cjs` (công cụ so thân JSON `sql-compare.mjs` có ở nhánh hieunang2). Bundle Mini đo bằng `tools/perf/bundle-report.mjs` ở chính worktree, trước và sau.
- Gói đụng điểm, hạng, ví, hoa hồng: race test thật trên Postgres riêng (cổng race của gói), không chỉ unit test.
