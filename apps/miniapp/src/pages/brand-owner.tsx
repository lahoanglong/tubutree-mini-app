import { useState } from 'react';
import { Box, Page, Text, Input, Sheet, useSnackbar, useNavigate } from 'zmp-ui';
import { Gift } from 'lucide-react';
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
import { ImageUpload } from '../components/image-upload';
import { haptic } from '../utils/haptic';
import { BrandSalesTab } from './brand-owner-sales';

export default function BrandOwnerPage() {
  const q = useQuery({ queryKey: ['owned-brand'], queryFn: getOwnedBrand, retry: false });

  if (q.isLoading) {
    return <Page className="page"><Box p={4}><Skeleton style={{ height: 140, borderRadius: 16 }} /></Box></Page>;
  }
  if (q.isError || !q.data) {
    const status = (q.error as { response?: { status?: number } })?.response?.status;
    return (
      <Page className="page" style={{ background: 'var(--neutral-50)' }}>
        {status === 404 ? (
          <Box p={6}>
            <EmptyState
              art="sprout"
              heading="Quản lý nhãn hàng"
              body="Bạn chưa được cấp quyền quản lý nhãn nào. Liên hệ Tubu để trở thành đối tác nhãn."
            />
          </Box>
        ) : (
          <ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />
        )}
      </Page>
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

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 96 }}>
      <Box p={4}>
        <Text bold size="large">{brand.name}</Text>
        <Box flex style={{ gap: 6, marginTop: 4 }}>
          <Text size="xSmall" style={{ color: brand.isVerified ? 'var(--leaf-700)' : 'var(--neutral-400)' }}>
            {brand.isVerified ? '✓ Chính hãng' : 'Chưa xác minh'}
          </Text>
          <Text size="xSmall" style={{ color: brand.isPublished ? 'var(--leaf-700)' : 'var(--neutral-400)' }}>
            · {brand.isPublished ? 'Đang hiển thị' : 'Nháp (admin duyệt)'}
          </Text>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>· {brand.followerCount} theo dõi</Text>
        </Box>
        <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 2 }}>
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
      </Box>

      <Box px={4} mb={3}>
        <SegmentedTabs items={OWNER_TABS} value={tab} onChange={(k) => setTab(k as OwnerTab)} />
      </Box>

      {tab === 'sales' && <BrandSalesTab />}

      {tab === 'profile' && (
        <>
          {/* Thông tin nhãn */}
          <Box mx={4} mb={3} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
            <Text bold size="small" style={{ marginBottom: 8 }}>Thông tin nhãn</Text>
            <Box mb={2}><ImageUpload label="Logo" value={f.logoUrl} onChange={(url) => setF({ ...f, logoUrl: url })} /></Box>
            <Box mb={2}><ImageUpload label="Ảnh bìa" value={f.coverUrl} onChange={(url) => setF({ ...f, coverUrl: url })} /></Box>
            <Box mb={2}><Input label="Tagline" value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} /></Box>
            <Box mb={2}><Input label="Nguồn gốc" value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} /></Box>
            <Box mb={2}><Input.TextArea label="Câu chuyện thương hiệu" value={f.story} onChange={(e) => setF({ ...f, story: e.target.value })} /></Box>
            <Button fullWidth loading={saveMut.isPending} onPress={() => saveMut.mutate()}>
              Lưu thông tin
            </Button>
          </Box>

          {/* Khuyến mãi */}
          <Box mx={4} mb={3} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
            <Box flex alignItems="center" style={{ gap: 6, marginBottom: 8 }}>
              <Gift size={16} color="var(--primary-700)" />
              <Text bold size="small">Khuyến mãi</Text>
            </Box>
            {brand.promotions.map((p) => (
              <Box key={p.id} flex alignItems="center" justifyContent="space-between" style={{ gap: 8, padding: '6px 0', borderBottom: '1px solid var(--neutral-100)' }}>
                <Box style={{ flex: 1 }}>
                  <Text size="small">{p.title}</Text>
                  {p.subtitle && <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>{p.subtitle}</Text>}
                </Box>
                <Box flex style={{ gap: 4 }}>
                  <Button variant="ghost" onPress={() => startEdit(p)}>Sửa</Button>
                  <Button variant="ghost" style={{ color: 'var(--color-text-danger)' }} onPress={() => setConfirmDeleteId(p.id)}>Xoá</Button>
                </Box>
              </Box>
            ))}
            <Box mt={2} flex flexDirection="column" style={{ gap: 6 }}>
              <Input placeholder="Tiêu đề (MUA 2 TẶNG 1)" value={promo.title} onChange={(e) => setPromo({ ...promo, title: e.target.value })} />
              <Input placeholder="Mô tả" value={promo.subtitle} onChange={(e) => setPromo({ ...promo, subtitle: e.target.value })} />
              {/* Không có mã thì banner chỉ là lời quảng cáo: khách đọc "MUA 2 TẶNG 1" rồi không
                  biết làm gì tiếp. Máy chủ chỉ nhận mã có thật, công khai và còn hạn. */}
              <Input
                placeholder="Mã giảm giá (tuỳ chọn) — VD: TUBU20"
                value={promo.couponCode}
                onChange={(e) => setPromo({ ...promo, couponCode: e.target.value.toUpperCase() })}
              />
              <Text size="xxxxSmall" style={{ color: 'var(--neutral-400)' }}>
                Có mã thì khách chạm để sao chép ngay trên trang nhãn. Mã giảm giá phải do Tubu tạo sẵn, công khai
                và còn hạn — mã không có trong hệ thống sẽ bị từ chối khi lưu. Để trống ô này khi sửa để gỡ mã.
              </Text>
              <Box flex style={{ gap: 6 }}>
                <input
                  type="date"
                  aria-label="Từ ngày"
                  value={promo.startAt}
                  onChange={(e) => setPromo({ ...promo, startAt: e.target.value })}
                  style={{ flex: 1, minHeight: 44, padding: 8, borderRadius: 8, border: '1px solid var(--neutral-200)' }}
                />
                <input
                  type="date"
                  aria-label="Đến ngày"
                  value={promo.endAt}
                  onChange={(e) => setPromo({ ...promo, endAt: e.target.value })}
                  style={{ flex: 1, minHeight: 44, padding: 8, borderRadius: 8, border: '1px solid var(--neutral-200)' }}
                />
              </Box>
              {dateRangeInvalid && (
                <Text size="xSmall" style={{ color: 'var(--danger)' }}>Ngày kết thúc phải sau ngày bắt đầu.</Text>
              )}
              {editingId ? (
                <Box flex style={{ gap: 6 }}>
                  <Button variant="secondary" style={{ flex: 1 }} disabled={!promo.title.trim() || dateRangeInvalid} loading={updPromo.isPending} onPress={() => updPromo.mutate()}>Lưu thay đổi</Button>
                  <Button variant="ghost" onPress={resetPromoForm}>Huỷ</Button>
                </Box>
              ) : (
                <Button variant="secondary" disabled={!promo.title.trim() || dateRangeInvalid} loading={addPromo.isPending} onPress={() => addPromo.mutate()}>+ Thêm khuyến mãi</Button>
              )}
            </Box>
          </Box>
        </>
      )}

      {/* Xác nhận xoá khuyến mãi (thao tác không hoàn tác) */}
      <Sheet visible={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)} autoHeight>
        <Box p={5} style={{ textAlign: 'center' }}>
          <Text.Title size="small">Xoá khuyến mãi này?</Text.Title>
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
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
          </Box>
        </Box>
      </Sheet>
    </Page>
  );
}
