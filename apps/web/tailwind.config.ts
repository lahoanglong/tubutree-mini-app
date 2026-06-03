import type { Config } from 'tailwindcss';

// Design tokens Tubu Tree (README M1). Mở rộng dần khi build component (Phase 5).
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        green: {
          50: '#F1F8F2',
          100: '#DDEDE0',
          200: '#B5D6BD',
          400: '#5FA376',
          600: '#2E7D4F',
          700: '#235F3D',
          900: '#0F2D1C',
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
