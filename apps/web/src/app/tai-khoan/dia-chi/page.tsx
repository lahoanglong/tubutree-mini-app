'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPin, Plus } from 'lucide-react';
import { useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthPhase } from '@/lib/auth-phase';
import { useOptionalAuth } from '@/lib/auth-context';
import { addressToForm, isLegacyGeo } from '@/lib/address-form';
import { createAddress, deleteAddress, getAddresses, updateAddress, type AddressDTO } from '@/lib/shop-client';
import { ui } from '@/lib/guest-ui';
import { AddressForm } from '@/components/address-form';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { mini } from '@/components/order-mobile/mobile-ui';
import { PageHeader } from '@/components/ui/page-header';
import { PAGE_NARROW } from '@/lib/page-frame';
import { actionErrorText } from '@/lib/error-text';

// Chỉ sổ địa chỉ rỗng mới cần màn trống: không kéo nó vào bundle đầu của trang.
const MiniEmptyState = dynamic(() => import('@/components/mini/empty-state').then((m) => m.EmptyState), { ssr: false });

/** ActionLink của Mini App: chữ 14px/600 xanh (Xóa đỏ), không gạch chân. */
const LINK_MINI = 'tubu-press min-w-11 justify-center max-md:text-sm max-md:no-underline max-md:text-[color:var(--color-text-brand)]';

const NOTICE_MS = 4000;

/** Việc khách làm trên MỘT địa chỉ: đặt mặc định hoặc xoá. Chung một khoá theo id nên hai việc của cùng địa chỉ không chồng nhau, địa chỉ khác vẫn chạy song song. */
type AddressOp = { op: 'default' | 'delete'; id: string };
const ADDRESS_OP_KEY = ['address-op'] as const;

const line = (a: AddressDTO) => [a.street, a.ward, a.district, a.province].filter(Boolean).join(', ');

export default function AddressBookPage() {
  const phase = useAuthPhase();
  const userId = useOptionalAuth()?.user?.id;
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const deleteTriggers = useRef(new Map<string, HTMLButtonElement>());
  const keepRef = useRef<HTMLButtonElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusFor = useRef<string | null>(null);

  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses, enabled: phase === 'authenticated' });
  const retrying = useRef(false);
  const retryLoad = () => {
    if (retrying.current) return;
    retrying.current = true;
    const release = () => {
      retrying.current = false;
    };
    void addrQ.refetch().then(release, (err: unknown) => {
      release();
      throw err;
    });
  };
  // Trả lời hứa để khoá của địa chỉ còn giữ tới khi sổ mới về: nhả sớm thì "Đặt mặc định" bấm được lần hai trên số liệu cũ.
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['addresses'] }), qc.invalidateQueries({ queryKey: ['quote'] })]);

  // Báo "Đã xóa" như snackbar của Mini App: tự tắt sau vài giây và tắt ngay khi có thao tác khác bắt đầu.
  const [removedNotice, setRemovedNotice] = useState(false);
  useEffect(() => {
    if (!removedNotice) return;
    const t = setTimeout(() => setRemovedNotice(false), NOTICE_MS);
    return () => clearTimeout(t);
  }, [removedNotice]);

  // Lỗi nhớ theo từng địa chỉ: `mutation.error` chỉ giữ lệnh sau cùng nên lệnh của địa chỉ A lỗi sau khi địa chỉ B đã chạy sẽ mất lời báo.
  const [opErrors, setOpErrors] = useState<ReadonlyMap<string, unknown>>(() => new Map());
  const clearError = (id: string) => setOpErrors((prev) => (prev.has(id) ? new Map([...prev].filter(([k]) => k !== id)) : prev));
  const deleteOk = useRef(false);
  const addressOp = useLockedMutation(
    {
      mutationKey: ADDRESS_OP_KEY,
      mutationFn: async (v: AddressOp): Promise<unknown> => (v.op === 'delete' ? deleteAddress(v.id) : updateAddress(v.id, { isDefault: true })),
      onMutate: (v) => {
        setRemovedNotice(false);
        clearError(v.id);
        if (v.op === 'delete') deleteOk.current = false;
      },
      onSuccess: (_d, v) => {
        if (v.op === 'delete') {
          deleteOk.current = true;
          setConfirmId((cur) => (cur === v.id ? null : cur));
          setRemovedNotice(true);
          // Lần tải lại có thể bị lần làm mới của lệnh sau huỷ hoặc lỗi mạng: dòng đã xoá không được ở lại chờ chúng.
          qc.setQueryData<AddressDTO[]>(['addresses'], (list) => list?.filter((x) => x.id !== v.id));
        }
        return refresh();
      },
      onError: (error, v) => {
        setOpErrors((prev) => new Map(prev).set(v.id, error));
        if (v.op === 'delete') setConfirmId((cur) => (cur === v.id ? null : cur));
      },
    },
    (v) => v.id,
  );
  // Mọi việc đang bay (không chỉ lệnh sau cùng): nút của đúng các địa chỉ đó báo aria-busy, địa chỉ khác vẫn bấm được.
  const inFlightOps = useMutationState({ filters: { mutationKey: ADDRESS_OP_KEY, status: 'pending' }, select: (m) => m.state.variables as AddressOp });
  const opOf = new Map(inFlightOps.map((v) => [v.id, v.op] as const));
  const busyKey = inFlightOps.map((v) => v.id).join('|');

  // Hộp xác nhận xóa thay chính nút "Xóa" của dòng nên focus phải được dời theo: vào "Giữ lại" (lựa chọn an toàn) khi mở, khi đóng
  // về nút "Xóa" của dòng đó. Xóa xong thì dòng biến mất sau khi tải lại danh sách, nên về nút "Thêm địa chỉ mới". Chờ hết
  // việc đang bay của địa chỉ đó vì kết quả xóa đến sau lúc hộp đóng.
  useEffect(() => {
    if (confirmId === null) return;
    restoreFocusFor.current = confirmId;
    keepRef.current?.focus();
  }, [confirmId]);
  useEffect(() => {
    const id = restoreFocusFor.current;
    if (confirmId !== null || id === null || busyKey.split('|').includes(id)) return;
    restoreFocusFor.current = null;
    const trigger = deleteOk.current ? undefined : deleteTriggers.current.get(id);
    (trigger ?? addButtonRef.current)?.focus();
  }, [confirmId, busyKey]);

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

  return (
    <Shell>
      {addrQ.isLoading && <p className="py-10 text-center text-stone-600">Đang tải địa chỉ…</p>}
      {addrQ.isError && (
        <p role="alert" className={`py-6 text-center ${ui.error}`}>
          Không tải được sổ địa chỉ.{' '}
          <button
            type="button"
            onClick={retryLoad}
            aria-busy={addrQ.isFetching || undefined}
            aria-disabled={addrQ.isFetching || undefined}
            className={ui.btnText}
          >
            Thử lại
          </button>
        </p>
      )}
      {removedNotice && (
        <p role="status" className="mb-3 text-sm font-medium text-success-fg">
          Đã xoá địa chỉ.
        </p>
      )}

      {addrQ.isSuccess && addresses.length === 0 && !adding && (
        <div className="max-md:-mx-4">
          <MiniEmptyState art="leaf" heading="Bạn chưa có địa chỉ giao hàng nào" />
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
                  submitLabel="Lưu"
                  initial={addressToForm(a)}
                  userId={userId}
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
                  <p className="mt-1 break-words text-sm text-stone-700 max-md:mt-0.5 max-md:text-[length:var(--type-caption-size)] max-md:text-[color:var(--color-text-secondary)]">{line(a)}</p>
                  {opErrors.has(a.id) && (
                    <p role="alert" className={`mt-1 ${ui.error}`}>
                      {actionErrorText(opErrors.get(a.id))}
                    </p>
                  )}
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
                        Xoá địa chỉ này?
                      </p>
                      <p id={`del-note-${a.id}`} className="mt-1 text-sm text-stone-700">
                        Các đơn đã đặt trước đây vẫn giữ nguyên địa chỉ giao.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {/* Đang xoá thì không đóng hộp: kết quả xoá vẫn đến, và nút không `disabled` thật vì "Xoá" đang giữ focus (Chromium thả focus về body). */}
                        <button
                          ref={keepRef}
                          type="button"
                          onClick={() => {
                            if (opOf.has(a.id)) return;
                            setConfirmId(null);
                          }}
                          aria-disabled={opOf.has(a.id) || undefined}
                          className={ui.btnPrimary}
                        >
                          Giữ lại
                        </button>
                        <button
                          type="button"
                          onClick={() => addressOp.mutate({ op: 'delete', id: a.id })}
                          aria-busy={opOf.get(a.id) === 'delete' || undefined}
                          aria-disabled={opOf.has(a.id) || undefined}
                          className={`${ui.btnSecondary} border-danger-fg text-danger-fg`}
                        >
                          {opOf.get(a.id) === 'delete' ? 'Đang xoá…' : 'Xoá'}
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
                          onClick={() => addressOp.mutate({ op: 'default', id: a.id })}
                          aria-busy={opOf.get(a.id) === 'default' || undefined}
                          aria-disabled={opOf.has(a.id) || undefined}
                          aria-label={`Đặt mặc định cho địa chỉ của ${a.recipient}`}
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
                          if (opOf.has(a.id)) return;
                          clearError(a.id);
                          setConfirmId(a.id);
                        }}
                        aria-disabled={opOf.has(a.id) || undefined}
                        aria-label={`Xoá địa chỉ của ${a.recipient}`}
                        className={`${ui.btnText} tubu-press min-w-11 justify-center text-danger-fg max-md:no-underline max-md:text-sm max-md:text-[color:var(--color-text-danger)]`}
                      >
                        Xoá
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
            title="Thêm địa chỉ"
            userId={userId}
            headingLevel={2}
            submitLabel="Lưu"
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
              className={`${ui.btnPrimary} w-full gap-2 sm:w-auto ${addresses.length > 0 ? 'max-md:border-transparent max-md:bg-[var(--color-action-secondary-bg)] max-md:text-[color:var(--color-action-secondary-fg)] max-md:shadow-none max-md:hover:bg-[var(--color-action-secondary-bg-pressed)]' : ''}`}
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
    <main className={`${PAGE_NARROW} py-6 max-md:px-0 max-md:py-0`}>
      <PageHeader title="Sổ địa chỉ" backHref="/tai-khoan" backLabel="Tài khoản" />
      <div className="mt-4 max-md:px-4">{children}</div>
    </main>
  );
}
