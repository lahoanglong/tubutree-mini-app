'use client';

import { useState } from 'react';
import {
  downloadPayoutsCsv,
  downloadPitCsv,
  downloadRefundsCsv,
  type PayoutExportStatus,
  type RefundExportStatus,
  type ReportRange,
} from '@/lib/admin-reports-client';
import { REVENUE_MAX_DAYS, rangeError } from '@/lib/admin-reports';
import { BTN_SECONDARY, FIELD_XS, Notice } from './ui';

const PAYOUT_STATUS_OPTIONS: { value: '' | PayoutExportStatus; label: string }[] = [
  { value: '', label: 'Mọi trạng thái' },
  { value: 'REQUESTED', label: 'Đang chờ duyệt' },
  { value: 'APPROVED', label: 'Đã duyệt, chờ chuyển khoản' },
  { value: 'PAID', label: 'Đã chuyển khoản' },
  { value: 'REJECTED', label: 'Bị từ chối (đã hoàn)' },
];

const REFUND_STATUS_OPTIONS: { value: '' | RefundExportStatus; label: string }[] = [
  { value: '', label: 'Mọi trạng thái' },
  { value: 'OPEN', label: 'Đang mở (còn việc)' },
  { value: 'UNVERIFIED', label: 'Chờ đối soát' },
  { value: 'PENDING', label: 'Chờ chuyển khoản' },
  { value: 'PROCESSING', label: 'Đang chuyển khoản' },
  { value: 'COMPLETED', label: 'Đã chuyển' },
  { value: 'DISMISSED', label: 'Không phải tiền dư' },
];

type Kind = 'tax' | 'payouts' | 'refunds';

/** Ba file CSV cho kế toán: khấu trừ TNCN của CTV, lệnh chuyển hoa hồng, hoàn tiền khách. Dùng khoảng ngày chung của tab Báo cáo. */
export function ReportsFinanceSection({ range }: { range: ReportRange }) {
  const error = rangeError(range.from, range.to, REVENUE_MAX_DAYS);
  const [payoutStatus, setPayoutStatus] = useState<'' | PayoutExportStatus>('');
  const [refundStatus, setRefundStatus] = useState<'' | RefundExportStatus>('');
  const [busy, setBusy] = useState<Kind | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (kind: Kind) => {
    setMsg(null);
    setBusy(kind);
    try {
      const r =
        kind === 'tax'
          ? await downloadPitCsv(range)
          : kind === 'payouts'
            ? await downloadPayoutsCsv(range, payoutStatus || undefined)
            : await downloadRefundsCsv(range, refundStatus || undefined);
      setMsg({ ok: true, text: `Đã tải ${r.filename}.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không xuất được CSV.' });
    } finally {
      setBusy(null);
    }
  };
  const disabled = !!error || busy !== null;

  return (
    <section className="space-y-3" aria-labelledby="reports-finance-title">
      <h3 id="reports-finance-title" className="text-base font-semibold text-stone-900">
        Xuất file cho kế toán
      </h3>
      {error && <Notice tone="warning" role="alert">{error}</Notice>}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
          <h4 className="text-sm font-medium text-stone-900">Khấu trừ thuế TNCN của CTV</h4>
          <p className="text-xs text-stone-500">Mỗi người nhận một dòng, gồm các lệnh đã chi hoa hồng trong khoảng ngày chi (giờ Việt Nam). Cùng số với bảng theo tháng ở mục Thuế TNCN hoa hồng.</p>
          <button type="button" disabled={disabled} onClick={() => void run('tax')} className={BTN_SECONDARY}>
            {busy === 'tax' ? 'Đang xuất…' : 'Xuất CSV thuế TNCN'}
          </button>
        </div>
        <div className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
          <h4 className="text-sm font-medium text-stone-900">Lệnh chuyển hoa hồng vào Ví và lệnh rút cũ</h4>
          <p className="text-xs text-stone-500">Chuyển hoa hồng CTV vào Ví Tubu và lệnh rút ngân hàng cũ, theo ngày yêu cầu, kèm tài khoản nhận và mã giao dịch ngân hàng nếu có.</p>
          <label className="block text-xs text-stone-600">
            Trạng thái
            <select value={payoutStatus} onChange={(e) => setPayoutStatus(e.target.value as '' | PayoutExportStatus)} className={`${FIELD_XS} mt-1 block w-full`}>
              {PAYOUT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={disabled} onClick={() => void run('payouts')} className={BTN_SECONDARY}>
            {busy === 'payouts' ? 'Đang xuất…' : 'Xuất CSV lệnh chuyển hoa hồng'}
          </button>
        </div>
        <div className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
          <h4 className="text-sm font-medium text-stone-900">Hoàn tiền khách</h4>
          <p className="text-xs text-stone-500">Khoản hoàn do huỷ đơn, trả hàng, tiền về muộn hoặc chuyển dư, theo ngày tạo khoản hoàn, kèm tài khoản nhận.</p>
          <label className="block text-xs text-stone-600">
            Trạng thái
            <select value={refundStatus} onChange={(e) => setRefundStatus(e.target.value as '' | RefundExportStatus)} className={`${FIELD_XS} mt-1 block w-full`}>
              {REFUND_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={disabled} onClick={() => void run('refunds')} className={BTN_SECONDARY}>
            {busy === 'refunds' ? 'Đang xuất…' : 'Xuất CSV hoàn tiền'}
          </button>
        </div>
      </div>
      <p className="text-xs text-stone-500">File có tài khoản ngân hàng và mã số thuế của người nhận: chỉ tài khoản quản trị tải được; giữ file trong máy làm việc, không gửi qua kênh chung.</p>
      {msg && (
        <Notice tone={msg.ok ? 'success' : 'danger'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </Notice>
      )}
    </section>
  );
}
