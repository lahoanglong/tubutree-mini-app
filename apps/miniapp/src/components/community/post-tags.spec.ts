import { describe, it, expect } from 'vitest';
import { dedupeTagsAgainstProducts } from './post-tags';

const tag = (name: string, slug = name) => ({ name, slug });
const product = (name: string, slug: string) => ({ name, slug });
const names = (tags: { name: string }[]) => tags.map((t) => t.name);

describe('dedupeTagsAgainstProducts — chỉ bỏ hashtag thật sự nhắc đúng sản phẩm', () => {
  it('trùng hẳn tên hoặc slug (bỏ dấu, hoa/thường, dấu cách và gạch nối) thì bỏ', () => {
    const p = [product('Nước rửa chén sinh học', 'nuoc-rua-chen-sinh-hoc')];
    expect(names(dedupeTagsAgainstProducts([tag('Nước Rửa Chén Sinh Học'), tag('nuocruachensinhhoc'), tag('x', 'nuoc-rua-chen-sinh-hoc')], p))).toEqual([]);
  });

  it('hashtag là phần đầu của tên, khớp trọn từ (vd "Nước rửa chén" của "Nước rửa chén sinh học") thì bỏ', () => {
    const p = [product('Nước rửa chén sinh học', 'nuoc-rua-chen-sinh-hoc')];
    expect(names(dedupeTagsAgainstProducts([tag('nước rửa chén', 'tag-khac')], p))).toEqual([]);
  });

  it('không khớp vắt qua ranh giới từ: "#Thương" không phải một phần của "Bột giặt hương sả"', () => {
    const p = [product('Bột giặt hương sả', 'bot-giat-huong-sa')];
    expect(names(dedupeTagsAgainstProducts([tag('Thương'), tag('thuong', 'thuong')], p))).toEqual(['Thương', 'thuong']);
  });

  it('hashtag chỉ là phần cuối/giữa của tên (vd "#Sinh học" của "Nước rửa chén sinh học") là chủ đề riêng: giữ', () => {
    const p = [product('Nước rửa chén sinh học', 'nuoc-rua-chen-sinh-hoc')];
    expect(names(dedupeTagsAgainstProducts([tag('Sinh học', 'sinh-hoc'), tag('rửa chén', 'rua-chen')], p))).toEqual(['Sinh học', 'rửa chén']);
  });

  it('hashtag ngắn (dưới 6 ký tự) chỉ khớp khi trùng hẳn: "chén" giữ nguyên', () => {
    const p = [product('Nước rửa chén sinh học', 'nuoc-rua-chen')];
    expect(names(dedupeTagsAgainstProducts([tag('nước'), tag('chén')], p))).toEqual(['nước', 'chén']);
  });

  it('không có sản phẩm gắn kèm thì giữ mọi hashtag', () => {
    expect(names(dedupeTagsAgainstProducts([tag('a'), tag('b')], []))).toEqual(['a', 'b']);
  });
});
