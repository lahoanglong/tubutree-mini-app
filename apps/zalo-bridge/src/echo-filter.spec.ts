import { describe, expect, it } from 'vitest';
import { EchoFilter } from './echo-filter';

function make() {
  let t = 0;
  const f = new EchoFilter(() => t);
  return { f, advance: (ms: number) => (t += ms) };
}

describe('EchoFilter', () => {
  it('isSelf trùng tin đang gửi thì là echo', () => {
    const { f } = make();
    f.noteSending('A');
    expect(f.isEcho({ msgId: 'x', isSelf: true, text: 'A' })).toBe(true);
  });

  it('isSelf nhưng nội dung khác thì không phải echo', () => {
    const { f } = make();
    f.noteSending('A');
    expect(f.isEcho({ msgId: 'x', isSelf: true, text: 'B' })).toBe(false);
  });

  it('sau 61 giây không có noteSent thì không còn là echo', () => {
    const { f, advance } = make();
    f.noteSending('A');
    advance(61_000);
    expect(f.isEcho({ msgId: 'x', isSelf: true, text: 'A' })).toBe(false);
  });

  it('noteSent rồi thì msgId là echo dù isSelf false', () => {
    const { f } = make();
    f.noteSent('m1', 'A');
    expect(f.isEcho({ msgId: 'm1', isSelf: false, text: null })).toBe(true);
  });

  it('msgId đã gửi hết hạn sau 24 giờ', () => {
    const { f, advance } = make();
    f.noteSent('m1', 'A');
    advance(24 * 3600_000 + 1);
    expect(f.isEcho({ msgId: 'm1', isSelf: false, text: null })).toBe(false);
  });

  it('nhân viên gõ đúng nội dung cũ sau 60 giây không bị nuốt', () => {
    const { f, advance } = make();
    f.noteSent('m1', 'A');
    advance(61_000);
    expect(f.isEcho({ msgId: 'm2', isSelf: true, text: 'A' })).toBe(false);
  });

  it('hai tin đang gửi cùng nội dung thì không coi là đúng một tin', () => {
    const { f } = make();
    f.noteSending('A');
    f.noteSending('A');
    expect(f.isEcho({ msgId: 'x', isSelf: true, text: 'A' })).toBe(false);
  });
});
