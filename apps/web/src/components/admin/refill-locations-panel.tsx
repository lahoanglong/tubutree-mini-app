'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createRefillLocation,
  listRefillLocations,
  reorderRefillLocations,
  updateRefillLocation,
  type RefillLocation,
  type RefillLocationInput,
} from '@/lib/admin-client';
import { useConfirm } from './confirm-dialog';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, Field, INPUT_CLASS, Notice, TOUCH_H, ToneBadge } from './ui';

const QUERY_KEY = ['admin-refill-locations'];
const NAME_MAX = 100;
const ADDRESS_MAX = 300;
const HOURS_MAX = 120;
// Cùng luật với API (PICKUP_PHONE_PATTERN): trống = ẩn nút gọi, khác trống phải là 10 số bắt đầu bằng 0 hoặc +84.
const PHONE_RE = /^(0|\+84)\d{9}$/;

const EMPTY_FORM: RefillLocationInput = { name: '', address: '', hours: '', phone: '', isActive: true };

function formProblem(f: RefillLocationInput): string | null {
  if (!f.name.trim()) return 'Nhập tên điểm nhận.';
  if (!f.address.trim()) return 'Nhập địa chỉ điểm nhận.';
  if (f.phone.trim() && !PHONE_RE.test(f.phone.trim())) return 'SĐT phải là 10 số bắt đầu bằng 0 hoặc +84 (hoặc để trống).';
  return null;
}

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * Admin quản lý điểm nhận vỏ chai: thêm, sửa, bật/tắt và sắp xếp. Khách chỉ thấy điểm đang bật theo đúng thứ tự ở đây,
 * điểm đầu tiên cũng là điểm hiện cho bản mini app cũ. Không có nút xoá: tắt điểm để các yêu cầu đã chọn điểm đó còn nguyên.
 */
export function RefillLocationsPanel() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const q = useQuery({ queryKey: QUERY_KEY, queryFn: listRefillLocations });
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: QUERY_KEY });
  const create = useMutation({
    mutationFn: (f: RefillLocationInput) => createRefillLocation(f),
    onSuccess: () => {
      setAdding(false);
      setNotice(null);
      void refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<RefillLocationInput> }) => updateRefillLocation(id, body),
    onSuccess: () => {
      setEditingId(null);
      setNotice(null);
      void refresh();
    },
    // Lỗi khi sửa hiện ngay trong form; lỗi bật/tắt (không có form) hiện ở đầu danh sách.
    onError: (e, vars) => {
      if (!('name' in vars.body)) setNotice(errorText(e, 'Không lưu được điểm nhận.'));
    },
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderRefillLocations(ids),
    onSuccess: (rows) => {
      setNotice(null);
      qc.setQueryData(QUERY_KEY, rows);
    },
    onError: (e) => {
      setNotice(errorText(e, 'Không đổi được thứ tự.'));
      void refresh();
    },
  });
  const busy = create.isPending || update.isPending || reorder.isPending;

  const rows = q.data ?? [];
  const activeCount = rows.filter((r) => r.isActive).length;

  const move = (index: number, delta: -1 | 1) => {
    const ids = rows.map((r) => r.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids);
  };

  const toggle = async (row: RefillLocation) => {
    if (row.isActive) {
      const ok = await confirm({
        title: `Tắt điểm "${row.name}"?`,
        message: 'Khách sẽ không còn thấy và không chọn được điểm này. Các yêu cầu đã gửi tới điểm này vẫn giữ nguyên.',
        confirmLabel: 'Tắt điểm',
        tone: 'danger',
      });
      if (!ok) return;
    }
    update.mutate({ id: row.id, body: { isActive: !row.isActive } });
  };

  return (
    <section className="space-y-3" aria-label="Điểm nhận vỏ chai">
      {dialog}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold text-stone-900">Điểm nhận vỏ</h2>
          {q.data && (
            <p className="text-xs text-stone-500">
              {rows.length} điểm · {activeCount} đang bật
            </p>
          )}
        </div>
        {!adding && (
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={busy}
            onClick={() => {
              setAdding(true);
              setEditingId(null);
              create.reset();
            }}
          >
            Thêm điểm nhận
          </button>
        )}
      </div>
      <p className="text-xs text-stone-600">
        Khách thấy các điểm đang bật theo đúng thứ tự dưới đây và chọn một điểm khi gửi yêu cầu đổi vỏ. Điểm đầu tiên cũng là điểm
        hiện cho bản mini app cũ.
      </p>

      {adding && (
        <div className="rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
          <h3 className="mb-2 text-sm font-semibold text-stone-900">Thêm điểm nhận</h3>
          <LocationForm
            initial={EMPTY_FORM}
            submitLabel="Thêm điểm"
            pending={create.isPending}
            error={create.isError ? errorText(create.error, 'Không thêm được điểm nhận.') : null}
            onCancel={() => setAdding(false)}
            onSubmit={(f) => create.mutate(f)}
          />
        </div>
      )}

      {q.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {q.isError && <Notice tone="danger" role="alert">Không tải được danh sách điểm nhận vỏ.</Notice>}
      {notice && <Notice tone="danger" role="alert">{notice}</Notice>}
      {q.data && rows.length === 0 && (
        <Notice tone="info">
          Chưa có điểm nhận nào. Khách đang thấy địa chỉ điểm nhận cũ trong Cấu hình hệ thống (nếu đã điền) — thêm điểm đầu tiên ở đây để thay thế.
        </Notice>
      )}
      {q.data && rows.length > 0 && activeCount === 0 && (
        <Notice tone="warning">Chưa có điểm nào đang bật: khách sẽ không thấy điểm nhận vỏ nào và được hướng dẫn liên hệ Tubu.</Notice>
      )}

      <ul className="space-y-2">
        {rows.map((row, index) => (
          <li
            key={row.id}
            className={`rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card ${row.isActive ? '' : 'opacity-80'}`}
          >
            {editingId === row.id ? (
              <LocationForm
                initial={{ name: row.name, address: row.address, hours: row.hours ?? '', phone: row.phone ?? '', isActive: row.isActive }}
                submitLabel="Lưu thay đổi"
                pending={update.isPending}
                error={update.isError ? errorText(update.error, 'Không lưu được điểm nhận.') : null}
                hideActive
                onCancel={() => setEditingId(null)}
                onSubmit={(f) => update.mutate({ id: row.id, body: { name: f.name, address: f.address, hours: f.hours, phone: f.phone } })}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-stone-500" aria-label={`Thứ tự ${index + 1}`}>
                        #{index + 1}
                      </span>
                      <span className="break-words text-sm font-semibold text-stone-900">{row.name}</span>
                      <ToneBadge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'Đang bật' : 'Đã tắt'}</ToneBadge>
                    </div>
                    <p className="mt-1 break-words text-xs text-stone-700">{row.address}</p>
                    {(row.hours || row.phone) && (
                      <p className="mt-0.5 break-words text-xs text-stone-500">{[row.hours, row.phone].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className={BTN_SMALL}
                      aria-label={`Chuyển "${row.name}" lên trên`}
                      disabled={busy || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={BTN_SMALL}
                      aria-label={`Chuyển "${row.name}" xuống dưới`}
                      disabled={busy || index === rows.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={BTN_SMALL}
                    disabled={busy}
                    onClick={() => {
                      setEditingId(row.id);
                      setAdding(false);
                      update.reset();
                    }}
                  >
                    Sửa
                  </button>
                  <button type="button" className={BTN_SMALL} disabled={busy} onClick={() => void toggle(row)}>
                    {row.isActive ? 'Tắt điểm' : 'Bật lại'}
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function LocationForm({
  initial,
  submitLabel,
  pending,
  error,
  hideActive,
  onSubmit,
  onCancel,
}: {
  initial: RefillLocationInput;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  /** Sửa điểm có sẵn thì bật/tắt đi qua nút riêng (có xác nhận), không đặt trong form. */
  hideActive?: boolean;
  onSubmit: (f: RefillLocationInput) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<RefillLocationInput>(initial);
  const [touched, setTouched] = useState(false);
  const problem = formProblem(f);
  const field = `${INPUT_CLASS} ${TOUCH_H}`;
  return (
    <form
      className="space-y-2"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (problem || pending) return;
        onSubmit({ ...f, name: f.name.trim(), address: f.address.trim(), hours: f.hours.trim(), phone: f.phone.trim() });
      }}
    >
      <Field label="Tên điểm (khách thấy khi chọn)">
        <input
          className={field}
          value={f.name}
          maxLength={NAME_MAX}
          placeholder="VD: Cửa hàng Quận 1"
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
      </Field>
      <Field label="Địa chỉ">
        <input
          className={field}
          value={f.address}
          maxLength={ADDRESS_MAX}
          placeholder="Số nhà, đường, phường/xã, quận/huyện"
          onChange={(e) => setF({ ...f, address: e.target.value })}
        />
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Giờ mở cửa (không bắt buộc)">
          <input
            className={field}
            value={f.hours}
            maxLength={HOURS_MAX}
            placeholder="VD: 8h–20h hằng ngày"
            onChange={(e) => setF({ ...f, hours: e.target.value })}
          />
        </Field>
        <Field label="SĐT gọi điểm nhận (không bắt buộc)">
          <input
            className={field}
            value={f.phone}
            inputMode="tel"
            maxLength={12}
            placeholder="VD: 0901234567"
            onChange={(e) => setF({ ...f, phone: e.target.value.replace(/[^\d+]/g, '') })}
          />
        </Field>
      </div>
      {!hideActive && (
        <label className={`flex items-center gap-2 text-xs text-stone-700 ${TOUCH_H}`}>
          <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
          Đang nhận vỏ (khách thấy và chọn được ngay)
        </label>
      )}
      {touched && problem && <Notice tone="danger" role="alert">{problem}</Notice>}
      {error && <Notice tone="danger" role="alert">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={BTN_PRIMARY} disabled={pending}>
          {pending ? 'Đang lưu…' : submitLabel}
        </button>
        <button type="button" className={BTN_SECONDARY} disabled={pending} onClick={onCancel}>
          Huỷ
        </button>
      </div>
    </form>
  );
}
