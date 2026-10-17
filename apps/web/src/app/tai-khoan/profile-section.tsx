'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { ApiError, NetworkError } from '@/lib/client-api';
import { updateMyName } from '@/lib/shop-client';
import { formatPhoneDisplay } from '@/lib/phone-display';
import { ui } from '@/lib/guest-ui';

const NAME_MAX = 120;

function saveErrorMessage(e: unknown): string {
  if (e instanceof NetworkError) return 'Không kết nối được tới Tubu Tree. Bạn kiểm tra mạng rồi thử lại nhé.';
  if (e instanceof ApiError && e.status === 400) return 'Họ tên chưa hợp lệ. Bạn kiểm tra lại nhé.';
  return 'Chưa lưu được. Bạn thử lại sau ít phút nhé.';
}

/**
 * Hồ sơ của khách trên web: sửa họ tên (PATCH /me). Số điện thoại chỉ hiển thị vì UpdateMeDto không nhận số này.
 */
export function ProfileSection({ name, phone }: { name: string | null; phone: string | null | undefined }) {
  const { updateProfile } = useAuth();
  const qc = useQueryClient();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const shownName = saved ?? name;

  const save = useMutation({
    mutationFn: (next: string) => updateMyName(next),
    onSuccess: (_res, next) => {
      setSaved(next);
      setEditing(false);
      setError(null);
      setJustSaved(true);
      qc.setQueryData<Record<string, unknown> | undefined>(['me'], (old) => (old ? { ...old, fullName: next } : old));
      updateProfile({ fullName: next });
    },
    onError: (e) => setError(saveErrorMessage(e)),
  });

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const open = () => {
    setDraft(shownName ?? '');
    setError(null);
    setJustSaved(false);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setError(null);
  };
  const submit = () => {
    if (save.isPending) return;
    const next = draft.trim();
    if (!next) {
      setError('Bạn nhập họ tên nhé.');
      return;
    }
    if (next === (shownName ?? '')) {
      cancel();
      return;
    }
    setError(null);
    save.mutate(next);
  };

  const phoneText = formatPhoneDisplay(phone);

  return (
    <section aria-label="Thông tin cá nhân" className={`${ui.card} mt-4 p-4`}>
      <h2 className={ui.sectionTitle}>Thông tin cá nhân</h2>

      {editing ? (
        <form
          noValidate
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor={inputId} className="text-sm font-medium text-stone-800">
            Họ tên
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={draft}
            maxLength={NAME_MAX}
            autoComplete="name"
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? `${inputId}-err` : undefined}
            onChange={(e) => setDraft(e.target.value)}
            className={`${error ? ui.fieldError : ui.field} mt-1`}
          />
          {error && (
            <p id={`${inputId}-err`} role="alert" className={`mt-1 ${ui.error}`}>
              {error}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={save.isPending} className={`${ui.btnPrimary} flex-1`}>
              {save.isPending ? 'Đang lưu…' : 'Lưu'}
            </button>
            <button type="button" onClick={cancel} disabled={save.isPending} className={`${ui.btnSecondary} flex-1`}>
              Huỷ
            </button>
          </div>
        </form>
      ) : (
        <dl className="mt-2 divide-y divide-stone-200 text-sm">
          <div className="flex min-h-11 items-center justify-between gap-3 py-1">
            <div className="min-w-0">
              <dt className="text-xs text-stone-600">Họ tên</dt>
              <dd className="truncate font-medium text-stone-900">{shownName?.trim() ? shownName : 'Chưa đặt tên'}</dd>
            </div>
            <button type="button" onClick={open} className={`${ui.btnText} shrink-0 text-forest-700`}>
              Sửa tên
            </button>
          </div>
          <div className="flex min-h-11 items-center py-1">
            <div className="min-w-0">
              <dt className="text-xs text-stone-600">Số điện thoại</dt>
              <dd className="font-medium text-stone-900">{phoneText || 'Chưa có số điện thoại'}</dd>
            </div>
          </div>
        </dl>
      )}

      <p role="status" className={justSaved && !editing ? 'mt-2 text-sm text-success-fg' : 'sr-only'}>
        {justSaved && !editing ? 'Đã lưu tên.' : ''}
      </p>
    </section>
  );
}
