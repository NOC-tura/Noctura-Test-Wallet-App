module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#050505',
        surface: '#0f0f0f',
        accent: '#f5f5f5',
        // Align onboarding/login accent colors with transparent mode (cyan)
        neon: '#00f0ff',
        'gradient-start': '#00f0ff',
        'gradient-mid1': '#00f0ff',
        'gradient-mid2': '#00f0ff',
        'gradient-end': '#00f0ff',
      },
      backgroundImage: {
        'gradient-neon': 'linear-gradient(90deg, #00f0ff 0%, #00f0ff 50%, #00f0ff 100%)',
      },
      fontFamily: {
        mono: ['"Space Mono"', 'monospace'],
        sans: ['"Space Grotesk"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
