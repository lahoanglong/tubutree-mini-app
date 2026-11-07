import { describe, it, expect } from 'vitest';
import {
  LIGHTBOX_EASE,
  LIGHTBOX_OPEN_MS,
  SWIPE_MIN_PX,
  lightboxCounter,
  lightboxStep,
  reviewMediaItems,
  swipeDirection,
} from './review-media';

describe('reviewMediaItems', () => {
  it('ảnh theo thứ tự đăng, video đứng cuối', () => {
    expect(reviewMediaItems({ images: ['/a.jpg', '/b.jpg'], videoUrl: 'https://v/x.mp4' })).toEqual([
      { kind: 'image', src: '/a.jpg' },
      { kind: 'image', src: '/b.jpg' },
      { kind: 'video', src: 'https://v/x.mp4' },
    ]);
  });
  it('bỏ đường dẫn rỗng; không ảnh không video thì rỗng', () => {
    expect(reviewMediaItems({ images: ['', '  ', '/a.jpg'], videoUrl: '  ' })).toEqual([{ kind: 'image', src: '/a.jpg' }]);
    expect(reviewMediaItems({ images: [], videoUrl: null })).toEqual([]);
  });
  it('chỉ có video', () => {
    expect(reviewMediaItems({ images: [], videoUrl: 'https://v/x.mp4' })).toEqual([{ kind: 'video', src: 'https://v/x.mp4' }]);
  });
});

describe('lightboxStep', () => {
  it('đi tiếp và lùi, quay vòng ở hai đầu', () => {
    expect(lightboxStep(0, 3, 1)).toBe(1);
    expect(lightboxStep(2, 3, 1)).toBe(0);
    expect(lightboxStep(0, 3, -1)).toBe(2);
    expect(lightboxStep(1, 3, -1)).toBe(0);
  });
  it('một tệp ở yên; không có tệp thì 0', () => {
    expect(lightboxStep(0, 1, 1)).toBe(0);
    expect(lightboxStep(0, 1, -1)).toBe(0);
    expect(lightboxStep(5, 0, 1)).toBe(0);
  });
});

describe('lightboxCounter', () => {
  it('ghi "vị trí / tổng" tính từ 1', () => {
    expect(lightboxCounter(0, 5)).toBe('1 / 5');
    expect(lightboxCounter(4, 5)).toBe('5 / 5');
  });
  it('kẹp vị trí ngoài khoảng; không tệp thì rỗng', () => {
    expect(lightboxCounter(9, 5)).toBe('5 / 5');
    expect(lightboxCounter(-2, 5)).toBe('1 / 5');
    expect(lightboxCounter(0, 0)).toBe('');
  });
});

describe('swipeDirection', () => {
  it('vuốt trái = tiếp, vuốt phải = trước', () => {
    expect(swipeDirection(-SWIPE_MIN_PX, 0)).toBe(1);
    expect(swipeDirection(SWIPE_MIN_PX, 0)).toBe(-1);
  });
  it('vuốt ngắn hơn ngưỡng thì bỏ qua', () => {
    expect(swipeDirection(-(SWIPE_MIN_PX - 1), 0)).toBe(0);
  });
  it('vuốt nghiêng theo chiều dọc (cuộn) thì bỏ qua', () => {
    expect(swipeDirection(-60, 80)).toBe(0);
    expect(swipeDirection(-90, 40)).toBe(1);
  });
});

describe('thời gian mở', () => {
  it('220ms, ease-drawer', () => {
    expect(LIGHTBOX_OPEN_MS).toBe(220);
    expect(LIGHTBOX_EASE).toBe('cubic-bezier(0.32, 0.72, 0, 1)');
  });
});
