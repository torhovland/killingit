import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y";
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
    // A plan run is described by named options, not by a growing tail of
    // positional booleans. These entry points take at most five parameters so a
    // sixth one has to become part of an options object instead. See
    // `docs/specs/plan-run-arguments.md`.
    files: [
      "apps/api/src/plans/generate.ts",
      "apps/api/src/plans/status.ts",
      "apps/api/src/plans/store.ts",
      "apps/api/src/routes/plan.ts",
    ],
    rules: {
      "max-params": ["error", 5],
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
    // The web app is the one React surface, so the accessibility rules run
    // only there. `recommended` covers the obvious barriers — a missing
    // alternative text, a label detached from its control, a click handler on
    // a non-interactive element, a positive tab index — and fails the build
    // instead of leaving them to review. See `docs/specs/accessibility-lint.md`.
    ...jsxA11y.flatConfigs.recommended,
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      ...jsxA11y.flatConfigs.recommended.languageOptions,
      globals: globals.browser,
    },
    settings: {
      "jsx-a11y": {
        // The primitives render a native control and forward every prop, so
        // the plugin can treat them as the element they are. This keeps a
        // wrapping `<label>` associated without repeating ids at each call
        // site. See `docs/specs/accessibility-lint.md`.
        components: {
          Input: "input",
          Select: "select",
          Textarea: "textarea",
        },
      },
    },
    plugins: {
      ...jsxA11y.flatConfigs.recommended.plugins,
      "react-hooks": reactHooks,
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Hooks must run in the same order on every render; a conditional or
      // looping hook is a runtime bug that TypeScript cannot catch.
      "react-hooks/rules-of-hooks": "error",
      // Every value an effect or callback reads belongs in its dependency
      // list. The auth object is stable (see `apps/web/src/auth/index.ts`), so
      // the rule's suggestions are always safe to apply here.
      "react-hooks/exhaustive-deps": "error",
      // `role="application"` hands raw key presses to the widget instead of
      // letting a screen reader browse the page, which is what the
      // keyboard-operable location map needs. jsx-a11y classifies
      // `application` as a structural role, so it has to be named explicitly;
      // every other non-interactive role still fails the rule. See
      // `docs/specs/accessibility-lint.md`.
      "jsx-a11y/no-noninteractive-tabindex": [
        "error",
        { roles: ["application"] },
      ],
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
    // The API origin is read once, in `apps/web/src/apiUrl.ts`; every other
    // module takes an API path and lets `requestParsed` / `fetchJsonAuthed`
    // resolve it. This rule stops a new page or hook from copying
    // `import.meta.env.VITE_API_URL` back into the app, which is how the
    // constant reached thirty files before. See
    // `docs/specs/web-api-base-url.md` and ADR 0044.
    //
    // jsx-a11y's interaction rules do not inspect pointer handlers, so a
    // non-SVG element could regress into a pointer-only `role="img"` surface,
    // as the location map did in #324. SVG charts keep `role="img"` with hover
    // handlers because they are read-only graphics. See
    // `docs/specs/accessibility-lint.md`.
    files: ["apps/web/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/apiUrl.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='VITE_API_URL']",
          message:
            "Read the API origin from ./apiUrl, or pass an API path to requestParsed/fetchJsonAuthed, instead of using VITE_API_URL directly.",
        },
        {
          selector:
            "JSXOpeningElement:not([name.name='svg']):has(JSXAttribute[name.name='role'][value.value='img']):has(JSXAttribute[name.name=/^onPointer/])",
          message:
            'A non-SVG element with role="img" must not be pointer-only. Make it keyboard operable and give it an interactive role, or move the pointer handling to a real control.',
        },
      ],
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
