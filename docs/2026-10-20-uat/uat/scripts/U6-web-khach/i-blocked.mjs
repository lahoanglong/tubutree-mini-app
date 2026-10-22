// Nhóm I: các ca cần dịch vụ ngoài thật mà lane UAT không có. Ghi BLOCKED kèm lý do và bằng chứng cấu hình lane (không ghi khoá).
import fs from 'node:fs';
import path from 'node:path';
import { Recorder, finish, L, HARNESS_DIR } from './_lib.mjs';

const rec = new Recorder('i-blocked');
const env = fs.readFileSync(path.join(HARNESS_DIR, 'state', 'lane-6', 'lane.env'), 'utf8');
const val = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) ?? [])[1] ?? '(không đặt)';
const secretFree = (k) => `${k}=${/SECRET|TOKEN|KEY|PASSWORD/.test(k) ? '(có giá trị giả, không ghi ra)' : val(k)}`;

await rec.run('U6-95', { role: 'Khách mới', journey: 'Đăng nhập Zalo thật', steps: 'Đăng nhập web bằng tài khoản Zalo thật qua OAuth của Zalo, lần đầu: tạo khách mới', expected: 'Khách mới được tạo với zaloId thật, tên và ảnh đại diện lấy từ Zalo; lần sau vào lại đúng tài khoản' }, async (c) => {
  c.ev('cấu hình lane', [secretFree('ZALO_APP_SECRET'), 'NEXT_PUBLIC_ZALO_APP_ID=uat-fake-zalo-app-id (nhóm B) hoặc để trống (nhóm A)']);
  c.blocked('Cần ứng dụng Zalo thật, tài khoản Zalo thật và địa chỉ gọi lại đã đăng ký với Zalo. Lane chỉ có Zalo giả (nhóm B đã kiểm vòng đăng nhập, làm mới phiên, đăng xuất và các đường lỗi trên Zalo giả). Việc tạo khách mới qua OAuth thật cần người thật thử trên máy chủ chạy thật.');
});

await rec.run('U6-96', { role: 'Khách quay lại', journey: 'Chuyển khoản thật', steps: 'Chuyển tiền thật tới CONG TY TNHH TUBU TREE, 8386790906, Techcombank, đúng nội dung mã đơn; chờ ngân hàng báo về', expected: 'Đơn tự chuyển sang đã trả khi tiền về đúng số, đúng nội dung; thiếu tiền thì chưa trả' }, async (c) => {
  c.ev('webhook ngân hàng', 'bank-webhook.mjs (UAT) gọi đường webhook thật của API với chữ ký giả của lane');
  c.blocked('Không có tiền thật chạy qua tài khoản và không có nhà cung cấp đối soát thật trong lane. Phần xử lý của API đã được kiểm bằng webhook giả (U6-33: sai nội dung, chuyển thiếu, chuyển đủ). Cần thử một khoản chuyển khoản nhỏ thật trước khi mở khách.');
});

await rec.run('U6-97', { role: 'Khách quay lại', journey: 'Pancake thật', steps: 'Đặt đơn thật để Pancake nhận đơn, in vận đơn, báo trạng thái giao thật', expected: 'Đơn sang Pancake đúng sản phẩm, số lượng, địa chỉ, tiền thu hộ; trạng thái từ Pancake về web đúng' }, async (c) => {
  c.ev('cấu hình lane', [val('PANCAKE_BASE_URL'), `PANCAKE_SHOP_ID=${val('PANCAKE_SHOP_ID')}`, secretFree('PANCAKE_API_KEY')]);
  c.blocked('Khoá Pancake thật chưa có (đã ghi nhận: khoá điền khi deploy). Lane dùng Pancake giả ở cổng 3268; đơn sang Pancake giả và các trạng thái vận chuyển được kiểm ở nhóm D, E.');
});

await rec.run('U6-98', { role: 'Khách quay lại', journey: 'Gomdon, Zalo OA, ZaloPay', steps: 'Chọn thu gom rác tận nhà (Gomdon); nhận tin Zalo OA khi đơn đổi trạng thái; trả bằng ZaloPay', expected: 'Gomdon nhận yêu cầu; tin OA đến máy khách; ZaloPay không xuất hiện ở web (Q4: web chỉ nhận chuyển khoản và COD)' }, async (c) => {
  c.ev('cấu hình lane', [val('GOMDON_BASE_URL'), secretFree('ZALO_OA_ACCESS_TOKEN'), 'waste.lane_pickup_enabled=false']);
  c.blocked('Không có tài khoản Gomdon, OA và ZaloPay thật; đường thu gom tận nhà đang tắt trong cấu hình mặc định. Web phải chỉ nhận chuyển khoản và COD theo Q4; thực tế còn hiện Ví Tubu (xem U6-37).');
});

await finish(rec);
