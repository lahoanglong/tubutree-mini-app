# Verify sau merge C2 (máy mới, macOS Apple Silicon)

- Ngày: 2026-10-11 · Nhánh: `hardening/2026-10` · HEAD lúc verify: `116dd31` (docs bàn giao; mã nguồn = `4b53388`)
- Môi trường: macOS arm64, 32 GB RAM (vẫn áp giới hạn 3 subagent song song, 1 job nặng một lúc), Docker 29.8.2, Postgres 16-alpine container `tubu_it_main` cổng 5550 DB `tubutree_it`.

## Kết quả (lệnh thật, chạy lại trên máy này)

| Hạng mục | Lệnh | Kết quả |
|---|---|---|
| Migration trên DB trống | `npx prisma migrate deploy` (`DATABASE_URL=...:5550/tubutree_it`) | 123/123 áp sạch, `migrate status`: "Database schema is up to date" |
| Drift schema | `npx prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel prisma/schema.prisma --exit-code` | "No difference detected", exit 0 |
| Partial unique index | `npx tsx prisma/check-partial-indexes.ts` | 14/14 |
| ESLint API | `npx eslint src --max-warnings=0` | exit 0, không có output |
| API unit | `npx jest` | 159 suite / 2872 test pass |
| Race suite (Postgres thật) | `npx jest -c test/integration-race/jest.config.js --runInBand` | 49 suite / 282 test pass (38,9 s) |
| tsc | `npx tsc --noEmit` trong api, miniapp, web; `npx tsc --noEmit -p tsconfig.json` trong e2e | 4 gói exit 0 |
| Vitest miniapp | `npx vitest run` | 144 file / 1220 test pass |
| Vitest web | `npx vitest run` | 43 file / 528 test pass |
| ESLint miniapp (`tubu-ds`) | `npx eslint "src/**/*.{ts,tsx}"` | 105 vấn đề (69 `tubu-ds/no-raw-color`, 21 `no-restricted-imports`, 15 `consistent-type-imports`), đúng baseline C-076 |
| static-scan UI | `node scripts/uiux/static-scan.mjs` | miniapp: 1.604 alias legacy / 147 hex / 308 emoji; web: 45 palette legacy |

Không có lỗi mã nguồn nào cần sửa; mọi thất bại ban đầu là lỗi môi trường (dưới đây).

## Lỗi môi trường đã gặp và cách xử lý

1. `tsc` miniapp báo `Cannot find module '@tubutree/shared-types'`: gói `packages/shared-types/dist` chưa build trên máy mới. Chạy `pnpm --filter @tubutree/shared-types build` (cũng là nguyên nhân Typecheck-001 trước đây).
2. Vitest miniapp: 91 lỗi `webidl.util.markAsUncloneable is not a function` trên Node 20.20.2. `jsdom@30.0.1` yêu cầu Node `^22.22.2 || ^24.15.0 || >=26`. Cài Node 22.23.3 cạnh Node 20 (`~/.local/node/node-v22.23.3-darwin-arm64`, không đổi symlink `current`) và đặt `PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh của repo. Trên Node 22: 1220/1220 pass, 0 lỗi.
3. `scripts/uiux/static-scan.mjs` cần thư mục `scripts/uiux/results/` (gitignored) tồn tại: `mkdir -p scripts/uiux/results`.
4. Không cần `apps/api/.env` để chạy jest unit/race.
