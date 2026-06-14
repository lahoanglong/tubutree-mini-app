import { useMemo, useState } from 'react';
import { Box, Page, Text, Header, Button, Input, Sheet, useSnackbar } from 'zmp-ui';
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
  getTemplates,
  saveTemplate,
  deleteTemplate,
  type DealerApplyInput,
  type PricelistRow,
} from '../services/dealer-api';
import { getErrorMessage } from '../services/api';
import { formatVnd, ORDER_STATUS_LABEL } from '../utils/format';
import { haptic } from '../utils/haptic';
import { useDebounced } from '../utils/use-debounced';
import { ImageUpload } from '../components/image-upload';
import { Skeleton } from '../components/ui/skeleton';

export default function DealerPage() {
  const meQ = useQuery({ queryKey: ['dealer-me'], queryFn: getDealerMe });

  if (meQ.isLoading) {
    return (
      <Page className="page" style={{ background: 'var(--dealer-bg, #f4f6f9)' }}>
        <Header title="Đại lý" />
        <Box p={4} flex flexDirection="column" style={{ gap: 12 }}>
          <Skeleton style={{ height: 100, borderRadius: 12 }} />
          <Skeleton style={{ height: 60, borderRadius: 12 }} />
        </Box>
      </Page>
    );
  }
  if (meQ.isError) {
    return (
      <Page className="page">
        <Header title="Đại lý" />
        <Box p={6} style={{ textAlign: 'center' }}>
          <Text style={{ color: 'var(--danger)' }}>{getErrorMessage(meQ.error)}</Text>
        </Box>
      </Page>
    );
  }

  const me = meQ.data!;
  if (me.isDealer || me.status === 'APPROVED') return <DealerHub />;
  if (me.status === 'PENDING') return <DealerPending />;
  return <DealerApply rejected={me.status === 'REJECTED'} />;
}

/* ─────────────── Đăng ký đại lý ─────────────── */
function DealerApply({ rejected }: { rejected: boolean }) {
  const { openSnackbar } = useSnackbar();
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
    <Page className="page" style={{ background: '#f4f6f9' }}>
      <Header title="Đăng ký đại lý" />
      <Box p={4}>
        <Box p={4} style={{ background: '#1f2a44', borderRadius: 'var(--radius-xl)', color: '#fff' }}>
          <Text style={{ fontSize: 36 }}>🏪</Text>
          <Text bold size="large" style={{ color: '#fff', marginTop: 4 }}>
            Trở thành đại lý Tubu
          </Text>
          <Text size="small" style={{ color: 'rgba(255,255,255,0.8)', marginTop: 4 }}>
            Giá sỉ đến 45% · công nợ · đặt hàng nhanh số lượng lớn.
          </Text>
        </Box>

        {rejected && (
          <Box mt={3} p={3} style={{ background: '#fbe9e9', borderRadius: 'var(--radius-md)' }}>
            <Text size="small" style={{ color: 'var(--danger)' }}>
              Hồ sơ trước bị từ chối. Vui lòng kiểm tra lại thông tin và nộp lại.
            </Text>
          </Box>
        )}

        <Box mt={4} flex flexDirection="column" style={{ gap: 12 }}>
          <Input label="Tên doanh nghiệp / cửa hàng *" value={form.businessName} onChange={set('businessName')} />
          <Input label="Mã số thuế" value={form.taxCode ?? ''} onChange={set('taxCode')} />
          <Input label="Người đại diện *" value={form.ownerName} onChange={set('ownerName')} />
          <Input label="Số điện thoại *" value={form.phone} onChange={set('phone')} />
          <Input label="Địa chỉ kinh doanh *" value={form.address} onChange={set('address')} />
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
        </Box>

        <Button
          fullWidth
          loading={mut.isPending}
          disabled={!valid}
          onClick={() => mut.mutate()}
          style={{ marginTop: 20, background: '#1f2a44' }}
        >
          Gửi hồ sơ đăng ký
        </Button>
      </Box>
    </Page>
  );
}

function DealerPending() {
  return (
    <Page className="page" style={{ background: '#f4f6f9' }}>
      <Header title="Đại lý" />
      <Box style={{ textAlign: 'center', padding: '64px 24px' }}>
        <Text style={{ fontSize: 56 }}>⏳</Text>
        <Text bold size="large" style={{ marginTop: 12 }}>
          Hồ sơ đang được duyệt
        </Text>
        <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 8 }}>
          Đội ngũ Tubu sẽ xét duyệt trong vòng 24 giờ và liên hệ lại với bạn qua Zalo.
        </Text>
      </Box>
    </Page>
  );
}

/* ─────────────── Dealer Hub ─────────────── */
type Tab = 'price' | 'orders' | 'credit' | 'report';

function DealerHub() {
  const [tab, setTab] = useState<Tab>('price');
  const meQ = useQuery({ queryKey: ['dealer-me'], queryFn: getDealerMe });
  const me = meQ.data;

  return (
    <Page className="page" style={{ background: '#f4f6f9' }}>
      <Header title="Đại lý Tubu" />

      {/* Thẻ tổng quan */}
      <Box p={4}>
        <Box p={4} style={{ background: '#1f2a44', borderRadius: 'var(--radius-lg)', color: '#fff' }}>
          <Box flex justifyContent="space-between" alignItems="center">
            <Box>
              <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.7)' }}>
                Bậc đại lý
              </Text>
              <Text bold size="large" style={{ color: '#fff' }}>
                {me?.tier?.name ?? 'Đang gán bậc'}
              </Text>
            </Box>
            <Box style={{ textAlign: 'right' }}>
              <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.7)' }}>
                Công nợ hiện tại
              </Text>
              <Text bold size="large" style={{ color: '#fff' }}>
                {formatVnd(me?.currentDebt ?? 0)}
              </Text>
            </Box>
          </Box>
          {me?.tier && (
            <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.7)', marginTop: 8 }}>
              Hạn mức: {formatVnd(me.tier.creditLimit)}
            </Text>
          )}
        </Box>
      </Box>

      {/* Tabs */}
      <Box flex mx={4} mb={3} style={{ gap: 6 }}>
        <TabChip label="Bảng giá" active={tab === 'price'} onClick={() => setTab('price')} />
        <TabChip label="Đơn hàng" active={tab === 'orders'} onClick={() => setTab('orders')} />
        <TabChip label="Công nợ" active={tab === 'credit'} onClick={() => setTab('credit')} />
        <TabChip label="Báo cáo" active={tab === 'report'} onClick={() => setTab('report')} />
      </Box>

      {tab === 'price' && <PriceAndOrder creditLimit={me?.tier?.creditLimit ?? 0} debt={me?.currentDebt ?? 0} />}
      {tab === 'orders' && <DealerOrders />}
      {tab === 'credit' && <DealerCredit />}
      {tab === 'report' && <DealerReport />}
    </Page>
  );
}

function TabChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Box
      className="tubu-press"
      onClick={onClick}
      style={{
        flex: 1,
        textAlign: 'center',
        padding: '8px 0',
        borderRadius: 'var(--radius-md)',
        background: active ? '#1f2a44' : 'var(--neutral-0)',
        border: '1px solid #1f2a44',
      }}
    >
      <Text size="small" bold style={{ color: active ? '#fff' : '#1f2a44' }}>
        {label}
      </Text>
    </Box>
  );
}

/* Bảng giá + đặt nhanh */
function PriceAndOrder({ creditLimit, debt }: { creditLimit: number; debt: number }) {
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

  const place = useMutation({
    mutationFn: (method: 'CREDIT' | 'PREPAID') =>
      placeDealerOrder(
        cart.map(([variationId, quantity]) => ({ variationId, quantity })),
        method,
      ),
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: 'Đã tạo đơn đại lý!', type: 'success' });
      setQty({});
      void qc.invalidateQueries({ queryKey: ['dealer-orders'] });
      void qc.invalidateQueries({ queryKey: ['dealer-me'] });
      void qc.invalidateQueries({ queryKey: ['dealer-credit'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const overLimit = debt + total > creditLimit;

  return (
    <Box mx={4} style={{ paddingBottom: cart.length > 0 ? 150 : 24 }}>
      <Box flex style={{ gap: 8 }}>
        <Box style={{ flex: 1 }}>
          <Input
            placeholder="Tìm theo tên / SKU / thương hiệu"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            clearable
          />
        </Box>
        <Button
          size="small"
          variant="secondary"
          onClick={() => {
            setPasteResult(null);
            setPasteOpen(true);
          }}
          style={{ flex: '0 0 auto' }}
        >
          📋 Dán đơn
        </Button>
      </Box>

      {/* Mẫu đơn lưu sẵn (#64) — chạm để đặt lại 1 chạm; ✕ để xoá */}
      {(templatesQ.data?.length ?? 0) > 0 && (
        <Box pt={3} style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
          {templatesQ.data?.map((t) => (
            <Box
              key={t.id}
              className="tubu-press"
              style={{
                flex: '0 0 auto',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'var(--neutral-0)',
                border: '1px solid #1f2a44',
                borderRadius: 'var(--radius-full)',
                padding: '6px 10px 6px 14px',
              }}
            >
              <Text size="xSmall" bold style={{ color: '#1f2a44' }} onClick={() => loadTemplate(t.items)}>
                📋 {t.name} ({t.items.length})
              </Text>
              <Text
                size="xSmall"
                onClick={() => delTpl.mutate(t.id)}
                style={{ color: 'var(--danger)', fontWeight: 700 }}
              >
                ✕
              </Text>
            </Box>
          ))}
        </Box>
      )}

      <Sheet visible={saveOpen} onClose={() => setSaveOpen(false)} autoHeight>
        <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
          <Text bold size="large" style={{ marginBottom: 10 }}>
            Lưu mẫu đơn
          </Text>
          <Input placeholder="Tên mẫu (vd Đơn tháng)" value={tplName} onChange={(e) => setTplName(e.target.value)} />
          <Button
            fullWidth
            loading={saveTpl.isPending}
            disabled={!tplName.trim()}
            onClick={() => saveTpl.mutate()}
            style={{ marginTop: 14, background: '#1f2a44' }}
          >
            Lưu mẫu
          </Button>
        </Box>
      </Sheet>

      <Sheet visible={pasteOpen} onClose={() => setPasteOpen(false)} autoHeight>
        <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
          <Text bold size="large">
            Đặt nhanh — dán từ Excel/Sheet
          </Text>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
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
          {pasteResult && (
            <Text size="xSmall" style={{ marginTop: 8, color: pasteResult.unmatched.length ? 'var(--clay-700)' : 'var(--leaf-700)' }}>
              ✓ Khớp {pasteResult.matched} dòng
              {pasteResult.unmatched.length > 0 ? ` · Không khớp: ${pasteResult.unmatched.join(', ')}` : ''}
            </Text>
          )}
          <Box flex style={{ gap: 8, marginTop: 12 }}>
            <Button variant="secondary" onClick={() => setPasteOpen(false)} style={{ flex: 1 }}>
              Đóng
            </Button>
            <Button
              disabled={!pasteText.trim()}
              onClick={applyPaste}
              style={{ flex: 1, background: '#1f2a44' }}
            >
              Thêm vào đơn
            </Button>
          </Box>
        </Box>
      </Sheet>

      <Box mt={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        {priceQ.isLoading ? (
          <Box p={3} flex flexDirection="column" style={{ gap: 8 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} style={{ height: 40 }} />
            ))}
          </Box>
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
          <Box p={4} style={{ textAlign: 'center' }}>
            <Text size="small" style={{ color: 'var(--neutral-400)' }}>
              Không tìm thấy sản phẩm.
            </Text>
          </Box>
        )}
      </Box>

      {/* Thanh tổng + đặt */}
      {cart.length > 0 && (
        <Box
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '12px 16px calc(12px + var(--safe-bottom))',
            background: 'var(--neutral-0)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <Box flex justifyContent="space-between" alignItems="center" mb={2}>
            <Text
              size="xSmall"
              bold
              className="tubu-press"
              onClick={() => setSaveOpen(true)}
              style={{ color: '#1f2a44' }}
            >
              💾 Lưu mẫu
            </Text>
            <Text bold size="large" style={{ color: '#1f2a44' }}>
              {formatVnd(total)}
            </Text>
          </Box>
          {overLimit && (
            <Text size="xSmall" style={{ color: 'var(--danger)', marginBottom: 6 }}>
              ⚠ Vượt hạn mức công nợ — chọn Trả trước hoặc giảm số lượng.
            </Text>
          )}
          <Box flex style={{ gap: 8 }}>
            <Button
              variant="secondary"
              loading={place.isPending}
              onClick={() => place.mutate('PREPAID')}
              style={{ flex: 1 }}
            >
              Trả trước
            </Button>
            <Button
              loading={place.isPending}
              disabled={overLimit}
              onClick={() => place.mutate('CREDIT')}
              style={{ flex: 1, background: '#1f2a44' }}
            >
              Ghi công nợ
            </Button>
          </Box>
        </Box>
      )}
    </Box>
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
  return (
    <Box
      flex
      alignItems="center"
      p={3}
      style={{ gap: 8, borderTop: top ? 'none' : '1px solid var(--neutral-100)' }}
    >
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text size="small" bold style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.product} · {row.variation}
        </Text>
        <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
          {row.sku} · tồn {row.stock}
        </Text>
        <Box flex alignItems="baseline" style={{ gap: 6 }}>
          <Text size="small" bold style={{ color: '#1f2a44' }}>
            {formatVnd(row.dealerPrice)}
          </Text>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)', textDecoration: 'line-through' }}>
            {formatVnd(row.retailPrice)}
          </Text>
          <Text size="xSmall" style={{ color: 'var(--leaf-700)' }}>
            -{row.discountPct}%
          </Text>
        </Box>
      </Box>
      <Box flex alignItems="center" style={{ gap: 4, flex: '0 0 auto' }}>
        <Stepper value={qty} onChange={onQty} max={row.stock} />
      </Box>
    </Box>
  );
}

function Stepper({ value, onChange, max }: { value: number; onChange: (n: number) => void; max: number }) {
  const btn = (label: string, fn: () => void, disabled?: boolean) => (
    <Box
      className="tubu-press"
      onClick={disabled ? undefined : fn}
      style={{
        width: 28,
        height: 28,
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--neutral-200)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
        background: 'var(--neutral-0)',
      }}
    >
      <Text bold>{label}</Text>
    </Box>
  );
  return (
    <>
      {btn('−', () => onChange(Math.max(0, value - 1)), value <= 0)}
      <Text size="small" bold style={{ minWidth: 22, textAlign: 'center' }}>
        {value}
      </Text>
      {btn('+', () => onChange(Math.min(max, value + 1)), value >= max)}
    </>
  );
}

function DealerOrders() {
  const ordersQ = useQuery({ queryKey: ['dealer-orders'], queryFn: getDealerOrders });
  return (
    <Box mx={4} style={{ paddingBottom: 24 }} flex flexDirection="column">
      {ordersQ.isLoading ? (
        <Box flex flexDirection="column" style={{ gap: 10 }}>
          <Skeleton style={{ height: 80, borderRadius: 12 }} />
          <Skeleton style={{ height: 80, borderRadius: 12 }} />
        </Box>
      ) : ordersQ.data && ordersQ.data.length > 0 ? (
        <Box flex flexDirection="column" style={{ gap: 10 }}>
          {ordersQ.data.map((o) => (
            <Box key={o.code} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
              <Box flex justifyContent="space-between" alignItems="center">
                <Text size="small" bold>
                  #{o.code}
                </Text>
                <Text size="xSmall" style={{ color: 'var(--info)' }}>
                  {ORDER_STATUS_LABEL[o.status] ?? o.status}
                </Text>
              </Box>
              <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 2 }}>
                {o.items?.length ?? 0} mặt hàng · {new Date(o.createdAt).toLocaleDateString('vi-VN')}
              </Text>
              <Text bold style={{ color: '#1f2a44', marginTop: 4 }}>
                {formatVnd(o.total)}
              </Text>
            </Box>
          ))}
        </Box>
      ) : (
        <Box style={{ textAlign: 'center', padding: '40px 0' }}>
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>
            Chưa có đơn đại lý nào.
          </Text>
        </Box>
      )}
    </Box>
  );
}

function DealerCredit() {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const ledgerQ = useQuery({ queryKey: ['dealer-credit'], queryFn: getCreditLedger });
  const [amount, setAmount] = useState('');

  const pay = useMutation({
    mutationFn: () => payCredit(Number(amount), 'Báo đã chuyển khoản'),
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: 'Đã ghi nhận thanh toán công nợ.', type: 'success' });
      setAmount('');
      void qc.invalidateQueries({ queryKey: ['dealer-credit'] });
      void qc.invalidateQueries({ queryKey: ['dealer-me'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const balance = ledgerQ.data?.balance ?? 0;

  return (
    <Box mx={4} style={{ paddingBottom: 24 }}>
      <Box p={4} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
        <Text size="small" style={{ color: 'var(--neutral-600)' }}>
          Dư nợ hiện tại
        </Text>
        <Text bold style={{ fontSize: 28, color: balance > 0 ? 'var(--danger)' : 'var(--leaf-700)' }}>
          {formatVnd(balance)}
        </Text>
        <Box flex style={{ gap: 8, marginTop: 12 }}>
          <Input
            type="number"
            placeholder="Số tiền đã chuyển"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Button
            disabled={Number(amount) <= 0 || Number(amount) > balance || pay.isPending}
            loading={pay.isPending}
            onClick={() => pay.mutate()}
            style={{ background: '#1f2a44', flex: '0 0 auto' }}
          >
            Báo đã CK
          </Button>
        </Box>
        {Number(amount) > balance && (
          <Text size="xSmall" style={{ color: 'var(--danger)', marginTop: 6 }}>
            ⚠ Số tiền vượt dư nợ hiện tại ({formatVnd(balance)}).
          </Text>
        )}
      </Box>

      <Text bold style={{ margin: '16px 0 8px' }}>
        Sổ công nợ
      </Text>
      {ledgerQ.data && ledgerQ.data.entries.length > 0 ? (
        <Box style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {ledgerQ.data.entries.map((e, i) => (
            <Box
              key={e.id}
              flex
              justifyContent="space-between"
              alignItems="center"
              p={3}
              style={{ borderTop: i === 0 ? 'none' : '1px solid var(--neutral-100)' }}
            >
              <Box>
                <Text size="small">{e.note ?? e.refType}</Text>
                <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                  {new Date(e.createdAt).toLocaleDateString('vi-VN')}
                </Text>
              </Box>
              <Text size="small" bold style={{ color: e.delta > 0 ? 'var(--danger)' : 'var(--leaf-700)' }}>
                {e.delta > 0 ? '+' : ''}
                {formatVnd(e.delta)}
              </Text>
            </Box>
          ))}
        </Box>
      ) : (
        <Text size="small" style={{ color: 'var(--neutral-400)' }}>
          Chưa có giao dịch công nợ.
        </Text>
      )}
    </Box>
  );
}

/** Báo cáo quý đại lý (#71) — doanh số quý + thưởng theo bậc. */
function DealerReport() {
  const q = useQuery({ queryKey: ['dealer-report'], queryFn: getQuarterlyReport });
  if (q.isLoading) {
    return (
      <Box mx={4} flex flexDirection="column" style={{ gap: 10 }}>
        <Skeleton style={{ height: 120, borderRadius: 12 }} />
        <Skeleton style={{ height: 80, borderRadius: 12 }} />
      </Box>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Box mx={4} p={6} style={{ textAlign: 'center' }}>
        <Text style={{ color: 'var(--danger)' }}>{getErrorMessage(q.error)}</Text>
      </Box>
    );
  }
  const d = q.data;
  const progress = d.nextTier
    ? Math.min(100, Math.round((d.revenue / d.nextTier.min) * 100))
    : 100;
  return (
    <Box mx={4} flex flexDirection="column" style={{ paddingBottom: 24, gap: 12 }}>
      {/* Card doanh số quý */}
      <Box p={4} style={{ background: 'linear-gradient(135deg, #1f2a44, #2e3b5e)', borderRadius: 'var(--radius-lg)', color: '#fff' }}>
        <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.7)' }}>
          Doanh số {d.quarter}
        </Text>
        <Text bold style={{ color: '#fff', fontSize: 26, marginTop: 2 }}>
          {formatVnd(d.revenue)}
        </Text>
        <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>
          {d.orderCount} đơn · Thưởng hiện tại {d.bonusPct}% = <b style={{ color: 'var(--leaf-400)' }}>{formatVnd(d.bonusAmount)}</b>
        </Text>
        {d.nextTier && (
          <Box style={{ marginTop: 12 }}>
            <Box style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 99, height: 8 }}>
              <Box style={{ width: `${progress}%`, height: 8, background: 'var(--leaf-400)', borderRadius: 99 }} />
            </Box>
            <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.85)', marginTop: 6 }}>
              Còn {formatVnd(d.nextTier.toNext)} để đạt thưởng {d.nextTier.pct}%
            </Text>
          </Box>
        )}
      </Box>

      {/* Bậc thưởng */}
      <Box p={4} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
        <Text size="small" bold style={{ marginBottom: 8 }}>
          Bậc thưởng doanh số quý
        </Text>
        {d.tiers.map((t) => {
          const reached = d.revenue >= t.min;
          return (
            <Box key={t.min} flex justifyContent="space-between" py={2} style={{ borderBottom: '1px solid var(--neutral-100)' }}>
              <Text size="small" style={{ color: reached ? 'var(--leaf-700)' : 'var(--neutral-600)' }}>
                {reached ? '✓ ' : ''}Từ {formatVnd(t.min)}
              </Text>
              <Text size="small" bold style={{ color: reached ? 'var(--leaf-700)' : 'var(--neutral-600)' }}>
                thưởng {t.pct}%
              </Text>
            </Box>
          );
        })}
        <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 8 }}>
          Thưởng tính trên tổng đơn đại lý (không tính đơn huỷ/trả) trong quý. Chốt cuối quý.
        </Text>
      </Box>
    </Box>
  );
}
