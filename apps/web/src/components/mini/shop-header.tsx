'use client';

// Nguồn: apps/miniapp/src/components/ui/shop-header.tsx
import { useId, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { CheckCircle2, Sprout } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useSizedImage } from '@/lib/image-src';
import { SHOP_AVATAR_SIZES, SHOP_COVER_SIZES } from '@/lib/image-sizes';
import { Heading, Text } from './text';

export interface ShopHeaderProps {
  /** Tên shop (Fraunces); tối đa 2 dòng. */
  title: string;
  /** Thẻ của tên shop, mặc định `h1`. Đầu xem trước trong trình dựng truyền `h2` vì trang đã có tiêu đề riêng. */
  titleAs?: ElementType;
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
   * Chỉ truyền true khi đặt trong `header` của `StoreLayout`: từ md đầu shop xếp vào lưới của nó (gốc `contents`). Không truyền (mặc định)
   * thì không có lớp `md:` nào và bố cục điện thoại giữ ở mọi khổ, nên dựng ngoài `StoreLayout` (vd xem trước gian hàng) không vỡ.
   */
  inStoreGrid?: boolean;
  /**
   * Nguồn ảnh. `storefront` (mặc định): ảnh do CTV dán, chỉ ảnh Cloudinary/của API có trong danh sách của /img nên chỉ ảnh đó đi qua bộ đổi cỡ.
   * `brand`: ảnh thương hiệu do admin nhập, mọi URL https đều có trong danh sách.
   */
  imageSource?: 'storefront' | 'brand';
}

/** Cao bìa ở điện thoại. Lớp `h-[120px]` của bìa phải bằng số này (Tailwind chỉ nhận lớp viết nguyên văn; `shop-header.spec` giữ hai số khớp). */
export const SHOP_COVER_HEIGHT = 120;
/** ~2 dòng ở 375px; ngắn hơn thì không cần nút "Xem thêm". */
const NOTE_FOLD_CHARS = 90;

/** Lớp md: của từng phần tử khi nằm trong lưới `StoreLayout` (xem `inStoreGrid`). */
const LG = {
  root: 'md:contents',
  cover: 'md:col-start-1 md:row-span-2 md:row-start-1 md:h-auto md:min-h-[200px]',
  info: 'md:col-start-2 md:row-start-1 md:grid md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-start md:gap-x-4 md:gap-y-1 md:px-6 md:pb-2 md:pt-6',
  avatarRow: 'md:contents',
  avatar: 'md:col-start-1 md:row-span-3 md:row-start-1 md:h-[72px] md:w-[72px]',
  action: 'md:col-start-3 md:row-start-1 md:pb-0',
  name: 'md:col-start-2 md:row-start-1 md:mt-0',
  badges: 'md:col-start-2 md:row-start-2 md:mt-0',
  note: 'md:col-span-2 md:col-start-2 md:row-start-3 md:mt-0',
} as const;

/** Bìa: điện thoại tràn 100vw (cao 120px); từ md là ô trái 5/12 của khung 1200px (store-layout) ~500px. */
const COVER_SIZES = SHOP_COVER_SIZES;
/** Avatar: 56px, từ md 72px (`LG.avatar`). */
const AVATAR_SIZES = SHOP_AVATAR_SIZES;

const CLAMP_2: CSSProperties = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };

/**
 * Đầu trang shop dùng chung cho gian hàng CTV và thương hiệu (critique-store 3.1): bìa phẳng, avatar 56px đè mép bìa, tên, huy hiệu,
 * nút hành động ở hàng avatar (không còn thanh dính đáy). Bìa/avatar/dấu tích chỉ trang trí; tên là h1.
 *
 * Với `inStoreGrid`, từ md phần tử gốc là `contents`: bìa và khối thông tin thành hai ô của lưới do `StoreLayout` dựng (bìa bên trái, thông tin
 * bên phải, số liệu ngay dưới thông tin), avatar không còn đè mép bìa mà đứng đầu hàng tên. Phần khác nhau giữa điện thoại và md nằm ở lớp
 * Tailwind (không ở style nội tuyến, vì style nội tuyến đè lớp `md:`); các lớp `md:` viết nguyên văn trong `LG` để Tailwind quét được.
 */
export function ShopHeader({ title, titleAs = 'h1', coverUrl, avatarUrl, verified, badges, action, note, inStoreGrid = false, imageSource = 'storefront' }: ShopHeaderProps) {
  const [open, setOpen] = useState(false);
  const noteId = useId();
  const cover = useSizedImage(coverUrl, 960, COVER_SIZES, false, imageSource === 'storefront');
  const avatar = useSizedImage(avatarUrl, 72, AVATAR_SIZES, false, imageSource === 'storefront');
  const long = (note ?? '').length > NOTE_FOLD_CHARS;
  const lg = (key: keyof typeof LG) => (inStoreGrid ? ` ${LG[key]}` : '');
  return (
    <div className={inStoreGrid ? LG.root : undefined} style={{ background: 'var(--color-bg-canvas)' }}>
      <div
        data-testid="shop-cover"
        aria-hidden="true"
        className={`h-[120px]${lg('cover')}`}
        style={{ position: 'relative', overflow: 'hidden', background: 'var(--color-bg-cover)' }}
      >
        {/* Thẻ img thay cho nền CSS: nền CSS không có srcset, `fetchpriority`, và trình duyệt chỉ thấy nó sau khi tải CSS. Bìa là ảnh to nhất màn đầu của shop nên ưu tiên cao. */}
        {cover.img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover.img.src}
            srcSet={cover.img.srcSet}
            sizes={cover.img.sizes}
            alt=""
            loading="eager"
            fetchPriority="high"
            decoding="async"
            onError={() => void cover.fallBack()}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
          />
        )}
      </div>
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
              {avatar.img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatar.img.src}
                  srcSet={avatar.img.srcSet}
                  sizes={avatar.img.sizes}
                  alt=""
                  width={56}
                  height={56}
                  decoding="async"
                  onError={() => void avatar.fallBack()}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
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
          {action && <div className={`relative flex-none pb-0.5${lg('action')}`}>{action}</div>}
        </div>
        <div className={`mt-2 min-w-0${lg('name')}`}>
          <Heading variant="title-lg" as={titleAs} style={{ minWidth: 0, ...CLAMP_2 }}>
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
