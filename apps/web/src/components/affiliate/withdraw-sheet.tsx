'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { requestPayout } from '@tubutree/app-core/api/affiliate';
import { withdrawView } from '@tubutree/app-core/affiliate-rules';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { newIdempotencyKey } from '@/lib/idempotency-key';
import { Sheet } from '@/components/ui/sheet';
import { Field } from '@/components/ui/field';
import { ChoiceCard } from './choice-card';
import { formatVndShort } from './vnd-short';

const DEFAULT_MIN_BANK = 50_000;
const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

export interface WithdrawSheetProps {
  open: boolean;
  onClose: () => void;
  /** Toàn bộ hoa hồng có thể rút (dashboard). */
  max: number;
  /** false khi dashboard lỗi: `max` tạm bằng 0, để máy chủ tự kiểm số dư thật. */
  knownMax: boolean;
  taxIdOnFile: string | null;
  onDone: (message: string) => void;
}

/** Sheet "Rút hoa hồng": mount khi mở để form lấy đúng `max` hiện tại và một Idempotency-Key mới cho mỗi lần mở. */
export function WithdrawSheet({ open, onClose, max, knownMax, taxIdOnFile, onDone }: WithdrawSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Rút hoa hồng">
      {open && <WithdrawForm max={max} knownMax={knownMax} taxIdOnFile={taxIdOnFile} onDone={onDone} />}
    </Sheet>
  );
}

function WithdrawForm({ max, knownMax, taxIdOnFile, onDone }: Omit<WithdrawSheetProps, 'open' | 'onClose'>) {
  const cfgQ = useQuery({ ...publicConfigQuery(coreHttp), staleTime: 5 * 60_000 });
  const cfgLoaded = cfgQ.isSuccess;
  const minBank = cfgQ.data?.affiliateMinWithdrawBank ?? DEFAULT_MIN_BANK;
  const pit = cfgQ.data?.affiliatePitWithhold;
  const [method, setMethod] = useState<'BANK' | 'WALLET_BALANCE'>('WALLET_BALANCE');
  const [bank, setBank] = useState({ bankName: '', accountNumber: '', accountName: '' });
  const [taxId, setTaxId] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Một khoá cho mỗi lần mở form: chạm đúp hay thử lại sau lỗi mạng gửi cùng khoá nên máy chủ không tạo lệnh rút thứ hai.
  const payKey = useRef(newIdempotencyKey());
  const busy = useRef(false);

  const mut = useMutation({
    mutationFn: () =>
      view.askTaxId
        ? requestPayout(coreHttp, max, method, method === 'BANK' ? bank : undefined, payKey.current, taxId.trim())
        : requestPayout(coreHttp, max, method, method === 'BANK' ? bank : undefined, payKey.current),
    onSuccess: (r) => {
      onDone(r.note ?? (method === 'BANK' ? 'Đã gửi lệnh rút. Theo dõi trạng thái ở mục Lệnh rút.' : 'Đã gửi yêu cầu rút.'));
    },
    onError: (e) => setError(errText(e)),
    onSettled: () => {
      busy.current = false;
    },
  });

  const view = withdrawView({ max, method, pit, taxIdOnFile, taxId, minBank, cfgLoaded, knownMax, bank, pending: mut.isPending });
  const submit = () => {
    // `disabled` chỉ có hiệu lực sau lần render kế: hai cú bấm trong cùng khung hình vẫn gọi mutate hai lần.
    if (busy.current || !view.valid) return;
    busy.current = true;
    setError(null);
    mut.mutate();
  };

  return (
    <div>
      <div role="group" aria-label="Rút về đâu" className="mb-3 flex gap-2">
        <ChoiceCard active={method === 'WALLET_BALANCE'} title="Ví Tubu" sub="Quy đổi 1:1, nhận ngay" onPress={() => setMethod('WALLET_BALANCE')} />
        <ChoiceCard
          active={method === 'BANK'}
          title="Ngân hàng"
          sub={cfgLoaded ? `Tối thiểu ${formatVndShort(minBank)}` : 'Đang tải mốc tối thiểu…'}
          onPress={() => setMethod('BANK')}
        />
      </div>

      {knownMax ? (
        <div>
          <div className="text-xs text-stone-700">Số tiền rút</div>
          <div className="text-lg font-bold tabular-nums text-stone-900">{formatVnd(view.amount)}</div>
          <div className="mt-0.5 text-xs text-stone-600">Mỗi lần rút là toàn bộ hoa hồng có thể rút.</div>
          {view.tax > 0 && (
            <div className="mt-1 text-xs text-stone-700">
              Khấu trừ thuế TNCN {formatVnd(view.tax)} · thực nhận {formatVnd(view.net)}
            </div>
          )}
          {view.tax > 0 && taxIdOnFile && <div className="mt-0.5 text-xs text-stone-600">Kê khai khấu trừ theo MST/CCCD {taxIdOnFile}</div>}
        </div>
      ) : (
        <p role="alert" className="text-xs text-danger-fg">
          Chưa tải được số hoa hồng có thể rút. Đóng lại rồi thử lại sau ít phút.
        </p>
      )}

      {view.askTaxId && (
        <div className="mt-3">
          <Field label="Mã số thuế cá nhân hoặc số CCCD">
            <input inputMode="numeric" value={taxId} onChange={(e) => setTaxId(e.target.value)} className={ui.field} />
          </Field>
          <div className={`mt-1 text-xs ${taxId.trim() && !view.taxIdValid ? 'text-danger-fg' : 'text-stone-600'}`}>
            {taxId.trim() && !view.taxIdValid
              ? 'Mã số thuế cá nhân gồm 10 chữ số, hoặc số CCCD 12 chữ số.'
              : 'Tubu Tree dùng số này để kê khai thuế đã khấu trừ và cấp chứng từ khấu trừ cho bạn. Chỉ cần nhập một lần.'}
          </div>
        </div>
      )}

      {method === 'BANK' && (
        <div className="mt-3 space-y-2.5">
          <Field label="Tên ngân hàng">
            <input value={bank.bankName} onChange={(e) => setBank((b) => ({ ...b, bankName: e.target.value }))} className={ui.field} />
          </Field>
          <Field label="Số tài khoản">
            <input inputMode="numeric" value={bank.accountNumber} onChange={(e) => setBank((b) => ({ ...b, accountNumber: e.target.value }))} className={ui.field} />
          </Field>
          <Field label="Chủ tài khoản">
            <input value={bank.accountName} onChange={(e) => setBank((b) => ({ ...b, accountName: e.target.value }))} className={ui.field} />
          </Field>
        </div>
      )}

      <div role="alert">{error && <p className={`mt-3 ${ui.error}`}>{error}</p>}</div>
      <button type="button" onClick={submit} disabled={!view.valid} className={`${ui.btnPrimary} mt-5 w-full`}>
        {mut.isPending ? 'Đang gửi…' : !cfgLoaded ? 'Đang tải…' : method === 'WALLET_BALANCE' ? `Nhận ${formatVnd(view.net)} vào Ví` : `Rút ${formatVnd(view.amount)}`}
      </button>
    </div>
  );
}
