import { useCallback, useEffect, useRef, useState } from 'react';
import { findProductCopyFallback } from '@tubutree/app-core/commerce/product-copy-fallback';
import { isAbortError, loadCatalogForAudit, type CatalogAuditProgress, type CatalogAuditSource } from '@tubutree/app-core/commerce/catalog-audit-loader';
import {
  auditCatalogProducts,
  CATALOG_ISSUE_KINDS,
  CATALOG_ISSUE_LABELS,
  COPY_STATUS_LABELS,
  type CatalogAuditResult,
  type CatalogIssueKind,
  type CopyStatus,
} from '@tubutree/app-core/commerce/catalog-quality-audit';
import { fetchProduct, fetchProducts } from '../services/shop-api';
import { Badge, type BadgeTone } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Chip } from '../components/ui/chip';
import { ErrorState } from '../components/ui/empty-state';
import { Heading, Text } from '../components/ui/text';

/** Đọc catalog công khai (cùng nguồn khách thấy): danh sách theo trang rồi mô tả gốc từng sản phẩm (chưa bù chữ dự phòng, khác trang sản phẩm của khách). */
const SOURCE: CatalogAuditSource = {
  async listPage(page, limit) {
    const res = await fetchProducts({ page, limit });
    return {
      rows: res.data.map((p) => ({ slug: p.slug, name: p.name, thumbnail: p.thumbnail ?? null, inStock: p.inStock !== false })),
      total: res.meta.total,
    };
  },
  async readDescription(slug) {
    const p = await fetchProduct(slug);
    return p.description ?? null;
  },
};

const TONE: Record<CatalogIssueKind, BadgeTone> = {
  known_media_mismatch: 'danger',
  missing_thumbnail: 'warning',
  invalid_retail_price: 'danger',
  placeholder_stock: 'warning',
  unnamed_variation: 'neutral',
  empty_native_description: 'neutral',
};

const COPY_TONE: Record<CopyStatus, BadgeTone> = {
  native: 'success',
  fallback: 'info',
  none: 'warning',
  unknown: 'neutral',
};

const hasFallbackCopy = (slug: string) => findProductCopyFallback(slug) !== undefined;

type Filter = CatalogIssueKind | 'all';

const COLUMN = { display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' } as const;
const WRAP_ROW = { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-stack-sm)', alignItems: 'center' } as const;
const ISSUE_ROW = { display: 'flex', gap: 'var(--space-stack-sm)', alignItems: 'flex-start' } as const;

/**
 * Phần "Catalog" của màn Quản trị: kiểm tra thiếu ảnh, ảnh lệch tên, mô tả gốc trống để ops sửa trong Pancake. Khớp tab "Kiểm tra catalog" của quản trị web.
 * Danh sách công khai không trả biến thể nên lỗi giá/tồn/tên biến thể, xuất CSV sửa Pancake và soạn mô tả bằng AI chỉ có trên web quản trị: Mini không kéo thêm mã cho các việc đó.
 */
export default function CatalogQualitySection() {
  const [open, setOpen] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<CatalogAuditProgress | null>(null);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<CatalogAuditResult | null>(null);
  const [unreadable, setUnreadable] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const busy = useRef(false);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const c = new AbortController();
    ctrl.current = c;
    setRunning(true);
    setError(false);
    setProgress(null);
    try {
      const load = await loadCatalogForAudit(SOURCE, { signal: c.signal, onProgress: setProgress });
      setResult(auditCatalogProducts(load.products, { hasFallbackCopy }));
      setUnreadable(load.unreadable.length);
      setFilter('all');
    } catch (e) {
      if (!isAbortError(e)) setError(true);
    } finally {
      busy.current = false;
      if (ctrl.current === c) ctrl.current = null;
      if (!c.signal.aborted) {
        setRunning(false);
        setProgress(null);
      }
    }
  }, []);

  const rows = result?.rows.filter((r) => filter === 'all' || r.issues.some((i) => i.kind === filter)) ?? [];
  const progressText = progress ? (progress.stage === 'list' ? `Đang đọc danh sách ${progress.done}/${progress.total}` : `Đang đọc mô tả ${progress.done}/${progress.total}`) : 'Đang bắt đầu';

  return (
    <div style={{ padding: '0 var(--space-gutter) var(--space-gutter)', ...COLUMN }}>
      <div style={{ ...WRAP_ROW, justifyContent: 'space-between' }}>
        <Heading variant="title-md" as="h2">
          Kiểm tra chất lượng Catalog
        </Heading>
        <Button variant="secondary" aria-expanded={open} aria-controls="catalog-quality-body" onPress={() => setOpen((v) => !v)}>
          {open ? 'Thu gọn' : 'Mở rộng'}
        </Button>
      </div>
      {open && (
        <div id="catalog-quality-body" aria-busy={running} style={COLUMN}>
          <Text tone="secondary">
            Tìm sản phẩm thiếu ảnh, ảnh lệch tên và mô tả gốc còn trống để sửa ngay trong Pancake. Số liệu lấy từ catalog đang hiện cho khách, nên sửa xong cần chờ đồng bộ rồi bấm Kiểm tra lại.
          </Text>
          <Text variant="caption" tone="secondary">
            Lỗi biến thể (giá 0, tồn kho giả, chưa đặt tên) và xuất CSV sửa Pancake xem trên Quản trị web.
          </Text>
          <div style={WRAP_ROW}>
            <Button variant="secondary" loading={running} onPress={run}>
              {result || error ? 'Kiểm tra lại' : 'Kiểm tra ngay'}
            </Button>
            {running && (
              <div role="status">
                <Text tone="secondary">{progressText}</Text>
              </div>
            )}
          </div>
          {error && !running && <ErrorState variant="inline" message="Không đọc được catalog. Kiểm tra mạng rồi thử lại." onRetry={run} />}
          {result && !error && (
            <>
              <div role="status">
                <Text>
                  {result.summary.flagged === 0
                    ? `Đã kiểm ${result.summary.total} sản phẩm, không có lỗi.`
                    : `Đã kiểm ${result.summary.total} sản phẩm: ${result.summary.flagged} sản phẩm cần sửa, trong đó ${result.summary.flaggedInStock} đang còn hàng.`}
                </Text>
              </div>
              {unreadable > 0 && (
                <Text tone="warning">Chưa đọc được mô tả của {unreadable} sản phẩm nên chưa kiểm phần mô tả của chúng. Bấm Kiểm tra lại để đọc lại.</Text>
              )}
              <div role="group" aria-label="Lọc theo loại lỗi" style={WRAP_ROW}>
                <Chip selected={filter === 'all'} onPress={() => setFilter('all')}>
                  {`Tất cả (${result.summary.flagged})`}
                </Chip>
                {CATALOG_ISSUE_KINDS.filter((k) => result.summary.byKind[k] > 0).map((k) => (
                  <Chip key={k} selected={filter === k} onPress={() => setFilter(k)}>
                    {`${CATALOG_ISSUE_LABELS[k]} (${result.summary.byKind[k]})`}
                  </Chip>
                ))}
              </div>
              {rows.length === 0 ? (
                <Text tone="secondary">Không có sản phẩm nào thuộc loại lỗi này.</Text>
              ) : (
                <ul aria-label="Sản phẩm cần sửa" style={{ ...COLUMN, listStyle: 'none', margin: 0, padding: 0 }}>
                  {rows.map((r) => (
                    <li key={r.slug}>
                      <Card variant="outline">
                        <div style={COLUMN}>
                          <div style={WRAP_ROW}>
                            <Heading variant="title-sm" as="h3">
                              {r.name}
                            </Heading>
                            {r.inStock === false && <Badge tone="neutral">Hết hàng</Badge>}
                            <Badge tone={COPY_TONE[r.copyStatus]}>{COPY_STATUS_LABELS[r.copyStatus]}</Badge>
                          </div>
                          <Text tone="secondary" style={{ wordBreak: 'break-all' }}>
                            {r.slug}
                          </Text>
                          {r.issues.map((i) => (
                            <div key={i.kind} style={ISSUE_ROW}>
                              <Badge tone={TONE[i.kind]}>{CATALOG_ISSUE_LABELS[i.kind]}</Badge>
                              <Text style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{i.detail}</Text>
                            </div>
                          ))}
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
