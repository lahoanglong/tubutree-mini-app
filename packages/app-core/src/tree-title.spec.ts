import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

describe('treeTitle và loài mặc định của máy chủ', () => {
  it('giá trị DEFAULT_TREE_TYPE ở API vẫn bị che thành "Cây của bạn" (đổi ở API mà quên đây thì giao diện lại hiện nó như tên thật)', () => {
    const constants = readFileSync(fileURLToPath(new URL('../../../apps/api/src/modules/game/game.constants.ts', import.meta.url)), 'utf8');
    const serverDefault = /export const DEFAULT_TREE_TYPE = '([^']+)'/.exec(constants)?.[1];
    expect(serverDefault).toBeTruthy();
    expect(treeTitle(serverDefault)).toBe(GENERIC_TREE_TITLE);
  });
});
