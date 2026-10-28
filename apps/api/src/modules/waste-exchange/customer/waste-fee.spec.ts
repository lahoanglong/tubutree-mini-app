import { estimateMailinFee } from './waste-fee';

const table = { zones: [{ name: 'Nội thành HCM', provinceCodes: ['79'], low: 20000, high: 35000 }, { name: 'Miền Bắc', provinceCodes: ['01', '84_VN01'], low: 35000, high: 60000 }], defaultZone: { name: 'Toàn quốc', low: 30000, high: 85000 } };
describe('estimateMailinFee (fee table only, spec 7.2)', () => {
  it('matching zone echoes the province', () => {
    expect(estimateMailinFee(table, { code: '01', name: 'Hà Nội' })).toEqual({ zoneName: 'Miền Bắc', provinceCode: '01', provinceName: 'Hà Nội', low: 35000, high: 60000 });
  });
  it('địa chỉ lưu "84_VN79" khớp vùng nhập "79" và ngược lại', () => {
    expect(estimateMailinFee(table, { code: '84_VN79', name: 'TP.HCM' }).zoneName).toBe('Nội thành HCM');
    expect(estimateMailinFee(table, { code: '84_VN01', name: 'Hà Nội' }).zoneName).toBe('Miền Bắc');
    expect(estimateMailinFee(table, { code: '01', name: 'Hà Nội' }).zoneName).toBe('Miền Bắc');
  });
  it('no zone -> defaultZone', () => {
    expect(estimateMailinFee(table, { code: '92', name: 'Cần Thơ' })).toEqual({ zoneName: 'Toàn quốc', provinceCode: '92', provinceName: 'Cần Thơ', low: 30000, high: 85000 });
    expect(estimateMailinFee({ zones: [], defaultZone: table.defaultZone }, { code: '79', name: 'TP.HCM' }).zoneName).toBe('Toàn quốc');
  });
});
