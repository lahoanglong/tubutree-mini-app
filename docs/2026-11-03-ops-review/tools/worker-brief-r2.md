# Đợt ops-1103 vòng 2: luật cho worker (03/11 tối)

Luật chung giống vòng 1: đọc `tools/worker-brief.md` cùng thư mục (TDD, chữ, comment, commit, kiểm, cấm). File này chỉ ghi phần khác.

Phát hiện gốc vòng 2 (đã qua verifier đối kháng): `docs/2026-11-03-ops-review/10-review-wf2.json` ở worktree `ops-1103-docs`
(`/Users/longla/coding/tubutree-mini-app/.claude/worktrees/ops-1103-docs`). Tìm theo `id`. Mục của phiên 2a chuyển sang (XANH-01/02/03, BAOMAT-06) ở
`/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-03-golive/audit/triage.json`, tìm theo `id`.

## Gốc, nhánh, môi trường
- Gốc mọi gói: nhánh `ops/1103-r1` (vòng 1 đã gộp, chưa vào main). Xem diff của gói bằng `git diff ops/1103-r1...HEAD`.
- Worktree `.claude/worktrees/ops-1103-<gói>`, nhánh `ops/1103-<gói>`, đã `pnpm install`, `prisma generate`, build `@tubutree/shared-types`.
- Race spec: luôn chạy `--runInBand` (các spec dùng chung một DB, chạy song song sẽ đỏ giả).

| Gói | Race Postgres |
|---|---|
| storefront | 46270 |
| dealer | 46280 |
| gardenapi | 46290 |
| gardenui | 46300 |
| catalog | 46310 |
| orders | 46320 |
| recycle2 | 46330 |
| pancake | 46340 |
| ctv2 | 46350 |

## Ranh giới với phiên 2a
- 2a đã nhường cho phiên này các file: `order-returns.service.ts` (nhánh isFull), `merchant.service.ts` createStore + module storefront, `apps/miniapp/src/pages/dealer.tsx`, `bank-transfer.service.ts` getBankQr, `flash-slots.ts`, `product-admin.service.ts`, `product-category-admin.service.ts`, `campaign-admin-rules.ts`, `apps/miniapp/src/pages/game.tsx`, `recycle-desk.tsx` (Mini và web), `bootstrap.ts` (chỉ CORS `exposedHeaders`), và các file gói ghi tên.
- File vùng 2a khác chỉ được sửa khi gói ghi rõ tên. Sửa đúng dòng cần, không định dạng lại.
- 2a đang sửa ở nhánh riêng: `bootstrap.ts` quanh dòng 119-127 (giới hạn thân request), `dealer.controller.ts` + DTO mẫu đặt hàng (chỉ MaxLength/ArrayMaxSize), `catalog.service.ts` (textMatchSql), `apps/miniapp/src/i18n/vi.ts` dòng ~37 và ~67. Tránh các vùng dòng đó.

## Quyết định của chủ (03/11 tối)
- DLSF-04: giữ như cũ (giá đại lý theo giá niêm yết). Không sửa.
- VX2-06: giữ như cũ (đơn đại lý vẫn cộng nước mua hàng). Không sửa.
- VX2-03: chỉ sửa chữ cho đúng (không hứa mỗi lô một mã riêng); không đổi luật mã thu hoạch.
- DR-03 (vòng 1): hạn giữ chỗ là trọn ngày D giờ VN, nên chữ "trước D" phải thành "đến hết D".

## Migration
Chỉ gói ghi "được migration" mới được thêm. Migration dữ liệu (đổi chữ mẫu, perks) chỉ UPDATE dòng còn đúng chuỗi cũ, để không ghi đè chữ admin đã sửa; cập nhật `seed.ts` cùng lúc. Tên thư mục migration theo mốc `202611032xxxxx_<tên>`, lớn hơn migration mới nhất ở gốc (`ops/1103-r1` đã có `20261103120000_ctv_milestone_revoke`).
