import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["api/**/*.js", "scripts/**/*.mjs", "tests/**/*.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["assets/voice-agent.js"],
    languageOptions: { globals: globals.browser },
  },
];
