import { describe, expect, it } from 'vitest';
import { GENERIC_TREE_TITLE, treeTitle } from './tree-title';

describe('treeTitle', () => {
  it('có loài thì hiện loài', () => {
    expect(treeTitle('Sồi')).toBe('Sồi');
    expect(treeTitle('  Mận hậu ')).toBe('Mận hậu');
  });

  it('không có loài hoặc chỉ là giá trị mặc định thì "Cây của bạn", không hiện như tên thật', () => {
    expect(treeTitle(undefined)).toBe(GENERIC_TREE_TITLE);
    expect(treeTitle(null)).toBe(GENERIC_TREE_TITLE);
    expect(treeTitle('')).toBe(GENERIC_TREE_TITLE);
    expect(treeTitle('   ')).toBe(GENERIC_TREE_TITLE);
    expect(treeTitle('Cây Dứa Fuwa3e')).toBe('Cây của bạn');
  });
});
