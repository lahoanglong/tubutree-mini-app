import { useCallback } from 'react';
import { useSnackbar } from 'zmp-ui';
import { Share2, Copy } from 'lucide-react';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { Text } from './ui/text';
import { QrCode } from './qr-code';
import { shareLink } from '../services/zmp-bridge';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { copyText } from '../utils/clipboard';
import { WEB_BASE_URL } from '../utils/web-base-url';

type ShareParams = Parameters<typeof shareLink>[0];

/** RESPONSE_CODE.USER_CANCEL của zmp-sdk: người dùng chủ động đóng hộp thoại, không phải lỗi. */
const ZMP_USER_CANCEL = -2003;

/**
 * Chia sẻ qua Zalo, không nuốt lỗi: API Zalo từ chối (chưa cấp quyền, webview cũ...) thì CTV bấm
 * nút mà không thấy gì xảy ra — mất cơ hội chia sẻ mà không biết vì sao.
 * Lỗi thì chép sẵn `fallbackText` (đã gồm liên kết có mã giới thiệu) vào clipboard và báo bằng
 * snackbar để họ dán gửi tay. Người dùng huỷ hộp thoại thì để yên: không ghi đè clipboard của họ.
 */
export function useShareWithFallback() {
  const { openSnackbar } = useSnackbar();
  return useCallback(
    async (params: ShareParams, fallbackText: string) => {
      try {
        await shareLink(params);
      } catch (err) {
        if ((err as { code?: number } | null)?.code === ZMP_USER_CANCEL) return;
        const copied = await copyText(fallbackText);
        openSnackbar(
          copied
            ? { text: vi.shareFallback.failedCopied, type: 'warning' }
            : { text: vi.shareFallback.failedManual, type: 'error' },
        );
      }
    },
    [openSnackbar],
  );
}

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
  const shareWithFallback = useShareWithFallback();
  const path = `/${pathPrefix}/${slug}`;
  // Mã giới thiệu PHẢI đi kèm ở CẢ 2 lối chia sẻ. Trước đây chỉ `url` (nút Sao chép link) có
  // `?ref=`, còn nút "Chia sẻ qua Zalo" gửi `path` trần → khách mở từ Zalo mua hàng thì CTV
  // KHÔNG được tính hoa hồng, mà không có dấu hiệu nào cho thấy điều đó.
  const sharePath = referralCode ? `${path}?ref=${referralCode}` : path;
  const url = `${WEB_BASE_URL}${sharePath}`;
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
    <BottomSheet open={visible} onClose={onClose} title={vi.storefront.shareTitle}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><QrCode value={url} /></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        <Button
          fullWidth
          icon={Share2}
          onPress={() => {
            haptic('light');
            void shareWithFallback({ title, description: captions[0] ?? '', thumbnail, path: sharePath }, url);
          }}
        >
          {vi.storefront.shareZalo}
        </Button>
        <Button fullWidth variant="secondary" icon={Copy} onPress={() => copy(url)}>
          {vi.storefront.copyLink}
        </Button>
      </div>
      <Text variant="label" as="div" style={{ marginBottom: 6 }}>{vi.storefront.captionHint}</Text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {captions.map((c, i) => (
          <button
            key={i}
            type="button"
            className="tubu-press"
            onClick={() => void copy(c)}
            style={{
              minHeight: 44,
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 12px',
              textAlign: 'left',
              border: 'none',
              cursor: 'pointer',
              background: 'var(--color-bg-subtle)',
              borderRadius: 'var(--radius-control)',
            }}
          >
            <Text variant="caption" tone="secondary">{c}</Text>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
