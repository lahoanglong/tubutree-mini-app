import { Box, Text, Button, Sheet, useSnackbar } from 'zmp-ui';
import { QrCode } from './qr-code';
import { shareLink } from '../services/zmp-bridge';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';

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
  const url = `${base}${path}${referralCode ? `?ref=${referralCode}` : ''}`;
  const captions = (
    captionsProp ?? [
      `Mình tuyển vài món sống xanh đang dùng, ghé xem nha 🌿 ${url}`,
      `Gian hàng sống xanh của mình đây 💚 ${url}`,
      `Đồ thiên nhiên lành cho da & nhẹ với đất 🌱 ${url}`,
    ]
  ).map((c) => (c.includes(url) ? c : `${c} ${url}`)); // luôn đảm bảo có link để dán
  const copy = async (t: string) => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(t);
      openSnackbar({ text: vi.storefront.copied, type: 'success' });
    } catch {
      // Quyền clipboard bị từ chối hoặc lỗi khác — báo cho user thay vì hiện toast thành công giả.
      openSnackbar({ text: vi.errors.generic, type: 'error' });
    }
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
            void shareLink({ title, description: captions[0] ?? '', thumbnail, path }).catch(() => {});
          }}
        >
          ↗ {vi.storefront.shareZalo}
        </Button>
        <Button fullWidth variant="secondary" style={{ marginBottom: 12 }} onClick={() => copy(url)}>
          📋 {vi.storefront.copyLink}
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
