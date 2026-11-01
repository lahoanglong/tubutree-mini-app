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
  it('Heading mặc định Fraunces (display); font="ui" đổi sang Inter 700 mà vẫn theo cỡ của variant (Q1: dưới 22px dùng Inter)', () => {
    render(
      <>
        <Heading variant="title-sm" data-testid="d">Mặc định</Heading>
        <Heading variant="title-md" font="ui" data-testid="u">Inter</Heading>
      </>,
    );
    expect(screen.getByTestId('d').style.fontFamily).toBe('var(--font-display)');
    const ui = screen.getByTestId('u');
    expect(ui.style.fontFamily).toBe('var(--font-ui)');
    expect(ui.style.fontWeight).toBe('700');
    expect(ui.style.fontSize).toBe('var(--type-title-md-size)');
    expect(ui.style.letterSpacing).toBe('-0.01em');
  });
});
