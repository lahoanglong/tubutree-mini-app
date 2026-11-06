import { describe, expect, it } from 'vitest';
import { isImeEnter, isSubmitShortcut } from './keyboard';

describe('isImeEnter: Enter bộ gõ tiếng Việt dùng để chốt chữ', () => {
  it('isComposing hoặc keyCode 229 (Safari, WKWebView của Zalo) là Enter của bộ gõ', () => {
    expect(isImeEnter({ key: 'Enter', isComposing: true })).toBe(true);
    expect(isImeEnter({ key: 'Enter', isComposing: false, keyCode: 229 })).toBe(true);
  });

  it('Enter thường và phím khác thì không', () => {
    expect(isImeEnter({ key: 'Enter', isComposing: false, keyCode: 13 })).toBe(false);
    expect(isImeEnter({ key: 'a', isComposing: true, keyCode: 229 })).toBe(false);
  });
});

describe('isSubmitShortcut: Ctrl+Enter hoặc ⌘+Enter gửi từ ô nhận xét', () => {
  it('Ctrl hoặc ⌘ cùng Enter là gửi', () => {
    expect(isSubmitShortcut({ key: 'Enter', ctrlKey: true, keyCode: 13 })).toBe(true);
    expect(isSubmitShortcut({ key: 'Enter', metaKey: true, keyCode: 13 })).toBe(true);
  });

  it('Enter thường để xuống dòng; Enter của bộ gõ không gửi dù có Ctrl', () => {
    expect(isSubmitShortcut({ key: 'Enter', keyCode: 13 })).toBe(false);
    expect(isSubmitShortcut({ key: 'Enter', ctrlKey: true, isComposing: true })).toBe(false);
    expect(isSubmitShortcut({ key: 'Enter', metaKey: true, keyCode: 229 })).toBe(false);
  });
});
