import { Box, Text, Button, Sheet, useSnackbar } from 'zmp-ui';
import { Share2, Copy } from 'lucide-react';
import { QrCode } from './qr-code';
import { shareLink } from '../services/zmp-bridge';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { copyText } from '../utils/clipboard';

export function ShareSheet({
  visible,
  onClose,
  slug,
  title,
  referralCode,
  thumbnail,
  pathPrefix = 's',
  captions: captionsProp,
}: {
  visible: boolean;
  onClose: () => void;
  slug: string;
  title: string;
  referralCode?: string | null;
  thumbnail?: string;
  /** 's' cho gian hàng CTV (/s/:slug), 'brand' cho trang nhãn (/brand/:slug). */
  pathPrefix?: 's' | 'brand';
  /** Caption tuỳ biến (vd brand share-to-earn). Mặc định bộ caption gian hàng CTV. */
  captions?: string[];
}) {
  const { openSnackbar } = useSnackbar();
  const base = (import.meta.env.VITE_WEB_BASE_URL as string | undefined) ?? 'https://shop.tubutree.com';
  const path = `/${pathPrefix}/${slug}`;
  // Mã giới thiệu PHẢI đi kèm ở CẢ 2 lối chia sẻ. Trước đây chỉ `url` (nút Sao chép link) có
  // `?ref=`, còn nút "Chia sẻ qua Zalo" gửi `path` trần → khách mở từ Zalo mua hàng thì CTV
  // KHÔNG được tính hoa hồng, mà không có dấu hiệu nào cho thấy điều đó.
  const sharePath = referralCode ? `${path}?ref=${referralCode}` : path;
  const url = `${base}${sharePath}`;
  const captions = (
    captionsProp ?? [
      `Mình tuyển vài món sống xanh đang dùng, ghé xem nha 🌿 ${url}`,
      `Gian hàng sống xanh của mình đây 💚 ${url}`,
      `Đồ thiên nhiên lành cho da & nhẹ với đất 🌱 ${url}`,
    ]
  ).map((c) => (c.includes(url) ? c : `${c} ${url}`)); // luôn đảm bảo có link để dán
  const copy = async (t: string) => {
    const ok = await copyText(t);
    openSnackbar(
      ok
        ? { text: vi.storefront.copied, type: 'success' }
        : { text: 'Không sao chép được — hãy chọn và chép thủ công.', type: 'error' },
    );
  };
  return (
    <Sheet visible={visible} onClose={onClose} autoHeight>
      <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
        <Text bold size="large" style={{ marginBottom: 12 }}>{vi.storefront.shareTitle}</Text>
        <Box flex justifyContent="center" mb={3}><QrCode value={url} /></Box>
        <Button
          fullWidth
          style={{ background: 'var(--primary-600)', marginBottom: 8 }}
          onClick={() => {
            haptic('light');
            void shareLink({ title, description: captions[0] ?? '', thumbnail, path: sharePath }).catch(() => {});
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Share2 size={16} />
            {vi.storefront.shareZalo}
          </span>
        </Button>
        <Button fullWidth variant="secondary" style={{ marginBottom: 12 }} onClick={() => copy(url)}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Copy size={16} />
            {vi.storefront.copyLink}
          </span>
        </Button>
        <Text size="xSmall" bold style={{ marginBottom: 6 }}>{vi.storefront.captionHint}</Text>
        {captions.map((c, i) => (
          <Box
            key={i}
            className="tubu-press"
            onClick={() => copy(c)}
            p={2}
            style={{ background: 'var(--neutral-50)', borderRadius: 'var(--radius-sm)', marginBottom: 6 }}
          >
            <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>{c}</Text>
          </Box>
        ))}
      </Box>
    </Sheet>
  );
}
