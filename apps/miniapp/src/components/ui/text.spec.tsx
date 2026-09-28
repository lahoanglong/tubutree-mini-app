import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Text, Heading } from './text';

describe('Text/Heading', () => {
  it('Text renders a <span> by default with the variant font-size token', () => {
    render(<Text variant="body-md" data-testid="t">Hello</Text>);
    const el = screen.getByTestId('t');
    expect(el.tagName).toBe('SPAN');
    expect(el.style.fontSize).toBe('var(--type-body-md-size)');
  });
  it('Heading renders h1/h2/h3 based on variant, defaulting sensibly', () => {
    render(<Heading variant="title-lg" data-testid="h">Title</Heading>);
    expect(screen.getByTestId('h').tagName).toBe('H1');
  });
  it('Heading "as" prop overrides the default tag (e.g. title-sm inside a card still an h3 semantically, but visually small)', () => {
    render(<Heading variant="display-lg" as="h2" data-testid="h2">Big</Heading>);
    expect(screen.getByTestId('h2').tagName).toBe('H2');
  });
});
