import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { apiImageOrigin } from './image-origin';

describe('apiImageOrigin', () => {
  it('lấy gốc của địa chỉ API, bỏ đường dẫn /api', () => {
    expect(apiImageOrigin('https://api.tubutree.com/api')).toBe('https://api.tubutree.com');
    expect(apiImageOrigin('http://localhost:3001/api/')).toBe('http://localhost:3001');
  });

  it('chưa cấu hình hoặc không phải URL thì null', () => {
    expect(apiImageOrigin(undefined)).toBeNull();
    expect(apiImageOrigin('')).toBeNull();
    expect(apiImageOrigin('không phải url')).toBeNull();
  });
});

describe('app/layout.tsx: preconnect gốc ảnh (Pa7)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../app/layout.tsx'), 'utf8');

  it('gọi cả prefetchDNS lẫn preconnect cho gốc API từ react-dom', () => {
    expect(src).toMatch(/import \{[^}]*\bpreconnect\b[^}]*\} from 'react-dom'/);
    expect(src).toMatch(/import \{[^}]*\bprefetchDNS\b[^}]*\} from 'react-dom'/);
    expect(src).toMatch(/prefetchDNS\(\s*imageOrigin\s*\)/);
    expect(src).toMatch(/preconnect\(\s*imageOrigin\s*\)/);
  });

  it('preconnect KHÔNG có crossOrigin: thẻ img (no-cors) dùng nhóm kết nối có thông tin xác thực, `crossorigin=anonymous` mở nhóm khác nên không được dùng lại', () => {
    expect(src).not.toMatch(/preconnect\([^)]*crossOrigin/);
  });
});
