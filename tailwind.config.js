/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Monotype everything — early-internet terminal feel.
        mono: [
          "Berkeley Mono",
          "ui-monospace",
          "SF Mono",
          "SFMono-Regular",
          "JetBrains Mono",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        // warm paper + ink
        paper: "#ECE6D6",
        panel: "#E6DFCB",
        ink: "#1C1A12",
        faint: "#8C8470",
        // sick flat accents (lines/needles, never glows)
        clay: "#C9542E",
        blue: "#2747C9",
        green: "#3F8F4E",
        lime: "#7FA61E",
        magenta: "#BF2E86",
        amber: "#D6920F",
        violet: "#6A4BC4",
      },
      keyframes: {
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        sweep: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        blink: {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0.15" },
        },
      },
      animation: {
        marquee: "marquee 38s linear infinite",
        sweep: "sweep 8s linear infinite",
        blink: "blink 1.4s steps(1) infinite",
      },
    },
  },
  plugins: [],
};
