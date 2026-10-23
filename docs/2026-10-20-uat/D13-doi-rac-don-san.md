# D13-doi-rac-don-san — Đổi rác, đơn sàn, giới thiệu

## Tóm tắt

Không có phát hiện P0 hoặc P1 cho đổi rác và đơn sàn. Đã đối chiếu với các tài liệu review trước (findings-catalog, review launch 2026-10-18 và ghi chú impl, D1–D5 đêm nay). Chỉ còn một phát hiện mới: D13-01 (P2). API không ép luật đã chốt "hộp sữa và vỏ chai Tubu chỉ kho HCMC nhận". Luật này chỉ dựa vào việc admin không tick hai món đó ở điểm đại lý. API nhận chúng ở điểm PARTNER. Bước xác nhận tại quầy không kiểm lại món điểm nhận.

Các phần đã lần theo mã và thấy có chốt chặn, không tìm được kịch bản lỗi:
- Quyền quầy: kiểm tra điểm chạy lại trong giao dịch có khoá. Điểm đại lý chỉ nhận món đã liên kết. Nhân viên không xác nhận được yêu cầu của chính mình hoặc yêu cầu trùng số điện thoại. Nhân viên đại lý không xác nhận được yêu cầu của đồng nghiệp. Yêu cầu lấy tận nơi phải xác nhận tại kho.
- Cộng điểm hai lần: một lý do sổ cái cho mỗi yêu cầu (RECYCLE:<code>) cộng điều kiện trạng thái. Hoàn chỉ từ COMPLETED. Mở lại chỉ từ EXPIRED.
- Một lần cộng cho mỗi mã vận đơn: một claim cho mỗi dòng đơn. Cùng mã hoặc cùng số đơn sàn đã claim ở dòng khác bị chặn. Ai đến trước được trước. Người gửi khác nhận "đã được tài khoản khác nhận".
- Mã vận đơn của người khác: 3 số cuối điện thoại lệch thì claim vào duyệt tay. Đã biết từ trước: đơn không có chữ số điện thoại thì không kiểm.
- Số điện thoại đổi chủ: phoneVerifiedAt quá 180 ngày vào duyệt tay. Điện thoại trên đơn đổi cũng vào duyệt tay.
- Đơn sàn: 1%, hệ số 1, countsForTier=false, spending12m chỉ tính claim PHONE.
- Đơn CSKH khớp điện thoại: trả sau giao + 14 ngày. Giữ 30 ngày khi chưa có thành viên. Huỷ hoặc hoàn khi trả hàng.
- Giới thiệu: chỉ mục duy nhất hai sổ cái, thu hồi theo tỷ lệ.

Hai điểm là theo thiết kế, không phải phát hiện:
- Mọi STAFF dùng được quầy đổi rác (staff-permissions.ts: quầy thu ngân, đổi vỏ chai, chấm công không cần nhóm).
- Web và Mini App dùng chung API gửi claim, vì số điện thoại luôn lấy từ Zalo.

DB UAT hiện không có điểm rác (waste_points rỗng), nên lỗi được lần theo mã, chưa tái hiện trên dữ liệu. Không chạy test, không sửa file.

## Phạm vi đã đọc

Đọc đủ: docs/2026-10-20-uat/00-brief.md; waste-exchange: core/waste-hold.service.ts, core/waste-access.service.ts, core/waste-caps.ts, waste-points.ts, waste.constants.ts, customer/waste-requests.service.ts, receiving/{waste-desk.service, waste-desk.controller, waste-receive.service, waste-confirm.service, waste-confirm-lines, waste-quota, waste-match, waste-reverse.service}.ts, catalog/waste-gift-redemptions.service.ts, catalog/waste-admin-points.service.ts (create/update/staff), pickup/{waste-pickup-attach, waste-pickup-hooks.service, waste-expiry.cron}.ts, giá trị mặc định trần trong waste-config.keys.ts; external-points: external-claim.service.ts, external-claim.rules.ts, external-claim.config.ts, external-claim-release.ts, external-claim-status.ts, external-chat.claim.ts, external-chat.rules.ts, external-claims-admin.service.ts, external-claims.controller.ts, external-points-rate.ts, phần goodsValue/deliveredAt của external-order.mapper.ts; loyalty.service.ts (spending12m/chatSpending12m, runRedeem cho quà rác); common/staff-access.ts, staff-permissions.ts, guards/roles.guard.ts; route và @Roles trong waste-admin-requests.controller.ts; miniapp i18n vi.ts (externalPoints); ô tick món trong web waste-point-form.tsx; checklist docs/launch/recycle-rewards-launch-checklist.md. DB UAT (chỉ SELECT, qua Prisma): waste_items (5 món, x1.000 đúng), waste_points rỗng, waste_point_items rỗng, một số system_configs loyalty.chat_*.

Đọc lướt: khoảng 260 dòng đầu wallet/referral-reward.ts, grep auth.service.ts về referral/merge.

Chưa đọc: waste-admin-requests.service.ts (chỉ grep reopen), waste-admin-gifts/items, waste-reports, waste-alerts, waste-ship-lock, waste-catalogue/preview/me, external-order.ingest/sync, external-claim-lookup/poll, external-orders-admin, phần còn lại của referral-reward.ts và đường giới thiệu trong checkout/orders, màn hình đổi rác của Mini App và web.

Test: không chạy (không cần file nào để chứng minh phát hiện).

## Bảng phát hiện

| ID | Mức (sau soát) | Soát chéo | Nhóm | Vùng | Vị trí | Mô tả + kịch bản | Đề xuất sửa + test |
|---|---|---|---|---|---|---|---|
| D13-01 | P2 | chưa soát | agent sửa ngay | UAT (api); file web waste-point-form.tsx thuộc vùng phiên web | apps/api/src/modules/waste-exchange/catalog/waste-admin-points.service.ts:172; :178; :249-257; core/waste-hold.service.ts:234-243; receiving/waste-confirm.service.ts:376-451; apps/web/src/components/admin/waste-point-form.tsx:381-383 | API không ép luật "hộp sữa và vỏ chai Tubu chỉ kho HCMC nhận". Admin tick hai món này ở điểm PARTNER, lưu được. Khách tạo yêu cầu DROP_OFF 50 hộp sữa, được ước tính 10.000 điểm. Nhân viên đại lý xác nhận, khách nhận 10.000 Điểm Xanh. Xem chi tiết bên dưới. | Chặn ở create/update khi kind=PARTNER (danh sách món cho phép, ví dụ WASTE_PARTNER_ALLOWED_ITEM_CODES). Thêm chặn ở waste-hold và lockAndCheck. Web ẩn hai món khi kind=PARTNER. Test: xem chi tiết. |

Không có P0, P1, P3 trong bảng.

## Chi tiết P0/P1

Không có phát hiện P0 hoặc P1. Phát hiện P2 duy nhất ghi lại đầy đủ ở đây để tiện tra cứu.

### D13-01 (P2, soát chéo: chưa soát, trước đó: mới)

Tiêu đề: API không ép luật "hộp sữa và vỏ chai Tubu chỉ kho HCMC nhận". Admin tick được hai món này ở điểm đại lý, bước xác nhận không kiểm lại.

Kịch bản:
1. Admin mở form sửa điểm PARTNER, tick nhầm "Vỏ hộp sữa sạch" (wi-milk-carton) hoặc quên checklist, rồi lưu. PUT gửi itemIds=[wi-carton, wi-milk-carton]. API chỉ kiểm món có tồn tại (dòng 251), rồi deleteMany/createMany waste_point_items (dòng 256-257) và trả 200.
2. Khách tạo yêu cầu DROP_OFF tại điểm đó với 50 hộp sữa. Hold service chỉ so với liên kết của chính điểm (waste-hold.service.ts:235-236), nên không có POINT_MISSING_ITEMS. estimatedPoints = floor(50/5)*1000 = 10.000.
3. Nhân viên đại lý tra mã TR- và xác nhận. lockAndCheck kiểm quyền điểm, trạng thái, tự xác nhận/đồng nghiệp, người dùng bị chặn, nhưng không kiểm wastePointItem. Khách được cộng 10.000 Điểm Xanh tại điểm đại lý. Trái luật đã chốt "đại lý chỉ nhận carton và nilon".
4. Dù admin bỏ tick sau đó, yêu cầu tạo lúc đang tick vẫn xác nhận được ở đại lý, vì confirm không kiểm lại.

Bằng chứng:
- waste-admin-points.service.ts:249-257: `if (body.itemIds !== undefined) { const ids = [...new Set(body.itemIds)]; if ((await tx.wasteItem.count({ where: { id: { in: ids } } })) !== ids.length) throw ...; ... await tx.wastePointItem.createMany({ data: ids.map((itemId) => ({ pointId: id, itemId })) }); }`. Không có nhánh theo cur.kind === 'PARTNER' và không có nhánh theo mã món. create (dòng 172-199) làm giống vậy.
- waste-hold.service.ts:234-236 chỉ kiểm `links.has(l.itemId)` với liên kết của chính điểm.
- Form web waste-point-form.tsx:381-383 liệt kê mọi món thành ô tick cho mọi loại điểm, không cảnh báo.
- docs/launch/recycle-rewards-launch-checklist.md:36 xác nhận luật chỉ được giữ bằng tay: "khi đăng ký đại lý, KHÔNG tick hai món này".
- DB UAT hiện có 0 waste_points, nên chưa tái hiện trên dữ liệu. Đã lần theo mã.

Lý do soát chéo: chưa có dữ liệu soát chéo cho phát hiện này (verdicts rỗng).

Đề xuất sửa: thêm chốt phía server trong create/update của waste-admin-points.service.ts. Khi kind là PARTNER (cur.kind khi update), từ chối itemIds có món ngoài danh sách cho phép (ví dụ hằng WASTE_PARTNER_ALLOWED_ITEM_CODES = ['CARTON','BUBBLE_WRAP'], hoặc thêm cột warehouseOnly trên WasteItem nếu chủ muốn cấu hình). Trả 400 "Món này chỉ kho Tubu nhận". Phòng thủ nhiều lớp: ở waste-hold.service.ts, với điểm PARTNER, từ chối dòng có các món đó (POINT_MISSING_ITEMS). Ở lockAndCheck với pointKind PARTNER, từ chối xác nhận yêu cầu có dòng chỉ-kho. Form web (file thuộc vùng phiên web) nên ẩn hoặc khoá hai món khi kind=PARTNER.

Test nên viết (phải fail trước khi sửa):
- (a) waste-admin-points.service.spec: cập nhật điểm PARTNER với itemIds chứa wi-milk-carton thì trả 400, không tạo dòng waste_point_items.
- (b) Điểm WAREHOUSE với cùng itemIds thì trả 200.
- (c) waste-confirm.service.spec: yêu cầu PARTNER có dòng TUBU_BOTTLE (dữ liệu seed trực tiếp), xác nhận qua route DESK trả 403/409 và không cộng điểm.

## Bỏ sót do soát chéo phát hiện

Không có.

## Đã bác bỏ

Không có.
