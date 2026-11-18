'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { actionErrorText, loadErrorText } from '@/lib/admin-error-text';
import { useConfirm } from '@/components/admin/confirm-dialog';
import { useToastedMessage, type AdminMsg } from '@/components/admin/admin-toast';
import { BTN_PRIMARY, BTN_XS_DANGER, BTN_XS_SECONDARY, Field, INPUT_CLASS, ListSkeleton, LoadError, Notice, ToneBadge } from '@/components/admin/ui';
import {
  POPULAR_TERMS_MAX,
  SYNONYM_FIELD_MAX,
  createSynonym,
  listSynonyms,
  parsePopularTerms,
  popularTermsError,
  readPopularTerms,
  removeSynonym,
  savePopularTerms,
  updateSynonym,
  type SearchSynonym,
} from './search-terms-api';

const SYN_KEY = ['admin', 'search-synonyms'] as const;
const POP_KEY = ['admin', 'search-popular-terms'] as const;

/**
 * Thẻ "Từ khoá tìm kiếm": từ đồng nghĩa (khách gõ cụm bên trái thì tìm thêm theo cụm bên phải; máy chủ lưu dạng bỏ dấu) và các cụm dự
 * phòng cho hàng "Tìm phổ biến". Từ đồng nghĩa chỉ có tác dụng khi cờ catalog.search_fuzzy_enabled bật; hàng phổ biến khi
 * catalog.search_popular_enabled bật. Tiến trình API khác nhận từ đồng nghĩa mới sau tối đa 5 phút, cụm phổ biến sau tối đa 1 giờ.
 */
export function SearchTermsCard() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<AdminMsg | null>(null);
  const shown = useToastedMessage(msg);
  const { confirm, ask, dialog } = useConfirm();
  const [form, setForm] = useState({ term: '', canonical: '' });
  const syn = useQuery({ queryKey: SYN_KEY, queryFn: listSynonyms });
  const pop = useQuery({ queryKey: POP_KEY, queryFn: readPopularTerms });
  const [popText, setPopText] = useState<string | null>(null);
  const popValue = popText ?? (pop.data ?? []).join('\n');
  const popTerms = parsePopularTerms(popValue);
  const popError = popularTermsError(popTerms);

  const settle = (text: string, ok: boolean) => {
    setMsg({ ok, text });
    void qc.invalidateQueries({ queryKey: SYN_KEY });
  };
  const fail = (e: unknown) => settle(actionErrorText(e), false);

  const add = useMutation({
    mutationFn: () => createSynonym({ term: form.term.trim(), canonical: form.canonical.trim() }),
    onSuccess: (row) => {
      setForm({ term: '', canonical: '' });
      settle(`Đã thêm: "${row.term}" → "${row.canonical}".`, true);
    },
    onError: fail,
  });
  const patch = useMutation({
    mutationFn: ({ row, body }: { row: SearchSynonym; body: { canonical?: string; isActive?: boolean } }) => updateSynonym(row.id, body),
    onSuccess: (row) => settle(`Đã lưu "${row.term}".`, true),
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (row: SearchSynonym) => removeSynonym(row.id),
    onSuccess: () => settle('Đã xoá từ đồng nghĩa.', true),
    onError: fail,
  });
  const savePop = useMutation({
    mutationFn: () => savePopularTerms(popTerms),
    onSuccess: () => {
      setPopText(null);
      setMsg({ ok: true, text: 'Đã lưu cụm tìm phổ biến dự phòng.' });
      void qc.invalidateQueries({ queryKey: POP_KEY });
    },
    onError: (e) => setMsg({ ok: false, text: actionErrorText(e) }),
  });

  const editCanonical = async (row: SearchSynonym) => {
    const text = await ask({
      title: `Sửa cụm tìm thay cho "${row.term}"`,
      message: 'Khách gõ cụm bên trái thì ô tìm tìm thêm theo cụm này (lấy chữ có trong tên hàng).',
      confirmLabel: 'Lưu',
      input: { label: 'Cụm tìm thay', initial: row.canonical, maxLength: SYNONYM_FIELD_MAX, required: true },
    });
    if (text) patch.mutate({ row, body: { canonical: text } });
  };
  const askRemove = async (row: SearchSynonym) => {
    const ok = await confirm({ title: 'Xoá từ đồng nghĩa?', message: `"${row.term}" → "${row.canonical}"`, confirmLabel: 'Xoá', tone: 'danger' });
    if (ok) remove.mutate(row);
  };

  const busy = add.isPending || patch.isPending || remove.isPending;
  const rows = syn.data ?? [];
  return (
    <section data-testid="search-terms-card" className="space-y-6">
      {shown && (
        <Notice tone={shown.ok ? 'success' : 'danger'} role={shown.ok ? 'status' : 'alert'}>
          {shown.text}
        </Notice>
      )}

      <div className="space-y-3">
        <h2 className="text-base font-semibold">Từ đồng nghĩa</h2>
        <form
          className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) add.mutate();
          }}
        >
          <Field label="Cụm khách gõ">
            <input
              name="term"
              value={form.term}
              onChange={(e) => setForm({ ...form, term: e.target.value })}
              maxLength={60}
              minLength={2}
              required
              className={INPUT_CLASS}
              placeholder="nước rửa bát"
            />
          </Field>
          <Field label="Cụm tìm thay">
            <input
              name="canonical"
              value={form.canonical}
              onChange={(e) => setForm({ ...form, canonical: e.target.value })}
              maxLength={60}
              minLength={2}
              required
              className={INPUT_CLASS}
              placeholder="nước rửa chén"
            />
          </Field>
          <button type="submit" disabled={busy} className={BTN_PRIMARY}>
            Thêm
          </button>
        </form>
        {syn.isLoading ? (
          <ListSkeleton label="Đang tải từ đồng nghĩa" />
        ) : syn.isError ? (
          <LoadError message={loadErrorText(syn.error)} onRetry={() => syn.refetch()} retrying={syn.isFetching} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-stone-600">Chưa có từ đồng nghĩa nào.</p>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-card border border-stone-200">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 break-words text-sm">
                  <span className="font-medium">{row.term}</span> → {row.canonical}
                </span>
                {!row.isActive && <ToneBadge tone="neutral">Đang tắt</ToneBadge>}
                <button type="button" disabled={busy} onClick={() => patch.mutate({ row, body: { isActive: !row.isActive } })} className={BTN_XS_SECONDARY}>
                  {row.isActive ? 'Tắt' : 'Bật'}
                </button>
                <button type="button" disabled={busy} onClick={() => void editCanonical(row)} className={BTN_XS_SECONDARY}>
                  Sửa
                </button>
                <button type="button" disabled={busy} onClick={() => void askRemove(row)} className={BTN_XS_DANGER}>
                  Xoá
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-semibold">Cụm tìm phổ biến dự phòng</h2>
        <p className="text-sm text-stone-600">
          Dùng khi dữ liệu tìm kiếm 14 ngày chưa đủ 4 cụm (mỗi cụm cần từ 3 người tìm ra hàng). Mỗi dòng một cụm, tối đa {POPULAR_TERMS_MAX} cụm.
        </p>
        {pop.isLoading ? (
          <ListSkeleton label="Đang tải cụm tìm phổ biến" rows={1} />
        ) : pop.isError ? (
          <LoadError message={loadErrorText(pop.error)} onRetry={() => pop.refetch()} retrying={pop.isFetching} />
        ) : (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!popError && !savePop.isPending) savePop.mutate();
            }}
          >
            <Field label="Cụm tìm phổ biến" hint={popError ?? undefined}>
              <textarea name="popularTerms" value={popValue} onChange={(e) => setPopText(e.target.value)} rows={6} className={INPUT_CLASS} aria-invalid={popError ? true : undefined} />
            </Field>
            <button type="submit" disabled={!!popError || savePop.isPending || popText === null} className={BTN_PRIMARY}>
              Lưu cụm phổ biến
            </button>
          </form>
        )}
      </div>
      {dialog}
    </section>
  );
}
