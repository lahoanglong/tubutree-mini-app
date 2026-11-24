import { describe, expect, it, vi } from 'vitest';
import {
  applyAddressPaste,
  fillPastedText,
  matchPastedWard,
  parseAddressPaste,
  takesAddressPaste,
  type AddressPasteHost,
  type GeoOption,
  type PasteGeo,
  type PasteSlot,
  type PasteTextField,
} from './address-paste';

const HCM = { code: '84_VN79', name: 'Thành phố Hồ Chí Minh' };
const HN = { code: '84_VN01', name: 'Thành phố Hà Nội' };
const DN = { code: '84_VN75', name: 'Tỉnh Đồng Nai' };
const PROVINCES: GeoOption[] = [HCM, HN, DN, { code: '84_VN48', name: 'Thành phố Đà Nẵng' }, { code: '84_VN46', name: 'Thành phố Huế' }];

const parse = (s: string, list: readonly GeoOption[] = PROVINCES) => parseAddressPaste(s, list);

describe('parseAddressPaste: địa chỉ 2 cấp (sau 07/2025)', () => {
  it('khối Zalo 3 dòng có dấu', () => {
    expect(parse('Nguyễn Văn An\n0912 345 678\n123 Lê Lợi, Phường Bến Thành, TP.HCM')).toEqual({
      recipient: 'Nguyễn Văn An',
      phone: '0912345678',
      street: '123 Lê Lợi',
      province: HCM,
      ward: { kind: 'p', name: 'Bến Thành' },
    });
  });

  it('một dòng ngăn bằng gạch, SĐT +84 có dấu cách', () => {
    expect(parse('Trần Thị Bình - +84 903 456 789 - 45/2 Nguyễn Trãi, P. Bến Thành, Hồ Chí Minh')).toEqual({
      recipient: 'Trần Thị Bình',
      phone: '0903456789',
      street: '45/2 Nguyễn Trãi',
      province: HCM,
      ward: { kind: 'p', name: 'Bến Thành' },
    });
  });

  it('có nhãn Tên/SĐT/Địa chỉ, HN viết tắt', () => {
    expect(parse('Tên: Lê Hoa\nSĐT: 0987.654.321\nĐịa chỉ: 12 Hàng Bài, P. Hoàn Kiếm, HN')).toEqual({
      recipient: 'Lê Hoa',
      phone: '0987654321',
      street: '12 Hàng Bài',
      province: HN,
      ward: { kind: 'p', name: 'Hoàn Kiếm' },
    });
  });

  it('không dấu, không dấu phẩy', () => {
    expect(parse('nguyen van an 0912345678 123 le loi p ben thanh hcm')).toEqual({
      recipient: 'nguyen van an',
      phone: '0912345678',
      street: '123 le loi',
      province: HCM,
      ward: { kind: 'p', name: 'ben thanh' },
    });
  });

  it('tên có dấu, địa chỉ gõ không dấu trong cùng khối', () => {
    expect(parse('Nguyễn Văn An 0912345678, 123 le loi, phuong ben thanh, hcm')).toMatchObject({
      recipient: 'Nguyễn Văn An',
      street: '123 le loi',
      province: HCM,
      ward: { kind: 'p', name: 'ben thanh' },
    });
  });

  it('tiền tố dính dấu chấm: P.Bến Thành, TP.HCM', () => {
    expect(parse('Chị Mai, 0909123456, 8 Pasteur, P.Bến Thành, TP.HCM')).toMatchObject({
      recipient: 'Chị Mai',
      street: '8 Pasteur',
      province: HCM,
      ward: { kind: 'p', name: 'Bến Thành' },
    });
  });

  it('SĐT 0084 và (+84)', () => {
    expect(parse('Lê Hùng 0084 912 345 678, 12 Lê Lợi, HCM')?.phone).toBe('0912345678');
    expect(parse('Lê Hùng (+84) 912345678, 12 Lê Lợi, HCM')?.phone).toBe('0912345678');
  });

  it('bỏ đuôi Việt Nam', () => {
    expect(parse('Lê Hùng, 0912345678, 12 Lê Lợi, Phường Sài Gòn, TP. Hồ Chí Minh, Việt Nam')).toMatchObject({
      street: '12 Lê Lợi',
      province: HCM,
      ward: { kind: 'p', name: 'Sài Gòn' },
    });
  });

  it('đặc khu, thị trấn và phường số dính chữ (P12)', () => {
    expect(parse('Nguyễn An 0912345678 12 Trần Hưng Đạo, Đặc khu Phú Quốc')?.ward).toEqual({ kind: 'd', name: 'Phú Quốc' });
    expect(parse('Nguyễn An 0912345678 12 Trần Hưng Đạo, Thị trấn Củ Chi, HCM')?.ward).toEqual({ kind: '', name: 'Củ Chi' });
    expect(parse('Nguyễn An 0912345678 12 Lê Lợi P12 HCM')).toMatchObject({ street: '12 Lê Lợi', ward: { kind: 'p', name: '12' } });
  });

  it('tổ/ấp giữ ở số nhà; huyện cũ viết trần sau xã bị bỏ', () => {
    expect(parse('Bảo Ngọc 0912345678\nTổ 5, Ấp 3, Xã Tân Thạnh Đông, Củ Chi, HCM')).toMatchObject({
      street: 'Tổ 5, Ấp 3',
      province: HCM,
      ward: { kind: 'x', name: 'Tân Thạnh Đông' },
    });
  });
});

describe('parseAddressPaste: địa chỉ cũ còn Quận/Huyện', () => {
  it('bỏ cấp quận, KHÔNG giữ phường (tên phường cũ có thể trùng phường mới ở chỗ khác)', () => {
    expect(parse('Nguyễn Văn An\n0912 345 678\n123 Lê Lợi, Phường Bến Thành, Quận 1, TP.HCM')).toEqual({
      recipient: 'Nguyễn Văn An',
      phone: '0912345678',
      street: '123 Lê Lợi',
      province: HCM,
      ward: null,
    });
    expect(parse('Tên: Lê Hoa\nSĐT: 0987654321\nĐịa chỉ: 12 Hàng Bài, P. Hoàn Kiếm, Q. Hoàn Kiếm, HN')).toMatchObject({ street: '12 Hàng Bài', province: HN, ward: null });
    expect(parse('nguyen van an 0912345678 123 le loi p ben thanh q1 hcm')).toMatchObject({ street: '123 le loi', province: HCM, ward: null });
  });

  it('thành phố cấp quận đã giải thể (TP Thủ Đức) cũng là cấp quận', () => {
    expect(parse('Anh Tú Lê\n0911222333\n5 Võ Văn Ngân, P. Linh Chiểu, TP Thủ Đức, TP Hồ Chí Minh')).toMatchObject({
      street: '5 Võ Văn Ngân',
      province: HCM,
      ward: null,
    });
  });

  it('tên quận cũ viết trần ("Bình Thạnh") ở lại số nhà, không bị đoán thành phường', () => {
    expect(parse('Lan Anh 0912345678, 208 Nguyễn Hữu Cảnh, Bình Thạnh, HCM')).toMatchObject({
      street: '208 Nguyễn Hữu Cảnh, Bình Thạnh',
      province: HCM,
      ward: null,
    });
  });
});

describe('parseAddressPaste: tên đường chứa chữ giống tỉnh/quận/phường', () => {
  it('"Bà Huyện Thanh Quan", "Xã Đàn" là tên đường', () => {
    expect(parse('Lê Hoa 0987654321, 12 Bà Huyện Thanh Quan, Q3, HCM')?.street).toBe('12 Bà Huyện Thanh Quan');
    expect(parse('Lê Hoa 0987654321, 12 Xã Đàn, Đống Đa, Hà Nội')).toMatchObject({ street: '12 Xã Đàn, Đống Đa', province: HN, ward: null });
  });

  it('"Tỉnh lộ 10" là tên đường', () => {
    expect(parse('Lê Hoa 0987654321, 123 Tỉnh lộ 10, Bình Chánh')?.street).toBe('123 Tỉnh lộ 10, Bình Chánh');
    expect(parse('Lê Hoa 0987654321, Ấp 3, Tỉnh lộ 8')?.street).toBe('Ấp 3, Tỉnh lộ 8');
  });

  it('Xa lộ Hà Nội là tên đường, không phải tỉnh hay xã', () => {
    expect(parse('Bảo Ngọc, 0912345678, 120 Xa lộ Hà Nội')).toMatchObject({ street: '120 Xa lộ Hà Nội', province: null, ward: null });
    expect(parse('bao ngoc 0912345678 120 xa lo ha noi')).toMatchObject({ street: '120 xa lo ha noi', province: null, ward: null });
  });

  it('"123 Đồng Nai" là đường; "…, Đồng Nai" đứng riêng là tỉnh', () => {
    expect(parse('Bảo Ngọc, 0912345678, 123 Đồng Nai')).toMatchObject({ street: '123 Đồng Nai', province: null });
    expect(parse('Bảo Ngọc, 0912345678, 12 Lê Lợi, Đồng Nai')).toMatchObject({ street: '12 Lê Lợi', province: DN });
  });

  it('"Huyền" có dấu không bị coi là "Huyện"', () => {
    expect(parse('Bảo Ngọc 0912345678 9 Huyền Trân Công Chúa')?.street).toBe('9 Huyền Trân Công Chúa');
  });

  it('phường viết trần không tiền tố thì ở lại số nhà', () => {
    expect(parse('Bảo Ngọc, 0912345678, 12 Lê Lợi, Bến Thành, HCM')).toMatchObject({ street: '12 Lê Lợi, Bến Thành', ward: null });
  });
});

describe('parseAddressPaste: tên, SĐT và chữ thừa', () => {
  it('SĐT ở cuối, không có tên', () => {
    expect(parse('123 Lê Lợi, P. Bến Thành, HCM 0912345678')).toMatchObject({ recipient: '', phone: '0912345678', street: '123 Lê Lợi' });
  });

  it('tên ở dòng riêng sau địa chỉ, ngay trước SĐT', () => {
    expect(parse('12 Lê Lợi, Phường Sài Gòn, TP HCM\nNguyễn An\n0912345678')?.recipient).toBe('Nguyễn An');
  });

  it('tên dòng đầu đứng riêng, không có SĐT', () => {
    expect(parse('Nguyễn An\n12 Lê Lợi, Phường Sài Gòn, TP HCM')).toMatchObject({ recipient: 'Nguyễn An', phone: '', street: '12 Lê Lợi' });
  });

  it('không dấu: "phuong anh" đứng đầu là tên, không phải phường', () => {
    expect(parse('phuong anh 0912345678 12 le loi p ben thanh hcm')).toMatchObject({ recipient: 'phuong anh', street: '12 le loi' });
  });

  it('"Ship cho …" và chữ đệm "nha" không lọt vào tên/số nhà', () => {
    expect(parse('Ship cho Lan Anh 0912345678 nha, 12 Lê Lợi, P. Bến Thành, HCM')).toMatchObject({ recipient: 'Lan Anh', street: '12 Lê Lợi' });
  });

  it('bỏ dòng Ghi chú; dòng ghi chú có số ở cuối khối không chặn việc tìm tỉnh/phường', () => {
    expect(parse('Nguyễn An\n0912345678\n12 Lê Lợi, P. Sài Gòn, HCM\nGhi chú: giao giờ hành chính, gọi trước')?.street).toBe('12 Lê Lợi');
    expect(parse('Nguyễn An\n0912345678\n123 Lê Lợi, P. Bến Thành, HCM\nGiao sau 17h')).toMatchObject({
      street: '123 Lê Lợi',
      province: HCM,
      ward: { kind: 'p', name: 'Bến Thành' },
    });
  });

  it('hai SĐT: lấy số đầu, số sau không lọt vào số nhà', () => {
    expect(parse('Nguyễn An 0912345678 / 0987654321, 12 Lê Lợi, P. Bến Thành, HCM')).toMatchObject({ phone: '0912345678', street: '12 Lê Lợi' });
  });

  it('ký tự vô hình và dấu cách cứng của Zalo', () => {
    const zw = String.fromCharCode(0x200b);
    const nb = String.fromCharCode(0xa0);
    expect(parse(`Nguyễn An${zw}\n0912${nb}345${nb}678\n12 Lê Lợi, HCM`)).toMatchObject({ recipient: 'Nguyễn An', phone: '0912345678' });
  });

  it('danh mục tỉnh chưa tải: tên tỉnh viết tắt/đúng tên không lọt vào số nhà', () => {
    expect(parse('Nguyễn An 0912345678 12 Lê Lợi, P. Bến Thành, TP Hồ Chí Minh', [])).toMatchObject({
      street: '12 Lê Lợi',
      province: null,
      ward: { kind: 'p', name: 'Bến Thành' },
    });
    expect(parse('Nguyễn An 0912345678 12 Hàng Bài, Hà Nội', [])?.street).toBe('12 Hàng Bài');
  });

  it('chữ không đủ dáng địa chỉ thì null (để ô dán như thường)', () => {
    for (const s of ['0912345678', '123 Lê Lợi', 'giao giờ hành chính', '', 'Số: 0912 345 678', 'Gọi 0912345678']) {
      expect(parse(s), s).toBeNull();
    }
  });

  it('chữ quá dài (cả đoạn chat) thì null', () => {
    expect(parse(`Nguyễn An 0912345678 ${'12 Lê Lợi, '.repeat(60)}`)).toBeNull();
  });
});

describe('matchPastedWard', () => {
  const COMMUNES: GeoOption[] = [
    { code: 'w1', name: 'Phường Bến Thành' },
    { code: 'w2', name: 'Phường Tân Thạnh' },
    { code: 'w3', name: 'Xã Tân Thạnh' },
    { code: 'w4', name: 'Phường Phú Lâm' },
    { code: 'w5', name: 'Phường Phú Lăm' },
    { code: 'w6', name: 'Phường 1' },
  ];

  it('khớp không dấu, đúng một mục', () => {
    expect(matchPastedWard(COMMUNES, { kind: 'p', name: 'ben thanh' })?.code).toBe('w1');
    expect(matchPastedWard(COMMUNES, { kind: '', name: 'Bến Thành' })?.code).toBe('w1');
  });

  it('phường/xã trùng tên: tiền tố quyết; không rõ loại thì không đoán', () => {
    expect(matchPastedWard(COMMUNES, { kind: 'x', name: 'Tân Thạnh' })?.code).toBe('w3');
    expect(matchPastedWard(COMMUNES, { kind: 'p', name: 'Tân Thạnh' })?.code).toBe('w2');
    expect(matchPastedWard(COMMUNES, { kind: '', name: 'Tân Thạnh' })).toBeNull();
  });

  it('trùng khi bỏ dấu: chữ có dấu chọn đúng mục; không dấu thì null', () => {
    expect(matchPastedWard(COMMUNES, { kind: 'p', name: 'Phú Lâm' })?.code).toBe('w4');
    expect(matchPastedWard(COMMUNES, { kind: 'p', name: 'phu lam' })).toBeNull();
  });

  it('phường số bỏ số 0 đầu', () => {
    expect(matchPastedWard(COMMUNES, { kind: 'p', name: '01' })?.code).toBe('w6');
  });

  it('không khớp hay chữ rỗng thì null', () => {
    expect(matchPastedWard(COMMUNES, { kind: 'p', name: 'Linh Chiểu' })).toBeNull();
    expect(matchPastedWard(COMMUNES, { kind: 'p', name: '  ' })).toBeNull();
  });
});

describe('fillPastedText', () => {
  const paste = { recipient: 'Lê Hoa', phone: '0987654321', street: '12 Hàng Bài', province: null, ward: null };

  it('chỉ điền ô trống khi không được đè', () => {
    expect(fillPastedText({ recipient: 'Tôi', phone: '', street: ' ' }, paste, () => false)).toEqual({
      recipient: 'Tôi',
      phone: '0987654321',
      street: '12 Hàng Bài',
    });
  });

  it('đè ô được phép; không đổi gì thì trả đúng object cũ', () => {
    expect(fillPastedText({ recipient: 'Tôi', phone: '0900000000', street: '' }, paste, (k) => k === 'recipient').recipient).toBe('Lê Hoa');
    const form = { recipient: 'A', phone: 'B', street: 'C' };
    expect(fillPastedText(form, paste, () => false)).toBe(form);
  });

  it('cắt tên quá trần độ dài', () => {
    expect(fillPastedText({ recipient: '', phone: '', street: '' }, { ...paste, recipient: 'a'.repeat(200) }, () => false).recipient).toHaveLength(120);
  });
});

describe('takesAddressPaste', () => {
  const BLOCK = 'Lê Hoa 0987654321, 12 Lê Lợi, P. Bến Thành, HCM';
  const el = (value: string, start: number, end: number) => ({ value, selectionStart: start, selectionEnd: end });

  it('ô trống, bôi hết, hay ô app điền sẵn thì nhận', () => {
    expect(takesAddressPaste(BLOCK, PROVINCES, el('', 0, 0), 'street', new Set(['street']))).toBe(true);
    expect(takesAddressPaste(BLOCK, PROVINCES, el('abc', 0, 3), 'street', new Set(['street']))).toBe(true);
    expect(takesAddressPaste(BLOCK, PROVINCES, el('Long', 4, 4), 'recipient', new Set())).toBe(true);
  });

  it('ô khách đã gõ, con trỏ chèn giữa/cuối: để trình duyệt dán', () => {
    expect(takesAddressPaste(BLOCK, PROVINCES, el('Chung cư A, ', 12, 12), 'street', new Set(['street']))).toBe(false);
  });

  it('chữ không có dáng địa chỉ: không nhận', () => {
    expect(takesAddressPaste('123 Lê Lợi', undefined, el('', 0, 0), 'street', new Set())).toBe(false);
  });
});

describe('applyAddressPaste', () => {
  const SAI_GON = { province: HCM.name, provinceCode: HCM.code, ward: 'Phường Sài Gòn', wardCode: 'w-sg' };
  const EMPTY = { province: '', provinceCode: '', ward: '', wardCode: '' };
  const COMMUNES: Record<string, GeoOption[]> = {
    [HCM.code]: [
      { code: 'w-bt', name: 'Phường Bến Thành' },
      { code: 'w-sg', name: 'Phường Sài Gòn' },
    ],
    [DN.code]: [{ code: 'w-dn-bt', name: 'Phường Bến Thành' }],
  };

  function host(form: Record<PasteTextField, string>, geo: PasteGeo, edited: PasteSlot[] = []) {
    const state = { form, geo };
    const communes = vi.fn(async (code: string) => COMMUNES[code] ?? []);
    const announce = vi.fn();
    const h: AddressPasteHost<PasteGeo> = {
      read: () => state,
      edited: new Set(edited),
      provinces: async () => PROVINCES,
      communes,
      setForm: (f) => {
        state.form = f;
      },
      setGeo: (u) => {
        state.geo = u(state.geo);
      },
      announce,
    };
    return { h, state, communes, announce };
  }
  const blank = { recipient: '', phone: '', street: '' };

  it('form trống: điền đủ, chọn tỉnh rồi phường, báo một lần', async () => {
    const t = host(blank, EMPTY);
    await applyAddressPaste('Lê Hoa 0987654321, 12 Lê Lợi, P. Bến Thành, HCM', 'recipient', t.h);
    expect(t.state.form).toEqual({ recipient: 'Lê Hoa', phone: '0987654321', street: '12 Lê Lợi' });
    expect(t.state.geo).toEqual({ province: HCM.name, provinceCode: HCM.code, ward: 'Phường Bến Thành', wardCode: 'w-bt' });
    expect(t.announce).toHaveBeenCalledTimes(1);
  });

  it('phường điền sẵn lần trước bị xoá khi địa chỉ dán cùng tỉnh mà phường không khớp', async () => {
    const t = host(blank, SAI_GON);
    await applyAddressPaste('Lê Hoa 0987654321, 12 Quang Trung, Phường Hạnh Thông, TP HCM', 'street', t.h);
    expect(t.state.geo).toEqual({ ...SAI_GON, ward: '', wardCode: '' });
    expect(t.announce).toHaveBeenCalledTimes(1);
  });

  it('khối dán không ghi tỉnh: không khớp phường trong tỉnh đang có, chỉ xoá phường điền sẵn', async () => {
    const t = host(blank, SAI_GON);
    await applyAddressPaste('Lê Hoa 0987654321, 12 Lê Lợi, Phường Bến Thành', 'street', t.h);
    expect(t.communes).not.toHaveBeenCalled();
    expect(t.state.geo).toEqual({ ...SAI_GON, ward: '', wardCode: '' });
  });

  it('tỉnh khách đã tự chọn khác tỉnh dán: không đổi tỉnh, không khớp phường ở tỉnh khách chọn', async () => {
    const t = host(blank, { province: DN.name, provinceCode: DN.code, ward: '', wardCode: '' }, ['geo']);
    await applyAddressPaste('Lê Hoa 0987654321, 12 Lê Lợi, P. Bến Thành, HCM', 'street', t.h);
    expect(t.communes).not.toHaveBeenCalled();
    expect(t.state.geo.provinceCode).toBe(DN.code);
    expect(t.state.geo.wardCode).toBe('');
  });

  it('khách đã chọn đúng tỉnh mà chưa chọn phường: khớp phường', async () => {
    const t = host(blank, { province: HCM.name, provinceCode: HCM.code, ward: '', wardCode: '' }, ['geo']);
    await applyAddressPaste('Lê Hoa 0987654321, 12 Lê Lợi, P. Bến Thành, HCM', 'street', t.h);
    expect(t.state.geo.wardCode).toBe('w-bt');
  });

  it('khách đổi tỉnh trong lúc chờ danh sách phường: không ghi phường', async () => {
    const t = host(blank, EMPTY);
    t.communes.mockImplementation(async (code: string) => {
      t.state.geo = { province: HN.name, provinceCode: HN.code, ward: '', wardCode: '' };
      (t.h.edited as Set<PasteSlot>).add('geo');
      return COMMUNES[code] ?? [];
    });
    await applyAddressPaste('Lê Hoa 0987654321, 12 Lê Lợi, P. Bến Thành, HCM', 'street', t.h);
    expect(t.state.geo.provinceCode).toBe(HN.code);
    expect(t.state.geo.wardCode).toBe('');
  });

  it('không ô nào nhận được gì: chữ dán thay ô đang nhận cú dán, không báo', async () => {
    const t = host({ recipient: 'A', phone: '0900000000', street: 'cũ' }, { ...SAI_GON }, ['recipient', 'phone', 'geo']);
    await applyAddressPaste('Lê Hoa 0987654321', 'street', t.h);
    expect(t.state.form).toEqual({ recipient: 'A', phone: '0900000000', street: 'Lê Hoa 0987654321' });
    expect(t.announce).not.toHaveBeenCalled();
  });

  it('danh mục lỗi mạng: vẫn điền tên/SĐT/đường', async () => {
    const t = host(blank, EMPTY);
    t.h.provinces = async () => {
      throw new Error('offline');
    };
    await applyAddressPaste('Lê Hoa 0987654321, 12 Lê Lợi, P. Bến Thành, HCM', 'street', t.h);
    expect(t.state.form.street).toBe('12 Lê Lợi');
    expect(t.state.geo).toEqual(EMPTY);
  });
});
