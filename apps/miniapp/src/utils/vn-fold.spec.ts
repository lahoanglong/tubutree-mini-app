import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { foldVietnamese, includesFolded } from './vn-fold';

describe('vn-fold (cùng bảng với apps/api/src/modules/catalog/search-text.ts)', () => {
  it('bỏ dấu, chữ HOA, NFD, khoảng trắng thừa', () => {
    expect(foldVietnamese('  NƯỚC   Rửa Chén ')).toBe('nuoc rua chen');
    expect(foldVietnamese('Đậu'.normalize('NFD'))).toBe('dau');
  });

  it('includesFolded khớp không dấu; needle rỗng → false', () => {
    expect(includesFolded('Cho mẹ & bé', 'me & be')).toBe(true);
    expect(includesFolded('Nhà bếp xanh', 'BEP')).toBe(true);
    expect(includesFolded('Sống xanh', 'nha')).toBe(false);
    expect(includesFolded('Sống xanh', '  ')).toBe(false);
  });
});

/**
 * Parity (carry note M5): bản sao ở miniapp phải CÙNG bảng với API, nếu không tìm kiếm phía client
 * (gợi ý danh mục, từ khoá gần đây) lệch với phía server. Miniapp không phụ thuộc apps/api nên không
 * import chéo package: đọc văn bản nguồn của cả hai file và dựng lại bảng from/to từ chính văn bản đó
 * (nhóm chữ thường + HOA, rồi dấu kết hợp ở cuối `from`, đúng như `buildFoldMap` của API).
 */
describe('vn-fold parity với API (VN_FOLD_FROM / VN_FOLD_TO)', () => {
  const API_FILE = resolve(__dirname, '../../../api/src/modules/catalog/search-text.ts');
  const MINIAPP_FILE = resolve(__dirname, './vn-fold.ts');

  function tablesFromSource(source: string): { from: string; to: string } {
    const groups = [...source.matchAll(/\[\s*'([a-z])'\s*,\s*'([^']+)'\s*\]/g)].map((m) => ({ base: m[1] ?? '', chars: m[2] ?? '' }));
    const marks = /VN_COMBINING_MARKS\s*=\s*'([^']+)'/.exec(source);
    const decodedMarks = marks
      ? (marks[1] ?? '').replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
      : '';
    let from = '';
    let to = '';
    for (const { base, chars } of groups) {
      for (const ch of chars + chars.toUpperCase()) {
        from += ch;
        to += base;
      }
    }
    return { from: from + decodedMarks, to };
  }

  it('bảng from/to của miniapp bằng đúng bảng của API', () => {
    const api = tablesFromSource(readFileSync(API_FILE, 'utf8'));
    const mini = tablesFromSource(readFileSync(MINIAPP_FILE, 'utf8'));
    expect(api.to.length).toBeGreaterThan(100); // bảng thật, không phải kết quả rỗng
    expect(api.from.length).toBe(api.to.length + 8); // 8 dấu kết hợp bị xoá
    expect(mini).toEqual(api);
  });

  it('hành vi: mọi ký tự trong bảng API được gấp giống nhau ở hai phía', () => {
    const api = tablesFromSource(readFileSync(API_FILE, 'utf8'));
    for (let i = 0; i < api.to.length; i += 1) {
      expect(foldVietnamese(api.from.charAt(i))).toBe(api.to.charAt(i));
    }
    for (const mark of api.from.slice(api.to.length)) {
      expect(foldVietnamese(`a${mark}`)).toBe('a');
    }
  });
});
