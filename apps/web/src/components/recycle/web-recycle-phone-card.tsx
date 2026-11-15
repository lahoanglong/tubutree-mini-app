'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Phone } from 'lucide-react';
import { saveContactPhone } from '@tubutree/app-core/api/account';
import { getAddresses, type AddressDTO } from '@tubutree/app-core/api/checkout';
import { WASTE_QUERY_KEYS } from '@tubutree/app-core/api/waste';
import { parseVnContactPhone } from '@tubutree/app-core/phone-input';
import { Field } from '@/components/ui/field';
import { coreHttp } from '@/lib/core-http';
import { friendlyActionError } from '@/lib/friendly-error';
import { ui } from '@/lib/guest-ui';
import { formatPhoneDisplay } from '@/lib/phone-display';
import { settleWithin } from '@/lib/settle-within';

function pickSavedPhone(addresses: readonly AddressDTO[] | undefined): string | null {
  if (!addresses?.length) return null;
  const ordered = [
    ...addresses.filter((a) => a.isDefault),
    ...addresses.filter((a) => !a.isDefault),
  ];
  for (const addr of ordered) {
    const parsed = parseVnContactPhone(addr.phone ?? '');
    if (parsed) return parsed;
  }
  return null;
}

export function WebRecyclePhoneCard({
  onSaved,
}: {
  onSaved?: (phone: string) => void;
} = {}) {
  const qc = useQueryClient();
  const [phone, setPhone] = useState('');
  const [touched, setTouched] = useState(false);
  const [prefilledFromAddress, setPrefilledFromAddress] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);

  const addrQ = useQuery({
    queryKey: ['addresses', 'recycle-phone-prefill'],
    queryFn: async () => {
      try {
        return await getAddresses(coreHttp);
      } catch {
        return [] as AddressDTO[];
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  const suggestedPhone = useMemo(() => pickSavedPhone(addrQ.data), [addrQ.data]);

  useEffect(() => {
    if (!suggestedPhone || dirtyRef.current) return;
    setPhone(formatPhoneDisplay(suggestedPhone));
    setPrefilledFromAddress(true);
  }, [suggestedPhone]);

  const parsed = parseVnContactPhone(phone);
  const fieldError =
    touched && !parsed
      ? phone.trim() === ''
        ? 'Nhập số điện thoại di động để bưu tá và quầy thu gom liên hệ.'
        : 'Nhập đúng số di động Việt Nam 10 số (đầu 03, 05, 07, 08, 09).'
      : null;

  const save = useMutation({
    mutationFn: async (normalized: string) => saveContactPhone(coreHttp, normalized),
    onSuccess: async (res, normalized) => {
      setErrMsg(null);
      if (res) qc.setQueryData(['me'], res);
      await settleWithin(
        Promise.all([
          qc.invalidateQueries({ queryKey: WASTE_QUERY_KEYS.all }),
          qc.invalidateQueries({ queryKey: ['me'] }),
        ]),
      );
      onSaved?.(res?.phone ?? normalized);
    },
    onError: (err) => {
      setErrMsg(friendlyActionError(err));
    },
    onSettled: () => {
      busyRef.current = false;
    },
  });

  const submit = () => {
    setTouched(true);
    if (busyRef.current) return;
    if (!parsed) return;
    busyRef.current = true;
    setErrMsg(null);
    save.mutate(parsed);
  };

  return (
    <section
      data-testid="web-recycle-phone-card"
      aria-label="Xác nhận số điện thoại đổi rác"
      className="space-y-3 rounded-card border border-[var(--color-border-brand)] bg-[var(--color-bg-surface)] p-4 [box-shadow:var(--elevation-1)]"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-subtle)] text-[color:var(--color-text-brand)]"
        >
          <Phone className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-base font-semibold text-[color:var(--color-text-primary)]">
            Thêm số điện thoại nhận thu gom để đổi rác ngay trên Web
          </h2>
          <p className="text-sm text-[color:var(--color-text-secondary)]">
            Bưu tá lấy tận nhà, quầy thu gom và hệ thống cộng Điểm Xanh cần số điện thoại liên hệ của bạn.
          </p>
        </div>
      </div>

      <form
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Số điện thoại di động" error={fieldError ?? undefined}>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0912 345 678"
            value={phone}
            onBlur={() => setTouched(true)}
            onChange={(e) => {
              dirtyRef.current = true;
              setPrefilledFromAddress(false);
              setPhone(e.target.value);
              if (errMsg) setErrMsg(null);
            }}
            className={`${fieldError ? ui.fieldError : ui.field} tabular-nums`}
          />
        </Field>

        {prefilledFromAddress && !fieldError && (
          <p className="text-xs text-[color:var(--color-text-brand)]">
            Đã điền sẵn số nhận hàng từ sổ địa chỉ của bạn — bấm xác nhận để mở Đổi rác ngay.
          </p>
        )}

        <div role="alert">{errMsg && <p className={ui.error}>{errMsg}</p>}</div>

        <button
          type="submit"
          aria-busy={save.isPending || undefined}
          aria-disabled={save.isPending || undefined}
          className={`${ui.btnPrimary} w-full sm:w-auto`}
        >
          {save.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Đang lưu số điện thoại…
            </>
          ) : (
            'Xác nhận SĐT & Đổi rác ngay'
          )}
        </button>
      </form>
    </section>
  );
}
