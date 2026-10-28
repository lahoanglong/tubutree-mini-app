// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { appendAdvisorMessage, clearAdvisorMessages, MAX_ADVISOR_MESSAGES, truncateAdvisorMessages, useAdvisorMessages } from './ai-advisor-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function read(userId: string) {
  let seen: readonly { content: string }[] = [];
  const el = document.createElement('div');
  const root = createRoot(el);
  const Probe = () => {
    seen = useAdvisorMessages(userId);
    return null;
  };
  act(() => root.render(createElement(Probe)));
  const out = seen;
  act(() => root.unmount());
  return out;
}

beforeEach(() => clearAdvisorMessages());

describe('ai-advisor-store', () => {
  it('giữ tin theo thứ tự cho đúng người dùng', () => {
    appendAdvisorMessage('u1', { role: 'user', content: 'a' });
    appendAdvisorMessage('u1', { role: 'assistant', content: 'b' });
    expect(read('u1').map((m) => m.content)).toEqual(['a', 'b']);
  });

  it('người dùng khác không đọc được, và ghi tin mới thì bắt đầu hội thoại riêng', () => {
    appendAdvisorMessage('u1', { role: 'user', content: 'riêng tư' });
    expect(read('u2')).toEqual([]);
    appendAdvisorMessage('u2', { role: 'user', content: 'của u2' });
    expect(read('u2').map((m) => m.content)).toEqual(['của u2']);
    expect(read('u1')).toEqual([]);
  });

  it('chỉ giữ 40 tin gần nhất', () => {
    for (let i = 1; i <= MAX_ADVISOR_MESSAGES + 5; i++) appendAdvisorMessage('u1', { role: 'user', content: `tin ${i}` });
    const list = read('u1');
    expect(list).toHaveLength(MAX_ADVISOR_MESSAGES);
    expect(list[0]!.content).toBe('tin 6');
  });

  it('truncate giữ n tin đầu; không đụng hội thoại của người khác', () => {
    appendAdvisorMessage('u1', { role: 'user', content: 'a' });
    appendAdvisorMessage('u1', { role: 'assistant', content: 'xin lỗi', failed: true });
    truncateAdvisorMessages('u2', 0);
    expect(read('u1')).toHaveLength(2);
    truncateAdvisorMessages('u1', 1);
    expect(read('u1').map((m) => m.content)).toEqual(['a']);
  });

  it('clear xoá hết', () => {
    appendAdvisorMessage('u1', { role: 'user', content: 'a' });
    clearAdvisorMessages();
    expect(read('u1')).toEqual([]);
  });
});
