# N3 gói payroll

## Xoá client chết adjustPayroll (backlog 64fb079acb)
Đã làm. Chạy lại git grep -w adjustPayroll trên worktree trước khi xoá: chỉ có dòng định nghĩa trong apps/miniapp/src/services/payroll-api.ts, không có nơi gọi ở src, spec, apps/e2e, scripts, docs. Đã xoá khối export (3 dòng). Backend POST /admin/payroll/adjust không đụng. Không sinh lại scripts/uiux/generated/miniapp-endpoints.json (điều phối viên làm sau khi gộp).

Không có bước đỏ trước khi sửa vì đây là xoá mã chết. Cách kiểm thay thế: grep rỗng sau xoá, tsc xanh (không còn tham chiếu), vitest các spec dùng payroll-api xanh, ESLint 0 cảnh báo.

## Lệnh kiểm
- git grep -nw adjustPayroll -- apps scripts: không kết quả (exit 1). Không dùng pathspec docs vì chính báo cáo này có chữ adjustPayroll.
- apps/miniapp: npx tsc --noEmit: exit 0
- npx eslint --max-warnings=0 src/services/payroll-api.ts: exit 0
- npx vitest run src/pages/admin.spec.tsx src/pages/my-payroll.spec.tsx: 2 file, 59 test xanh, exit 0

## Ghi nhận ngoài phạm vi
Review tìm thêm năm export client không ai gọi, chưa xoá vì cần đối chiếu backend và kế hoạch UI trước: attendance-api.ts adminAddSession, game-api.ts buySeeds, shifts-api.ts updateTemplate, storefront-api.ts reorderCollections và reorderItems. Mọi export còn lại của payroll-api.ts đều có nơi dùng.

## Chưa verify
Playwright e2e, capture/axe, full suite.

## Rủi ro
Thấp. File endpoints.json được sinh sẵn sẽ còn dòng adjust cho tới khi điều phối viên sinh lại (hoặc vẫn còn nếu nó quét backend).
