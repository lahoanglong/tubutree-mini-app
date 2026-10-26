import { SAMPLE_STOREFRONT_LABEL } from '@tubutree/app-core/storefront-signup';
import type { OgCardData } from '@/lib/storefront-og';

export interface OgCardImages {
  avatar: string | null;
  thumbnails: string[];
}

const INK = '#1c2b22';
const MUTED = '#5b6b60';

/**
 * Thẻ chia sẻ 1200x630 của gian hàng, dựng bằng satori (ImageResponse): chỉ hỗ trợ một phần CSS (flex, kích thước cố định, bo góc),
 * nên mọi khối nhiều con đều khai `display: 'flex'`. Ảnh đã tải sẵn thành data URI (xem fetchOgImage).
 */
export function StorefrontOgCard({ data, images }: { data: OgCardData; images: OgCardImages }) {
  const { thumbnails } = images;
  const tile = thumbnails.length === 1 ? 300 : 280;
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#f7f5ef', padding: 56, fontFamily: 'BeVietnam' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {images.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={images.avatar} width={150} height={150} alt="" style={{ width: 150, height: 150, borderRadius: 75, objectFit: 'cover', border: '6px solid #ffffff' }} />
        ) : (
          <div style={{ width: 150, height: 150, borderRadius: 75, background: data.color, color: '#ffffff', fontSize: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '6px solid #ffffff' }}>
            {data.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginLeft: 36 }}>
          {data.isSample && (
            <div style={{ display: 'flex', alignSelf: 'flex-start', marginBottom: 12, padding: '6px 22px', borderRadius: 999, background: '#fdecc8', color: '#7a4a05', fontSize: 30 }}>
              {SAMPLE_STOREFRONT_LABEL}
            </div>
          )}
          <div style={{ display: 'flex', fontSize: data.name.length > 28 ? 52 : 68, color: INK, lineHeight: 1.15 }}>{data.name}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 28 }}>
        {thumbnails.length > 0 ? (
          thumbnails.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} width={tile} height={tile} alt="" style={{ width: tile, height: tile, objectFit: 'cover', borderRadius: 28, marginRight: i === thumbnails.length - 1 ? 0 : 28 }} />
          ))
        ) : (
          <div style={{ display: 'flex', flex: 1, height: 240, borderRadius: 28, background: data.color, color: '#ffffff', fontSize: 44, alignItems: 'center', justifyContent: 'center' }}>
            Gian hàng trên Tubu Tree
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', marginTop: 20, fontSize: 30, color: MUTED }}>
        <div style={{ display: 'flex', width: 14, height: 14, borderRadius: 7, background: data.color, marginRight: 12 }} />
        Tubu Tree
      </div>
    </div>
  );
}
