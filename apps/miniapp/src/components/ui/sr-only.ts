import type { CSSProperties } from 'react';

// Ẩn về mặt hình ảnh nhưng vẫn trong cây accessibility — dùng làm accessible name cho control
// không có nhãn hiện ra (vd checkbox từng dòng giỏ hàng / sheet mua lại).
export const SR_ONLY: CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
};
