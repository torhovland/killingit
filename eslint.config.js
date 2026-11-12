import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import local from "./eslint-rules/index.js";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      // Python sidecar artifacts (not application JS/TS).
      "services/**/.venv/**",
      "services/**/__pycache__/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // Detect unused variables and constants. TypeScript's noUnusedLocals
      // already checks non-exported values; this keeps the same check in the
      // linter, including for values TypeScript treats as part of a module's
      // public surface.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          vars: "all",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    plugins: { local },
    rules: {
      // Keep exported consts together before exported functions so modules
      // read predictably. Within each group the existing semantic order is
      // preserved.
      "local/consts-before-functions": "error",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["scripts/**/*.{ts,tsx}", "benchmarks/**/*.{ts,tsx}"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: null,
        projectService: false,
      },
    },
  },
  {
    files: ["apps/api/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Hooks must run in the same order on every render; a conditional or
      // looping hook is a runtime bug that TypeScript cannot catch.
      "react-hooks/rules-of-hooks": "error",
      // Every value an effect or callback reads belongs in its dependency
      // list. The auth object is stable (see `apps/web/src/auth/index.ts`), so
      // the rule's suggestions are always safe to apply here.
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    // The Playwright runner and its config run in Node; the specs also use
    // browser APIs through the Playwright page objects.
    files: ["apps/web/playwright.config.ts", "apps/web/e2e/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // The service worker template is plain JavaScript outside the TypeScript
    // project. `__PRECACHE_URLS__` is a build placeholder, not a real global.
    files: ["apps/web/pwa/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        __PRECACHE_URLS__: "readonly",
      },
    },
  },
  prettier,
);
