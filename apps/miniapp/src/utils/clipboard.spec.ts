// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyText } from './clipboard';

const originalClipboard = navigator.clipboard;

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true });
}

describe('copyText — chỉ báo thành công khi ĐÃ chép thật', () => {
  beforeEach(() => {
    (document as unknown as { execCommand?: unknown }).execCommand = vi.fn(() => false);
  });
  afterEach(() => {
    setClipboard(originalClipboard);
    vi.restoreAllMocks();
  });

  it('clipboard API chạy được → true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await expect(copyText('TUBU20')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('TUBU20');
  });

  it('quyền bị từ chối và execCommand cũng hỏng → false (KHÔNG báo thành công giả)', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });
    await expect(copyText('TUBU20')).resolves.toBe(false);
  });

  it('quyền bị từ chối nhưng execCommand chạy được → true', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn(() => true);
    await expect(copyText('TUBU20')).resolves.toBe(true);
  });

  it('webview không có clipboard API → vẫn thử execCommand', async () => {
    setClipboard(undefined);
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    await expect(copyText('TUBU20')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('chuỗi rỗng → false, không đụng tới clipboard', async () => {
    const writeText = vi.fn();
    setClipboard({ writeText });
    await expect(copyText('')).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('dọn sạch textarea tạm sau khi dùng phương án hai', async () => {
    setClipboard(undefined);
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn(() => true);
    await copyText('TUBU20');
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });
});

// Giữ cho mọi màn dùng chung một đường sao chép: nơi nào tự gọi navigator.clipboard là nơi đó
// dễ lặp lại lỗi "báo đã chép nhưng chưa chép" hoặc "chạm vào không có gì xảy ra".
describe('không màn nào gọi thẳng navigator.clipboard', () => {
  it('chỉ utils/clipboard.ts được phép', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const full = join(dir, n);
        if (statSync(full).isDirectory()) return walk(full);
        return /\.tsx?$/.test(full) ? [full] : [];
      });
    const offenders = walk(join(process.cwd(), 'src')).filter(
      (f) => !f.includes('clipboard') && readFileSync(f, 'utf8').includes('navigator.clipboard'),
    );
    expect(offenders.map((f) => f.replace(process.cwd(), ''))).toEqual([]);
  });
});
