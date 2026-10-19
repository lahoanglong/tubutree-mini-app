# PROGRESS — phiên UAT 2026-10-20

Phiên: `tubutree-mini-app-b4` (ListAgents). Worktree `.claude/worktrees/uat`, nhánh `uat/2026-10-20` từ origin/main `05e6ae97`.
Bị ngắt thì đọc file này, `00-brief.md`, rồi journal workflow (đường dẫn ghi ở mục Workflow) và chạy lại bằng `resumeFromRunId`.

## Mốc

| Giờ | Commit | Việc | Lệnh | Kết quả |
|---|---|---|---|---|
| 21:50 | 05e6ae97 | Tạo worktree, cài deps | `git worktree add -b uat/2026-10-20 .claude/worktrees/uat origin/main`; `pnpm install --prefer-offline`; build shared-types; prisma generate | exit 0 (`logs/install.log`) |
| 21:52 | 05e6ae97 | Postgres chạy thẳng 25432, Redis Docker 26379 | `tools/pg-native.sh install/start 25432/createdb 25432 tubutree_uat`; `docker run -d --rm --name tubu-uat-redis --tmpfs /data -p 127.0.0.1:26379:6379 redis:7-alpine` | PG 16.14 lên, Redis PONG |
| 21:53 | 05e6ae97 | Migrate + seed DB UAT | `prisma migrate deploy`; `tsx prisma/seed.ts`; `tsx prisma/seed-reference.ts --with-business-defaults` | exit 0 cả ba (`logs/seed*.log`) |
| 21:54 | 05e6ae97 | Mốc đầu đêm (sàn) | `tools/baseline.sh` → `logs/baseline/` | xem mục "Sàn test" |

## Sàn test đầu đêm (05e6ae97)

| Bộ | Lệnh | Số |
|---|---|---|
| jest api | `cd apps/api && npx jest --maxWorkers=4` | 426 suite / 9308 test, exit 0 |
| vitest miniapp (VN) | `cd apps/miniapp && npx vitest run` | 283 file / 4313 test, exit 0 |
| vitest miniapp (UTC) | `TZ=UTC npx vitest run` | 283 / 4313, exit 0 |
| vitest web (VN) | `cd apps/web && npx vitest run` | 358 file / 6178 test, exit 0 |
| vitest web (UTC) | `TZ=UTC npx vitest run` | 358 / 6178, exit 0 |
| vitest app-core | `cd packages/app-core && npx vitest run` | 41 file / 489 test, exit 0 |
| vitest eslint-config | `cd packages/eslint-config && npx vitest run` | 2 / 7, exit 0 |
| Playwright Mini App (list) | `E2E_SCOPE=miniapp npx playwright test --list` | 170 test / 24 file |
| Playwright web (list) | `E2E_SCOPE=web npx playwright test --list` | 292 test / 17 file |
| race (2 luồng, Postgres chạy thẳng 25541/25542) | `tools/race-shard.sh` (`--shard=i/2 --runInBand`) | 127+126 = 253 suite, 1007+957 = 1964 test, exit 0 cả hai, không spec nào phải chạy lại |

Log: `logs/baseline.out`, `logs/baseline/*.log`. Xong 22:01.

## Phối hợp

| Giờ | Chiều | Nội dung |
|---|---|---|
| 21:56 | gửi d3 | Báo tên phiên b4, worktree, nhánh, cổng 3221/3222/3223/25432/26379; phân vùng; hỏi lịch gate nặng |
| 21:57 | nhận d3 | Đồng ý phân vùng. Gate nặng phía web: 21:40–22:30 web-gate + Playwright Mini App (3121–3123, 5199); 22:30–01:00 lane `mshell`; 01:00–05:00 tối đa 4 lane (3131–3133, 3141–3143, 3151–3153, 3161–3163, PG 15432+/Redis 16379+); 05:00–07:00 gate tổng + PR nháp. Không chạy jest API hay race. Không cần báo trước gate của mình, chỉ tránh cổng; không dùng 32xx/255xx/25432/26379. |

## Workflow

| Giờ | Tên | runId | Script | Trạng thái |
|---|---|---|---|---|
| 22:00 | uat-w1-review (5 góc review + soát chéo + báo cáo D1–D5) | wf_97071786-f31 | `tools/w1-review.workflow.js` | chạy |
| 22:01 | uat-w2-uiux-perf-docker (D6–D10) | wf_a29b9daf-94b | `tools/w2-uiux-perf-docker.workflow.js` | chạy |
| 22:03 | uat-w3-e2e (bộ khung + 6 lane UAT U1–U6) | wf_88990532-be7 | `tools/w3-uat.workflow.js` | chạy |

Journal workflow: `~/.claude/projects/-Users-longla-coding-tubutree-mini-app/290ef81c-34a8-4ce1-8b2c-51c8d5a19dd7/subagents/workflows/<runId>/journal.jsonl`.

## Tiến trình nền của phiên (dọn cuối đêm)

- Postgres chạy thẳng: cụm 25432 (`~/.cache/tubu-uat/data-25432`), dừng bằng `tools/pg-native.sh stop 25432`. Cụm race 25541/25542 đã dừng 22:02.
- Redis: container `tubu-uat-redis` (26379), xoá bằng `docker rm -f -v tubu-uat-redis`.
- API UAT 3221 (PID trong `~/.cache/tubu-uat/api-3221.pid`), dừng bằng `tools/api-up.sh stop 3221`.
