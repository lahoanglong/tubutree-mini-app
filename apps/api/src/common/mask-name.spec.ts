import { maskFullName, maskName } from './mask-name';

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
