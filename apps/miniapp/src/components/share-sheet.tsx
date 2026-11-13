import { useCallback, useRef, useState } from 'react';
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
import { miniAppLink } from '../utils/miniapp-link';
import { usePublicConfig } from '../hooks/use-public-config';
import { shareDescription, welcomeOfferOf } from '@tubutree/app-core/commerce/share-offer';

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

/**
 * Một việc chia sẻ/sao chép chạy tại một thời điểm: bấm thêm lúc đang chạy bị bỏ qua, khỏi gọi lặp
 * hộp thoại chia sẻ hay clipboard. Ref chặn hai cú chạm sát nhau trước khi state kịp vẽ lại; `active` là
 * loại việc đang chạy để nút đúng loại báo bận. Nút báo khoá bằng `aria-disabled`, không dùng `disabled` thật:
 * nút đang giữ focus mà `disabled` thì Chromium thả focus về body.
 */
export function useActionLock() {
  const lockRef = useRef(false);
  const [active, setActive] = useState<string | null>(null);
  const run = useCallback(async (kind: string, task: () => Promise<unknown>) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setActive(kind);
    try {
      await task();
    } finally {
      lockRef.current = false;
      setActive(null);
    }
  }, []);
  return { busy: active !== null, active, run };
}

export function ShareSheet({
  visible,
  onClose,
  slug,
  title,
  heading,
  basePath,
  referralCode,
  thumbnail,
  pathPrefix = 's',
  captions: captionsProp,
}: {
  visible: boolean;
  onClose: () => void;
  /** Bắt buộc khi không truyền `basePath`. */
  slug?: string;
  title: string;
  /** Tiêu đề bảng; mặc định "Chia sẻ gian hàng". */
  heading?: string;
  /** Đường dẫn Mini App chia sẻ thẳng (vd '/' cho trang chủ kèm mã giới thiệu), thay cho `/${pathPrefix}/${slug}`. */
  basePath?: string;
  referralCode?: string | null;
  thumbnail?: string;
  /** 's' cho gian hàng CTV (/s/:slug), 'brand' cho trang nhãn (/brand/:slug). */
  pathPrefix?: 's' | 'brand';
  /** Caption tuỳ biến (vd brand share-to-earn). Mặc định bộ caption gian hàng CTV. */
  captions?: string[];
}) {
  const { openSnackbar } = useSnackbar();
  const shareWithFallback = useShareWithFallback();
  const welcomeOffer = welcomeOfferOf(usePublicConfig());
  const path = basePath ?? `/${pathPrefix}/${slug}`;
  // Mã giới thiệu PHẢI đi kèm ở CẢ 2 lối chia sẻ. Trước đây chỉ `url` (nút Sao chép link) có
  // `?ref=`, còn nút "Chia sẻ qua Zalo" gửi `path` trần → khách mở từ Zalo mua hàng thì CTV
  // KHÔNG được tính hoa hồng, mà không có dấu hiệu nào cho thấy điều đó.
  const sharePath = referralCode ? `${path}?ref=${referralCode}` : path;
  // Link Mini App (không phải web): người nhận trong Zalo ở lại Mini App, không phải đăng nhập lại.
  const url = miniAppLink(sharePath);
  const captions = (
    captionsProp ?? [
      `Mình tuyển vài món sống xanh đang dùng, ghé xem nha 🌿 ${url}`,
      `Gian hàng sống xanh của mình đây 💚 ${url}`,
      `Đồ thiên nhiên lành cho da & nhẹ với đất 🌱 ${url}`,
    ]
  ).map((c) => (c.includes(url) ? c : `${c} ${url}`)); // luôn đảm bảo có link để dán
  const lock = useActionLock();
  const copy = (t: string) =>
    lock.run('copy', async () => {
      const ok = await copyText(t);
      openSnackbar(
        ok
          ? { text: vi.storefront.copied, type: 'success' }
          : { text: 'Không sao chép được — hãy chọn và chép thủ công.', type: 'error' },
      );
    });
  return (
    <BottomSheet open={visible} onClose={onClose} title={heading ?? vi.storefront.shareTitle}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><QrCode value={url} /></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        <Button
          fullWidth
          icon={Share2}
          loading={lock.active === 'share'}
          aria-disabled={lock.busy || undefined}
          onPress={() => {
            void lock.run('share', async () => {
              haptic('light');
              await shareWithFallback({ title, description: shareDescription(captions[0], welcomeOffer), thumbnail, path: sharePath }, url);
            });
          }}
        >
          {vi.storefront.shareZalo}
        </Button>
        <Button fullWidth variant="secondary" icon={Copy} aria-disabled={lock.busy || undefined} onPress={() => copy(url)}>
          {vi.storefront.copyLink}
        </Button>
      </div>
      <section aria-label={vi.storefront.captionHint}>
        <Text variant="label" as="div" style={{ marginBottom: 6 }}>{vi.storefront.captionHint}</Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {captions.map((c, i) => (
            <button
              key={i}
              type="button"
              className="tubu-press"
              aria-disabled={lock.busy || undefined}
              onClick={() => void copy(c)}
              style={{
                minHeight: 44,
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 12px',
                textAlign: 'left',
                border: 'none',
                cursor: 'pointer',
                opacity: lock.busy ? 0.6 : undefined,
                background: 'var(--color-bg-subtle)',
                borderRadius: 'var(--radius-control)',
              }}
            >
              <Text variant="caption" tone="secondary">{c}</Text>
            </button>
          ))}
        </div>
      </section>
    </BottomSheet>
  );
}
