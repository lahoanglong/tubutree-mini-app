import { AlertTriangle } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TriangleAlertIcon } from './triangle-alert-icon';

describe('TriangleAlertIcon', () => {
  it('vẽ đúng markup của AlertTriangle (lucide) cỡ h-8 w-8, ẩn khỏi trình đọc màn hình', () => {
    expect(renderToStaticMarkup(<TriangleAlertIcon />)).toBe(renderToStaticMarkup(<AlertTriangle className="h-8 w-8" aria-hidden="true" />));
  });
});
