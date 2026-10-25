import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LegalMarkdown } from './legal-markdown';

describe('LegalMarkdown', () => {
  it('dựng tiêu đề, đoạn, danh sách, chữ đậm', () => {
    render(<LegalMarkdown source={'## Điều 1\nNội dung **quan trọng**\n\n- Một\n- Hai\n\n1. Bước'} />);
    expect(screen.getByRole('heading', { name: 'Điều 1' })).toBeInTheDocument();
    expect(screen.getByText('quan trọng').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('liên kết chỉ hiện chữ, không có thẻ a; HTML thô bị escape', () => {
    const { container } = render(<LegalMarkdown source={'Xem [Chính sách](https://example.com/x) <script>alert(1)</script>'} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('Xem Chính sách');
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });
});
