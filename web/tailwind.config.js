/** Token màu lấy từ CSS variables để có light/dark. */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--ink) / <alpha-value>)",
        paper: "rgb(var(--paper) / <alpha-value>)",
        sheet: "rgb(var(--sheet) / <alpha-value>)",
        mirror: "rgb(var(--mirror) / <alpha-value>)",
        marker: "rgb(var(--marker) / <alpha-value>)",
        moss: "rgb(var(--moss) / <alpha-value>)",
        rust: "rgb(var(--rust) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
      },
      fontFamily: {
        sans: ['"Be Vietnam Pro"', "system-ui", "Segoe UI", "Roboto", "sans-serif"],
        serif: ['"Source Serif 4"', "Georgia", "Times New Roman", "serif"],
      },
    },
  },
};
