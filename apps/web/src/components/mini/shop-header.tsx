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
  /**
   * Chỉ truyền true khi đặt trong `header` của `StoreLayout`: từ lg đầu shop xếp vào lưới của nó (gốc `contents`). Không truyền (mặc định)
   * thì không có lớp `lg:` nào và bố cục điện thoại giữ ở mọi khổ, nên dựng ngoài `StoreLayout` (vd xem trước gian hàng) không vỡ.
   */
  inStoreGrid?: boolean;
}

/** Cao bìa ở điện thoại. Lớp `h-[120px]` của bìa phải bằng số này (Tailwind chỉ nhận lớp viết nguyên văn; `shop-header.spec` giữ hai số khớp). */
export const SHOP_COVER_HEIGHT = 120;
/** ~2 dòng ở 375px; ngắn hơn thì không cần nút "Xem thêm". */
const NOTE_FOLD_CHARS = 90;

/** Lớp lg: của từng phần tử khi nằm trong lưới `StoreLayout` (xem `inStoreGrid`). */
const LG = {
  root: 'lg:contents',
  cover: 'lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:h-auto lg:min-h-[200px]',
  info: 'lg:col-start-2 lg:row-start-1 lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-start lg:gap-x-4 lg:gap-y-1 lg:px-6 lg:pb-2 lg:pt-6',
  avatarRow: 'lg:contents',
  avatar: 'lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:h-[72px] lg:w-[72px]',
  action: 'lg:col-start-3 lg:row-start-1 lg:pb-0',
  name: 'lg:col-start-2 lg:row-start-1 lg:mt-0',
  badges: 'lg:col-start-2 lg:row-start-2 lg:mt-0',
  note: 'lg:col-span-2 lg:col-start-2 lg:row-start-3 lg:mt-0',
} as const;

const CLAMP_2: CSSProperties = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };

/**
 * Đầu trang shop dùng chung cho gian hàng CTV và thương hiệu (critique-store 3.1): bìa phẳng, avatar 56px đè mép bìa, tên, huy hiệu,
 * nút hành động ở hàng avatar (không còn thanh dính đáy). Bìa/avatar/dấu tích chỉ trang trí; tên là h1.
 *
 * Với `inStoreGrid`, từ lg phần tử gốc là `contents`: bìa và khối thông tin thành hai ô của lưới do `StoreLayout` dựng (bìa bên trái, thông tin
 * bên phải, số liệu ngay dưới thông tin), avatar không còn đè mép bìa mà đứng đầu hàng tên. Phần khác nhau giữa điện thoại và lg nằm ở lớp
 * Tailwind (không ở style nội tuyến, vì style nội tuyến đè lớp `lg:`); các lớp `lg:` viết nguyên văn trong `LG` để Tailwind quét được.
 */
export function ShopHeader({ title, coverUrl, avatarUrl, verified, badges, action, note, inStoreGrid = false }: ShopHeaderProps) {
  const [open, setOpen] = useState(false);
  const noteId = useId();
  // Ngoặc kép quanh URL + mã hoá ký tự phá chuỗi (", \, xuống dòng) để URL lạ không thoát khỏi url().
  const background = coverUrl ? `url("${coverUrl.replace(/["\\\r\n]/g, encodeURIComponent)}") center/cover` : 'var(--color-bg-cover)';
  const long = (note ?? '').length > NOTE_FOLD_CHARS;
  const lg = (key: keyof typeof LG) => (inStoreGrid ? ` ${LG[key]}` : '');
  return (
    <div className={inStoreGrid ? LG.root : undefined} style={{ background: 'var(--color-bg-canvas)' }}>
      <div
        data-testid="shop-cover"
        aria-hidden="true"
        className={`h-[120px]${lg('cover')}`}
        style={{ background }}
      />
      <div className={`px-4${lg('info')}`}>
        <div className={`-mt-7 flex items-end justify-between gap-3${lg('avatarRow')}`}>
          <div className={`relative h-14 w-14 flex-none${lg('avatar')}`}>
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
          {action && <div className={`flex-none pb-0.5${lg('action')}`}>{action}</div>}
        </div>
        <div className={`mt-2 min-w-0${lg('name')}`}>
          <Heading variant="title-lg" as="h1" style={{ minWidth: 0, ...CLAMP_2 }}>
            {title}
          </Heading>
        </div>
        {badges && <div className={`mt-2 flex flex-wrap gap-1.5${lg('badges')}`}>{badges}</div>}
        {note && (
          <div id={noteId} className={`mt-2${lg('note')}`}>
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
