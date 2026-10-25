import { describe, it, expect } from 'vitest';
import { isDirectVideoUrl } from './video-url';

describe('isDirectVideoUrl', () => {
  it.each([
    'https://res.cloudinary.com/demo/video/upload/v1/khoa/bai1.mp4',
    'https://cdn.test/a.WEBM',
    'https://cdn.test/a.mp4?sig=1',
  ])('nhận %s', (u) => expect(isDirectVideoUrl(u)).toBe(true));

  it.each(['https://youtube.com/watch?v=x', 'http://cdn.test/a.mp4', 'https://cdn.test/a.mp4.html', 'javascript:alert(1)', '', 'a.mp4'])(
    'từ chối %s',
    (u) => expect(isDirectVideoUrl(u)).toBe(false),
  );
});
