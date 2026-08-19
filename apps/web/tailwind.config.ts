import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * SwissHub Design Tokens.
 * Dunkles, hochwertiges Admin-Theme mit dezenter Akzentfarbe (#83060a).
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
          elevated: 'hsl(var(--card-elevated))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          muted: 'hsl(var(--primary-muted))',
          bright: 'hsl(var(--primary-bright))',
        },
        sidebar: 'hsl(var(--sidebar))',
        info: 'hsl(var(--info))',
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px hsl(var(--primary) / 0.45), 0 10px 40px -14px hsl(var(--primary-bright) / 0.65)',
        card: '0 1px 2px 0 rgb(0 0 0 / 0.5), 0 10px 30px -20px rgb(0 0 0 / 0.8)',
        'inner-glow': 'inset 0 0 24px -12px hsl(var(--primary-bright) / 0.8)',
      },
      backgroundImage: {
        'accent-gradient':
          'linear-gradient(135deg, hsl(var(--primary-bright)) 0%, hsl(var(--primary)) 55%, hsl(var(--primary-muted)) 100%)',
        'surface-gradient':
          'radial-gradient(900px 500px at 15% -10%, hsl(var(--primary) / 0.12), transparent 60%)',
        'promo-gradient':
          'linear-gradient(140deg, hsl(var(--primary) / 0.35) 0%, hsl(var(--card-elevated)) 55%, hsl(var(--card)) 100%)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-ring': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '0.15' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        shimmer: 'shimmer 1.8s infinite',
        'pulse-ring': 'pulse-ring 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [animate],
};

export default config;
