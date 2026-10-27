import { maskFullName, maskName, publicDisplayName } from './mask-name';

// Bảng ca dùng chung với đặc tả ở game/game-gift/game-season/merchant (viết trước khi gom, xanh trên
// bản chép tay): hai hàm phải cho đúng kết quả của các bản cũ trên cùng một tập đầu vào.
const NAME_INPUTS: [string, string | null | undefined][] = [
  ['null', null],
  ['undefined', undefined],
  ['rỗng', ''],
  ['chỉ khoảng trắng', '   '],
  ['một từ', 'Long'],
  ['nhiều từ', 'Lã Hoàng Long'],
  ['thừa khoảng trắng đầu/cuối', '  Nguyễn An  '],
  ['hai dấu cách liền nhau', 'Lã  Long'],
  ['tab giữa tên', 'Lã\tLong'],
  ['nbsp giữa tên', 'Lã Long'],
];

const MASK_NAME_EXPECTED = [
  'Bạn Tubu',
  'Bạn Tubu',
  'Bạn Tubu',
  '***',
  'Long***',
  'Long***',
  'An***',
  'Long***',
  'Lã\tLong***',
  'Lã Long***',
];

const MASK_FULL_NAME_EXPECTED = [
  'Khách Tubu',
  'Khách Tubu',
  'Khách Tubu',
  'Khách Tubu',
  'Long***',
  'Long***',
  'An***',
  'Long***',
  'Long***',
  'Long***',
];

describe('maskName (BXH / bạn bè Vườn Xanh)', () => {
  it.each(NAME_INPUTS.map(([label, input], i) => [label, input, MASK_NAME_EXPECTED[i]] as const))(
    '%s',
    (_label, input, expected) => {
      expect(maskName(input)).toBe(expected);
    },
  );
});

describe('maskFullName (đơn gian hàng đối tác)', () => {
  it.each(NAME_INPUTS.map(([label, input], i) => [label, input, MASK_FULL_NAME_EXPECTED[i]] as const))(
    '%s',
    (_label, input, expected) => {
      expect(maskFullName(input)).toBe(expected);
    },
  );
});

describe('publicDisplayName (bài viết, bình luận, đánh giá công khai)', () => {
  it.each([
    ['Nguyễn Thị Quay Lại', 'Lại N.'],
    ['  Lã  Hoàng Long ', 'Long L.'],
    ['đỗ hương', 'hương Đ.'],
    ['Long', 'Long'],
  ])('%s -> %s', (name, want) => {
    expect(publicDisplayName(name)).toBe(want);
  });

  it.each([null, undefined, '', '   '])('trống (%p) dùng tên chung', (name) => {
    expect(publicDisplayName(name)).toBe('Bạn Tubu');
    expect(publicDisplayName(name, 'Khách Tubu')).toBe('Khách Tubu');
  });

  it.each(['0912345678', '+84 912 345 678', '0912.345.678', 'Long 0912345678', 'an@mail.com'])('"%s" giống số điện thoại hoặc email: không in ra', (name) => {
    expect(publicDisplayName(name)).toBe('Bạn Tubu');
  });
});
