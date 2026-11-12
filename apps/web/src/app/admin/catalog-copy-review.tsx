'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { COPY_DRAFT_MAX_BATCH, isBlankHtmlText, type CopyApproveItem, type CopyApproveResponse, type CopyDraft } from '@tubutree/shared-types';
import { BTN_PRIMARY, BTN_SECONDARY, INPUT_CLASS, LoadError, Notice, ToneBadge } from '@/components/admin/ui';
import { actionErrorText } from '@/lib/admin-error-text';
import { postCopyApprove, postCopyDrafts } from './catalog-quality-api';

// Cùng trần với `checkCopyForSave` của API; API vẫn kiểm lại từng mục khi lưu nên lệch số chỉ làm mục bị từ chối kèm lý do, không ghi bản sai.
const SHORT_MAX = 140;
const DESC_MAX = 800;
const INGREDIENTS_MAX = 8;

/** Nút đang chạy báo bận bằng aria-disabled thay `disabled` DOM: Chromium thả focus về body khi nút đang giữ focus bị disabled. */
const BUSY_CLASS = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

/** Chữ hiện có của sản phẩm trong DB (lấy từ lần kiểm), để đối chiếu với bản nháp. */
export interface CurrentCopy {
  shortDesc: string | null;
  description: string;
  hasIngredients: boolean;
}

export interface CopyReviewSelection {
  id: string;
  name: string;
}

interface CardState {
  id: string;
  name: string;
  source: CopyDraft['source'];
  warnings: string[];
  shortDesc: string;
  description: string;
  ingredientsText: string;
  saved: boolean;
  picked: boolean;
  /** Lý do máy chủ từ chối lần duyệt gần nhất; xoá khi admin sửa tiếp. */
  rejected: string[];
}

type Phase = 'idle' | 'composing' | 'saving';

const toCard = (d: CopyDraft): CardState => ({
  id: d.id,
  name: d.name,
  source: d.source,
  warnings: d.warnings,
  shortDesc: d.shortDesc,
  description: d.description,
  ingredientsText: d.ingredients.join('\n'),
  saved: false,
  picked: false,
  rejected: [],
});

/** Mỗi dòng là một tên (dấu phẩy trong tên như "Hạt, củ, quả" được giữ nguyên); bỏ tên trống và tên trùng (không phân biệt hoa thường). */
export function parseIngredients(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const name = raw.replace(/\s+/g, ' ').trim();
    const key = name.toLowerCase();
    if (name === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function problemsOf(c: CardState): string[] {
  const out: string[] = [];
  if (isBlankHtmlText(c.description)) out.push('Mô tả đang trống.');
  if (c.shortDesc.trim().length > SHORT_MAX) out.push(`Mô tả ngắn dài quá ${SHORT_MAX} ký tự.`);
  if (c.description.trim().length > DESC_MAX) out.push(`Mô tả dài quá ${DESC_MAX} ký tự.`);
  const n = parseIngredients(c.ingredientsText).length;
  if (n > INGREDIENTS_MAX) out.push(`Tối đa ${INGREDIENTS_MAX} thành phần (đang ${n}).`);
  return out;
}

const toItem = (c: CardState): CopyApproveItem => ({
  id: c.id,
  shortDesc: c.shortDesc.trim(),
  description: c.description.trim(),
  ingredients: parseIngredients(c.ingredientsText),
});

/** Mô tả gốc của Pancake là HTML: chỉ lấy chữ để đối chiếu, vẽ như văn bản thường. */
function plainText(html: string): string {
  return html
    .replace(/<(?:br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface Props {
  selected: readonly CopyReviewSelection[];
  current: ReadonlyMap<string, CurrentCopy>;
  /** Số dòng trống mô tả đang hiện, cho nút chọn nhanh. */
  emptyCount: number;
  /** Lần kiểm đang chạy lại: khoá soạn/duyệt để không ghi chồng lên dữ liệu đang tải. */
  auditBusy: boolean;
  onSelectEmpty: () => void;
  /** Chạy lại lần kiểm sau khi lưu; chỉ nhả khoá khi xong (dữ liệu mới đã về hoặc đã báo lỗi). */
  onSaved: (savedIds: readonly string[]) => Promise<unknown>;
}

export function CatalogCopyReview({ selected, current, emptyCount, auditBusy, onSelectEmpty, onSaved }: Props) {
  const [cards, setCards] = useState<CardState[]>([]);
  const [failed, setFailed] = useState<{ id: string; name: string; reason: string }[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());
  const [composeError, setComposeError] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<{ text: string; ids: string[] } | null>(null);
  // Ref khoá đồng bộ: hai lần bấm sát nhau chạy trước khi React kịp vẽ lại nút đã khoá.
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const busy = phase !== 'idle' || auditBusy;
  const composing = phase === 'composing';
  const canCompose = !busy && selected.length > 0 && selected.length <= COPY_DRAFT_MAX_BATCH;

  const compose = async () => {
    if (lock.current || auditBusy || selected.length === 0 || selected.length > COPY_DRAFT_MAX_BATCH) return;
    lock.current = true;
    setPhase('composing');
    setComposeError(null);
    setApproveError(null);
    const names = new Map(selected.map((s) => [s.id, s.name]));
    try {
      const res = await postCopyDrafts(selected.map((s) => s.id));
      if (!alive.current) return;
      const fresh = res.drafts.map(toCard);
      const freshIds = new Set(fresh.map((c) => c.id));
      setCards((prev) => [...fresh, ...prev.filter((c) => !freshIds.has(c.id) && !c.saved)]);
      setFailed(res.failed.map((f) => ({ id: f.id, name: names.get(f.id) ?? f.id, reason: f.reason })));
    } catch (e) {
      if (alive.current) setComposeError(actionErrorText(e));
    } finally {
      lock.current = false;
      if (alive.current) setPhase('idle');
    }
  };

  const approve = async (ids: readonly string[]) => {
    if (lock.current || auditBusy) return;
    const targets = cards.filter((c) => ids.includes(c.id) && !c.saved && problemsOf(c).length === 0);
    if (targets.length === 0 || targets.length > COPY_DRAFT_MAX_BATCH) return;
    lock.current = true;
    setPhase('saving');
    setSavingIds(new Set(targets.map((t) => t.id)));
    setApproveError(null);
    setComposeError(null);
    let res: CopyApproveResponse;
    try {
      res = await postCopyApprove(targets.map(toItem));
    } catch (e) {
      // Không biết máy chủ đã ghi hay chưa: giữ nguyên bản đang sửa để admin thử lại hoặc kiểm tra.
      lock.current = false;
      if (alive.current) {
        setApproveError({ text: actionErrorText(e), ids: targets.map((t) => t.id) });
        setSavingIds(new Set());
        setPhase('idle');
      }
      return;
    }
    if (alive.current) {
      const saved = new Set(res.saved);
      const rejected = new Map(res.rejected.map((r) => [r.id, r.reasons]));
      setCards((prev) =>
        prev.map((c) => (saved.has(c.id) ? { ...c, saved: true, picked: false, rejected: [] } : rejected.has(c.id) ? { ...c, rejected: rejected.get(c.id)! } : c)),
      );
    }
    // Khoá giữ tới khi lần kiểm lại xong: nhả sớm thì bấm tiếp trên số liệu cũ.
    try {
      if (res.saved.length > 0) await onSaved(res.saved);
    } finally {
      lock.current = false;
      if (alive.current) {
        setSavingIds(new Set());
        setPhase('idle');
      }
    }
  };

  const edit = (id: string, patch: Partial<CardState>) => setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch, rejected: [] } : c)));
  const pick = (id: string, picked: boolean) => setCards((prev) => prev.map((c) => (c.id === id ? { ...c, picked } : c)));

  const open = cards.filter((c) => !c.saved);
  const pickedValid = open.filter((c) => c.picked && problemsOf(c).length === 0);
  const overBatch = pickedValid.length > COPY_DRAFT_MAX_BATCH;
  const canApproveBatch = !busy && pickedValid.length > 0 && !overBatch;
  const selectAllOpen = () => {
    const ids = new Set(open.filter((c) => problemsOf(c).length === 0).slice(0, COPY_DRAFT_MAX_BATCH).map((c) => c.id));
    setCards((prev) => prev.map((c) => (c.saved ? c : { ...c, picked: ids.has(c.id) })));
  };

  return (
    <div className="space-y-3" aria-busy={phase !== 'idle' || undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`${BTN_SECONDARY} ${BUSY_CLASS}`}
          aria-disabled={busy || emptyCount === 0 || undefined}
          onClick={() => {
            if (!busy && emptyCount > 0) onSelectEmpty();
          }}
        >
          Chọn các dòng trống mô tả (<span className="tabular-nums">{Math.min(emptyCount, COPY_DRAFT_MAX_BATCH)}</span>)
        </button>
        <button
          type="button"
          className={`${BTN_PRIMARY} ${BUSY_CLASS}`}
          aria-busy={composing || undefined}
          aria-disabled={!canCompose || undefined}
          onClick={() => void compose()}
        >
          {composing ? (
            'Đang soạn'
          ) : (
            <>
              Soạn mô tả bằng AI (<span className="tabular-nums">{selected.length}</span>)
            </>
          )}
        </button>
      </div>
      <p className="text-xs text-stone-500">
        Tích chọn sản phẩm trong danh sách bên dưới, tối đa {COPY_DRAFT_MAX_BATCH} sản phẩm mỗi lần. Đã chọn <span className="tabular-nums">{selected.length}</span>/<span className="tabular-nums">{COPY_DRAFT_MAX_BATCH}</span>. AI chỉ soạn bản nháp, chưa ghi vào DB cho tới khi bạn duyệt.
      </p>
      {composing && (
        <p role="status" className="text-sm text-stone-700">
          AI đang soạn, có thể mất tới một phút.
        </p>
      )}
      {composeError && <LoadError onRetry={() => void compose()} retrying={busy}>{composeError}</LoadError>}
      {failed.length > 0 && (
        <Notice tone="warning">
          <p className="font-medium">Chưa soạn được {failed.length} sản phẩm:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {failed.map((f) => (
              <li key={f.id} className="break-words">
                {f.name}: {f.reason}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {cards.length > 0 && (
        <>
          <Notice tone="info">Kiểm lại thành phần với bao bì trước khi lưu.</Notice>
          {open.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`${BTN_PRIMARY} ${BUSY_CLASS}`}
                aria-busy={phase === 'saving' || undefined}
                aria-disabled={!canApproveBatch || undefined}
                onClick={() => void approve(pickedValid.map((c) => c.id))}
              >
                Duyệt lô đã chọn (<span className="tabular-nums">{pickedValid.length}</span>)
              </button>
              <button type="button" className={`${BTN_SECONDARY} ${BUSY_CLASS}`} aria-disabled={busy || undefined} onClick={() => !busy && selectAllOpen()}>
                Chọn các thẻ chưa lưu
              </button>
              {overBatch && <span className="text-xs text-danger-fg">Mỗi lần duyệt tối đa {COPY_DRAFT_MAX_BATCH} thẻ.</span>}
            </div>
          )}
          {approveError && (
            <LoadError onRetry={() => void approve(approveError.ids)} retrying={busy}>
              {`Chưa lưu được, bản đang sửa vẫn còn đây. ${approveError.text}`}
            </LoadError>
          )}
          <ul aria-label="Bản nháp mô tả" className="space-y-3">
            {cards.map((c) => (
              <CopyCard
                key={c.id}
                card={c}
                current={current.get(c.id)}
                busy={busy}
                saving={savingIds.has(c.id)}
                onEdit={(patch) => edit(c.id, patch)}
                onPick={(v) => pick(c.id, v)}
                onApprove={() => void approve([c.id])}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function CopyCard({
  card,
  current,
  busy,
  saving,
  onEdit,
  onPick,
  onApprove,
}: {
  card: CardState;
  current: CurrentCopy | undefined;
  busy: boolean;
  saving: boolean;
  onEdit: (patch: Partial<CardState>) => void;
  onPick: (picked: boolean) => void;
  onApprove: () => void;
}) {
  const problems = problemsOf(card);
  const ingredientCount = parseIngredients(card.ingredientsText).length;
  return (
    <li data-copy-card={card.id} className="min-w-0 space-y-2 rounded-control border border-stone-200 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {!card.saved && (
          <label className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center">
            <input type="checkbox" checked={card.picked} onChange={(e) => onPick(e.target.checked)} aria-label={`Chọn thẻ ${card.name} để duyệt`} className="h-5 w-5" />
          </label>
        )}
        <span className="min-w-0 flex-1 break-words text-sm font-medium text-stone-900">{card.name}</span>
        {card.saved ? (
          <ToneBadge tone="success">Đã lưu</ToneBadge>
        ) : card.source === 'ai' ? (
          <ToneBadge tone="info">AI soạn</ToneBadge>
        ) : (
          <ToneBadge tone="neutral">Chữ dự phòng đã duyệt</ToneBadge>
        )}
      </div>
      {card.saved ? (
        <p className="text-sm text-success-fg">Đã lưu vào DB.</p>
      ) : (
        <>
          {card.warnings.length > 0 && (
            <Notice tone="warning">
              <ul className="list-disc space-y-0.5 pl-4">
                {card.warnings.map((w, i) => (
                  <li key={`${i}-${w}`}>{w}</li>
                ))}
              </ul>
            </Notice>
          )}
          {current && !isBlankHtmlText(current.description) && (
            <Notice tone="warning">
              Sản phẩm này đã có mô tả từ Pancake. Đồng bộ Pancake (mỗi 15 phút) sẽ ghi đè mô tả khi Pancake có chữ thật; mô tả vừa lưu chỉ bền khi ô mô tả trên Pancake để trống.
            </Notice>
          )}
          {card.rejected.length > 0 && (
            <Notice tone="danger" role="alert">
              <p className="font-medium">Máy chủ chưa lưu thẻ này, sửa rồi duyệt lại:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {card.rejected.map((r, i) => (
                  <li key={`${i}-${r}`}>{r}</li>
                ))}
              </ul>
            </Notice>
          )}
          {current && (
            <details className="rounded-control border border-stone-200 bg-stone-50">
              <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-xs font-medium text-stone-700">Hiện tại trong DB</summary>
              <dl className="space-y-2 px-3 pb-3 text-xs text-stone-700">
                <div>
                  <dt className="font-medium">Mô tả ngắn</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap break-words">{current.shortDesc?.trim() || 'Chưa có'}</dd>
                </div>
                <div>
                  <dt className="font-medium">Mô tả</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap break-words">{plainText(current.description) || 'Chưa có'}</dd>
                </div>
                <div>
                  <dt className="font-medium">Thành phần</dt>
                  <dd className="mt-0.5">{current.hasIngredients ? 'Đã có trong DB' : 'Chưa có'}</dd>
                </div>
              </dl>
            </details>
          )}
          <CountedField label="Mô tả ngắn" value={card.shortDesc} rows={2} count={card.shortDesc.length} max={SHORT_MAX} unit="ký tự" maxLength={SHORT_MAX} onChange={(v) => onEdit({ shortDesc: v })} />
          <CountedField label="Mô tả" value={card.description} rows={6} count={card.description.length} max={DESC_MAX} unit="ký tự" maxLength={DESC_MAX} onChange={(v) => onEdit({ description: v })} />
          <CountedField
            label="Thành phần"
            value={card.ingredientsText}
            rows={3}
            count={ingredientCount}
            max={INGREDIENTS_MAX}
            unit="thành phần"
            hint="Mỗi dòng là một thành phần; dấu phẩy trong tên được giữ nguyên."
            onChange={(v) => onEdit({ ingredientsText: v })}
          />
          {problems.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-danger-fg">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className={`${BTN_PRIMARY} ${BUSY_CLASS}`}
            aria-busy={saving || undefined}
            aria-disabled={busy || problems.length > 0 || undefined}
            onClick={onApprove}
          >
            {saving ? 'Đang lưu' : 'Duyệt & Lưu vào DB'}
          </button>
        </>
      )}
    </li>
  );
}

/** `maxLength` chỉ đặt cho ô chữ có trần độ dài; ô thành phần đếm theo số tên nên không chặn gõ. */
function CountedField({
  label,
  value,
  rows,
  count,
  max,
  unit,
  maxLength,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  rows: number;
  count: number;
  max: number;
  unit: string;
  maxLength?: number;
  hint?: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const over = count > max;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-xs font-medium text-stone-700">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        maxLength={maxLength}
        aria-describedby={`${id}-count`}
        aria-invalid={over || undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 block ${INPUT_CLASS}`}
      />
      <div id={`${id}-count`} className={`mt-0.5 break-words text-[11px] ${over ? 'text-danger-fg' : 'text-stone-500'}`}>
        <span className="tabular-nums">
          {count}/{max}
        </span>{' '}
        {unit}
        {hint ? `. ${hint}` : ''}
      </div>
    </div>
  );
}
