'use client';

// Nguồn: apps/miniapp/src/components/affiliate/link-builder-sheet.tsx
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  AFFILIATE_LINK_TARGETS,
  LINK_BUILDER_COPY as T,
  linkCategoryOptions,
  linkTargetNeedsPick,
  type AffiliateLinkTarget,
} from '@tubutree/app-core/commerce/affiliate-deep-link';
import { categoriesQuery } from '@tubutree/app-core/queries/catalog';
import { pickerQuery } from '@tubutree/app-core/queries/storefront';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { useDebounced } from '@/lib/use-debounced';
import { ErrorState } from '@/components/ui/error-state';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';

export interface LinkBuilderTarget {
  targetType: AffiliateLinkTarget;
  targetId?: string;
}

export interface LinkBuilderSheetProps {
  open: boolean;
  onClose: () => void;
  /** Đang tạo link: nút giữ bận, sheet không đóng được bằng chạm nền. */
  busy: boolean;
  /** Lời lỗi của lần tạo gần nhất (máy chủ từ chối đích, mất mạng). */
  error: string | null;
  onCreate: (target: LinkBuilderTarget) => void;
}

type Picked = { id: string; label: string } | null;

function OptionRow({ active, label, sub, onPick }: { active: boolean; label: string; sub?: string; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onPick}
      className={`tubu-press flex min-h-11 w-full flex-col justify-center gap-0.5 rounded-control border-2 px-3 py-2 text-left ${active ? 'border-forest-600 bg-stone-50' : 'border-stone-200 bg-stone-0'}`}
    >
      <span className="line-clamp-2 break-words text-sm font-semibold text-stone-900">{label}</span>
      {sub && <span className="text-xs text-stone-600">{sub}</span>}
    </button>
  );
}

/**
 * Bộ tạo link CTV: chọn link mở tới Trang chủ, một sản phẩm có hoa hồng (tìm trong danh sách chọn sản phẩm của CTV), một danh mục, hay trang
 * Giờ vàng; một nút "Tạo link". Link sâu dựng ở `commerce/affiliate-deep-link.ts`.
 */
export function LinkBuilderSheet({ open, onClose, busy, error, onCreate }: LinkBuilderSheetProps) {
  const [type, setType] = useState<AffiliateLinkTarget>('PRODUCT');
  const [picked, setPicked] = useState<Picked>(null);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 250);

  // Mỗi lần mở là một lần tạo mới: không giữ lựa chọn của lần trước.
  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setSearch('');
  }, [open]);

  const productsQ = useQuery({ ...pickerQuery(coreHttp, q), enabled: open && type === 'PRODUCT', staleTime: 60_000 });
  const categoriesQ = useQuery({ ...categoriesQuery(coreHttp), enabled: open && type === 'CATEGORY', staleTime: 60_000 });
  const categories = useMemo(() => linkCategoryOptions(categoriesQ.data), [categoriesQ.data]);
  const products = (productsQ.data ?? []).filter((p) => p.maxAffiliateRate > 0);

  const needsPick = linkTargetNeedsPick(type);
  const ready = !needsPick || picked !== null;
  const submit = () => {
    if (!ready || busy) return;
    onCreate(needsPick && picked ? { targetType: type, targetId: picked.id } : { targetType: type });
  };

  const list = (() => {
    if (type === 'HOMEPAGE') return <p className="text-sm text-stone-600">{T.homeHint}</p>;
    if (type === 'DEAL') return <p className="text-sm text-stone-600">{T.dealHint}</p>;
    const query = type === 'PRODUCT' ? productsQ : categoriesQ;
    const groupLabel = type === 'PRODUCT' ? T.pickProduct : T.pickCategory;
    if (query.isError) return <ErrorState variant="inline" message={T.loadError} onRetry={() => query.refetch()} />;
    if (query.isLoading)
      return (
        <div role="status" aria-label={groupLabel} className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={44} />
          ))}
        </div>
      );
    const rows =
      type === 'PRODUCT'
        ? products.map((p) => ({ id: p.id, label: p.name, sub: p.brand || undefined }))
        : categories.map((c) => ({ id: c.id, label: c.label, sub: undefined }));
    if (rows.length === 0) return <p className="text-sm text-stone-600">{type === 'PRODUCT' ? T.noProduct : T.noCategory}</p>;
    return (
      <div role="radiogroup" aria-label={groupLabel} className="flex flex-col gap-2">
        {rows.map((r) => (
          <OptionRow key={r.id} active={picked?.id === r.id} label={r.label} sub={r.sub} onPick={() => setPicked({ id: r.id, label: r.label })} />
        ))}
      </div>
    );
  })();

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={T.title}
      size="full"
      dismissible={!busy}
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p role="alert" className={ui.error}>
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={!ready}
            aria-busy={busy || undefined}
            aria-disabled={busy || undefined}
            onClick={submit}
            className={`${ui.btnPrimary} w-full`}
          >
            {busy ? T.submitting : T.submit}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <SegmentedTabs
          label={T.targetLabel}
          items={AFFILIATE_LINK_TARGETS.map((t) => ({ key: t.key, label: t.label }))}
          value={type}
          onChange={(k) => {
            setType(k as AffiliateLinkTarget);
            setPicked(null);
          }}
        />
        {type === 'PRODUCT' && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" aria-hidden="true" />
            <input
              type="search"
              aria-label={T.searchProduct}
              placeholder={T.searchProduct}
              className={`${ui.field} pl-9`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
        {picked && needsPick && <p className="text-xs text-stone-600">{`${T.picked} ${picked.label}`}</p>}
        {list}
      </div>
    </Sheet>
  );
}
