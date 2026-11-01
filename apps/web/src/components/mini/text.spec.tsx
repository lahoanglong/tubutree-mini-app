// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from './harness';
import { Heading } from './text';

const q = (sel: string) => document.querySelector<HTMLElement>(sel);

describe('Heading (web)', () => {
  it('mặc định Fraunces (display); font="ui" đổi sang Inter 700 mà vẫn theo cỡ của variant (Q1: dưới 22px dùng Inter)', () => {
    const m = mount(
      <>
        <Heading variant="title-sm" data-testid="d">Mặc định</Heading>
        <Heading variant="title-md" font="ui" data-testid="u">Inter</Heading>
      </>,
    );
    expect(q('[data-testid="d"]')!.style.fontFamily).toBe('var(--font-display)');
    const ui = q('[data-testid="u"]')!;
    expect(ui.style.fontFamily).toBe('var(--font-ui)');
    expect(ui.style.fontWeight).toBe('700');
    expect(ui.style.fontSize).toBe('var(--type-title-md-size)');
    expect(ui.style.letterSpacing).toBe('-0.01em');
    m.unmount();
  });
});
