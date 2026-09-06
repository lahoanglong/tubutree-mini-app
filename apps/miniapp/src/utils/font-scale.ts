const FONT_PX: Record<'small' | 'normal' | 'large', string> = {
  small: '15px',
  normal: '16px',
  large: '18px',
};

export function applyFontScale(scale: 'small' | 'normal' | 'large') {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.fontScale = scale;
    document.documentElement.style.fontSize = FONT_PX[scale] ?? '16px';
  }
}
