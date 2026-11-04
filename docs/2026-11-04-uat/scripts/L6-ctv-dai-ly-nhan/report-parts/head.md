# UAT lane 6: Cộng tác viên, Đại lý, Chủ nhãn

Ngày chạy: 04/11/2026, bắt đầu khoảng 03:56 giờ máy và dừng khoảng 05:35 giờ máy, sớm hơn mức 3 giờ cho phép vì đã hết ca cần kiểm trong phạm vi. Người chạy: agent UAT lane 6, khoá `L6-ctv-dai-ly-nhan`.

## Môi trường

| Mục | Giá trị |
|---|---|
| Mã nguồn | worktree `uat-1104`, SHA `98803f006` (giống PROD) |
| Lane | 6: API 3261, web 3262, Mini 3263, Pancake giả 3268, DB `tubutree_uat_l6`, Redis db 6 |
| Dựng lane | `lane-down`, `lane-db create --fresh`, `lane-up --web`, `prisma migrate deploy`, `lane-down` + `lane-up --web`, `seed-data all`; xoá thêm `app-orders.json` của Pancake giả để mã đơn không va đơn cũ |
| Migration | 267 thư mục, 267 dòng `_prisma_migrations` đã chạy xong, 0 dòng dở |
| Persona | `ctv`, `ctv_pending`, `dealer`, `brand`, `new`, `admin`, `ketoan` (cộng `returning` làm CTV thứ hai) |
| Khổ màn hình | Mini 375, web 375, web 1280 |
| Dữ liệu | Không đọc, không ghi PROD. Không gọi `api.tubutree.com` hay `app.tubutree.com`. |

## Cách chạy lại

Mỗi ca là một script chạy lại được, ở `docs/2026-11-04-uat/scripts/L6-ctv-dai-ly-nhan/`. Chạy từ gốc worktree `uat-1104` với `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`. Thứ tự trên lane mới dựng: `c1-money`, `c2-tax-milestone`, `c3-debt`, `c4-storefront`, `c5-dealer`, `c6-brand`, `c8-partial-return`, `c10-order-for-customer`, `c11-quests-rbac-idor`, `c12-dealer-tiers`, `c13-sf-settings-copy`, `c16-layout-375`, `c7-ui`, `c9-ui-flows` (đặt `CLICK=1` để bấm thật "Chuyển vào Ví" ở cuối), `c14-payout-race-note`, `c15-dealer-bonus-rewards` (chờ 66 giây bên trong), rồi `c17-order-sheet-ui`, `c18-idor-orders-templates`, `c19-dealer-order-ui`, `c20-ctv-order-ui`, `c21-brand-owner-ui`, `c22-builder-ui`, `c23-dealer-credit-race`, `c24-reversal-race`, `c25-credit-payment-race`, `c26-storefront-identifiers-images`, `c27-dealer-doubleclick-ui` và `c28-dealer-idor` (c28 đổi vai persona `new` thành DEALER rồi trả về CUSTOMER). `c9b-explore.mjs` và `c9c-explore-sf.mjs` chỉ chụp ảnh khám phá, không ghi ca. Dựng lane theo thứ tự trong `brief.md`, nhớ xoá `state/lane-6/pancake/app-orders.json` trước khi bật Pancake giả. Kết quả ghi nối vào `results.jsonl`; `build-report.mjs` dựng bảng dưới đây từ file đó. Ảnh chụp ở `docs/2026-11-04-uat/shots/L6-ctv-dai-ly-nhan/`.

## Tóm tắt kết quả

Lane 6 không tìm thấy lỗi mất tiền, mất điểm hay lộ dữ liệu; một lỗi nhỏ có thể chặn một đơn hợp lệ của đại lý khi hai lệnh đến cùng lúc (L6-B07). Mọi ca tiền, điểm, ví, hoa hồng, thưởng mốc, thu hồi và công nợ đều khớp sổ SQL, và hai script đối soát của repo báo 0 user lệch. Chín ca FAIL gom thành bảy lỗi ở mục dưới: sáu lỗi là lệch giao diện hoặc chữ giữa web 375 và Mini, hoặc chữ bị cắt ở khổ 375 (nhóm P2 và P3); lỗi thứ bảy (L6-B07, P2) là API: hai đơn Ghi công nợ của đại lý đến cùng lúc thì bên thua nhận 500 "Lỗi cơ sở dữ liệu." thay vì lỗi thử lại được, tiền và công nợ vẫn đúng.


## Bảng ca

Cột "Thực tế" và "Bằng chứng" được cắt cho gọn; bản đầy đủ của từng ca nằm trong `scripts/L6-ctv-dai-ly-nhan/results.jsonl`. Mỗi ca tiền, điểm, ví, hoa hồng đều đối chiếu SQL trong cột "Bằng chứng" hoặc trong cột "Thực tế" (số dư ví so với tổng sổ ví, tổng hoa hồng PAID so với dòng payouts, dòng REVERSAL, bảng `ctv_milestone_claims`, `dealer_credit_ledgers`).

