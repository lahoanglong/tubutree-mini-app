import { useState, type ReactNode } from 'react';
import { Page, Input, useSnackbar, useNavigate } from 'zmp-ui';
import { Check, Gift, Plus } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOwnedBrand,
  updateOwnedBrand,
  createOwnedPromotion,
  updateOwnedPromotion,
  deleteOwnedPromotion,
  type OwnedBrand,
} from '../services/brand-owner-api';
import { getErrorMessage } from '../services/api';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Button } from '../components/ui/button';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { PageHeader } from '../components/ui/page-header';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Icon } from '../components/ui/icon';
import { Field } from '../components/ui/form';
import { Text, Heading } from '../components/ui/text';
import { ImageUpload } from '../components/image-upload';
import { haptic } from '../utils/haptic';
import { BrandSalesTab } from './brand-owner-sales';

const PAGE_TITLE = 'Quản lý nhãn hàng';

function OwnerShell({ children, paddingBottom = 0 }: { children: ReactNode; paddingBottom?: number }) {
  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom }}>
      <PageHeader title={PAGE_TITLE} />
      {children}
    </Page>
  );
}

export default function BrandOwnerPage() {
  const q = useQuery({ queryKey: ['owned-brand'], queryFn: getOwnedBrand, retry: false });

  if (q.isLoading) {
    return (
      <OwnerShell>
        <div style={{ padding: 16 }}>
          <Skeleton style={{ height: 140, borderRadius: 'var(--radius-card)' }} />
        </div>
      </OwnerShell>
    );
  }
  if (q.isError || !q.data) {
    const status = (q.error as { response?: { status?: number } })?.response?.status;
    return (
      <OwnerShell>
        {status === 404 ? (
          <div style={{ padding: 24 }}>
            <EmptyState
              art="sprout"
              heading="Quản lý nhãn hàng"
              body="Bạn chưa được cấp quyền quản lý nhãn nào. Liên hệ Tubu để trở thành đối tác nhãn."
            />
          </div>
        ) : (
          <ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />
        )}
      </OwnerShell>
    );
  }
  return <Editor brand={q.data} />;
}

type OwnerTab = 'profile' | 'sales';
const OWNER_TABS = [
  { key: 'profile', label: 'Hồ sơ & khuyến mãi' },
  { key: 'sales', label: 'Doanh thu' },
];

function Editor({ brand }: { brand: OwnedBrand }) {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const refresh = () => qc.invalidateQueries({ queryKey: ['owned-brand'] });
  const [tab, setTab] = useState<OwnerTab>('profile');

  const [f, setF] = useState({
    logoUrl: brand.logoUrl ?? '',
    coverUrl: brand.coverUrl ?? '',
    tagline: brand.tagline ?? '',
    origin: brand.origin ?? '',
    story: brand.story ?? '',
  });
  const saveMut = useMutation({
    mutationFn: () => updateOwnedBrand(f),
    onSuccess: () => { haptic('medium'); openSnackbar({ text: 'Đã lưu thông tin nhãn', type: 'success' }); void refresh(); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [promo, setPromo] = useState({ title: '', subtitle: '', couponCode: '', startAt: '', endAt: '' });
  const resetPromoForm = () => { setEditingId(null); setPromo({ title: '', subtitle: '', couponCode: '', startAt: '', endAt: '' }); };
  // Chặn khi CẢ HAI ngày được nhập và endAt < startAt — không tự hoán đổi, chỉ chặn submit +
  // báo lỗi (an toàn hơn tự sửa hộ dữ liệu người dùng nhập). Khi CHỈ có endAt (startAt để trống),
  // promoIso() mặc định startMs = Date.now() nên phải so endAt với hiện tại — nếu không, endAt là
  // ngày quá khứ vẫn lọt qua vì !!promo.startAt là false, tạo ra khuyến mãi chết ngay khi lưu.
  const dateRangeInvalid =
    (!!promo.startAt && !!promo.endAt && new Date(promo.endAt).getTime() < new Date(promo.startAt).getTime()) ||
    (!promo.startAt && !!promo.endAt && new Date(promo.endAt).getTime() < Date.now());
  // startAt/endAt (yyyy-mm-dd từ input date) → ISO. endAt mặc định = startAt + 30 ngày
  // (KHÔNG phải now+30d — nếu chiến dịch bắt đầu >30 ngày sau thì endAt<startAt, KM không bao giờ hiện).
  const promoIso = () => {
    const startMs = promo.startAt ? new Date(promo.startAt).getTime() : Date.now();
    const endMs = promo.endAt ? new Date(promo.endAt).getTime() : startMs + 30 * 864e5;
    return {
      title: promo.title.trim(),
      subtitle: promo.subtitle.trim() || undefined,
      couponCode: promo.couponCode.trim().toUpperCase() || undefined,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
    };
  };
  const addPromo = useMutation({
    mutationFn: () => createOwnedPromotion(promoIso()),
    onSuccess: () => { resetPromoForm(); openSnackbar({ text: 'Đã thêm khuyến mãi', type: 'success' }); void refresh(); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const updPromo = useMutation({
    // Khi sửa, ô mã trống nghĩa là GỠ mã (chuỗi rỗng) — `undefined` bị bỏ qua nên mã cũ sẽ ở lại.
    mutationFn: () => updateOwnedPromotion(editingId!, { ...promoIso(), couponCode: promo.couponCode.trim().toUpperCase() }),
    onSuccess: () => { resetPromoForm(); openSnackbar({ text: 'Đã cập nhật khuyến mãi', type: 'success' }); void refresh(); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const delPromo = useMutation({
    mutationFn: (id: string) => deleteOwnedPromotion(id),
    // So khớp đúng promo VỪA XOÁ (biến mutate) với promo đang sửa dở — không phải "có đang sửa gì đó
    // hay không" — kẻo xoá promo B trong lúc đang sửa dở promo A lại làm mất luôn form đang sửa của A.
    onSuccess: (_data, deletedId) => { if (editingId === deletedId) resetPromoForm(); setConfirmDeleteId(null); void refresh(); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const startEdit = (p: OwnedBrand['promotions'][number]) => {
    setEditingId(p.id);
    setPromo({
      title: p.title,
      subtitle: p.subtitle ?? '',
      couponCode: p.couponCode ?? '',
      startAt: p.startAt ? new Date(p.startAt).toISOString().slice(0, 10) : '',
      endAt: p.endAt ? new Date(p.endAt).toISOString().slice(0, 10) : '',
    });
  };

  const dateInputStyle = {
    flex: 1,
    minHeight: 44,
    padding: 8,
    borderRadius: 'var(--radius-control)',
    border: '1px solid var(--color-border-default)',
  } as const;

  return (
    <OwnerShell paddingBottom={96}>
      <div style={{ padding: 16 }}>
        <Heading variant="title-md" as="h2">{brand.name}</Heading>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 }}>
          {brand.isVerified ? (
            <Badge tone="success" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <Icon icon={Check} size="sm" tone="brand" />
              Chính hãng
            </Badge>
          ) : (
            <Badge>Chưa xác minh</Badge>
          )}
          <Badge tone={brand.isPublished ? 'success' : 'warning'}>
            {brand.isPublished ? 'Đang hiển thị' : 'Nháp (admin duyệt)'}
          </Badge>
          <Text variant="caption" tone="tertiary">{brand.followerCount} theo dõi</Text>
        </div>
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>
          Bạn sửa được thông tin & khuyến mãi. Tên nhãn, chứng nhận, đăng/ẩn do Tubu duyệt.
        </Text>
        {/* Sửa logo/ảnh bìa/câu chuyện mà không xem được kết quả thì chỉ đoán — trang nhãn
            công khai đã có sẵn ở /brand/:slug, chỉ thiếu lối sang. */}
        <Button
          variant="secondary"
          style={{ marginTop: 10 }}
          onPress={() => {
            if (!brand.isPublished) {
              openSnackbar({ text: 'Nhãn đang là nháp — Tubu duyệt xong khách mới xem được.', type: 'warning' });
              return;
            }
            navigate(`/brand/${brand.slug}`);
          }}
        >
          Xem trang nhãn
        </Button>
      </div>

      <div style={{ padding: '0 16px', marginBottom: 12 }}>
        <SegmentedTabs items={OWNER_TABS} value={tab} onChange={(k) => setTab(k as OwnerTab)} />
      </div>

      {tab === 'sales' && <BrandSalesTab />}

      {tab === 'profile' && (
        <>
          {/* Thông tin nhãn */}
          <Card style={{ margin: '0 16px 12px' }}>
            <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>Thông tin nhãn</Heading>
            <div style={{ marginBottom: 8 }}><ImageUpload label="Logo" value={f.logoUrl} onChange={(url) => setF({ ...f, logoUrl: url })} /></div>
            <div style={{ marginBottom: 8 }}><ImageUpload label="Ảnh bìa" value={f.coverUrl} onChange={(url) => setF({ ...f, coverUrl: url })} /></div>
            <div style={{ marginBottom: 8 }}>
              <Field label="Tagline"><Input value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} /></Field>
            </div>
            <div style={{ marginBottom: 8 }}>
              <Field label="Nguồn gốc"><Input value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} /></Field>
            </div>
            <div style={{ marginBottom: 8 }}>
              <Field label="Câu chuyện thương hiệu"><Input.TextArea value={f.story} onChange={(e) => setF({ ...f, story: e.target.value })} /></Field>
            </div>
            <Button fullWidth loading={saveMut.isPending} onPress={() => saveMut.mutate()}>
              Lưu thông tin
            </Button>
          </Card>

          {/* Khuyến mãi */}
          <Card style={{ margin: '0 16px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Icon icon={Gift} size="sm" tone="brand" />
              <Heading variant="title-sm" as="h2">Khuyến mãi</Heading>
            </div>
            {brand.promotions.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="body-sm" as="div">{p.title}</Text>
                  {p.subtitle && <Text variant="caption" tone="secondary" as="div">{p.subtitle}</Text>}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button variant="ghost" onPress={() => startEdit(p)}>Sửa</Button>
                  <Button variant="ghost" style={{ color: 'var(--color-text-danger)' }} onPress={() => setConfirmDeleteId(p.id)}>Xoá</Button>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Input aria-label="Tiêu đề (MUA 2 TẶNG 1)" placeholder="Tiêu đề (MUA 2 TẶNG 1)" value={promo.title} onChange={(e) => setPromo({ ...promo, title: e.target.value })} />
              <Input aria-label="Mô tả" placeholder="Mô tả" value={promo.subtitle} onChange={(e) => setPromo({ ...promo, subtitle: e.target.value })} />
              {/* Không có mã thì banner chỉ là lời quảng cáo: khách đọc "MUA 2 TẶNG 1" rồi không
                  biết làm gì tiếp. Máy chủ chỉ nhận mã có thật, công khai và còn hạn. */}
              <Input
                aria-label="Mã giảm giá (tuỳ chọn) — VD: TUBU20"
                placeholder="Mã giảm giá (tuỳ chọn) — VD: TUBU20"
                value={promo.couponCode}
                onChange={(e) => setPromo({ ...promo, couponCode: e.target.value.toUpperCase() })}
              />
              <Text variant="caption" tone="tertiary" as="div">
                Có mã thì khách chạm để sao chép ngay trên trang nhãn. Mã giảm giá phải do Tubu tạo sẵn, công khai
                và còn hạn — mã không có trong hệ thống sẽ bị từ chối khi lưu. Để trống ô này khi sửa để gỡ mã.
              </Text>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="date"
                  aria-label="Từ ngày"
                  value={promo.startAt}
                  onChange={(e) => setPromo({ ...promo, startAt: e.target.value })}
                  style={dateInputStyle}
                />
                <input
                  type="date"
                  aria-label="Đến ngày"
                  value={promo.endAt}
                  onChange={(e) => setPromo({ ...promo, endAt: e.target.value })}
                  style={dateInputStyle}
                />
              </div>
              {dateRangeInvalid && (
                <Text variant="caption" tone="danger" as="div">Ngày kết thúc phải sau ngày bắt đầu.</Text>
              )}
              {editingId ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button variant="secondary" style={{ flex: 1 }} disabled={!promo.title.trim() || dateRangeInvalid} loading={updPromo.isPending} onPress={() => updPromo.mutate()}>Lưu thay đổi</Button>
                  <Button variant="ghost" onPress={resetPromoForm}>Huỷ</Button>
                </div>
              ) : (
                <Button variant="secondary" icon={Plus} disabled={!promo.title.trim() || dateRangeInvalid} loading={addPromo.isPending} onPress={() => addPromo.mutate()}>Thêm khuyến mãi</Button>
              )}
            </div>
          </Card>
        </>
      )}

      {/* Xác nhận xoá khuyến mãi (thao tác không hoàn tác) */}
      <BottomSheet open={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)} title="Xoá khuyến mãi này?">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          <Button fullWidth variant="secondary" onPress={() => setConfirmDeleteId(null)}>
            Huỷ
          </Button>
          <Button
            fullWidth
            variant="danger"
            loading={delPromo.isPending}
            onPress={() => delPromo.mutate(confirmDeleteId!)}
          >
            Xoá
          </Button>
        </div>
      </BottomSheet>
    </OwnerShell>
  );
}
