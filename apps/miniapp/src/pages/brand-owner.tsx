import { useState } from 'react';
import { Box, Page, Text, Button, Input, useSnackbar } from 'zmp-ui';
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
import { EmptyState } from '../components/ui/empty-state';
import { ImageUpload } from '../components/image-upload';
import { haptic } from '../utils/haptic';

export default function BrandOwnerPage() {
  const q = useQuery({ queryKey: ['owned-brand'], queryFn: getOwnedBrand, retry: false });

  if (q.isLoading) {
    return <Page className="page"><Box p={4}><Skeleton style={{ height: 140, borderRadius: 16 }} /></Box></Page>;
  }
  if (q.isError || !q.data) {
    const status = (q.error as { response?: { status?: number } })?.response?.status;
    return (
      <Page className="page" style={{ background: 'var(--neutral-50)' }}>
        <Box p={6}>
          <EmptyState
            art="sprout"
            heading="Quản lý nhãn hàng"
            body={status === 404 ? 'Bạn chưa được cấp quyền quản lý nhãn nào. Liên hệ Tubu để trở thành đối tác nhãn.' : getErrorMessage(q.error)}
          />
        </Box>
      </Page>
    );
  }
  return <Editor brand={q.data} />;
}

function Editor({ brand }: { brand: OwnedBrand }) {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const refresh = () => qc.invalidateQueries({ queryKey: ['owned-brand'] });

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
  const [promo, setPromo] = useState({ title: '', subtitle: '', startAt: '', endAt: '' });
  const resetPromoForm = () => { setEditingId(null); setPromo({ title: '', subtitle: '', startAt: '', endAt: '' }); };
  // startAt/endAt (yyyy-mm-dd từ input date) → ISO. endAt mặc định = startAt + 30 ngày
  // (KHÔNG phải now+30d — nếu chiến dịch bắt đầu >30 ngày sau thì endAt<startAt, KM không bao giờ hiện).
  const promoIso = () => {
    const startMs = promo.startAt ? new Date(promo.startAt).getTime() : Date.now();
    const endMs = promo.endAt ? new Date(promo.endAt).getTime() : startMs + 30 * 864e5;
    return {
      title: promo.title.trim(),
      subtitle: promo.subtitle.trim() || undefined,
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
    mutationFn: () => updateOwnedPromotion(editingId!, promoIso()),
    onSuccess: () => { resetPromoForm(); openSnackbar({ text: 'Đã cập nhật khuyến mãi', type: 'success' }); void refresh(); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const delPromo = useMutation({
    mutationFn: (id: string) => deleteOwnedPromotion(id),
    onSuccess: () => { if (editingId) resetPromoForm(); void refresh(); },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const startEdit = (p: OwnedBrand['promotions'][number]) => {
    setEditingId(p.id);
    setPromo({
      title: p.title,
      subtitle: p.subtitle ?? '',
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
      </Box>

      {/* Thông tin nhãn */}
      <Box mx={4} mb={3} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
        <Text bold size="small" style={{ marginBottom: 8 }}>Thông tin nhãn</Text>
        <Box mb={2}><ImageUpload label="Logo" value={f.logoUrl} onChange={(url) => setF({ ...f, logoUrl: url })} /></Box>
        <Box mb={2}><ImageUpload label="Ảnh bìa" value={f.coverUrl} onChange={(url) => setF({ ...f, coverUrl: url })} /></Box>
        <Box mb={2}><Input label="Tagline" value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} /></Box>
        <Box mb={2}><Input label="Nguồn gốc" value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} /></Box>
        <Box mb={2}><Input.TextArea label="Câu chuyện thương hiệu" value={f.story} onChange={(e) => setF({ ...f, story: e.target.value })} /></Box>
        <Button fullWidth style={{ background: 'var(--primary-600)' }} loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
          Lưu thông tin
        </Button>
      </Box>

      {/* Khuyến mãi */}
      <Box mx={4} mb={3} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
        <Text bold size="small" style={{ marginBottom: 8 }}>🎉 Khuyến mãi</Text>
        {brand.promotions.map((p) => (
          <Box key={p.id} flex alignItems="center" justifyContent="space-between" style={{ gap: 8, padding: '6px 0', borderBottom: '1px solid var(--neutral-100)' }}>
            <Box style={{ flex: 1 }}>
              <Text size="small">{p.title}</Text>
              {p.subtitle && <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>{p.subtitle}</Text>}
            </Box>
            <Box flex style={{ gap: 12 }}>
              <Text size="xSmall" className="tubu-press" style={{ color: 'var(--primary-600)' }} onClick={() => startEdit(p)}>Sửa</Text>
              <Text size="xSmall" className="tubu-press" style={{ color: 'var(--danger)' }} onClick={() => delPromo.mutate(p.id)}>Xoá</Text>
            </Box>
          </Box>
        ))}
        <Box mt={2} flex flexDirection="column" style={{ gap: 6 }}>
          <Input placeholder="Tiêu đề (MUA 2 TẶNG 1)" value={promo.title} onChange={(e) => setPromo({ ...promo, title: e.target.value })} />
          <Input placeholder="Mô tả" value={promo.subtitle} onChange={(e) => setPromo({ ...promo, subtitle: e.target.value })} />
          <Box flex style={{ gap: 6 }}>
            <input
              type="date"
              aria-label="Từ ngày"
              value={promo.startAt}
              onChange={(e) => setPromo({ ...promo, startAt: e.target.value })}
              style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid var(--neutral-200)' }}
            />
            <input
              type="date"
              aria-label="Đến ngày"
              value={promo.endAt}
              onChange={(e) => setPromo({ ...promo, endAt: e.target.value })}
              style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid var(--neutral-200)' }}
            />
          </Box>
          {editingId ? (
            <Box flex style={{ gap: 6 }}>
              <Button variant="secondary" style={{ flex: 1 }} disabled={!promo.title.trim()} loading={updPromo.isPending} onClick={() => updPromo.mutate()}>Lưu thay đổi</Button>
              <Button variant="tertiary" onClick={resetPromoForm}>Huỷ</Button>
            </Box>
          ) : (
            <Button variant="secondary" disabled={!promo.title.trim()} loading={addPromo.isPending} onClick={() => addPromo.mutate()}>+ Thêm khuyến mãi</Button>
          )}
        </Box>
      </Box>
    </Page>
  );
}
