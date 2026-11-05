'use client';

import { useEffect, useState } from 'react';
import { bannerImageFit } from './admin-campaign-form';

export interface BannerImageCheck {
  status: 'none' | 'loading' | 'ok' | 'crop' | 'error';
  message?: string;
}

const NONE: BannerImageCheck = { status: 'none' };

/** Tải ảnh banner ở trình duyệt để biết kích thước thật: lệch khung 5:2 hơn 10% thì cảnh báo bị cắt, không tải được cũng cảnh báo. */
export function useBannerImageCheck(src: string, delayMs = 400): BannerImageCheck {
  const [state, setState] = useState<BannerImageCheck>(NONE);
  const url = src.trim();

  useEffect(() => {
    if (!url) {
      setState(NONE);
      return;
    }
    setState({ status: 'loading' });
    let live = true;
    const img = new Image();
    const timer = setTimeout(() => {
      img.onload = () => {
        if (!live) return;
        const fit = bannerImageFit(img.naturalWidth, img.naturalHeight);
        setState(
          fit.ok
            ? { status: 'ok' }
            : { status: 'crop', ...(fit.message ? { message: fit.message } : {}) },
        );
      };
      img.onerror = () =>
        live &&
        setState({
          status: 'error',
          message:
            'Không tải được ảnh này để kiểm tỉ lệ. Kiểm lại đường dẫn ảnh: khách có thể thấy ô trống.',
        });
      img.src = url;
    }, delayMs);
    return () => {
      live = false;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
    };
  }, [url, delayMs]);

  return state;
}
