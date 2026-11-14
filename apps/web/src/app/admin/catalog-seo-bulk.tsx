'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { LoadError, Notice, FIELD_CLASS } from '@/components/admin/ui';
import { useToastedMessage } from '@/components/admin/admin-toast';
import { actionErrorText, loadErrorText } from '@/lib/admin-error-text';
import { getCatalogSeo, postSeoApply, SEO_DESC_MAX, SEO_TITLE_MAX, type CatalogSeoResponse, type CatalogSeoRow } from './catalog-quality-api';

// Màn này dành cả cho điện thoại: mọi nút và ô nhập giữ 44px ở mọi cỡ màn (không dùng TOUCH_H vì nó hạ về 36px từ `sm`).
const TOUCH = 'min-h-[44px]';
const BTN_BASE = `${TOUCH} rounded-control px-3.5 py-1.5 text-sm font-medium aria-disabled:cursor-not-allowed aria-disabled:opacity-60`;
const BTN_PRIMARY_44 = `${BTN_BASE} bg-forest-600 text-stone-0 hover:bg-forest-700`;
const BTN_SECONDARY_44 = `${BTN_BASE} border border-stone-450 bg-stone-0 text-stone-700 hover:bg-stone-50`;
const FIELD_44 = `block w-full ${TOUCH} ${FIELD_CLASS}`;

type Filter = 'missing' | 'all';
interface Draft {
  title: string;
  desc: string;
}

/** Bỏ dấu và đổi chữ thường để tìm "mat ong" ra "Mật ong". */
const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase('vi');

const blank = (s: string): boolean => s.trim() === '';

/**
 * Duyệt và sửa SEO (`metaTitle` ≤ 65, `metaDesc` ≤ 155 ký tự) của sản phẩm nhà đang bán, hàng loạt. Máy chủ dựng bản đề xuất từ dữ liệu thật của sản phẩm
 * (tên, thương hiệu, phân loại, câu đầu mô tả; không bịa công dụng, hữu cơ, xuất xứ). "Điền nháp" chỉ điền ô đang TRỐNG, không đè chữ đã có hay đang gõ.
 * Không có gì tự ghi: nhân viên xem, sửa, chọn dòng rồi bấm Lưu; máy chủ kiểm lại từng chữ và ghi cả lô trong một giao dịch.
 */
export function CatalogSeoBulk() {
  const [data, setData] = useState<CatalogSeoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('missing');
  const [query, setQuery] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inlineMsg = useToastedMessage(msg);
  const searchId = useId();
  const titleId = useId();
  const loadBusy = useRef(false);
  const saveBusy = useRef(false);
  // apiFetch không nhận tín hiệu huỷ: rời màn thì bỏ kết quả về muộn.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<boolean> => {
    if (loadBusy.current) return false;
    loadBusy.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getCatalogSeo();
      if (!alive.current) return false;
      setData(res);
      return true;
    } catch (e) {
      if (alive.current) setLoadError(`Không đọc được danh sách SEO. ${loadErrorText(e)}`);
      return false;
    } finally {
      loadBusy.current = false;
      if (alive.current) setLoading(false);
    }
  }, []);

  const rows = data?.rows ?? [];
  const shown = useMemo(() => {
    const q = fold(query.trim());
    return rows.filter((r) => (filter === 'all' || r.missingTitle || r.missingDesc) && (q === '' || fold(`${r.name} ${r.brand}`).includes(q)));
  }, [rows, filter, query]);

  const valueOf = (r: CatalogSeoRow): Draft => ({ title: drafts[r.id]?.title ?? r.metaTitle ?? '', desc: drafts[r.id]?.desc ?? r.metaDesc ?? '' });
  const edit = (r: CatalogSeoRow, patch: Partial<Draft>) => setDrafts((prev) => ({ ...prev, [r.id]: { ...valueOf(r), ...patch } }));
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const fillBlanks = () => {
    const nextDrafts: Record<string, Draft> = {};
    const touched: string[] = [];
    for (const r of shown) {
      const cur = valueOf(r);
      const title = blank(cur.title) ? r.suggested.metaTitle : cur.title;
      const desc = blank(cur.desc) ? r.suggested.metaDesc : cur.desc;
      if (title !== cur.title || desc !== cur.desc) {
        nextDrafts[r.id] = { title, desc };
        touched.push(r.id);
      }
    }
    if (touched.length === 0) {
      setMsg({ ok: false, text: 'Không có ô trống nào để điền trong các dòng đang hiện.' });
      return;
    }
    setDrafts((prev) => ({ ...prev, ...nextDrafts }));
    setSelected((prev) => new Set([...prev, ...touched]));
    setMsg({ ok: true, text: `Đã điền nháp cho ${touched.length} dòng. Xem lại, sửa nếu cần, rồi bấm "Lưu các mục đã chọn".` });
  };

  const save = async () => {
    if (saveBusy.current || selected.size === 0) return;
    const chosen = rows.filter((r) => selected.has(r.id));
    const problems: string[] = [];
    const items = chosen.map((r) => {
      const title = valueOf(r).title.trim();
      const desc = valueOf(r).desc.trim();
      if (title === '') problems.push(`"${r.name}": tiêu đề đang trống.`);
      else if (title.length > SEO_TITLE_MAX) problems.push(`"${r.name}": tiêu đề dài quá ${SEO_TITLE_MAX} ký tự (đang ${title.length}).`);
      if (desc === '') problems.push(`"${r.name}": mô tả đang trống.`);
      else if (desc.length > SEO_DESC_MAX) problems.push(`"${r.name}": mô tả dài quá ${SEO_DESC_MAX} ký tự (đang ${desc.length}).`);
      return { productId: r.id, metaTitle: title, metaDesc: desc };
    });
    if (problems.length > 0) {
      setMsg({ ok: false, text: problems.join(' ') });
      return;
    }
    saveBusy.current = true;
    setSaving(true);
    setMsg(null);
    try {
      const res = await postSeoApply(items);
      if (!alive.current) return;
      const posted = new Set(items.map((i) => i.productId));
      setSelected((prev) => new Set([...prev].filter((id) => !posted.has(id))));
      setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !posted.has(id))));
      const skipped = res.skippedIds.length;
      setMsg({ ok: skipped === 0, text: skipped === 0 ? `Đã lưu ${res.updated} mục.` : `Đã lưu ${res.updated} mục, bỏ qua ${skipped} mục (sản phẩm của đối tác hoặc đã bị xoá).` });
      await load();
    } catch (e) {
      if (alive.current) setMsg({ ok: false, text: actionErrorText(e) });
    } finally {
      saveBusy.current = false;
      if (alive.current) setSaving(false);
    }
  };

  const cannotSave = saving || selected.size === 0;

  return (
    <div role="region" aria-labelledby="seo-bulk-title" className="space-y-3 rounded-card border border-stone-200 bg-stone-0 p-3">
      <h3 id="seo-bulk-title" className="m-0 font-display text-base font-semibold text-stone-900">
        Duyệt SEO sản phẩm
      </h3>
      <p className="max-w-2xl text-sm text-stone-600">
        Tiêu đề (tối đa {SEO_TITLE_MAX} ký tự) và mô tả (tối đa {SEO_DESC_MAX} ký tự) hiện trên Google. Bản nháp chỉ dựng từ tên, thương hiệu, phân loại và câu đầu mô tả của chính sản phẩm; không tự thêm công dụng, hữu cơ hay xuất xứ. Bạn xem và sửa rồi mới bấm Lưu.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={BTN_SECONDARY_44} aria-disabled={loading || undefined} aria-busy={loading || undefined} onClick={() => void load()}>
          {loading ? 'Đang tải…' : data ? 'Tải lại danh sách' : 'Mở bảng SEO'}
        </button>
        {data?.truncated && (
          <Notice tone="warning" role="status">
            Danh sách vượt trần đọc của máy chủ nên đã bị cắt.
          </Notice>
        )}
      </div>
      {loadError && !loading && <LoadError onRetry={() => load()}>{loadError}</LoadError>}
      {data && (
        <>
          <div role="group" aria-label="Lọc SEO" className="flex flex-wrap gap-2">
            <Chip active={filter === 'missing'} onPress={() => setFilter('missing')}>
              Thiếu SEO <span className="tabular-nums">({data.missing})</span>
            </Chip>
            <Chip active={filter === 'all'} onPress={() => setFilter('all')}>
              Tất cả <span className="tabular-nums">({data.total})</span>
            </Chip>
          </div>
          <div>
            <label htmlFor={searchId} className="text-xs font-medium text-stone-700">
              Tìm theo tên hoặc thương hiệu
            </label>
            <input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ví dụ: mật ong, Xanh Việt" className={`mt-1 ${FIELD_44}`} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={BTN_SECONDARY_44} onClick={fillBlanks}>
              Điền nháp cho các dòng đang trống
            </button>
            <button type="button" className={BTN_SECONDARY_44} onClick={() => setSelected((prev) => new Set([...prev, ...shown.map((r) => r.id)]))}>
              Chọn các dòng đang hiện
            </button>
            <button type="button" onClick={() => void save()} aria-disabled={cannotSave || undefined} aria-busy={saving || undefined} className={BTN_PRIMARY_44}>
              {saving ? 'Đang lưu…' : `Lưu các mục đã chọn (${selected.size})`}
            </button>
          </div>
          {inlineMsg && (
            <Notice tone={inlineMsg.ok ? 'success' : 'danger'} role={inlineMsg.ok ? 'status' : 'alert'}>
              {inlineMsg.text}
            </Notice>
          )}
          {shown.length === 0 ? (
            <p className="text-sm text-stone-600">
              {filter === 'missing' && data.missing === 0 && query.trim() === '' ? 'Mọi sản phẩm đang bán đều đã có tiêu đề và mô tả SEO.' : 'Không có sản phẩm nào khớp với bộ lọc và từ khoá này.'}
            </p>
          ) : (
            <ul className="m-0 list-none space-y-3 p-0">
              {shown.map((r) => (
                <li key={r.id} data-testid={`seo-row-${r.id}`} className="grid min-w-0 gap-3 rounded-control border border-stone-200 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,2fr)] lg:items-start">
                  <SeoRow idBase={`${titleId}-${r.id}`} row={r} value={valueOf(r)} checked={selected.has(r.id)} onCheck={(on) => toggle(r.id, on)} onEdit={(p) => edit(r, p)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function SeoRow({ idBase, row, value, checked, onCheck, onEdit }: { idBase: string; row: CatalogSeoRow; value: Draft; checked: boolean; onCheck: (on: boolean) => void; onEdit: (p: Partial<Draft>) => void }) {
  const titleOver = value.title.length > SEO_TITLE_MAX;
  const descOver = value.desc.length > SEO_DESC_MAX;
  return (
    <>
      <div className="flex min-w-0 items-start gap-1">
        <label className={`inline-flex ${TOUCH} min-w-[44px] shrink-0 cursor-pointer items-center justify-center`}>
          <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Chọn ${row.name}`} className="h-5 w-5 accent-forest-600" />
        </label>
        <div className="min-w-0 pt-2.5">
          <h4 className="m-0 break-words text-sm font-semibold text-stone-900">{row.name}</h4>
          <p className="m-0 break-words text-xs text-stone-600">{row.brand}</p>
        </div>
      </div>
      <div className="min-w-0">
        <label htmlFor={`${idBase}-t`} className="text-xs font-medium text-stone-700">
          Tiêu đề SEO<span className="sr-only"> của {row.name}</span>
        </label>
        <input id={`${idBase}-t`} type="text" value={value.title} onChange={(e) => onEdit({ title: e.target.value })} aria-invalid={titleOver || undefined} aria-describedby={`${idBase}-tc`} className={`mt-1 ${FIELD_44}`} />
        <Counter testId={`seo-title-count-${row.id}`} domId={`${idBase}-tc`} n={value.title.length} max={SEO_TITLE_MAX} />
      </div>
      <div className="min-w-0">
        <label htmlFor={`${idBase}-d`} className="text-xs font-medium text-stone-700">
          Mô tả SEO<span className="sr-only"> của {row.name}</span>
        </label>
        <textarea id={`${idBase}-d`} rows={3} value={value.desc} onChange={(e) => onEdit({ desc: e.target.value })} aria-invalid={descOver || undefined} aria-describedby={`${idBase}-dc`} className={`mt-1 ${FIELD_44}`} />
        <Counter testId={`seo-desc-count-${row.id}`} domId={`${idBase}-dc`} n={value.desc.length} max={SEO_DESC_MAX} />
      </div>
    </>
  );
}

function Counter({ testId, domId, n, max }: { testId: string; domId: string; n: number; max: number }) {
  return (
    <div id={domId} className="mt-0.5 text-[11px]">
      <span data-testid={testId} className={`tabular-nums ${n > max ? 'text-danger-fg' : 'text-stone-500'}`}>{`${n}/${max}`}</span>
    </div>
  );
}

function Chip({ active, onPress, children }: { active: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onPress}
      className={`${TOUCH} rounded-full border px-3 text-sm font-medium ${active ? 'border-forest-600 bg-forest-600 text-stone-0' : 'border-stone-450 bg-stone-0 text-stone-700 hover:bg-stone-50'}`}
    >
      {children}
    </button>
  );
}
