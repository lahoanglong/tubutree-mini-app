import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Input, Page, useSnackbar, useNavigate } from 'zmp-ui';
import {
  Store,
  Hourglass,
  Save,
  AlertTriangle,
  ClipboardList,
  Plane,
  Gift,
  Award,
  X,
  ChevronRight,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getDealerMe,
  applyDealer,
  getPricelist,
  placeDealerOrder,
  getDealerOrders,
  getCreditLedger,
  payCredit,
  getQuarterlyReport,
  getDealerRewards,
  claimDealerReward,
  rewardClaimView,
  type DealerRewardsView,
  type RewardClaimTone,
  getTemplates,
  saveTemplate,
  deleteTemplate,
  type DealerApplyInput,
  type PricelistRow,
  type DealerOrderRules,
} from '../services/dealer-api';
import { getErrorMessage } from '../services/api';
import { formatDate, formatRatePct, formatVnd } from '../utils/format';
import { usePublicConfig } from '../hooks/use-public-config';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { useDebounced } from '../utils/use-debounced';
import { newIdempotencyKey } from '../utils/idempotency';
import { ImageUpload } from '../components/image-upload';
import {
  DEALER_BENEFITS,
  DEALER_BENEFITS_TITLE,
  DEALER_REQUIREMENTS,
  DEALER_REQUIREMENTS_TITLE,
  PARTNER_STOREFRONT_TITLE,
  PARTNER_STOREFRONT_WEB_HINT,
  dealerReviewLine,
  dealerApplyPitch,
} from '@tubutree/app-core/dealer-apply-copy';
import { Field } from '../components/ui/form';
import { Badge, type BadgeTone } from '../components/ui/badge';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Icon } from '../components/ui/icon';
import { PageHeader } from '../components/ui/page-header';
import { ProgressBar } from '../components/ui/progress-bar';
import { QuantitySelector } from '../components/ui/quantity-selector';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { SearchField } from '../components/ui/search-field';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { Heading, Text } from '../components/ui/text';
import { DEALER_MAX_QTY, preorderQty, realDiscountPct } from './dealer-pricing';
import '../css/dealer-theme.css';

const INK = 'var(--color-dealer-ink)';

/** Bậc thưởng quý admin đặt được 1 chữ số lẻ (2,5%), nên in kiểu Việt thay vì để JS ghi "2.5". API trả đơn vị %, formatRatePct nhận phân số. */
const bonusPctText = (pct: number) => formatRatePct(pct / 100);

/** Nút chính mang màu ink B2B; khi vô hiệu để ZaUI bridge tự vẽ trạng thái disabled, đừng đè nền ink lên. */
const inkButton = (disabled?: boolean): CSSProperties | undefined => (disabled ? undefined : { background: INK });

/** Mỗi nhánh render có đúng một h1 (PageHeader) và cùng nền B2B. */
function DealerShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Page style={{ background: 'var(--color-dealer-bg)' }}>
      <PageHeader title={title} />
      {children}
    </Page>
  );
}

const TITLE_HUB = 'Kênh đại lý';

export default function DealerPage() {
  const meQ = useQuery({ queryKey: ['dealer-me'], queryFn: getDealerMe });

  if (meQ.isLoading) {
    return (
      <DealerShell title={TITLE_HUB}>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Skeleton height={100} radius="var(--radius-card)" />
          <Skeleton height={60} radius="var(--radius-card)" />
        </div>
      </DealerShell>
    );
  }
  if (meQ.isError && !meQ.data) {
    return (
      <DealerShell title={TITLE_HUB}>
        <ErrorState message={getErrorMessage(meQ.error)} onRetry={() => void meQ.refetch()} />
      </DealerShell>
    );
  }

  const me = meQ.data!;
  if (me.isDealer || me.status === 'APPROVED') return <DealerHub />;
  if (me.status === 'PENDING') return <DealerPending />;
  return <DealerApply rejected={me.status === 'REJECTED'} rejectionReason={me.rejectionReason ?? null} />;
}

/* ─────────────── Đăng ký đại lý ─────────────── */
function DealerApply({ rejected, rejectionReason }: { rejected: boolean; rejectionReason: string | null }) {
  const { openSnackbar } = useSnackbar();
  const config = usePublicConfig();
  const maxDiscountPct = config.isLoaded ? config.dealer?.maxDiscountPct : null;
  const qc = useQueryClient();
  const [form, setForm] = useState<DealerApplyInput>({
    businessName: '',
    ownerName: '',
    phone: '',
    address: '',
    cccdFrontUrl: '',
    cccdBackUrl: '',
  });

  const mut = useMutation({
    mutationFn: () => applyDealer(form),
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: 'Đã gửi hồ sơ đăng ký đại lý!', type: 'success' });
      void qc.invalidateQueries({ queryKey: ['dealer-me'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const set = (k: keyof DealerApplyInput) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const valid =
    form.businessName.trim() &&
    form.ownerName.trim() &&
    form.phone.trim() &&
    form.address.trim() &&
    form.cccdFrontUrl.trim() &&
    form.cccdBackUrl.trim();

  return (
    <DealerShell title="Đăng ký đại lý">
      <div style={{ padding: 16 }}>
        <div style={{ padding: 16, background: INK, borderRadius: 'var(--radius-card)' }}>
          <Icon icon={Store} size="lg" tone="inverse" />
          <Heading variant="title-md" as="h2" tone="inverse" style={{ marginTop: 4 }}>
            Trở thành đại lý Tubu
          </Heading>
          <Text variant="body-sm" tone="inverse" as="p" style={{ marginTop: 4, opacity: 0.8 }}>
            {dealerApplyPitch(maxDiscountPct ? formatRatePct(maxDiscountPct) : null)}
          </Text>
        </div>

        <div style={{ marginTop: 12, padding: 12, background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)' }} data-testid="dealer-conditions">
          <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>{DEALER_REQUIREMENTS_TITLE}</Text>
          <ul style={{ margin: '4px 0 8px', paddingLeft: 18, listStyleType: 'disc' }}>
            {DEALER_REQUIREMENTS.map((t) => (
              <li key={t}><Text variant="body-sm" tone="secondary">{t}</Text></li>
            ))}
          </ul>
          <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>{DEALER_BENEFITS_TITLE}</Text>
          <ul style={{ margin: '4px 0 8px', paddingLeft: 18, listStyleType: 'disc' }}>
            {DEALER_BENEFITS.map((t) => (
              <li key={t}><Text variant="body-sm" tone="secondary">{t}</Text></li>
            ))}
          </ul>
          <Text variant="caption" tone="secondary" as="p">{dealerReviewLine(config.isLoaded ? config.dealer?.reviewHours : null)}</Text>
        </div>

        {rejected && (
          <div
            style={{ marginTop: 12, padding: 12, background: 'var(--color-status-danger-bg)', borderRadius: 'var(--radius-control)' }}
          >
            <Text variant="body-sm" tone="danger" as="p">
              Hồ sơ trước bị từ chối. Vui lòng kiểm tra lại thông tin và nộp lại.
            </Text>
            {rejectionReason && (
              <Text variant="body-sm" tone="danger" as="p" style={{ marginTop: 4, fontWeight: 600 }}>
                Lý do: {rejectionReason}
              </Text>
            )}
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Tên doanh nghiệp / cửa hàng *">
            <Input value={form.businessName} onChange={set('businessName')} />
          </Field>
          <Field label="Mã số thuế">
            <Input value={form.taxCode ?? ''} onChange={set('taxCode')} />
          </Field>
          <Field label="Người đại diện *">
            <Input value={form.ownerName} onChange={set('ownerName')} />
          </Field>
          <Field label="Số điện thoại *">
            <Input value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Địa chỉ kinh doanh *">
            <Input value={form.address} onChange={set('address')} />
          </Field>
          <ImageUpload
            label="Ảnh CCCD mặt trước *"
            value={form.cccdFrontUrl}
            onChange={(url) => setForm((f) => ({ ...f, cccdFrontUrl: url }))}
          />
          <ImageUpload
            label="Ảnh CCCD mặt sau *"
            value={form.cccdBackUrl}
            onChange={(url) => setForm((f) => ({ ...f, cccdBackUrl: url }))}
          />
        </div>

        <Button
          fullWidth
          loading={mut.isPending}
          disabled={!valid || mut.isPending}
          onPress={() => mut.mutate()}
          style={{ marginTop: 20, ...inkButton(!valid || mut.isPending) }}
        >
          Gửi hồ sơ đăng ký
        </Button>
      </div>
    </DealerShell>
  );
}

function DealerPending() {
  const config = usePublicConfig();
  const reviewHours = config.isLoaded ? config.dealer?.reviewHours : null;
  return (
    <DealerShell title="Hồ sơ đại lý">
      <div style={{ textAlign: 'center', padding: '64px 24px' }}>
        <Icon icon={Hourglass} size="lg" style={{ width: 48, height: 48, stroke: INK }} />
        <Heading variant="title-md" as="h2" style={{ marginTop: 12 }}>
          Hồ sơ đang được duyệt
        </Heading>
        <Text variant="body-sm" tone="secondary" as="p" style={{ marginTop: 8 }}>
          {reviewHours ? vi.dealerApply.pendingBody(reviewHours) : vi.dealerApply.pendingBodyGeneric}
        </Text>
      </div>
    </DealerShell>
  );
}

/* ─────────────── Dealer Hub ─────────────── */
type Tab = 'price' | 'orders' | 'credit' | 'report';

const TABS: { key: Tab; label: string }[] = [
  { key: 'price', label: 'Bảng giá' },
  { key: 'orders', label: 'Đơn hàng' },
  { key: 'credit', label: 'Công nợ' },
  { key: 'report', label: 'Báo cáo' },
];

function DealerHub() {
  const [tab, setTab] = useState<Tab>('price');
  const meQ = useQuery({ queryKey: ['dealer-me'], queryFn: getDealerMe });
  const me = meQ.data;

  return (
    <DealerShell title={TITLE_HUB}>
      {/* Thẻ tổng quan */}
      <div style={{ padding: 16 }}>
        <div style={{ padding: 16, background: INK, borderRadius: 'var(--radius-card)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div>
              <Text variant="caption" tone="inverse" as="div" style={{ opacity: 0.7 }}>
                Bậc đại lý
              </Text>
              <Heading variant="title-md" as="div" tone="inverse">
                {me?.tier?.name ?? 'Đang gán bậc'}
              </Heading>
            </div>
            <div style={{ textAlign: 'right' }}>
              <Text variant="caption" tone="inverse" as="div" style={{ opacity: 0.7 }}>
                Công nợ hiện tại
              </Text>
              <Heading variant="title-md" as="div" tone="inverse">
                {formatVnd(me?.currentDebt ?? 0)}
              </Heading>
            </div>
          </div>
          {me?.tier && (
            <Text variant="caption" tone="inverse" as="div" style={{ marginTop: 8, opacity: 0.7 }}>
              Hạn mức: {formatVnd(me.tier.creditLimit)}
            </Text>
          )}
        </div>
      </div>

      {me?.hasPartnerStorefront && (
      <div style={{ margin: '0 16px 12px', padding: 12, background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)' }} data-testid="partner-storefront-note">
        <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>{PARTNER_STOREFRONT_TITLE}</Text>
        <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 2 }}>{PARTNER_STOREFRONT_WEB_HINT}</Text>
      </div>
      )}

      <div style={{ margin: '0 16px 12px' }}>
        <SegmentedTabs items={TABS} value={tab} onChange={(key) => setTab(key as Tab)} />
      </div>

      {tab === 'price' && <PriceAndOrder creditLimit={me?.tier?.creditLimit ?? 0} debt={me?.currentDebt ?? 0} rules={me?.orderRules} />}
      {tab === 'orders' && <DealerOrders />}
      {tab === 'credit' && <DealerCredit />}
      {tab === 'report' && <DealerReport />}
    </DealerShell>
  );
}

const TEMPLATE_PILL_BUTTON: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 44,
  border: 'none',
  background: 'transparent',
  font: 'inherit',
  cursor: 'pointer',
};

/* Bảng giá + đặt nhanh */
function PriceAndOrder({ creditLimit, debt, rules }: { creditLimit: number; debt: number; rules?: DealerOrderRules }) {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const priceQ = useQuery({ queryKey: ['dealer-pricelist'], queryFn: getPricelist });
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 250);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteResult, setPasteResult] = useState<{ matched: number; unmatched: string[] } | null>(null);

  // Mẫu đơn lưu sẵn (#64)
  const templatesQ = useQuery({ queryKey: ['dealer-templates'], queryFn: getTemplates });
  const [saveOpen, setSaveOpen] = useState(false);
  const [tplName, setTplName] = useState('');
  const loadTemplate = (items: { variationId: string; quantity: number }[]) => {
    haptic('light');
    setQty(Object.fromEntries(items.map((i) => [i.variationId, i.quantity])));
  };
  const saveTpl = useMutation({
    mutationFn: () =>
      saveTemplate(
        tplName,
        Object.entries(qty).filter(([, n]) => n > 0).map(([variationId, quantity]) => ({ variationId, quantity })),
      ),
    onSuccess: () => {
      haptic('medium');
      setSaveOpen(false);
      setTplName('');
      openSnackbar({ text: 'Đã lưu mẫu đơn.', type: 'success' });
      void qc.invalidateQueries({ queryKey: ['dealer-templates'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const delTpl = useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['dealer-templates'] }),
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  /** Đặt nhanh: dán "SKU<sep>SốLượng" mỗi dòng (sep = tab/phẩy/khoảng trắng) → khớp bảng giá. */
  const applyPaste = () => {
    // Bảng giá chưa tải xong → bySku rỗng, mọi SKU hợp lệ sẽ bị báo nhầm "không khớp". Chặn sớm.
    if (priceQ.isLoading) return;
    const list = priceQ.data ?? [];
    const bySku = new Map(list.map((r) => [r.sku.toUpperCase(), r.variationId]));
    const next: Record<string, number> = { ...qty };
    let matched = 0;
    const unmatched: string[] = [];
    for (const raw of pasteText.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split(/[\t,;]+|\s{2,}|\s+(?=\d+$)/).map((p) => p.trim()).filter(Boolean);
      const sku = (parts[0] ?? '').toUpperCase();
      const q = parseInt(parts[parts.length - 1] ?? '', 10);
      const vid = bySku.get(sku);
      if (vid && q > 0) {
        next[vid] = (next[vid] ?? 0) + q;
        matched++;
      } else if (sku) {
        unmatched.push(sku);
      }
    }
    setQty(next);
    setPasteResult({ matched, unmatched });
    haptic('medium');
  };

  const rows = useMemo(() => {
    const list = priceQ.data ?? [];
    const q = debounced.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.product.toLowerCase().includes(q) ||
        r.sku.toLowerCase().includes(q) ||
        r.brand.toLowerCase().includes(q),
    );
  }, [priceQ.data, debounced]);

  const cart = useMemo(
    () => Object.entries(qty).filter(([, n]) => n > 0),
    [qty],
  );
  const total = useMemo(() => {
    const map = new Map((priceQ.data ?? []).map((r) => [r.variationId, r.dealerPrice]));
    return cart.reduce((s, [id, n]) => s + (map.get(id) ?? 0) * n, 0);
  }, [cart, priceQ.data]);
  const preorderLines = useMemo(() => {
    const stockOf = new Map((priceQ.data ?? []).map((r) => [r.variationId, r.stock]));
    return cart.filter(([id, n]) => preorderQty(n, stockOf.get(id) ?? 0) > 0).length;
  }, [cart, priceQ.data]);

  // Idempotency-Key giữ nguyên qua các lần retry của CÙNG 1 lần đặt đơn (double-tap/timeout mạng) →
  // BE không tạo đơn công nợ đôi; regenerate sau khi đặt thành công (đơn sau là đơn mới, mirror wallet.withdraw).
  const orderKey = useRef(newIdempotencyKey());
  const navigate = useNavigate();
  const place = useMutation({
    mutationFn: (method: 'CREDIT' | 'PREPAID') =>
      placeDealerOrder(
        cart.map(([variationId, quantity]) => ({ variationId, quantity })),
        method,
        undefined,
        orderKey.current,
      ),
    onSuccess: (order, method) => {
      haptic('medium');
      const hasPreorder = order.items?.some((it) => (it.backorderedQty ?? 0) > 0) ?? false;
      openSnackbar({
        text: hasPreorder ? vi.dealerOrder.createdWithPreorder : vi.dealerOrder.created,
        type: 'success',
      });
      orderKey.current = newIdempotencyKey();
      setQty({});
      void qc.invalidateQueries({ queryKey: ['dealer-orders'] });
      void qc.invalidateQueries({ queryKey: ['dealer-me'] });
      void qc.invalidateQueries({ queryKey: ['dealer-credit'] });
      // Đơn mới làm tăng doanh số quý/năm → refresh thẻ tiến trình phần thưởng & báo cáo quý,
      // nếu không card vẫn hiện "Còn X để đạt" dù backend đã tính achieved.
      void qc.invalidateQueries({ queryKey: ['dealer-rewards'] });
      void qc.invalidateQueries({ queryKey: ['dealer-report'] });
      // Đơn "Trả trước" tạo ra ở trạng thái PENDING_PAYMENT / BANK_TRANSFER nhưng trước đây
      // không có đường nào tới màn QR — đại lý đặt xong không biết chuyển khoản vào đâu.
      if (method === 'PREPAID') navigate(`/bank-payment/${order.code}`);
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const belowMin = !!rules && rules.minOrderValue > 0 && total < rules.minOrderValue;
  const shippingFee = rules && !belowMin && total < rules.freeShipThreshold ? rules.shippingFee : 0;
  const grandTotal = total + shippingFee;
  const overLimit = debt + grandTotal > creditLimit;
  const placing = place.isPending;

  return (
    // Chừa chỗ cho thanh đặt hàng dính đáy (cao nhất khi có đủ ghi chú đặt trước + cảnh báo hạn mức).
    <div style={{ margin: '0 16px', paddingBottom: cart.length > 0 ? 'calc(220px + var(--safe-bottom))' : 24 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <SearchField
          value={search}
          onChange={setSearch}
          onSubmit={() => undefined}
          label="Tìm sản phẩm"
          clearLabel="Xoá từ khoá"
          placeholder="Tìm theo tên / SKU / thương hiệu"
        />
        <Button
          variant="secondary"
          onPress={() => {
            setPasteResult(null);
            setPasteOpen(true);
          }}
          style={{ flex: '0 0 auto' }}
        >
          Dán đơn
        </Button>
      </div>

      {/* Mẫu đơn lưu sẵn (#64) — chạm tên để đặt lại 1 chạm; nút X để xoá */}
      {(templatesQ.data?.length ?? 0) > 0 && (
        <div style={{ paddingTop: 12, display: 'flex', gap: 8, overflowX: 'auto' }}>
          {templatesQ.data?.map((t) => (
            <div
              key={t.id}
              style={{
                flex: '0 0 auto',
                display: 'flex',
                alignItems: 'center',
                background: 'var(--color-bg-surface)',
                border: `1px solid ${INK}`,
                borderRadius: 'var(--radius-pill)',
              }}
            >
              <button
                type="button"
                className="tubu-press"
                onClick={() => loadTemplate(t.items)}
                style={{ ...TEMPLATE_PILL_BUTTON, gap: 6, padding: '0 4px 0 12px' }}
              >
                <Icon icon={ClipboardList} size="sm" style={{ flexShrink: 0, stroke: INK }} />
                <Text variant="caption" style={{ color: INK, fontWeight: 600 }}>
                  {t.name} ({t.items.length})
                </Text>
              </button>
              <button
                type="button"
                className="tubu-press"
                aria-label="Xoá mẫu đơn"
                aria-disabled={delTpl.isPending}
                onClick={() => { if (!delTpl.isPending) delTpl.mutate(t.id); }}
                style={{ ...TEMPLATE_PILL_BUTTON, minWidth: 44, opacity: delTpl.isPending ? 0.5 : 1 }}
              >
                <Icon icon={X} size="sm" tone="danger" />
              </button>
            </div>
          ))}
        </div>
      )}

      <BottomSheet open={saveOpen} onClose={() => setSaveOpen(false)} title="Lưu mẫu đơn">
        <Input placeholder="Tên mẫu (vd Đơn tháng)" value={tplName} onChange={(e) => setTplName(e.target.value)} />
        <Button
          fullWidth
          loading={saveTpl.isPending}
          disabled={!tplName.trim() || saveTpl.isPending}
          onPress={() => saveTpl.mutate()}
          style={{ marginTop: 14, ...inkButton(!tplName.trim() || saveTpl.isPending) }}
        >
          Lưu mẫu
        </Button>
      </BottomSheet>

      <BottomSheet open={pasteOpen} onClose={() => setPasteOpen(false)} title="Đặt nhanh — dán từ Excel/Sheet">
        <Text variant="caption" tone="tertiary" as="p" style={{ marginBottom: 8 }}>
          Mỗi dòng: <b>SKU</b> và <b>số lượng</b> (cách nhau bằng tab/phẩy/khoảng trắng). VD:
          <br />
          POLANG-SP-500 10
        </Text>
        <Input.TextArea
          placeholder={'POLANG-SP-500\t10\nFUWA-DW-1L, 24'}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={5}
        />
        {priceQ.isLoading && (
          <Text variant="caption" tone="tertiary" as="p" style={{ marginTop: 8 }}>
            Đang tải bảng giá, vui lòng đợi trước khi dán đơn…
          </Text>
        )}
        {pasteResult && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon icon={Check} size="sm" tone="brand" style={{ flexShrink: 0 }} />
            <Text
              variant="caption"
              tone="brand"
              style={pasteResult.unmatched.length ? { color: 'var(--color-promo-fg)' } : undefined}
            >
              Khớp {pasteResult.matched} dòng
              {pasteResult.unmatched.length > 0 ? ` · Không khớp: ${pasteResult.unmatched.join(', ')}` : ''}
            </Text>
          </div>
        )}
        <Button
          fullWidth
          disabled={!pasteText.trim() || priceQ.isLoading}
          onPress={applyPaste}
          style={{ marginTop: 12, ...inkButton(!pasteText.trim() || priceQ.isLoading) }}
        >
          Thêm vào đơn
        </Button>
      </BottomSheet>

      <Card padding={0} style={{ marginTop: 12, overflow: 'hidden' }}>
        {priceQ.isLoading ? (
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={40} />
            ))}
          </div>
        ) : priceQ.isError ? (
          <ErrorState message={getErrorMessage(priceQ.error)} onRetry={() => void priceQ.refetch()} />
        ) : rows.length > 0 ? (
          rows.map((r, i) => (
            <PriceRow
              key={r.variationId}
              row={r}
              qty={qty[r.variationId] ?? 0}
              onQty={(n) => setQty((s) => ({ ...s, [r.variationId]: n }))}
              top={i === 0}
            />
          ))
        ) : (
          <EmptyState variant="inline" art="search" heading="Không tìm thấy sản phẩm" />
        )}
      </Card>

      {/* Thanh tổng + đặt */}
      {cart.length > 0 && (
        <StickyActionBar
          summary={
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <Button variant="ghost" icon={Save} onPress={() => setSaveOpen(true)}>
                  Lưu mẫu
                </Button>
                <Text variant="price-lg" style={{ color: INK }}>
                  {formatVnd(grandTotal)}
                </Text>
              </div>
              {belowMin && rules && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Icon icon={AlertTriangle} size="sm" tone="danger" style={{ flexShrink: 0 }} />
                  <Text variant="caption" tone="danger">
                    Đơn tối thiểu {formatVnd(rules.minOrderValue)} tiền hàng — thêm {formatVnd(rules.minOrderValue - total)} nữa để đặt.
                  </Text>
                </div>
              )}
              {rules && !belowMin && (
                <Text variant="caption" tone="secondary" as="div">
                  {shippingFee > 0
                    ? `Tiền hàng ${formatVnd(total)} + Phí giao ${formatVnd(shippingFee)} (miễn phí từ ${formatVnd(rules.freeShipThreshold)})`
                    : `Miễn phí giao (đơn từ ${formatVnd(rules.freeShipThreshold)})`}
                </Text>
              )}
              {preorderLines > 0 && (
                <Text variant="caption" tone="warning" as="div">
                  {vi.dealerOrder.preorderNote(preorderLines)}
                </Text>
              )}
              {overLimit && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Icon icon={AlertTriangle} size="sm" tone="danger" style={{ flexShrink: 0 }} />
                  <Text variant="caption" tone="danger">
                    Vượt hạn mức công nợ — chọn Trả trước hoặc giảm số lượng.
                  </Text>
                </div>
              )}
            </>
          }
          secondary={
            <Button
              variant="secondary"
              loading={placing}
              disabled={placing || belowMin}
              onPress={() => place.mutate('PREPAID')}
              style={{ flex: 1 }}
            >
              Trả trước
            </Button>
          }
          primary={
            <Button
              fullWidth
              loading={placing}
              disabled={overLimit || placing || belowMin}
              onPress={() => place.mutate('CREDIT')}
              style={inkButton(overLimit || placing || belowMin)}
            >
              Ghi công nợ
            </Button>
          }
        />
      )}
    </div>
  );
}

function PriceRow({
  row,
  qty,
  onQty,
  top,
}: {
  row: PricelistRow;
  qty: number;
  onQty: (n: number) => void;
  top: boolean;
}) {
  const preorder = preorderQty(qty, row.stock);
  const discountPct = realDiscountPct(row.retailPrice, row.dealerPrice);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: 12,
        borderTop: top ? 'none' : '1px solid var(--color-border-subtle)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text
          variant="body-sm"
          as="div"
          style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {row.product} · {row.variation}
        </Text>
        <Text variant="caption" tone="tertiary" as="div">
          {row.sku} · {row.stock > 0 ? `tồn ${row.stock}` : vi.dealerOrder.outOfStockPreorder}
        </Text>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <Text variant="price-sm" style={{ color: INK }}>
            {formatVnd(row.dealerPrice)}
          </Text>
          <Text variant="caption" tone="tertiary" style={{ textDecoration: 'line-through' }}>
            {formatVnd(row.retailPrice)}
          </Text>
          {discountPct > 0 && (
            <Text variant="caption" tone="brand">
              -{discountPct}%
            </Text>
          )}
        </div>
        {preorder > 0 && (
          <div style={{ marginTop: 4 }}>
            <Badge tone="warning" size="sm">
              {vi.dealerOrder.preorderLine(preorder)}
            </Badge>
          </div>
        )}
      </div>
      <div style={{ flex: '0 0 auto' }}>
        <QuantitySelector value={qty} min={0} max={DEALER_MAX_QTY} size="md" onChange={onQty} />
      </div>
    </div>
  );
}

function DealerOrders() {
  const navigate = useNavigate();
  const ordersQ = useQuery({ queryKey: ['dealer-orders'], queryFn: getDealerOrders });
  return (
    <div style={{ margin: '0 16px', paddingBottom: 24, display: 'flex', flexDirection: 'column' }}>
      {ordersQ.isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Skeleton height={80} radius="var(--radius-card)" />
          <Skeleton height={80} radius="var(--radius-card)" />
        </div>
      ) : ordersQ.isError ? (
        <ErrorState message={getErrorMessage(ordersQ.error)} onRetry={() => void ordersQ.refetch()} />
      ) : ordersQ.data && ordersQ.data.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ordersQ.data.map((o) => {
            // Đơn "Trả trước" nằm ở PENDING_PAYMENT/BANK_TRANSFER — màn chi tiết đơn có sẵn
            // nút "Thanh toán ngay" dẫn tới QR, nên thẻ đơn phải bấm được thì đại lý mới trả
            // tiền được sau khi đã rời màn đặt hàng.
            const needsPayment = o.status === 'PENDING_PAYMENT' && o.paymentMethod === 'BANK_TRANSFER';
            // Tổng số lượng đang đặt trước (chờ nhập hàng) của đơn — DealerService.placeOrder
            // ghi vào OrderItem.backorderedQty khi đặt vượt tồn hiện có (đặt trước thay vì chặn).
            const totalBackordered = o.items?.reduce((s, it) => s + (it.backorderedQty || 0), 0) ?? 0;
            return (
              <div
                key={o.code}
                role="button"
                aria-label={`Xem đơn ${o.code}`}
                className="tubu-press"
                {...rowKeyboardProps()}
                onClick={() => {
                  haptic('light');
                  navigate(`/order/${o.code}`);
                }}
                style={{
                  padding: 12,
                  background: 'var(--color-bg-surface)',
                  borderRadius: 'var(--radius-card)',
                  boxShadow: 'var(--elevation-1)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Text variant="body-sm" style={{ fontWeight: 600 }}>
                    #{o.code}
                  </Text>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Badge tone={needsPayment ? 'warning' : 'info'} size="sm">
                      {vi.orderStatus[o.status] ?? o.status}
                    </Badge>
                    <Icon icon={ChevronRight} size="sm" tone="muted" />
                  </div>
                </div>
                <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>
                  {o.items?.length ?? 0} mặt hàng · {formatDate(o.createdAt)}
                </Text>
                {totalBackordered > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <Badge tone="warning" size="sm">
                      Đặt trước {totalBackordered} — chờ hàng về
                    </Badge>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, gap: 8 }}>
                  <Text variant="body-lg" style={{ color: INK, fontWeight: 700 }}>
                    {formatVnd(o.total)}
                  </Text>
                  {needsPayment && (
                    <Text variant="caption" tone="brand" style={{ fontWeight: 600 }}>
                      Thanh toán ngay →
                    </Text>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState art="box" heading="Chưa có đơn đại lý nào" />
      )}
    </div>
  );
}

function DealerCredit() {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const ledgerQ = useQuery({ queryKey: ['dealer-credit'], queryFn: getCreditLedger });
  const [amount, setAmount] = useState('');

  // A5-09 (docs/audit-2026-09/05-ctv-dealer-staff.md): "Báo đã CK" KHÔNG còn tự trừ nợ — chỉ tạo
  // thông báo cho admin xác nhận (DealerService.reportCreditPayment). Sổ công nợ CHỈ giảm sau khi
  // admin tự kiểm tra sao kê ngân hàng và xác nhận. Giữ Idempotency-Key để tương thích payCredit()
  // hiện có (BE không còn dùng để trừ nợ, chỉ có tác dụng nếu tương lai cần dedupe thông báo).
  const payKey = useRef(newIdempotencyKey());
  const pay = useMutation({
    mutationFn: () => payCredit(Number(amount), payKey.current, 'Báo đã chuyển khoản'),
    onSuccess: (res) => {
      haptic('medium');
      openSnackbar({
        text: (res as { message?: string })?.message ?? 'Đã báo cho quản trị viên — chờ xác nhận đã nhận được tiền.',
        type: 'success',
      });
      payKey.current = newIdempotencyKey();
      setAmount('');
      // Sổ công nợ CHƯA đổi ngay (chỉ đổi khi admin xác nhận) — vẫn refetch để đồng bộ nếu admin
      // đã xử lý một khoản khác trong lúc này.
      void qc.invalidateQueries({ queryKey: ['dealer-credit'] });
      void qc.invalidateQueries({ queryKey: ['dealer-me'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const balance = ledgerQ.data?.balance ?? 0;

  if (ledgerQ.isLoading) {
    return (
      <div style={{ margin: '0 16px', paddingBottom: 24 }}>
        <Skeleton height={140} radius="var(--radius-card)" />
      </div>
    );
  }
  if (ledgerQ.isError && !ledgerQ.data) {
    return (
      <div style={{ margin: '0 16px', paddingBottom: 24 }}>
        <ErrorState message={getErrorMessage(ledgerQ.error)} onRetry={() => void ledgerQ.refetch()} />
      </div>
    );
  }

  const payDisabled = !Number.isFinite(Number(amount)) || Number(amount) <= 0 || Number(amount) > balance || pay.isPending;

  return (
    <div style={{ margin: '0 16px', paddingBottom: 24 }}>
      <Card padding={16}>
        <Text variant="body-sm" tone="secondary" as="div">
          Dư nợ hiện tại
        </Text>
        <Text variant="price-xl" tone={balance > 0 ? 'danger' : 'brand'} as="div">
          {formatVnd(balance)}
        </Text>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Input
            type="number"
            placeholder="Số tiền đã chuyển"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Button
            disabled={payDisabled}
            loading={pay.isPending}
            onPress={() => pay.mutate()}
            style={{ flex: '0 0 auto', ...inkButton(payDisabled) }}
          >
            Báo đã CK
          </Button>
        </div>
        {Number(amount) > balance && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <Icon icon={AlertTriangle} size="sm" tone="danger" style={{ flexShrink: 0 }} />
            <Text variant="caption" tone="danger">
              Số tiền vượt dư nợ hiện tại ({formatVnd(balance)}).
            </Text>
          </div>
        )}
        <Text variant="caption" tone="tertiary" as="p" style={{ marginTop: 6 }}>
          "Báo đã CK" chỉ gửi thông báo cho Tubu Tree — dư nợ chỉ giảm sau khi admin kiểm tra sao kê
          ngân hàng và xác nhận.
        </Text>
      </Card>

      <Heading variant="title-sm" as="h2" style={{ margin: '16px 0 8px' }}>
        Sổ công nợ
      </Heading>
      {ledgerQ.data && ledgerQ.data.entries.length > 0 ? (
        <Card padding={0} style={{ overflow: 'hidden' }}>
          {ledgerQ.data.entries.map((e, i) => (
            <div
              key={e.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                padding: 12,
                borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)',
              }}
            >
              <div>
                <Text variant="body-sm" as="div">{e.note ?? e.refType}</Text>
                <Text variant="caption" tone="tertiary" as="div">
                  {formatDate(e.createdAt)}
                </Text>
              </div>
              <Text variant="body-sm" tone={e.delta > 0 ? 'danger' : 'brand'} style={{ fontWeight: 700 }}>
                {e.delta > 0 ? '+' : ''}
                {formatVnd(e.delta)}
              </Text>
            </div>
          ))}
        </Card>
      ) : (
        <EmptyState variant="inline" art="leaf" heading="Chưa có giao dịch công nợ" />
      )}
    </div>
  );
}

/** Báo cáo quý đại lý (#71) — doanh số quý + thưởng theo bậc. */
function DealerReport() {
  const q = useQuery({ queryKey: ['dealer-report'], queryFn: getQuarterlyReport });
  if (q.isLoading) {
    return (
      <div style={{ margin: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Skeleton height={120} radius="var(--radius-card)" />
        <Skeleton height={80} radius="var(--radius-card)" />
      </div>
    );
  }
  if (!q.data) {
    return (
      <div style={{ margin: '0 16px' }}>
        <ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const d = q.data;
  const progress = d.nextTier
    ? Math.min(100, Math.round((d.revenue / d.nextTier.min) * 100))
    : 100;
  return (
    <div style={{ margin: '0 16px', display: 'flex', flexDirection: 'column', paddingBottom: 24, gap: 12 }}>
      {/* Card doanh số quý */}
      <div
        style={{
          padding: 16,
          background: `linear-gradient(135deg, ${INK}, var(--color-dealer-ink-soft))`,
          borderRadius: 'var(--radius-card)',
        }}
      >
        <Text variant="caption" tone="inverse" as="div" style={{ opacity: 0.7 }}>
          Doanh số {d.quarter}
        </Text>
        <Text variant="price-xl" tone="inverse" as="div" style={{ marginTop: 2 }}>
          {formatVnd(d.revenue)}
        </Text>
        <Text variant="caption" tone="inverse" as="div" style={{ marginTop: 2, opacity: 0.7 }}>
          {d.orderCount} đơn đã chốt · Thưởng hiện tại {bonusPctText(d.bonusPct)} = <b style={{ color: 'var(--color-dealer-accent)' }}>{formatVnd(d.bonusAmount)}</b>
        </Text>
        {d.pendingRevenue > 0 && (
          <Text variant="caption" tone="inverse" as="div" style={{ marginTop: 2, opacity: 0.7 }}>
            + {formatVnd(d.pendingRevenue)} ({d.pendingOrderCount} đơn) chờ thanh toán/đóng gói — chưa tính thưởng
          </Text>
        )}
        {d.nextTier && (
          <div style={{ marginTop: 12 }}>
            {/* Nền thanh mờ của chữ trắng; hai lớp riêng để độ mờ không làm nhạt phần đã đạt. */}
            <div style={{ position: 'relative', height: 8 }}>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'var(--color-text-inverse)',
                  opacity: 0.2,
                  borderRadius: 'var(--radius-pill)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: `${progress}%`,
                  background: 'var(--color-dealer-accent)',
                  borderRadius: 'var(--radius-pill)',
                }}
              />
            </div>
            <Text variant="caption" tone="inverse" as="div" style={{ marginTop: 6, opacity: 0.85 }}>
              Còn {formatVnd(d.nextTier.toNext)} để đạt thưởng {bonusPctText(d.nextTier.pct)}
            </Text>
          </div>
        )}
      </div>

      {/* Bậc thưởng */}
      <Card padding={16}>
        <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>
          Bậc thưởng doanh số quý
        </Heading>
        {d.tiers.map((t) => {
          const reached = d.revenue >= t.min;
          const tone = reached ? 'brand' : 'secondary';
          return (
            <div
              key={t.min}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: '1px solid var(--color-border-subtle)',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {reached && <Icon icon={Check} size="sm" tone="brand" style={{ flexShrink: 0 }} />}
                <Text variant="body-sm" tone={tone}>
                  Từ {formatVnd(t.min)}
                </Text>
              </span>
              <Text variant="body-sm" tone={tone} style={{ fontWeight: 600 }}>
                thưởng {bonusPctText(t.pct)}
              </Text>
            </div>
          );
        })}
        <Text variant="caption" tone="tertiary" as="p" style={{ marginTop: 8 }}>
          Thưởng tính trên đơn đại lý đặt trong quý đã thanh toán (hoặc ghi công nợ) và đã đóng gói/giao — không tính đơn chờ xử lý, huỷ, trả. Thưởng quý được cộng vào công nợ khoảng ngày 10 của quý kế tiếp.
        </Text>
      </Card>

      <DealerRewardsCard />
    </div>
  );
}

const REWARD_ICON: Record<string, LucideIcon> = { TOUR: Plane, GIFT: Gift };

const CLAIM_BADGE_TONE: Record<RewardClaimTone, BadgeTone> = {
  info: 'info',
  success: 'success',
  danger: 'danger',
  muted: 'neutral',
};

/** Phần thưởng đại lý (tour/quà): điều kiện + tiến trình đạt mốc + yêu cầu nhận thưởng (lưu thật, admin duyệt). */
function DealerRewardsCard() {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dealer-rewards'], queryFn: getDealerRewards });
  const rewards = q.data?.rewards ?? [];

  const claimMut = useMutation({
    mutationFn: (v: { rewardId: string; periodKey: string }) => claimDealerReward(v.rewardId, v.periodKey),
    onSuccess: (res, v) => {
      haptic('heavy');
      openSnackbar({ text: res.message, type: res.alreadyClaimed ? 'info' : 'success' });
      // Cập nhật ngay trạng thái dòng vừa gửi: không để nút bật lại trong lúc chờ refetch.
      qc.setQueryData<DealerRewardsView>(['dealer-rewards'], (old) =>
        old
          ? {
              ...old,
              rewards: old.rewards.map((r) =>
                r.id === v.rewardId && r.periodKey === v.periodKey
                  ? { ...r, claimStatus: res.claimStatus, claimId: res.claim.id, canClaim: false }
                  : r,
              ),
            }
          : old,
      );
      void qc.invalidateQueries({ queryKey: ['dealer-rewards'] });
    },
    onError: (e) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      // Hết hạn / tụt doanh số... → tải lại để nút và trạng thái khớp backend.
      void qc.invalidateQueries({ queryKey: ['dealer-rewards'] });
    },
  });

  if (!rewards.length) return null;
  const pendingKey = claimMut.isPending ? `${claimMut.variables?.rewardId}|${claimMut.variables?.periodKey}` : null;
  return (
    <Card padding={16}>
      <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>
        Phần thưởng đại lý
      </Heading>
      {rewards.map((r) => {
        // Guard chia-0: threshold=0 (admin cho phép @Min(0)) → 0/0=NaN → width:'NaN%'. Đạt ngay = 100%.
        const pct = r.threshold > 0 ? Math.min(100, Math.round((r.volume / r.threshold) * 100)) : 100;
        const view = rewardClaimView(r);
        const rowKey = `${r.id}|${r.periodKey}`;
        return (
          <div key={rowKey} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <Icon icon={REWARD_ICON[r.type] ?? Award} size="sm" tone="brand" style={{ flexShrink: 0 }} />
                {r.achieved && <Icon icon={Check} size="sm" tone="brand" style={{ flexShrink: 0 }} />}
                <Text variant="body-sm" tone={r.achieved ? 'brand' : 'primary'}>
                  {r.title}
                </Text>
              </div>
              <Text variant="caption" tone="tertiary" style={{ whiteSpace: 'nowrap' }}>
                {formatVnd(r.threshold)}/{r.period === 'YEAR' ? 'năm' : 'quý'}
              </Text>
            </div>
            {!r.isCurrentPeriod && (
              <Text variant="caption" as="div" style={{ color: INK, fontWeight: 600 }}>
                Kỳ trước · {r.periodLabel}
              </Text>
            )}
            {r.description && (
              <Text variant="caption" tone="tertiary" as="div">{r.description}</Text>
            )}
            <div style={{ marginTop: 6 }}>
              <ProgressBar value={pct} max={100} />
            </div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <Text variant="caption" tone="tertiary" style={{ flex: '1 1 140px', minWidth: 0 }}>
                {view.hint}
              </Text>
              {view.badge && (
                <Badge tone={CLAIM_BADGE_TONE[view.badge.tone]} size="sm">
                  {view.badge.label}
                </Badge>
              )}
              {view.showClaimButton && (
                <Button
                  disabled={claimMut.isPending}
                  loading={claimMut.isPending && pendingKey === rowKey}
                  onPress={() => claimMut.mutate({ rewardId: r.id, periodKey: r.periodKey })}
                  style={{ flexShrink: 0, ...inkButton(claimMut.isPending) }}
                >
                  Yêu cầu nhận thưởng
                </Button>
              )}
            </div>
          </div>
        );
      })}
      <Text variant="caption" tone="tertiary" as="p" style={{ marginTop: 8 }}>
        Chỉ tính đơn đã thanh toán/ghi công nợ và đã đóng gói. Mốc đạt trong kỳ vẫn gửi yêu cầu được trong{' '}
        {q.data?.claimGraceDays ?? 30} ngày sau khi kỳ kết thúc.
      </Text>
    </Card>
  );
}
