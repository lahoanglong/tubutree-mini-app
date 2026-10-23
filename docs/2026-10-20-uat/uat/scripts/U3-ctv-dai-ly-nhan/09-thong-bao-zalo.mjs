#!/usr/bin/env node
// U3-45: tin Zalo (ZNS/OA) cho CTV và đại lý. Bộ khung tắt mọi tin ra ngoài (README uat-harness mục 2), nên chỉ đối chiếu được
// thông báo trong app; ca ghi BLOCKED kèm số dòng notification_logs theo kênh để thấy rõ phần đã và chưa kiểm.
// Dùng: node 09-thong-bao-zalo.mjs
import { closeDb, recorder, short, sql } from './u3lib.mjs';

const R = recorder('09-thong-bao-zalo');
try {
  const rows = await sql(
    `SELECT "templateCode" t, channel, status, count(*)::int n FROM notification_logs
      WHERE "userId" IN ('uat_ctv','uat_dealer') AND "templateCode" IN ('COMMISSION_NEW','COMMISSION_APPROVED','COMMISSION_PAYOUT_APPROVED','COMMISSION_PAYOUT_PAID','DEALER_BONUS_PAID','DEALER_CREDIT_PAYMENT_CONFIRMED','DEALER_REWARD_CLAIM_PAID')
      GROUP BY 1,2,3 ORDER BY 1,2`,
  );
  const zns = rows.filter((r) => r.channel !== 'INAPP').length;
  R.add({
    id: 'U3-45', role: 'CTV / đại lý', journey: 'Tin báo tiền qua Zalo', title: 'Tin ZNS/OA khi có hoa hồng, lệnh rút đã chi, thưởng quý, kế toán ghi trả nợ',
    steps: 'Sau U3-04..U3-15 và U3-28..U3-33: SQL notification_logs của uat_ctv, uat_dealer theo mẫu và kênh',
    expected: 'Mỗi sự kiện tiền có thông báo trong app; tin ZNS/OA gửi theo mẫu đã đăng ký',
    actual: { rows, nonInappRows: zns },
    evidence: `SQL notification_logs ${short(rows, 900)}`,
    status: 'BLOCKED',
    data: { reason: 'Lane UAT tắt Zalo OA/ZNS (tools/uat-harness/README.md mục 2, VITE_ZALO_OA_ID trống); chỉ kiểm được kênh INAPP, tất cả SENT.' },
  });
} catch (e) {
  R.add({ id: 'U3-45', title: 'script lỗi', actual: String(e?.message ?? e).slice(0, 600), status: 'BLOCKED' });
} finally {
  R.save();
  await closeDb();
}
