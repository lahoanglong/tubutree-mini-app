'use client';

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminImage } from '@/components/admin/admin-image';
import { ProductPicker } from '@/components/admin/product-picker';
import { BTN_LINK, BTN_LINK_DANGER, BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, Field, INPUT_CLASS, ListSkeleton, LoadError, Notice, ToneBadge } from '@/components/admin/ui';
import { VnDateTimeInput } from '@/components/admin/vn-date-input';
import { ProductCard } from '@/components/mini/product-card';
import { actionErrorText, loadErrorText } from '@/lib/admin-error-text';
import { ApiError } from '@/lib/client-api';
import type { Tone } from '@/lib/recycling';
import { getEmptyEntrances, getMerchOverview, getMerchProduct, getMerchShelf, saveMerchShelf, suggestMerchPins, type MerchPinWarning, type MerchProductView, type MerchShelfSummary, type MerchShelfView } from './api';
import { WARNING_TEXT, addPins, draftFromPin, draftFromProduct, draftIssues, isDirty, movePin, previewCards, removePin, toPinInputs, updatePin, type DraftPin } from './editor';

const DEFAULT_KEY = 'home_featured';
const WARNING_TONE: Record<MerchPinWarning, Tone> = {
  NO_IMAGE: 'danger',
  NOT_ON_SALE: 'warning',
  OUT_OF_STOCK: 'warning',
  OUTSIDE_CATEGORY: 'warning',
  NO_SHORT_DESC: 'neutral',
  NO_CATEGORY: 'neutral',
};
const KIND_GROUP: Record<MerchShelfSummary['kind'], string> = { home: 'Trang chủ', best_sellers: 'Bán chạy', category: 'Danh mục' };

/** Thẻ xem trước không dẫn đi đâu: bấm vào không được rời trang admin. */
const stayHere = (e: MouseEvent) => {
  if (e.target instanceof Element && e.target.closest('a')) e.preventDefault();
};

function ShelfPreview({ pins, shelfKey }: { pins: readonly DraftPin[]; shelfKey: string }) {
  const cards = previewCards(pins);
  const variant = shelfKey === 'best_sellers' ? 'rank' : 'grid';
  return (
    <section aria-labelledby="merch-preview-title" className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3">
      <h3 id="merch-preview-title" className="text-sm font-semibold text-stone-900">
        Khách sẽ thấy ở đầu kệ
      </h3>
      <p className="text-xs text-stone-600">Theo bản nháp đang sửa; món ẩn, hết hàng, ngoài danh mục hoặc ngoài khung giờ không hiện. Sau các món này là danh sách thường như hôm nay.</p>
      {cards.length === 0 ? (
        <p data-testid="merch-preview-empty" className="rounded-control bg-stone-50 px-3 py-6 text-center text-sm text-stone-500">
          Chưa có món nào sẽ hiện: khách thấy kệ như hôm nay.
        </p>
      ) : (
        <div className="space-y-3" onClickCapture={stayHere}>
          <figure className="m-0 min-w-0 space-y-1">
            <figcaption className="text-xs font-medium text-stone-700">Điện thoại 390px</figcaption>
            <div data-testid="merch-preview-phone" className="w-[390px] max-w-full rounded-card border border-stone-200 bg-stone-50 p-4">
              <div className="grid grid-cols-2 gap-3">
                {cards.map((c) => (
                  <ProductCard key={c.id} product={c} variant={variant} showWishlist={false} imageSizes="180px" />
                ))}
              </div>
            </div>
          </figure>
          <figure className="m-0 min-w-0 space-y-1">
            <figcaption className="text-xs font-medium text-stone-700">Máy tính (5 cột)</figcaption>
            <div data-testid="merch-preview-desktop" className="overflow-x-auto rounded-card border border-stone-200 bg-stone-50 p-4">
              <div className="grid min-w-[880px] grid-cols-5 gap-4">
                {cards.map((c) => (
                  <ProductCard key={c.id} product={c} variant={variant} showWishlist={false} imageSizes="200px" />
                ))}
              </div>
            </div>
          </figure>
        </div>
      )}
    </section>
  );
}

function EmptyEntrances() {
  const q = useQuery({ queryKey: ['admin-merch-empty-entrances'], queryFn: getEmptyEntrances });
  return (
    <section aria-labelledby="merch-empty-title" className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3">
      <h3 id="merch-empty-title" className="text-sm font-semibold text-stone-900">
        Lối vào đang trống
      </h3>
      <p className="text-xs text-stone-600">Khách bấm vào những lối này sẽ gặp trang rỗng. Thêm hàng hoặc tạm ẩn lối vào ở tab tương ứng.</p>
      {q.isPending ? (
        <ListSkeleton label="Đang kiểm lối vào" rows={2} className="h-10" />
      ) : q.isError ? (
        <LoadError message={loadErrorText(q.error)} onRetry={() => q.refetch()} retrying={q.isFetching} />
      ) : q.data.entrances.length === 0 ? (
        <p className="text-sm text-success-fg">Mọi lối vào đều có hàng.</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {q.data.entrances.map((e) => (
            <li key={e.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-stone-900">{e.label}</p>
                <p className="break-words text-xs text-stone-600">{e.detail}</p>
              </div>
              {e.adminTab && (
                <a href={`/admin?tab=${encodeURIComponent(e.adminTab)}`} className={`${BTN_LINK} text-sm`}>
                  Mở tab
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PinRow({
  pin,
  index,
  count,
  onMove,
  onRemove,
  onChange,
  onKeyMove,
  handleRef,
  onDragStart,
  onDrop,
}: {
  pin: DraftPin;
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
  onChange: (patch: Partial<Pick<DraftPin, 'startsLocal' | 'endsLocal' | 'note'>>) => void;
  onKeyMove: (e: KeyboardEvent<HTMLButtonElement>) => void;
  handleRef: (el: HTMLButtonElement | null) => void;
  onDragStart: (e: DragEvent<HTMLButtonElement>) => void;
  onDrop: (e: DragEvent<HTMLLIElement>) => void;
}) {
  const hidden = pin.warnings.some((w) => w === 'NOT_ON_SALE' || w === 'OUT_OF_STOCK' || w === 'NO_IMAGE' || w === 'OUTSIDE_CATEGORY');
  const outOfWindow = !hidden && pin.card !== null && previewCards([pin]).length === 0;
  return (
    <li
      data-testid="merch-pin"
      data-product-id={pin.productId}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3"
    >
      <div className="flex flex-wrap items-start gap-2">
        <button
          type="button"
          ref={handleRef}
          draggable
          onDragStart={onDragStart}
          onKeyDown={onKeyMove}
          aria-label={`Đổi chỗ "${pin.name}", đang ở vị trí ${index + 1} trên ${count}. Bấm mũi tên lên hoặc xuống để chuyển.`}
          className="flex min-h-[44px] min-w-[44px] cursor-grab items-center justify-center rounded-control border border-stone-200 bg-stone-50 text-sm font-semibold text-stone-700 active:cursor-grabbing sm:min-h-9 sm:min-w-9"
        >
          {index + 1}
        </button>
        <AdminImage src={pin.thumbnail} alt={pin.name} className="h-12 w-12 shrink-0 rounded-control border border-stone-200 object-cover" />
        <div className="min-w-0 flex-1 basis-40">
          <p className="break-words text-sm font-medium text-stone-900">{pin.name}</p>
          {pin.brand && <p className="break-words text-xs text-stone-600">{pin.brand}</p>}
          {(pin.warnings.length > 0 || outOfWindow) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {pin.warnings.map((w) => (
                <ToneBadge key={w} tone={WARNING_TONE[w]} wrap>
                  {WARNING_TEXT[w]}
                </ToneBadge>
              ))}
              {outOfWindow && (
                <ToneBadge tone="info" wrap>
                  Ngoài khung giờ: chưa hiện lúc này
                </ToneBadge>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className={BTN_SMALL} disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Đưa "${pin.name}" lên`}>
            ↑
          </button>
          <button type="button" className={BTN_SMALL} disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label={`Đưa "${pin.name}" xuống`}>
            ↓
          </button>
          <button type="button" className={`${BTN_LINK_DANGER} text-sm`} onClick={onRemove} aria-label={`Gỡ "${pin.name}" khỏi kệ`}>
            Gỡ
          </button>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Hiện từ (bỏ trống: ngay)">
          <VnDateTimeInput value={pin.startsLocal} onChange={(v) => onChange({ startsLocal: v })} ariaLabel={`Hiện từ, ${pin.name}`} />
        </Field>
        <Field label="Hiện đến (bỏ trống: không hạn)">
          <VnDateTimeInput value={pin.endsLocal} onChange={(v) => onChange({ endsLocal: v })} ariaLabel={`Hiện đến, ${pin.name}`} />
        </Field>
        <Field label="Ghi chú nội bộ">
          <input className={INPUT_CLASS} value={pin.note} maxLength={200} onChange={(e) => onChange({ note: e.target.value })} aria-label={`Ghi chú, ${pin.name}`} />
        </Field>
      </div>
    </li>
  );
}

/**
 * Xếp kệ: admin ghim tối đa 12 món lên đầu Trang chủ, Bán chạy (khi chưa đủ số bán thật) và từng danh mục. Sửa trên bản nháp, bấm Lưu mới ghi;
 * kệ bị người khác lưu trong lúc sửa thì máy chủ trả 409 và admin tải lại. Cờ `merch.shelves_enabled` tắt thì khách chưa thấy gì khác.
 */
export function MerchShelvesTab() {
  const qc = useQueryClient();
  const [shelfKey, setShelfKey] = useState(DEFAULT_KEY);
  const overview = useQuery({ queryKey: ['admin-merch-shelves'], queryFn: getMerchOverview });
  // Không tự tải lại khi quay lại cửa sổ: bản tải mới sẽ đè bản nháp đang sửa.
  const shelf = useQuery({ queryKey: ['admin-merch-shelf', shelfKey], queryFn: () => getMerchShelf(shelfKey), gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false });

  const [loadedFrom, setLoadedFrom] = useState<MerchShelfView | null>(null);
  const [saved, setSaved] = useState<DraftPin[]>([]);
  const [draft, setDraft] = useState<DraftPin[]>([]);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'warning' | 'info'; text: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<'add' | 'suggest' | 'save' | null>(null);
  const [suggestions, setSuggestions] = useState<MerchProductView[] | null>(null);
  const [announce, setAnnounce] = useState('');
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);
  const dragFrom = useRef<number | null>(null);

  if (shelf.data && shelf.data !== loadedFrom) {
    const pins = shelf.data.pins.map(draftFromPin);
    setLoadedFrom(shelf.data);
    setSaved(pins);
    setDraft(pins);
    setSuggestions(null);
  }

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    handles.current.get(id)?.focus();
  }, [draft]);

  const view = shelf.data;
  const maxPins = view?.maxPins ?? 12;
  const status = view?.status ?? overview.data?.status;
  const dirty = isDirty(draft, saved);
  const issues = draftIssues(draft);

  const move = (from: number, to: number, focus: boolean) => {
    const pin = draft[from];
    if (!pin || to < 0 || to >= draft.length || from === to) return;
    if (focus) pendingFocus.current = pin.productId;
    setDraft(movePin(draft, from, to));
    setAnnounce(`Đã chuyển "${pin.name}" tới vị trí ${to + 1} trên ${draft.length}.`);
  };

  const onPick = async (productId: string) => {
    setBusy('add');
    setMessage(null);
    try {
      const p = await getMerchProduct(productId, shelfKey);
      const r = addPins(draft, [draftFromProduct(p)], maxPins);
      // Ghép vào bản nháp mới nhất: trong lúc chờ API, admin có thể đã sửa hay gỡ món khác.
      setDraft((d) => addPins(d, [draftFromProduct(p)], maxPins).list);
      if (r.added === 0) setMessage({ tone: 'warning', text: draft.some((d) => d.productId === p.productId) ? `"${p.name}" đã có trên kệ.` : `Kệ đã đủ ${maxPins} món: gỡ bớt trước khi thêm.` });
    } catch (e) {
      setMessage({ tone: 'danger', text: actionErrorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const onSuggest = async () => {
    setBusy('suggest');
    setMessage(null);
    try {
      const r = await suggestMerchPins(shelfKey, draft.map((d) => d.productId));
      setSuggestions(r.items);
    } catch (e) {
      setMessage({ tone: 'danger', text: actionErrorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const addSuggested = (items: MerchProductView[]) => {
    const r = addPins(draft, items.map(draftFromProduct), maxPins);
    setDraft(r.list);
    const have = new Set(r.list.map((d) => d.productId));
    setSuggestions((s) => (s ? s.filter((x) => !have.has(x.productId)) : s));
    setMessage(r.skipped > 0 ? { tone: 'warning', text: `Kệ đã đủ ${maxPins} món: ${r.skipped} gợi ý chưa thêm.` } : null);
  };

  const onSave = async () => {
    if (!view) return;
    setBusy('save');
    setMessage(null);
    try {
      const next = await saveMerchShelf(shelfKey, view.version, toPinInputs(draft));
      qc.setQueryData(['admin-merch-shelf', shelfKey], next);
      void qc.invalidateQueries({ queryKey: ['admin-merch-shelves'] });
      setMessage({
        tone: 'success',
        text: next.status.enabled ? 'Đã lưu kệ. Khách thấy thứ tự mới trong vài phút.' : 'Đã lưu kệ. Cờ Xếp kệ đang tắt nên khách chưa thấy thay đổi.',
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      else setMessage({ tone: 'danger', text: actionErrorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const reload = async () => {
    setConflict(false);
    setMessage(null);
    setLoadedFrom(null);
    await shelf.refetch();
  };

  const shelves = overview.data?.shelves ?? [];
  const groups = (['home', 'best_sellers', 'category'] as const).map((kind) => ({ kind, items: shelves.filter((s) => s.kind === kind) })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-stone-900">Xếp kệ</h2>
        <p className="text-sm text-stone-600">Ghim tối đa {maxPins} món lên đầu kệ. Món hết hàng, bị ẩn hoặc hết khung giờ tự rơi khỏi kệ; phần còn lại vẫn xếp như hôm nay.</p>
      </div>

      {status && !status.enabled && (
        <Notice tone="warning">Cờ Xếp kệ (merch.shelves_enabled) đang tắt: khách chưa thấy món ghim. Có thể xếp và lưu trước, nhờ quản trị viên bật cờ ở Cấu hình khi sẵn sàng.</Notice>
      )}
      {status?.curated && (
        <Notice tone="info">
          Bán chạy nhất chưa đủ số bán thật: khi có món ghim ở kệ Bán chạy, khách thấy tiêu đề &ldquo;Tubu chọn cho bạn&rdquo; với đúng các món đó, không đánh số hạng.
        </Notice>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-card border border-stone-200 bg-stone-0 p-3">
        <Field label="Kệ" className="min-w-0 flex-1 basis-56" hint={dirty ? 'Lưu hoặc bỏ thay đổi trước khi đổi kệ.' : undefined}>
          <select
            className={INPUT_CLASS}
            value={shelfKey}
            disabled={dirty || busy !== null}
            onChange={(e) => {
              setShelfKey(e.target.value);
              setMessage(null);
              setConflict(false);
            }}
          >
            {groups.length === 0 && <option value={shelfKey}>{view?.label ?? 'Trang chủ: Gợi ý hôm nay'}</option>}
            {groups.map((g) => (
              <optgroup key={g.kind} label={KIND_GROUP[g.kind]}>
                {g.items.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                    {s.pinCount > 0 ? ` (${s.pinCount} món ghim)` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <div className="min-w-0 flex-1 basis-64">
          <ProductPicker
            mode="product"
            value={null}
            label="Thêm món vào kệ"
            onChange={(v) => {
              if (v && busy === null) void onPick(v.id);
            }}
          />
        </div>
      </div>

      {overview.isError && <LoadError message={loadErrorText(overview.error)} onRetry={() => overview.refetch()} retrying={overview.isFetching} />}

      {shelf.isPending ? (
        <ListSkeleton label="Đang tải kệ" rows={3} />
      ) : shelf.isError ? (
        <LoadError message={loadErrorText(shelf.error)} onRetry={reload} retrying={shelf.isFetching} />
      ) : (
        <>
          <p aria-live="polite" className="sr-only">
            {announce}
          </p>
          {conflict && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-control border border-warning-fg bg-warning-bg px-3 py-2 text-sm text-warning-fg">
              <span className="min-w-0 flex-1 break-words">Kệ vừa được người khác lưu. Tải lại để xem bản mới nhất; thay đổi chưa lưu của bạn sẽ mất.</span>
              <button type="button" className={BTN_SECONDARY} onClick={() => void reload()}>
                Tải lại kệ
              </button>
            </div>
          )}
          {message && (
            <Notice tone={message.tone} role={message.tone === 'danger' ? 'alert' : 'status'}>
              {message.text}
            </Notice>
          )}

          {draft.length === 0 ? (
            <p data-testid="merch-empty" className="rounded-card border border-dashed border-stone-300 px-3 py-6 text-center text-sm text-stone-600">
              Kệ chưa ghim món nào: khách thấy thứ tự như hôm nay. Thêm món ở ô trên hoặc lấy gợi ý bên dưới.
            </p>
          ) : (
            <ol className="space-y-2" aria-label={`Món ghim trên kệ ${view?.label ?? ''}`}>
              {draft.map((p, i) => (
                <PinRow
                  key={p.productId}
                  pin={p}
                  index={i}
                  count={draft.length}
                  onMove={(to) => move(i, to, false)}
                  onRemove={() => setDraft(removePin(draft, p.productId))}
                  onChange={(patch) => setDraft(updatePin(draft, p.productId, patch))}
                  onKeyMove={(e) => {
                    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                    e.preventDefault();
                    move(i, e.key === 'ArrowUp' ? i - 1 : i + 1, true);
                  }}
                  handleRef={(el) => {
                    if (el) handles.current.set(p.productId, el);
                    else handles.current.delete(p.productId);
                  }}
                  onDragStart={(e) => {
                    dragFrom.current = i;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', p.productId);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = dragFrom.current;
                    dragFrom.current = null;
                    if (from !== null) move(from, i, false);
                  }}
                />
              ))}
            </ol>
          )}

          {issues.length > 0 && (
            <Notice tone="danger" role="alert">
              <ul className="list-disc space-y-0.5 pl-4">
                {issues.map((x, i) => (
                  <li key={`${x.productId}-${i}`}>{x.text}</li>
                ))}
              </ul>
            </Notice>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={!dirty || issues.length > 0 || busy !== null || conflict} onClick={() => void onSave()}>
              {busy === 'save' ? 'Đang lưu…' : 'Lưu kệ'}
            </button>
            <button type="button" className={BTN_SECONDARY} disabled={!dirty || busy !== null} onClick={() => setDraft(saved)}>
              Bỏ thay đổi
            </button>
            <button type="button" className={BTN_SECONDARY} disabled={busy !== null || draft.length >= maxPins} onClick={() => void onSuggest()}>
              {busy === 'suggest' ? 'Đang tìm…' : 'Gợi ý 8 món sẵn sàng'}
            </button>
            <span className="text-xs text-stone-600">
              {draft.length}/{maxPins} món{dirty ? ' · có thay đổi chưa lưu' : ''}
            </span>
          </div>

          {suggestions && (
            <section aria-labelledby="merch-suggest-title" className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="merch-suggest-title" className="text-sm font-semibold text-stone-900">
                  Gợi ý: món đang bán, còn hàng, có ảnh
                </h3>
                {suggestions.length > 0 && (
                  <button type="button" className={BTN_SMALL} onClick={() => addSuggested(suggestions)}>
                    Thêm tất cả
                  </button>
                )}
              </div>
              <p className="text-xs text-stone-600">Chỉ thêm vào bản nháp; bấm Lưu kệ thì khách mới thấy.</p>
              {suggestions.length === 0 ? (
                <p className="text-sm text-stone-600">Không còn món nào đủ điều kiện ngoài các món đã ghim.</p>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {suggestions.map((s) => (
                    <li key={s.productId} data-testid="merch-suggestion" className="flex items-center gap-2 py-2">
                      <AdminImage src={s.thumbnail} alt={s.name} className="h-10 w-10 shrink-0 rounded-control border border-stone-200 object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm text-stone-900">{s.name}</p>
                        {s.brand && <p className="break-words text-xs text-stone-600">{s.brand}</p>}
                      </div>
                      <button type="button" className={BTN_SMALL} disabled={draft.length >= maxPins} onClick={() => addSuggested([s])} aria-label={`Thêm "${s.name}" vào kệ`}>
                        Thêm
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <ShelfPreview pins={draft} shelfKey={shelfKey} />
        </>
      )}

      <EmptyEntrances />
    </div>
  );
}
