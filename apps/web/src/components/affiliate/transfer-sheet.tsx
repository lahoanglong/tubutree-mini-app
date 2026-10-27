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
import { actionErrorText, loadErrorText } from '@/lib/error-text';
const errText = loadErrorText;
const actErrText = actionErrorText;

export interface TransferSheetProps {
  open: boolean;
  onClose: () => void;
  /** Toàn bộ hoa hồng có thể chuyển vào Ví (dashboard). */
  max: number;
  /** false khi dashboard lỗi: `max` tạm bằng 0, để máy chủ tự kiểm số dư thật. */
  knownMax: boolean;
  taxIdOnFile: string | null;
  /** Thuế máy chủ sẽ khấu trừ nếu chuyển hết ngay (dashboard.withdrawTaxPreview, cộng dồn tháng); thiếu khi API cũ. */
  taxPreview?: number;
  onDone: (message: string) => void;
}

/** Sheet "Chuyển hoa hồng vào Ví": mount khi mở để form lấy đúng `max` hiện tại và một Idempotency-Key mới cho mỗi lần mở. */
export function TransferSheet({ open, onClose, max, knownMax, taxIdOnFile, taxPreview, onDone }: TransferSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Chuyển hoa hồng vào Ví">
      {open && <TransferForm max={max} knownMax={knownMax} taxIdOnFile={taxIdOnFile} taxPreview={taxPreview} onDone={onDone} />}
    </Sheet>
  );
}

function TransferForm({ max, knownMax, taxIdOnFile, taxPreview, onDone }: Omit<TransferSheetProps, 'open' | 'onClose'>) {
  const cfgQ = useQuery({ ...publicConfigQuery(coreHttp), staleTime: 5 * 60_000 });
  const cfgLoaded = cfgQ.isSuccess;
  const pit = cfgQ.data?.affiliatePitWithhold;
  const [taxId, setTaxId] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Một khoá cho mỗi lần mở form: chạm đúp hay thử lại sau lỗi mạng gửi cùng khoá nên máy chủ không tạo lệnh thứ hai.
  const payKey = useRef(newIdempotencyKey());
  const busy = useRef(false);

  const mut = useMutation({
    mutationFn: () =>
      view.askTaxId ? requestPayout(coreHttp, max, payKey.current, taxId.trim()) : requestPayout(coreHttp, max, payKey.current),
    onSuccess: (r) => {
      onDone(r.note ?? 'Đã chuyển hoa hồng vào Ví Tubu.');
    },
    onError: (e) => setError(actErrText(e)),
    onSettled: () => {
      busy.current = false;
    },
  });

  const view = withdrawView({ max, pit, taxPreview, taxIdOnFile, taxId, cfgLoaded, knownMax, pending: mut.isPending });
  const submit = () => {
    // `disabled` chỉ có hiệu lực sau lần render kế: hai cú bấm trong cùng khung hình vẫn gọi mutate hai lần.
    if (busy.current || !view.valid) return;
    busy.current = true;
    setError(null);
    mut.mutate();
  };

  return (
    <div>
      {knownMax ? (
        <div>
          <div className="text-xs text-stone-700">Số tiền chuyển vào Ví</div>
          <div className="text-lg font-bold tabular-nums text-stone-900">{formatVnd(view.amount)}</div>
          <div className="mt-0.5 text-xs text-stone-600">Mỗi lần chuyển là toàn bộ hoa hồng có thể chuyển.</div>
          {view.tax > 0 && (
            <div className="mt-1 text-xs text-stone-700">
              Khấu trừ thuế TNCN {formatVnd(view.tax)} · thực nhận {formatVnd(view.net)}
            </div>
          )}
          {view.tax > 0 && taxIdOnFile && <div className="mt-0.5 text-xs text-stone-600">Kê khai khấu trừ theo MST/CCCD {taxIdOnFile}</div>}
        </div>
      ) : (
        <p role="alert" className="text-xs text-danger-fg">
          Chưa tải được số hoa hồng có thể chuyển. Đóng lại rồi thử lại sau ít phút.
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

      {cfgQ.isError && (
        <div className="mt-3 flex items-center gap-2">
          <p role="alert" className="text-xs text-danger-fg">
            Chưa tải được cấu hình thuế.
          </p>
          <button type="button" onClick={() => void cfgQ.refetch()} className="text-xs font-semibold text-stone-900 underline">
            Thử lại
          </button>
        </div>
      )}
      <div role="alert">{error && <p className={`mt-3 ${ui.error}`}>{error}</p>}</div>
      <button type="button" onClick={submit} disabled={!view.valid} className={`${ui.btnPrimary} mt-5 w-full`}>
        {mut.isPending ? 'Đang gửi…' : cfgQ.isError ? 'Thử lại sau' : !cfgLoaded ? 'Đang tải…' : `Nhận ${formatVnd(view.net)} vào Ví`}
      </button>
    </div>
  );
}
