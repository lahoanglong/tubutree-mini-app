import type { Config } from 'tailwindcss';

// Design tokens Tubu Tree (README M1). Mở rộng dần khi build component (Phase 5).
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary — Cam logo (hex chuẩn M2, khớp apps/miniapp/src/css/tokens.css).
        // Spec §7.1: brand green cũ (#2E7D4F) đã lỗi thời, đã bỏ hẳn — không giữ alias.
        primary: {
          50: '#FDF3E3',
          100: '#FBE4C4',
          200: '#F4C98A',
          400: '#EBA94A',
          600: '#E08C1C',
          700: '#B86A10',
          900: '#5C3505',
        },
        // Secondary — Lá logo (hex chuẩn M2).
        leaf: {
          50: '#EEF7D9',
          100: '#DCEFBE',
          200: '#BBD98A',
          400: '#95D222',
          600: '#509018',
          700: '#3C6D12',
          900: '#1F3A09',
        },
        clay: { 50: '#FBF4ED', 200: '#EDD4BD', 500: '#C97B4A', 700: '#8C4F2A' },
        sun: { 300: '#FDD96E', 500: '#F4B400' },
        neutral: {
          0: '#FFFFFF',
          50: '#FAFAF8',
          100: '#F2F2EF',
          200: '#E5E5E0',
          400: '#A8A8A0',
          600: '#5F5F58',
          900: '#1A1A17',
        },
      },
      fontFamily: {
        sans: ['"Be Vietnam Pro"', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: { sm: '6px', md: '10px', lg: '16px', xl: '24px' },
    },
  },
  plugins: [],
};

export default config;
