import { ipMatch, ipMatchOne } from './ip.util';

describe('ipMatchOne', () => {
  it('exact khớp', () => {
    expect(ipMatchOne('113.161.1.10', '113.161.1.10')).toBe(true);
  });
  it('exact không khớp', () => {
    expect(ipMatchOne('113.161.1.11', '113.161.1.10')).toBe(false);
  });
  it('CIDR /24 trong dải', () => {
    expect(ipMatchOne('113.161.1.55', '113.161.1.0/24')).toBe(true);
  });
  it('CIDR /24 ngoài dải', () => {
    expect(ipMatchOne('113.161.2.55', '113.161.1.0/24')).toBe(false);
  });
  it('CIDR /32 chỉ khớp đúng 1 IP', () => {
    expect(ipMatchOne('10.0.0.1', '10.0.0.1/32')).toBe(true);
    expect(ipMatchOne('10.0.0.2', '10.0.0.1/32')).toBe(false);
  });
  it('IPv4-mapped IPv6', () => {
    expect(ipMatchOne('::ffff:113.161.1.10', '113.161.1.10')).toBe(true);
  });
  it('IP rác → false', () => {
    expect(ipMatchOne('not-an-ip', '113.161.1.0/24')).toBe(false);
    expect(ipMatchOne('999.1.1.1', '999.1.1.1')).toBe(false);
  });
  it('CIDR bits sai → false', () => {
    expect(ipMatchOne('10.0.0.1', '10.0.0.0/33')).toBe(false);
  });
});

describe('ipMatch', () => {
  it('list rỗng → false', () => {
    expect(ipMatch('10.0.0.1', [])).toBe(false);
  });
  it('khớp 1 trong nhiều mục', () => {
    expect(ipMatch('192.168.1.20', ['113.161.1.0/24', '192.168.1.0/24'])).toBe(true);
  });
});
