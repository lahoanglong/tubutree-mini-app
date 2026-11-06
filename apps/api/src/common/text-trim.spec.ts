import { removeInvisible, trimInvisible } from './text-trim';

describe('trimInvisible', () => {
  it.each([
    ['  a  ', 'a'],
    ['\u200b\u200c a \ufeff\u2060', 'a'],
    ['\u00a0\u200b', ''],
    ['a\u200bb', 'a\u200bb'],
    ['👨\u200d👩\u200d👧', '👨\u200d👩\u200d👧'],
    ['\u3164', ''],
    [' \u3164 \u3164 ', ''],
    ['\u115f\u1160\uffa0\u2800', ''],
    ['\u3164An\u3164', 'An'],
    ['한글', '한글'],
  ])('%j → %j', (input, out) => {
    expect(trimInvisible(input)).toBe(out);
  });
});

describe('removeInvisible', () => {
  it.each([
    ['0912\u2060345678', '0912345678'],
    ['09\u200b12\ufeff345\u00ad678\u200e', '0912345678'],
    ['\u200b\u200c\u200d', ''],
    ['0912 345 678', '0912 345 678'],
    ['a\tb', 'a\tb'],
  ])('%j → %j (bỏ ký tự vô hình ở mọi vị trí, giữ khoảng trắng)', (input, out) => {
    expect(removeInvisible(input)).toBe(out);
  });
});
