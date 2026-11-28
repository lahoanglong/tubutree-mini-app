import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  AFFILIATE_LINK_TARGETS,
  LINK_BUILDER_COPY as T,
  linkCampaignOptions,
  linkCategoryOptions,
  linkTargetNeedsPick,
  type AffiliateLinkTarget,
} from '@tubutree/app-core/commerce/affiliate-deep-link';
import { campaignsQuery } from '@tubutree/app-core/queries/campaign';
import { coreHttp } from '../../services/core-http';
import { pickerProducts } from '../../services/storefront-api';
import { fetchCategories } from '../../services/shop-api';
import { CATEGORIES_KEY } from '../../hooks/use-categories';
import { serverNow } from '../../utils/server-clock';
import { useDebounced } from '../../utils/use-debounced';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { ErrorState } from '../ui/empty-state';
import { Input } from '../ui/input';
import { SegmentedTabs } from '../ui/segmented-tabs';
import { Skeleton } from '../ui/skeleton';
import { Text } from '../ui/text';

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

const LIST = { display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' } as const;

function OptionRow({ active, label, sub, onPick }: { active: boolean; label: string; sub?: string; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onPick}
      className="tubu-press touch-target"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'center',
        gap: 'var(--space-inline-xs)',
        width: '100%',
        padding: 'var(--space-inline-sm) var(--space-inline-md)',
        textAlign: 'left',
        font: 'inherit',
        cursor: 'pointer',
        borderRadius: 'var(--radius-control)',
        // Viền chọn dày gấp đôi bằng bóng trong, không đổi kích thước dòng khi chọn.
        border: `1px solid ${active ? 'var(--color-border-selected)' : 'var(--color-border-subtle)'}`,
        boxShadow: active ? 'inset 0 0 0 1px var(--color-border-selected)' : undefined,
        background: active ? 'var(--color-action-secondary-bg)' : 'var(--color-bg-surface)',
      }}
    >
      <Text variant="body-sm" as="span" style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
        {label}
      </Text>
      {sub && (
        <Text variant="caption" tone="tertiary" as="span">
          {sub}
        </Text>
      )}
    </button>
  );
}

/**
 * Bộ tạo link CTV: chọn link mở tới Trang chủ, một sản phẩm có hoa hồng (tìm trong danh sách chọn sản phẩm của CTV), một danh mục, trang
 * Giờ vàng, một chiến dịch đang chạy hay trang Bộ quà tặng; một nút "Tạo link". Link sâu dựng ở `commerce/affiliate-deep-link.ts`. Bản web: apps/web/src/components/affiliate/link-builder-sheet.tsx.
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

  const productsQ = useQuery({ queryKey: ['affiliate-link-picker', q], queryFn: () => pickerProducts(q), enabled: open && type === 'PRODUCT', staleTime: 60_000 });
  const categoriesQ = useQuery({ queryKey: CATEGORIES_KEY, queryFn: fetchCategories, enabled: open && type === 'CATEGORY', staleTime: 60_000, retry: false });
  const categories = useMemo(() => linkCategoryOptions(categoriesQ.data), [categoriesQ.data]);
  const campaignQs = useQueries({
    queries: (['HOME_TOP', 'OFFERS_TOP'] as const).map((placement) => ({ ...campaignsQuery(coreHttp, placement), enabled: open && type === 'CAMPAIGN', staleTime: 60_000, retry: false })),
  });
  const campaigns = linkCampaignOptions(campaignQs.map((c) => c.data), serverNow());
  const campaignState = { isError: campaignQs.some((c) => c.isError) && campaigns.length === 0, isLoading: campaignQs.some((c) => c.isLoading) && campaigns.length === 0, refetch: () => campaignQs.forEach((c) => void c.refetch()) };
  const products = (productsQ.data ?? []).filter((p) => p.maxAffiliateRate > 0);

  const needsPick = linkTargetNeedsPick(type);
  const ready = !needsPick || picked !== null;
  const submit = () => {
    if (!ready || busy) return;
    onCreate(needsPick && picked ? { targetType: type, targetId: picked.id } : { targetType: type });
  };

  const list = (() => {
    if (type === 'HOMEPAGE') return <Text variant="body-sm" tone="secondary" as="p">{T.homeHint}</Text>;
    if (type === 'DEAL') return <Text variant="body-sm" tone="secondary" as="p">{T.dealHint}</Text>;
    if (type === 'COMBO') return <Text variant="body-sm" tone="secondary" as="p">{T.comboHint}</Text>;
    const query = type === 'PRODUCT' ? productsQ : type === 'CAMPAIGN' ? campaignState : categoriesQ;
    const groupLabel = type === 'PRODUCT' ? T.pickProduct : type === 'CAMPAIGN' ? T.pickCampaign : T.pickCategory;
    if (query.isError) return <ErrorState variant="inline" message={T.loadError} onRetry={() => query.refetch()} />;
    if (query.isLoading)
      return (
        <div role="status" aria-label={groupLabel} style={LIST}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={44} />
          ))}
        </div>
      );
    const rows =
      type === 'PRODUCT'
        ? products.map((p) => ({ id: p.id, label: p.name, sub: p.brand || undefined }))
        : (type === 'CAMPAIGN' ? campaigns : categories).map((c) => ({ id: c.id, label: c.label, sub: undefined }));
    if (rows.length === 0)
      return (
        <Text variant="body-sm" tone="secondary" as="p">
          {type === 'PRODUCT' ? T.noProduct : type === 'CAMPAIGN' ? T.noCampaign : T.noCategory}
        </Text>
      );
    return (
      <div role="radiogroup" aria-label={groupLabel} style={LIST}>
        {rows.map((r) => (
          <OptionRow key={r.id} active={picked?.id === r.id} label={r.label} sub={r.sub} onPick={() => setPicked({ id: r.id, label: r.label })} />
        ))}
      </div>
    );
  })();

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={T.title}
      size="full"
      dismissible={!busy}
      footer={
        <div style={LIST}>
          {error && (
            <p role="alert" style={{ margin: 0 }}>
              <Text variant="body-sm" tone="danger">
                {error}
              </Text>
            </p>
          )}
          <Button variant="primary" fullWidth disabled={!ready} loading={busy} onPress={submit}>
            {T.submit}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-inline-md)' }}>
        <SegmentedTabs
          label={T.targetLabel}
          items={AFFILIATE_LINK_TARGETS.map((t) => ({ key: t.key, label: t.label }))}
          scroll
          value={type}
          onChange={(k) => {
            setType(k as AffiliateLinkTarget);
            setPicked(null);
          }}
        />
        {type === 'PRODUCT' && (
          <Input type="search" aria-label={T.searchProduct} placeholder={T.searchProduct} value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
        {picked && needsPick && (
          <Text variant="caption" tone="tertiary" as="p">
            {`${T.picked} ${picked.label}`}
          </Text>
        )}
        {list}
      </div>
    </BottomSheet>
  );
}
