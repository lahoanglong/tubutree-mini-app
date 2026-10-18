import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Timeline } from './timeline';
import { findNestedInteractive } from './nested-interactive';

const STEPS = ['Đã gửi', 'Vận chuyển', 'Đã nhận ở kho', 'Cộng điểm'];

describe('Timeline (§16.1)', () => {
  it('danh sách có tên, đủ 4 bước theo thứ tự', () => {
    render(<Timeline steps={STEPS} current={1} />);
    const list = screen.getByRole('list', { name: 'Tiến độ yêu cầu' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-step'))).toEqual(STEPS);
  });
  it('bước trước là xong, bước hiện tại có aria-current, bước sau chưa tới; trình đọc màn hình nghe trạng thái', () => {
    render(<Timeline steps={STEPS} current={1} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-state'))).toEqual(['done', 'current', 'upcoming', 'upcoming']);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).toHaveTextContent('Đã gửi, đã xong');
    expect(items[1]).toHaveTextContent('Vận chuyển, đang diễn ra');
    expect(items[2]).toHaveTextContent('Đã nhận ở kho, chưa tới');
  });
  it('current = 4 → mọi bước xong, không bước nào aria-current', () => {
    render(<Timeline steps={STEPS} current={4} />);
    const items = screen.getAllByRole('listitem');
    expect(items.every((li) => li.getAttribute('data-state') === 'done')).toBe(true);
    expect(items.some((li) => li.hasAttribute('aria-current'))).toBe(false);
  });
  it('không có phần tử tương tác (không lồng nút)', () => {
    const { container } = render(<Timeline steps={STEPS} current={2} compact />);
    expect(container.querySelectorAll('button, a, [tabindex]')).toHaveLength(0);
    expect(findNestedInteractive(container)).toEqual([]);
  });
  it('compact: chữ bước hiện tại hiện ra dưới các chấm, ẩn với trình đọc màn hình', () => {
    const { container } = render(<Timeline steps={STEPS} current={1} compact />);
    const visible = container.querySelector('div[aria-hidden]');
    expect(visible).toHaveTextContent('Vận chuyển');
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('Vận chuyển, đang diễn ra');
  });
  it('compact: mọi bước xong thì chữ là bước cuối', () => {
    const { container } = render(<Timeline steps={STEPS} current={4} compact />);
    expect(container.querySelector('div[aria-hidden]')).toHaveTextContent('Cộng điểm');
  });
  it('không compact: không có chữ phụ dưới danh sách', () => {
    const { container } = render(<Timeline steps={STEPS} current={1} />);
    expect(container.querySelector('div[aria-hidden]')).toBeNull();
  });
  it('hints: dòng phụ dưới đúng bước ở bản đầy đủ, không hiện ở compact', () => {
    const { rerender } = render(<Timeline steps={STEPS} current={1} hints={{ 1: <span>Ghi chú bước 2</span> }} />);
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('Ghi chú bước 2');
    expect(screen.getAllByRole('listitem')[0]).not.toHaveTextContent('Ghi chú');
    rerender(<Timeline steps={STEPS} current={1} compact hints={{ 1: <span>Ghi chú bước 2</span> }} />);
    expect(screen.queryByText('Ghi chú bước 2')).toBeNull();
  });
  it('hints: bước có dòng phụ canh trên cùng với tên bước, bước không có dòng phụ vẫn canh giữa', () => {
    render(<Timeline steps={STEPS} current={1} hints={{ 1: <span>Ghi chú bước 2</span> }} />);
    const items = screen.getAllByRole('listitem');
    expect(items[1]!.style.alignItems).toBe('flex-start');
    expect(items[0]!.style.alignItems).toBe('center');
  });
});
