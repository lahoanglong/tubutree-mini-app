'use client';

// Nguồn: apps/miniapp/src/components/ui/shop-header.tsx
import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { CheckCircle2, Sprout } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Heading, Text } from './text';

export interface ShopHeaderProps {
  /** Tên shop, h1 (Fraunces); tối đa 2 dòng. */
  title: string;
  /** Thiếu thì bìa phẳng `--color-bg-cover`. */
  coverUrl?: string | null;
  /** Thiếu thì nền chủ đạo + biểu tượng lá, một kiểu cho cả hai app. */
  avatarUrl?: string | null;
  /** Dấu tích ở góc avatar: gian hàng đã được Tubu Tree duyệt. */
  verified?: boolean;
  /** Hàng huy hiệu dưới tên. */
  badges?: ReactNode;
  /** Nút bên phải hàng avatar (Theo dõi của thương hiệu, Chia sẻ của chủ shop). */
  action?: ReactNode;
  /** Lời nhắn của shop / khẩu hiệu thương hiệu: cắt 2 dòng, "Xem thêm" mở hết. */
  note?: string | null;
}

export const SHOP_COVER_HEIGHT = 120;
const AVATAR = 56;
/** ~2 dòng ở 375px; ngắn hơn thì không cần nút "Xem thêm". */
const NOTE_FOLD_CHARS = 90;

const CLAMP_2: CSSProperties = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };

/**
 * Đầu trang shop dùng chung cho gian hàng CTV và thương hiệu (critique-store 3.1): bìa phẳng, avatar 56px đè mép bìa, tên, huy hiệu,
 * nút hành động ở hàng avatar (không còn thanh dính đáy). Bìa/avatar/dấu tích chỉ trang trí; tên là h1.
 */
export function ShopHeader({ title, coverUrl, avatarUrl, verified, badges, action, note }: ShopHeaderProps) {
  const [open, setOpen] = useState(false);
  const noteId = useId();
  // Ngoặc kép quanh URL + mã hoá ký tự phá chuỗi (", \, xuống dòng) để URL lạ không thoát khỏi url().
  const background = coverUrl ? `url("${coverUrl.replace(/["\\\r\n]/g, encodeURIComponent)}") center/cover` : 'var(--color-bg-cover)';
  const long = (note ?? '').length > NOTE_FOLD_CHARS;
  return (
    <div style={{ background: 'var(--color-bg-canvas)' }}>
      <div data-testid="shop-cover" aria-hidden="true" style={{ height: SHOP_COVER_HEIGHT, background }} />
      <div style={{ padding: '0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: -(AVATAR / 2) }}>
          <div style={{ position: 'relative', width: AVATAR, height: AVATAR, flex: '0 0 auto' }}>
            <div
              data-testid="shop-avatar"
              style={{
                width: '100%', height: '100%', borderRadius: '50%', background: 'var(--color-action-primary-bg)',
                border: '3px solid var(--color-bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              }}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <Sprout size={28} color="var(--color-text-inverse)" aria-hidden="true" />
              )}
            </div>
            {verified && (
              <span style={{ position: 'absolute', right: -4, bottom: -4, background: 'var(--color-bg-surface)', borderRadius: '50%', padding: 2, display: 'flex' }}>
                <CheckCircle2 size={20} color="var(--color-action-primary-bg)" role="img" aria-label="Đã được Tubu Tree duyệt" />
              </span>
            )}
          </div>
          {action && <div style={{ flex: '0 0 auto', paddingBottom: 2 }}>{action}</div>}
        </div>
        <Heading variant="title-lg" as="h1" style={{ marginTop: 8, minWidth: 0, ...CLAMP_2 }}>
          {title}
        </Heading>
        {badges && <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>{badges}</div>}
        {note && (
          <div id={noteId} style={{ marginTop: 8 }}>
            <Text data-testid="shop-note" variant="body-sm" tone="secondary" as="p" style={long && !open ? CLAMP_2 : undefined}>
              {note}
            </Text>
            {long && (
              <button
                type="button"
                className="tubu-press tubu-hit-44"
                aria-expanded={open}
                aria-controls={noteId}
                onClick={() => setOpen((v) => !v)}
                style={{ border: 'none', background: 'transparent', padding: 0, font: 'inherit', cursor: 'pointer', color: 'var(--color-text-brand)', fontSize: 'var(--type-label-size)', fontWeight: 600 }}
              >
                {open ? fillCopy('shop.noteLess') : fillCopy('shop.noteMore')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
