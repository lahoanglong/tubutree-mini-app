# Đợt 2 (1028b): luật riêng cho worker

Đọc `docs/2026-10-28-review/tools/gd3-worker-brief.md` trước: mọi luật chung ở đó vẫn áp dụng (môi trường, cấm, cách làm, bộ kiểm, báo cáo). File này chỉ ghi chỗ khác.

## Gốc và nhánh
- Gốc: `origin/main` 2a3566479 (đã có #59–#73). Mỗi gói một worktree và nhánh `review/1028b-<gói>` dựng sẵn từ gốc đó, đã `pnpm install`, `prisma generate`, build `@tubutree/shared-types`.
- Lệnh diff của gói: `git diff 2a3566479..HEAD`.
- Đường dẫn tài liệu: `docs/2026-10-28-review/` ngay trong worktree của gói (main đã có đủ báo cáo, backlog, công cụ). Ảnh và số đo ghi ra thư mục ảnh của gói (đường dẫn tuyệt đối trong prompt), không ghi vào worktree tài liệu.

## Không đụng file đợt P3
- Một phiên khác đang làm đợt P3 trên 228 file liệt kê ở `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/tools/p3-files.txt`, chưa merge.
- KHÔNG sửa file nào có trong danh sách đó, trừ `apps/miniapp/src/i18n/vi.ts`: được THÊM khoá mới ở cuối nhóm của màn mình, không sửa hay dời khoá cũ.
- Cách sửa đúng mà buộc phải đụng file trong danh sách: dừng mục đó, ghi "chờ P3" kèm file và lý do vào báo cáo.

## Ảnh trước/sau
- Ảnh TRƯỚC: chụp ở chính worktree của gói TRƯỚC commit đầu tiên (mã = main 2a3566479), rồi chép `docs/2026-10-28-review/screens` sang `<thư mục ảnh của gói>/before`. Ảnh SAU: chụp lại sau khi sửa và so bằng `before-after.mjs --before <thư mục ảnh>/before --after docs/2026-10-28-review/screens --out <thư mục ảnh> --keys ...`.
- Không có `BEFORE` dùng chung như đợt trước. Số đo gốc (bundle, CLS, SQL) cũng đo ở worktree của gói trước khi sửa.

## Lane và cổng
| Gói | Lane (API / web / Mini App) | Khối cổng e2e | Race Postgres |
|---|---|---|---|
| trangchu | 1 (3211 / 3212 / 3213) | 3900–3909 (e2e API 3901, web 3902, Mini App 3903, gate PG 3904, gate Redis 3905) | 46000 |
| khungcho | 2 (3221 / 3222 / 3223) | 3910–3919 (3911, 3912, 3913, 3914, 3915) | 46010 |
| quantri-ngay | 3 (3231 / 3232 / 3233) | 3920–3929 (3921, 3922, 3923, 3924, 3925) | 46020 |
| hieunang2 | 4 (3241 / 3242 / 3243) | 3930–3939 (3931, 3932, 3933, 3934, 3935) | 46030 |

- Postgres 25432 và Redis 26379 dùng chung đã bật (người giao bật). Không dừng chúng.
- Lane bật từ CHÍNH worktree của gói. Lane cũ có thể còn DB từ đợt trước: chạy `npx prisma migrate deploy` cho DB lane trước khi nạp dữ liệu.
- Lane 5–9 và cổng 3791–3795, 3800–3899, 45800–45999 là của phiên khác: không đụng.

## Khác
- Commit kết thúc bằng `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Không push.
- Không chạy `tools/perf/run-all.mjs` (máy dùng chung). Gói hieunang2 đếm SQL bằng `tools/perf/prisma-query-log.cjs`; gói trangchu đo CLS bằng `tools/perf/cls-probe.mjs` (đọc đầu file để biết tham số).
- Bộ kiểm tĩnh đầy đủ người giao tự chạy lại bằng `tools/gate.sh <worktree> --base 2a3566479`; worker vẫn phải chạy phần kiểm của brief cho phần mình đổi.
