import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#05080f",
          900: "#0a0e1a",
          800: "#0f1628",
          700: "#151e38",
          600: "#1e2d4f",
        },
        signal: {
          blue: "#00c8ff",
          "blue-dim": "#0099cc",
          green: "#00e676",
          "green-dim": "#00b35a",
        },
        slate: {
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
        },
      },
      fontFamily: {
        display: ["'Barlow Condensed'", "sans-serif"],
        body: ["'DM Sans'", "sans-serif"],
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(rgba(0,200,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,200,255,0.03) 1px, transparent 1px)",
      },
      backgroundSize: {
        grid: "60px 60px",
      },
    },
  },
  plugins: [],
};

export default config;
