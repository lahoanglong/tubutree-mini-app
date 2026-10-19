'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthPhase } from '@/lib/auth-phase';
import { addressToForm, isLegacyGeo } from '@/lib/address-form';
import { createAddress, deleteAddress, getAddresses, updateAddress, type AddressDTO } from '@/lib/shop-client';
import { ui } from '@/lib/guest-ui';
import { AddressForm } from '@/components/address-form';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { TitleBand, mini } from '@/components/order-mobile/mobile-ui';

/** ActionLink của Mini App: chữ 14px/600 xanh (Xóa đỏ), không gạch chân. */
const LINK_MINI = 'max-md:text-sm max-md:no-underline max-md:text-[color:var(--color-text-brand)]';

const NOTICE_MS = 4000;

const line = (a: AddressDTO) => [a.street, a.ward, a.district, a.province].filter(Boolean).join(', ');

export default function AddressBookPage() {
  const phase = useAuthPhase();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const deleteTriggers = useRef(new Map<string, HTMLButtonElement>());
  const keepRef = useRef<HTMLButtonElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusFor = useRef<string | null>(null);

  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses, enabled: phase === 'authenticated' });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['addresses'] });
    void qc.invalidateQueries({ queryKey: ['quote'] });
  };

  // Báo "Đã xóa" như snackbar của Mini App: tự tắt sau vài giây và tắt ngay khi có thao tác khác bắt đầu.
  const [removedNotice, setRemovedNotice] = useState(false);
  useEffect(() => {
    if (!removedNotice) return;
    const t = setTimeout(() => setRemovedNotice(false), NOTICE_MS);
    return () => clearTimeout(t);
  }, [removedNotice]);

  const makeDefault = useMutation({
    mutationFn: (id: string) => updateAddress(id, { isDefault: true }),
    onMutate: () => setRemovedNotice(false),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteAddress(id),
    onMutate: () => setRemovedNotice(false),
    onSuccess: () => {
      setConfirmId(null);
      setRemovedNotice(true);
      refresh();
    },
    onError: () => setConfirmId(null),
  });

  // Hộp xác nhận xóa thay chính nút "Xóa" của dòng nên focus phải được dời theo: vào "Giữ lại" (lựa chọn an toàn) khi mở, khi đóng
  // về nút "Xóa" của dòng đó. Xóa xong thì dòng biến mất sau khi tải lại danh sách, nên về nút "Thêm địa chỉ mới". Chờ hết
  // `isPending` vì kết quả xóa đến sau lúc hộp đóng.
  useEffect(() => {
    if (confirmId === null) return;
    restoreFocusFor.current = confirmId;
    keepRef.current?.focus();
  }, [confirmId]);
  useEffect(() => {
    const id = restoreFocusFor.current;
    if (confirmId !== null || id === null || remove.isPending) return;
    restoreFocusFor.current = null;
    const trigger = remove.isSuccess ? undefined : deleteTriggers.current.get(id);
    (trigger ?? addButtonRef.current)?.focus();
  }, [confirmId, remove.isPending, remove.isSuccess, remove.isError]);

  if (phase === 'loading') {
    return (
      <Shell>
        <AuthLoading />
      </Shell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <Shell>
        <SessionUnavailable />
      </Shell>
    );
  }
  if (phase === 'guest') {
    return (
      <Shell>
        <LoginRequired message="Đăng nhập để quản lý sổ địa chỉ của bạn." returnTo="/tai-khoan/dia-chi" />
      </Shell>
    );
  }

  const addresses = addrQ.data ?? [];
  const actionError = makeDefault.isError ? makeDefault.error : remove.isError ? remove.error : null;

  return (
    <Shell>
      {addrQ.isLoading && <p className="py-10 text-center text-stone-600">Đang tải địa chỉ…</p>}
      {addrQ.isError && (
        <p role="alert" className={`py-6 text-center ${ui.error}`}>
          Không tải được sổ địa chỉ.{' '}
          <button type="button" onClick={() => void addrQ.refetch()} className={ui.btnText}>
            Thử lại
          </button>
        </p>
      )}
      {removedNotice && (
        <p role="status" className="mb-3 text-sm font-medium text-success-fg">
          Đã xóa địa chỉ.
        </p>
      )}
      {actionError && (
        <p role="alert" className={`mb-3 ${ui.error}`}>
          {actionError instanceof Error ? actionError.message : 'Không thực hiện được. Vui lòng thử lại.'}
        </p>
      )}

      {addrQ.isSuccess && addresses.length === 0 && !adding && (
        <div className="py-10 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-forest-50 text-forest-600 shadow-card">
            <MapPin className="h-8 w-8 stroke-[1.5]" aria-hidden="true" />
          </div>
          <p className="mx-auto mt-4 max-w-sm text-stone-700">Bạn chưa lưu địa chỉ nào. Thêm địa chỉ để thanh toán nhanh hơn.</p>
        </div>
      )}

      {addresses.length > 0 && (
        <ul className="space-y-3">
          {addresses.map((a) => (
            <li
              key={a.id}
              className={`p-4 ${ui.card} ${
                a.isDefault
                  ? 'max-md:border-[1.5px] max-md:border-[color:var(--color-action-primary-bg)] max-md:shadow-none'
                  : mini.card
              }`}
            >
              {editingId === a.id ? (
                <AddressForm
                  title="Sửa địa chỉ"
                  headingLevel={2}
                  submitLabel="Lưu thay đổi"
                  initial={addressToForm(a)}
                  onSubmit={async (payload) => {
                    await updateAddress(a.id, payload);
                    setEditingId(null);
                    refresh();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 break-words font-semibold text-stone-900 max-md:text-sm">
                      {a.recipient} · {a.phone}
                    </span>
                    {a.isDefault && (
                      <span className="rounded-full bg-forest-50 px-2 py-0.5 text-xs font-medium text-forest-800">Mặc định</span>
                    )}
                  </div>
                  <p className="mt-1 break-words text-sm text-stone-700">{line(a)}</p>
                  {isLegacyGeo(a) && (
                    <p className="mt-1 text-xs font-medium text-warning-fg">
                      Địa giới cũ (trước khi sắp xếp tỉnh/phường 2025) — chưa giao được, bấm Sửa để chọn lại tỉnh/phường.
                    </p>
                  )}

                  {confirmId === a.id ? (
                    <div
                      role="alertdialog"
                      aria-labelledby={`del-${a.id}`}
                      aria-describedby={`del-note-${a.id}`}
                      className="mt-3 rounded-control border border-danger-fg bg-danger-bg p-3"
                    >
                      <p id={`del-${a.id}`} className="font-semibold text-stone-900">
                        Xóa địa chỉ này?
                      </p>
                      <p id={`del-note-${a.id}`} className="mt-1 text-sm text-stone-700">
                        Các đơn đã đặt trước đây vẫn giữ nguyên địa chỉ giao.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button ref={keepRef} type="button" onClick={() => setConfirmId(null)} disabled={remove.isPending} className={ui.btnPrimary}>
                          Giữ lại
                        </button>
                        <button
                          type="button"
                          onClick={() => remove.mutate(a.id)}
                          disabled={remove.isPending}
                          className={`${ui.btnSecondary} border-danger-fg text-danger-fg`}
                        >
                          {remove.isPending ? 'Đang xóa…' : 'Xóa'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-x-2">
                      <button
                        type="button"
                        onClick={() => {
                          setAdding(false);
                          setEditingId(a.id);
                        }}
                        aria-label={`Sửa địa chỉ của ${a.recipient}`}
                        className={`${ui.btnText} ${LINK_MINI}`}
                      >
                        Sửa
                      </button>
                      {!a.isDefault && (
                        <button
                          type="button"
                          onClick={() => makeDefault.mutate(a.id)}
                          disabled={makeDefault.isPending}
                          aria-label={`Đặt địa chỉ của ${a.recipient} làm mặc định`}
                          className={`${ui.btnText} ${LINK_MINI}`}
                        >
                          Đặt mặc định
                        </button>
                      )}
                      <button
                        ref={(el) => {
                          if (el) deleteTriggers.current.set(a.id, el);
                          else deleteTriggers.current.delete(a.id);
                        }}
                        type="button"
                        onClick={() => {
                          remove.reset();
                          setConfirmId(a.id);
                        }}
                        aria-label={`Xóa địa chỉ của ${a.recipient}`}
                        className={`${ui.btnText} text-danger-fg max-md:no-underline max-md:text-sm max-md:text-[color:var(--color-text-danger)]`}
                      >
                        Xóa
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        {adding ? (
          <AddressForm
            title="Thêm địa chỉ mới"
            headingLevel={2}
            submitLabel="Lưu địa chỉ"
            onSubmit={async (payload) => {
              await createAddress(payload);
              setAdding(false);
              refresh();
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          addrQ.isSuccess && (
            <button
              ref={addButtonRef}
              type="button"
              onClick={() => {
                setEditingId(null);
                setAdding(true);
              }}
              className={`${ui.btnPrimary} w-full gap-2 sm:w-auto max-md:border-transparent max-md:bg-[var(--color-action-secondary-bg)] max-md:text-[color:var(--color-action-secondary-fg)] max-md:hover:bg-[var(--color-action-secondary-bg-pressed)]`}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Thêm địa chỉ mới
            </button>
          )
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 max-md:max-w-none max-md:px-0 max-md:py-0">
      <TitleBand title="Sổ địa chỉ" backHref="/tai-khoan" backLabel="Tài khoản" />
      <div className="mt-4 max-md:px-4">{children}</div>
    </main>
  );
}
