'use client';

import { useId, useRef, useState } from 'react';
import { BTN_PRIMARY, INPUT_CLASS, Notice } from '@/components/admin/ui';
import { useToastedMessage } from '@/components/admin/admin-toast';
import { ProgressBar } from '@/components/ui/progress-bar';
import { actionErrorText } from '@/lib/admin-error-text';
import { readImageForLabelOcr } from '@/lib/image-compress';
import { ImageDropZone } from './image-drop-zone';
import { INGREDIENT_NAME_MAX, INGREDIENTS_MAX, ingredientsToText, parseIngredientDraft } from './ingredient-draft';
import { postExtractIngredients, postSaveIngredients } from './catalog-quality-api';

/** Nút đang chạy báo bận bằng aria-disabled thay `disabled` DOM: Chromium thả focus về body khi nút đang giữ focus bị disabled. */
const BUSY_CLASS = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

const MSG = {
  compressFail: 'Không xử lý được ảnh bao bì này. Chụp lại hoặc chọn ảnh khác.',
  tooMany: (n: number) => `Tối đa ${INGREDIENTS_MAX} thành phần mỗi lần lưu (đang có ${n}). Bớt đi rồi lưu.`,
  nameTooLong: `Mỗi thành phần tối đa ${INGREDIENT_NAME_MAX} ký tự.`,
  readingHint: 'Chụp rõ mặt sau bao bì, có mục "Thành phần". Kéo ảnh vào đây hoặc bấm vào ô này rồi nhấn Ctrl+V (⌘V trên Mac).',
} as const;

export interface IngredientsFillProduct {
  id: string;
  name: string;
}

interface RowState {
  text: string;
  error: string | null;
  /** Cảnh báo của máy chủ cho bản nháp vừa đọc (tên sẽ bị bộ chặn, quá trần, ảnh không đọc được); giữ tới lần đọc hoặc lưu kế tiếp. */
  notes: string[];
  fromImage: boolean;
}

const EMPTY: RowState = { text: '', error: null, notes: [], fromImage: false };
type Phase = 'reading' | 'saving';

const keyOf = (name: string) => name.toLocaleLowerCase('vi');

/** Nối tên đọc từ ảnh vào chữ nhân viên đã gõ: không nuốt chữ đã có, bỏ tên trùng (không phân biệt hoa thường). */
function mergeDraft(text: string, names: readonly string[]): string {
  const merged = parseIngredientDraft(text);
  const seen = new Set(merged.map(keyOf));
  for (const name of names) {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (clean === '' || seen.has(keyOf(clean))) continue;
    seen.add(keyOf(clean));
    merged.push(clean);
  }
  return ingredientsToText(merged);
}

interface Props {
  /** Sản phẩm đang bán mà cột thành phần còn trống (từ lần kiểm catalog gần nhất). */
  products: readonly IngredientsFillProduct[];
  /** Số sản phẩm đang bán, mẫu số của thanh tiến độ. */
  total: number;
  /** Gọi sau khi lưu xong một sản phẩm, để nơi dùng nạp lại lần kiểm. */
  onSaved: (id: string) => unknown;
}

/**
 * Điền thành phần cho sản phẩm còn thiếu: gõ tay (mỗi dòng một tên; dấu phẩy ngoài ngoặc cũng tách), hoặc chụp/kéo-thả/dán ảnh mặt sau bao bì
 * để AI đọc ra BẢN NHÁP. AI không bao giờ tự ghi: bản nháp chỉ điền vào ô nhập, nhân viên xem rồi bấm "Lưu thành phần". Máy chủ chỉ nối thêm
 * tên mới và kiểm lại cùng bộ chặn với duyệt mô tả. Một thao tác (đọc hoặc lưu) tại một thời điểm trên cả khối.
 */
export function CatalogIngredientsFill({ products, total, onSaved }: Props) {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<{ id: string; phase: Phase } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inFlight = useRef(false);
  const inlineMsg = useToastedMessage(msg);

  const remaining = products.filter((p) => !saved.has(p.id));
  const done = Math.max(0, total - remaining.length);
  const locked = busy !== null;

  const patch = (id: string, next: Partial<RowState>) => setRows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY), ...next } }));

  const readLabel = async (p: IngredientsFillProduct, file: File) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setMsg(null);
    patch(p.id, { error: null, notes: [], fromImage: false });
    setBusy({ id: p.id, phase: 'reading' });
    try {
      let image: string;
      try {
        image = await readImageForLabelOcr(file);
      } catch {
        patch(p.id, { error: MSG.compressFail });
        return;
      }
      try {
        const res = await postExtractIngredients(p.id, image);
        const drafted = res.readable && res.ingredients.length > 0;
        setRows((prev) => {
          const cur = prev[p.id] ?? EMPTY;
          return { ...prev, [p.id]: { ...cur, text: drafted ? mergeDraft(cur.text, res.ingredients) : cur.text, notes: res.warnings, fromImage: drafted } };
        });
        if (drafted) setMsg({ ok: true, text: `Đã đọc ${res.ingredients.length} thành phần từ ảnh bao bì "${p.name}". Xem lại rồi bấm "Lưu thành phần".` });
      } catch (e) {
        patch(p.id, { error: actionErrorText(e) });
      }
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const save = async (p: IngredientsFillProduct) => {
    if (inFlight.current) return;
    const names = parseIngredientDraft((rows[p.id] ?? EMPTY).text);
    if (names.length === 0) return;
    if (names.length > INGREDIENTS_MAX) {
      patch(p.id, { error: MSG.tooMany(names.length) });
      return;
    }
    if (names.some((n) => n.length > INGREDIENT_NAME_MAX)) {
      patch(p.id, { error: MSG.nameTooLong });
      return;
    }
    inFlight.current = true;
    setMsg(null);
    patch(p.id, { error: null, notes: [] });
    setBusy({ id: p.id, phase: 'saving' });
    try {
      const res = await postSaveIngredients(p.id, names);
      setSaved((prev) => new Set(prev).add(p.id));
      setMsg({ ok: true, text: res.added > 0 ? `Đã lưu ${res.added} thành phần cho "${p.name}".` : `Các thành phần này đã có sẵn trong "${p.name}".` });
      void onSaved(p.id);
    } catch (e) {
      patch(p.id, { error: actionErrorText(e) });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  return (
    <div role="region" aria-labelledby="ingredients-fill-title" className="space-y-3 rounded-card border border-stone-200 bg-stone-0 p-3">
      <h3 id="ingredients-fill-title" className="m-0 font-display text-base font-semibold text-stone-900">
        Bổ sung thành phần
      </h3>
      <p className="max-w-2xl text-sm text-stone-600">
        Sản phẩm đang bán mà chưa có thành phần. Gõ tay từ nhãn bao bì, hoặc đưa ảnh mặt sau bao bì để AI đọc ra bản nháp. AI không tự lưu: bạn xem và sửa rồi mới bấm Lưu.
      </p>
      <div className="space-y-1">
        <p data-testid="ingredients-progress" className="text-xs text-stone-700">
          Đã đủ thành phần <span className="tabular-nums">{done}</span>/<span className="tabular-nums">{total}</span> sản phẩm.
        </p>
        <ProgressBar value={done} max={total} ariaLabel="Tiến độ bổ sung thành phần" />
      </div>
      {inlineMsg && (
        <Notice tone={inlineMsg.ok ? 'success' : 'danger'} role={inlineMsg.ok ? 'status' : 'alert'}>
          {inlineMsg.text}
        </Notice>
      )}
      {products.length === 0 ? (
        <p className="text-sm text-stone-600">Mọi sản phẩm đang bán đều đã có thành phần.</p>
      ) : (
        <ul className="m-0 list-none space-y-3 p-0">
          {products.map((p) => (
            <li key={p.id}>
              <IngredientRow
                product={p}
                state={rows[p.id] ?? EMPTY}
                done={saved.has(p.id)}
                phase={busy?.id === p.id ? busy.phase : null}
                locked={locked}
                onText={(text) => patch(p.id, { text, error: null })}
                onFile={(file) => void readLabel(p, file)}
                onSave={() => void save(p)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IngredientRow({
  product,
  state,
  done,
  phase,
  locked,
  onText,
  onFile,
  onSave,
}: {
  product: IngredientsFillProduct;
  state: RowState;
  done: boolean;
  phase: Phase | null;
  locked: boolean;
  onText: (text: string) => void;
  onFile: (file: File) => void;
  onSave: () => void;
}) {
  const id = useId();
  const names = parseIngredientDraft(state.text);
  const over = names.length > INGREDIENTS_MAX;
  const cannotSave = locked || names.length === 0;

  return (
    <div data-testid={`ingredients-row-${product.id}`} className="space-y-2 rounded-control border border-stone-200 p-3">
      <h4 className="m-0 break-words text-sm font-semibold text-stone-900">{product.name}</h4>
      {done ? (
        <p className="text-sm text-success-fg">Đã lưu thành phần.</p>
      ) : (
        <>
          <div>
            <label htmlFor={id} className="text-xs font-medium text-stone-700">
              Thành phần của {product.name}
            </label>
            <textarea
              id={id}
              rows={4}
              value={state.text}
              onChange={(e) => onText(e.target.value)}
              aria-describedby={`${id}-count`}
              aria-invalid={over || undefined}
              placeholder={'Mỗi dòng một thành phần, ví dụ:\nĐường\nMuối'}
              className={`mt-1 block ${INPUT_CLASS}`}
            />
            <div id={`${id}-count`} className={`mt-0.5 text-[11px] ${over ? 'text-danger-fg' : 'text-stone-500'}`}>
              <span className="tabular-nums">
                {names.length}/{INGREDIENTS_MAX}
              </span>{' '}
              thành phần
            </div>
          </div>
          <ImageDropZone label={`Ảnh bao bì của ${product.name}`} pickLabel="Đọc từ ảnh bao bì" hint={MSG.readingHint} busy={phase === 'reading'} disabled={locked && phase !== 'reading'} onFile={onFile} />
          {phase === 'reading' && (
            <p role="status" className="text-xs text-stone-600">
              Đang đọc ảnh bao bì…
            </p>
          )}
          {state.fromImage && !phase && <p className="text-xs text-stone-600">Bản nháp đọc từ ảnh bao bì: xem lại rồi bấm &quot;Lưu thành phần&quot;.</p>}
          {state.notes.length > 0 && (
            <Notice tone="warning">
              <ul className="m-0 list-disc space-y-0.5 pl-4">
                {state.notes.map((n, i) => (
                  <li key={`${i}-${n}`}>{n}</li>
                ))}
              </ul>
            </Notice>
          )}
          {state.error && (
            <p role="alert" className="text-xs text-danger-fg">
              {state.error}
            </p>
          )}
          <button type="button" onClick={onSave} aria-disabled={cannotSave || undefined} aria-busy={phase === 'saving' || undefined} className={`${BTN_PRIMARY} ${BUSY_CLASS}`}>
            {phase === 'saving' ? 'Đang lưu…' : 'Lưu thành phần'}
          </button>
        </>
      )}
    </div>
  );
}
