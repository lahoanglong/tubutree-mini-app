'use client';

import { useState } from 'react';
import { Hourglass, Store } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { applyDealer, type DealerApplyInput } from '@tubutree/app-core/api/dealer';
import { dealerMeQuery } from '@tubutree/app-core/queries/dealer';
import { coreHttp } from '@/lib/core-http';
import { usePublicConfig } from '@/lib/use-public-config';
import { applyPitch, pendingBody } from '@/lib/dealer-view';
import { ui } from '@/lib/guest-ui';
import { Field } from '@/components/ui/field';
import { EvidenceUpload } from '@/components/evidence-upload';
import { DealerShell, errText } from './dealer-shell';

/** Hồ sơ đang chờ duyệt. Số giờ chỉ hiện khi cấu hình thật đã về. */
export function DealerPending() {
  const config = usePublicConfig();
  return (
    <DealerShell title="Hồ sơ đại lý">
      <div role="status" className="py-12 text-center">
        <Hourglass className="mx-auto h-12 w-12 text-stone-900" strokeWidth={1.5} aria-hidden="true" />
        <h2 className="mt-3 font-display text-lg font-semibold text-stone-900">Hồ sơ đang được duyệt</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-stone-600">{pendingBody(config.isLoaded ? config.dealer?.reviewHours : null)}</p>
      </div>
    </DealerShell>
  );
}

/** Đăng ký đại lý. SĐT gõ tay như Mini App (web không có SĐT đã xác minh qua Zalo). */
export function DealerApply({ rejected, rejectionReason }: { rejected: boolean; rejectionReason: string | null }) {
  const config = usePublicConfig();
  const qc = useQueryClient();
  const [form, setForm] = useState<DealerApplyInput>({ businessName: '', ownerName: '', phone: '', address: '', cccdFrontUrl: '', cccdBackUrl: '' });
  const [done, setDone] = useState(false);

  const mut = useMutation({
    mutationFn: () => applyDealer(coreHttp, form),
    onSuccess: () => {
      setDone(true);
      void qc.invalidateQueries({ queryKey: dealerMeQuery(coreHttp).queryKey });
    },
  });

  const set = (k: keyof DealerApplyInput) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = Boolean(
    form.businessName.trim() && form.ownerName.trim() && form.phone.trim() && form.address.trim() && form.cccdFrontUrl.trim() && form.cccdBackUrl.trim(),
  );

  return (
    <DealerShell title="Đăng ký đại lý">
      <div className="mx-auto max-w-xl">
        <div className="rounded-card bg-stone-900 p-4 text-stone-0 max-md:bg-[var(--color-dealer-ink)]">
          <Store className="h-6 w-6" aria-hidden="true" />
          <h2 className="mt-1 font-display text-lg font-semibold">Trở thành đại lý Tubu</h2>
          <p className="mt-1 text-sm text-stone-100">{applyPitch(config.isLoaded ? config.dealer?.maxDiscountPct : null)}</p>
        </div>

        {rejected && (
          <div className="mt-3 rounded-control bg-danger-bg p-3 text-sm text-danger-fg">
            <p>Hồ sơ trước bị từ chối. Vui lòng kiểm tra lại thông tin và nộp lại.</p>
            {rejectionReason && <p className="mt-1 font-semibold">Lý do: {rejectionReason}</p>}
          </div>
        )}

        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !mut.isPending) mut.mutate();
          }}
        >
          <Field label="Tên doanh nghiệp / cửa hàng *">
            <input className={ui.field} value={form.businessName} onChange={set('businessName')} />
          </Field>
          <Field label="Mã số thuế">
            <input className={ui.field} value={form.taxCode ?? ''} onChange={set('taxCode')} />
          </Field>
          <Field label="Người đại diện *">
            <input className={ui.field} value={form.ownerName} onChange={set('ownerName')} />
          </Field>
          <Field label="Số điện thoại *">
            <input className={ui.field} type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Địa chỉ kinh doanh *">
            <input className={ui.field} value={form.address} onChange={set('address')} />
          </Field>
          <EvidenceUpload
            label="Ảnh CCCD mặt trước *"
            hint="bắt buộc"
            max={1}
            value={form.cccdFrontUrl ? [form.cccdFrontUrl] : []}
            onChange={(imgs) => setForm((f) => ({ ...f, cccdFrontUrl: imgs[0] ?? '' }))}
          />
          <EvidenceUpload
            label="Ảnh CCCD mặt sau *"
            hint="bắt buộc"
            max={1}
            value={form.cccdBackUrl ? [form.cccdBackUrl] : []}
            onChange={(imgs) => setForm((f) => ({ ...f, cccdBackUrl: imgs[0] ?? '' }))}
          />
          <div role="status" aria-live="polite">
            {done && <p className="text-sm font-medium text-success-fg">Đã gửi hồ sơ đăng ký đại lý!</p>}
          </div>
          {mut.isError && (
            <p role="alert" className={ui.error}>
              {errText(mut.error)}
            </p>
          )}
          <button type="submit" disabled={!valid || mut.isPending} className={`${ui.btnPrimary} mt-2 w-full`}>
            {mut.isPending ? 'Đang gửi...' : 'Gửi hồ sơ đăng ký'}
          </button>
        </form>
      </div>
    </DealerShell>
  );
}
