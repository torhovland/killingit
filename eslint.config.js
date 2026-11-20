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
    // An optional value forwarded to another object is typed `T | undefined`
    // and passed straight through. The conditional object spread that used to
    // satisfy `exactOptionalPropertyTypes` hides an optional field behind a
    // shape change and drifts apart from the consumer's type. Tests keep their
    // fixture shortcuts; production API code does not. See AGENTS.md.
    files: ["apps/api/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "local/no-optional-spread": "error",
    },
  },
  {
    // A conditional `className` is composed through `cn()` so conflicting
    // Tailwind utilities merge and an omitted fragment leaves no stray space.
    // A template literal passed to `cn()` is the intended dynamic input. See
    // `docs/specs/web-component-library.md`.
    files: ["apps/web/**/*.{ts,tsx}"],
    rules: {
      "local/no-template-classname": "error",
    },
  },
  {
    // A web failure caught by the app goes through `reportError` or
    // `reportErrorQuietly` so Sentry sees it; a bare console call would bypass
    // the report. Tests may still log. `ErrorBoundary` deliberately logs the
    // component stack for development, and the root hooks in `main.tsx`
    // already capture render errors, so those two keep their console calls.
    // See `docs/specs/error-monitoring.md`.
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: [
      "apps/web/src/**/*.test.{ts,tsx}",
      "apps/web/src/ErrorBoundary.tsx",
    ],
    rules: {
      "no-console": "error",
    },
  },
  {
    // The root error hooks warn alongside their own Sentry capture.
    files: ["apps/web/src/main.tsx"],
    rules: {
      "no-console": ["error", { allow: ["warn"] }],
    },
  },
  {
    // The benchmark stores its run files as JSON, so every stage reads them
    // through the Zod schema that describes the file. This rule stops a new
    // stage from parsing a stored file with a hand-written cast again. Only
    // `jsonFile.ts` parses stored files; `promptBenchmark.ts` parses the model's
    // answer and `run.ts` parses its own outgoing request, so those two are not
    // reads of a stored file. See `docs/specs/llm-benchmark.md`.
    files: ["tools/benchmark/src/**/*.ts"],
    ignores: [
      "tools/benchmark/src/jsonFile.ts",
      "tools/benchmark/src/promptBenchmark.ts",
      "tools/benchmark/src/run.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='JSON'][callee.property.name='parse']",
          message:
            "Parse a stored benchmark file through readJsonFile in ./jsonFile.ts so its shape is validated.",
        },
      ],
    },
  },
  {
    // A function is bounded in length, branching and positional arguments so a
    // growing handler is split instead of becoming unreviewable. A plan run is
    // also described by named options, not by a growing tail of positional
    // booleans, so a sixth argument has to become part of an options object.
    //
    // These are the first ratchet step: the numbers catch today's worst
    // offenders, every one of them is fixed rather than suppressed, and the
    // benchmark harness is exempt until it becomes production code. Tighten the
    // numbers as the tree shrinks; see `docs/specs/function-size-limits.md` and
    // ADR 0061.
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "**/*.d.ts",
      "apps/api/e2e/**",
      "apps/web/e2e/**",
      "tools/benchmark/**",
    ],
    rules: {
      complexity: ["error", 30],
      "max-lines-per-function": ["error", 200],
      "max-params": ["error", 5],
    },
  },
  {
    // A plan-generation write is fenced by `ensureGenerationCurrent` in
    // `generation/persist.ts`, which also refuses to write for an aborted run.
    // Calling the generation store's `isCurrent` directly skips that abort
    // check, so every fence in the plan package goes through the helper, not
    // only the ones under `generation/`. See
    // `docs/specs/coach-run-cancellation.md`.
    files: ["apps/api/src/plans/**/*.ts"],
    ignores: ["apps/api/src/plans/generation/persist.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.property.name='generations'][callee.property.name='isCurrent']",
          message:
            "Fence a plan-generation write through ensureGenerationCurrent in ./generation/persist.ts so an aborted run stops too.",
        },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // The root scripts belong to no workspace package, so they are checked by
    // the root `tsconfig.scripts.json` project rather than the project service,
    // which only discovers files named `tsconfig.json`. They run in Bun and
    // Node, hence the Node globals. See
    // `docs/specs/typescript-project-coverage.md`.
    files: ["scripts/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: ["./tsconfig.scripts.json"],
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
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
      // `img` is named for the focusable, read-only charts, whose keyboard
      // cursor announces its day through a live region rather than through the
      // graphic's children. Every other non-interactive role still fails the
      // rule. See `docs/specs/accessibility-lint.md` and
      // `docs/specs/chart-keyboard-navigation.md`.
      "jsx-a11y/no-noninteractive-tabindex": [
        "error",
        { roles: ["application", "img"] },
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
    // A native confirm bypasses the dialog primitive's focus trap, Escape and
    // focus restore, and its blocking browser prompt cannot be styled or
    // tested like the rest of the app. Every confirmation opens a
    // `ConfirmDialog`; the rule stops the native prompt from creeping back as
    // the activity, question and manual-activity deletes once did. See
    // `docs/specs/modal-dialog.md` and `docs/specs/accessibility-lint.md`.
    //
    // jsx-a11y's interaction rules do not inspect pointer handlers, so a
    // non-SVG element could regress into a pointer-only `role="img"` surface,
    // as the location map did in #324. SVG charts keep `role="img"` with hover
    // handlers because they are read-only graphics, and they carry the keyboard
    // cursor instead: an SVG with a pointer handler has to be a tab stop and
    // handle keys, so a pointer-only chart cannot come back. See
    // `docs/specs/accessibility-lint.md` and
    // `docs/specs/chart-keyboard-navigation.md`.
    files: ["apps/web/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/apiUrl.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='confirm']",
          message:
            "Open a ConfirmDialog from ./components/ConfirmDialog instead of a native confirm, so focus, Escape and the backdrop behave like every other dialog.",
        },
        {
          selector:
            "CallExpression[callee.object.name='window'][callee.property.name='confirm']",
          message:
            "Open a ConfirmDialog from ./components/ConfirmDialog instead of window.confirm, so focus, Escape and the backdrop behave like every other dialog.",
        },
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
        {
          selector:
            "JSXOpeningElement[name.name='svg']:has(JSXAttribute[name.name=/^onPointer/]):not(:has(JSXAttribute[name.name='tabIndex']))",
          message:
            "An SVG chart with a pointer handler must also be a keyboard stop. Give it tabIndex={0} and a keyboard cursor, such as useChartKeyboard, so its values are reachable without a pointer.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='svg']:has(JSXAttribute[name.name=/^onPointer/]):not(:has(JSXAttribute[name.name='onKeyDown']))",
          message:
            "An SVG chart with a pointer handler must also handle keys, such as with useChartKeyboard, so its values are reachable without a pointer.",
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
