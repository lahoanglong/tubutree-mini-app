import type { CSSProperties } from 'react';
import { hideBrokenImage } from '@tubutree/app-core/image-fallback';

/** Nền chuyển sắc mặc định của zmp-ui Avatar: hiện khi ảnh đang tải, ảnh có nền trong suốt (logo đối tác), ảnh lỗi hoặc chưa có ảnh. */
export const AVATAR_BACKGROUND = 'linear-gradient(45deg, var(--color-avatar-gradient-from) 0%, var(--color-avatar-gradient-to) 100%)';

const IMAGE_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  borderRadius: '100%',
  overflow: 'hidden',
};

/**
 * Ảnh tròn kích thước `size` px, thay `Avatar` của zmp-ui với đúng phần app dùng (chỉ ảnh, không chữ/story/online), cùng khung và nền,
 * nên bản build bỏ được CSS Avatar của zaui.css (xem build-zaui-prune.ts). Ảnh là trang trí: tên luôn nằm cạnh nên `alt` rỗng như zmp-ui.
 */
export function Avatar({ src, size, style }: { src?: string | null; size: number; style?: CSSProperties }) {
  return (
    <div
      data-testid="avatar"
      style={{
        position: 'relative',
        display: 'inline-block',
        verticalAlign: 'middle',
        width: size,
        height: size,
        borderRadius: '100%',
        background: AVATAR_BACKGROUND,
        ...style,
      }}
    >
      {src ? <img src={src} alt="" style={IMAGE_STYLE} onError={hideBrokenImage} /> : null}
    </div>
  );
}
