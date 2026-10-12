import { describe, expect, it } from 'vitest';
import { uniqueById } from './unique-by-id';

describe('uniqueById', () => {
  it('bỏ dòng trùng id, giữ bản đầu và thứ tự', () => {
    const rows = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'a', n: 3 }, { id: 'c', n: 4 }, { id: 'b', n: 5 }];
    expect(uniqueById(rows)).toEqual([{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'c', n: 4 }]);
  });

  it('không có trùng → cùng nội dung; rỗng → rỗng; không sửa mảng gốc', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(uniqueById(rows)).toEqual(rows);
    expect(uniqueById([])).toEqual([]);
    expect(rows).toHaveLength(2);
  });
});
