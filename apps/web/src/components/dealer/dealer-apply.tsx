'use client';

import { useEffect, useState } from 'react';
import { DEALER_REJECTED_RESUBMIT } from '@tubutree/app-core/client-copy';
import { Hourglass, Store } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { applyDealer, type DealerApplyInput } from '@tubutree/app-core/api/dealer';
import { dealerMeQuery } from '@tubutree/app-core/queries/dealer';
import { coreHttp } from '@/lib/core-http';
import { usePublicConfig } from '@/lib/use-public-config';
import { useAuth } from '@/lib/auth-context';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import {
  DEALER_BENEFITS,
  DEALER_BENEFITS_TITLE,
  DEALER_REQUIREMENTS,
  DEALER_REQUIREMENTS_TITLE,
  dealerReviewLine,
} from '@tubutree/app-core/dealer-apply-copy';
import { applyPitch, pendingBody } from '@/lib/dealer-view';
import { ui } from '@/lib/guest-ui';
import { IMAGES_UPLOADING, useUploadBusy } from '@/lib/use-upload-busy';
import { phoneBodySm, phoneCaption } from '@/lib/phone-ui';
import { skin } from '@/components/pro-shared/mini-skin';
import { Field } from '@/components/ui/field';
import { BrandImageField } from '@/components/brand-owner/brand-image-field';
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
  // Gửi hồ sơ lúc ảnh CCCD còn đang lên (nhất là chọn lại ảnh mờ) sẽ gửi đi ảnh cũ để duyệt.
  const { busy: imagesBusy, onBusyChange } = useUploadBusy();

  // Gửi đúng bản hồ sơ lúc bấm lần đầu (biến mutate), không đọc `form` mới hơn; khoá giữ tới khi hồ sơ mới về để màn không cho gửi lần hai trên trạng thái cũ.
  const mut = useLockedMutation({
    mutationFn: (sent: DealerApplyInput) => applyDealer(coreHttp, sent),
    onSuccess: () => {
      setDone(true);
      return qc.invalidateQueries({ queryKey: dealerMeQuery(coreHttp).queryKey });
    },
  });

  const set = (k: keyof DealerApplyInput) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Điền sẵn tên và SĐT đã có trong tài khoản để khách không gõ lại; ô nào khách đã gõ thì giữ nguyên. Phiên chưa có SĐT thì bỏ trống.
  const { user } = useAuth();
  const accountName = user?.fullName?.trim() ?? '';
  const accountPhone = (user as { phone?: string | null } | null)?.phone?.trim() ?? '';
  useEffect(() => {
    setForm((f) => ({ ...f, ownerName: f.ownerName || accountName, phone: f.phone || accountPhone }));
  }, [accountName, accountPhone]);
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

        <section data-testid="dealer-conditions" className="mt-3 rounded-card border border-stone-200 bg-stone-0 p-3 max-md:border-0">
          <h3 className={`text-sm font-semibold text-stone-900 ${phoneBodySm}`}>{DEALER_REQUIREMENTS_TITLE}</h3>
          <ul className={`mb-2 mt-1 list-disc pl-[18px] text-sm text-stone-600 ${phoneBodySm}`}>
            {DEALER_REQUIREMENTS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <h3 className={`text-sm font-semibold text-stone-900 ${phoneBodySm}`}>{DEALER_BENEFITS_TITLE}</h3>
          <ul className={`mb-2 mt-1 list-disc pl-[18px] text-sm text-stone-600 ${phoneBodySm}`}>
            {DEALER_BENEFITS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <p className={`text-xs text-stone-600 ${phoneCaption}`}>{dealerReviewLine(config.isLoaded ? config.dealer?.reviewHours : null)}</p>
        </section>

        {rejected && (
          <div className="mt-3 rounded-control bg-danger-bg p-3 text-sm text-danger-fg">
            <p>{DEALER_REJECTED_RESUBMIT}</p>
            {rejectionReason && <p className="mt-1 font-semibold">Lý do: {rejectionReason}</p>}
          </div>
        )}

        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !imagesBusy) mut.mutate(form);
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
          <BrandImageField
            upload="inline"
            label="Ảnh CCCD mặt trước *"
            value={form.cccdFrontUrl}
            onChange={(url) => setForm((f) => ({ ...f, cccdFrontUrl: url }))}
            onBusyChange={onBusyChange}
            disabled={mut.isPending}
          />
          <BrandImageField
            upload="inline"
            label="Ảnh CCCD mặt sau *"
            value={form.cccdBackUrl}
            onChange={(url) => setForm((f) => ({ ...f, cccdBackUrl: url }))}
            onBusyChange={onBusyChange}
            disabled={mut.isPending}
          />
          <div role="status" aria-live="polite">
            {done && <p className="text-sm font-medium text-success-fg">Đã gửi hồ sơ đăng ký đại lý!</p>}
          </div>
          {mut.isError && (
            <p role="alert" className={ui.error}>
              {errText(mut.error)}
            </p>
          )}
          {/* Đang gửi giữ aria-busy/aria-disabled chứ không `disabled`: Chromium thả focus về body khi nút đang giữ focus bị vô hiệu. */}
          <button
            type="submit"
            disabled={!valid}
            aria-busy={mut.isPending || imagesBusy || undefined}
            aria-disabled={mut.isPending || imagesBusy || undefined}
            className={`${ui.btnPrimary} ${skin.dealerInkBtn} mt-2 w-full`}
          >
            {mut.isPending ? 'Đang gửi…' : imagesBusy ? IMAGES_UPLOADING : 'Gửi hồ sơ đăng ký'}
          </button>
        </form>
      </div>
    </DealerShell>
  );
}
