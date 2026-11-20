// Flat ESLint config (opt-in). Run with: npm run lint
// Kept out of CI on purpose — the test suite stays zero-install. Linting needs
// eslint fetched on demand via npx, so it is a developer convenience, not a gate.
"use strict";

module.exports = [
  {
    files: ["**/*.js"],
    ignores: ["node_modules/**", "web/compare.html"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        // Browser + extension + service worker + test runner surfaces.
        chrome: "readonly",
        self: "readonly",
        window: "readonly",
        document: "readonly",
        fetch: "readonly",
        console: "readonly",
        OffscreenCanvas: "readonly",
        btoa: "readonly",
        setTimeout: "readonly",
        Promise: "readonly",
        importScripts: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none" }],
      "no-undef": "error",
      eqeqeq: ["warn", "smart"],
      "no-var": "off",
    },
  },
];
