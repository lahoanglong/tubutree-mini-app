import { describe, it, expect } from 'vitest';
import { isDirectVideoUrl } from './video-url';

describe('isDirectVideoUrl', () => {
  it.each([
    'https://res.cloudinary.com/demo/video/upload/v1/khoa/bai1.mp4',
    'https://cdn.test/a.WEBM',
    'https://cdn.test/a.mp4?sig=1',
    'https://cdn.test/khoa/bai-1.m4v',
  ])('nhận %s', (u) => expect(isDirectVideoUrl(u)).toBe(true));

  it.each(['https://youtube.com/watch?v=x', 'https://youtu.be/abc', 'https://www.facebook.com/watch/?v=1', 'http://cdn.test/a.mp4', 'https://cdn.test/a.mp4.html', 'javascript:alert(1)', '', 'a.mp4'])(
    'từ chối %s',
    (u) => expect(isDirectVideoUrl(u)).toBe(false),
  );
});
