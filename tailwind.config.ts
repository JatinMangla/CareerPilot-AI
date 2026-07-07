import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0e17",
          900: "#0e1422",
          850: "#131a2b",
          800: "#182136",
          700: "#233049",
          600: "#31415f",
          400: "#64748b",
          300: "#94a3b8",
          200: "#cbd5e1",
          100: "#e7edf5",
        },
        neon: {
          400: "#34e3b0",
          500: "#17c996",
          600: "#0ea87c",
        },
        amberx: {
          400: "#ffc45e",
          500: "#f5a623",
        },
        coral: {
          400: "#ff7a6b",
          500: "#f4553f",
        },
        sky2: {
          400: "#5db3ff",
          500: "#2f8fef",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 24px rgba(23, 201, 150, 0.18)",
        card: "0 8px 30px rgba(0, 0, 0, 0.35)",
      },
    },
  },
  plugins: [],
};
export default config;
