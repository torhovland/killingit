import { RuleTester } from "eslint";
import local from "./index.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run("no-template-classname", local.rules["no-template-classname"], {
  valid: [
    '<div className="p-4" />;',
    "<div className={styles.panel} />;",
    "<div data-testid={`row-${index}`} />;",
    // A template literal is a legitimate dynamic input to cn(): only the JSX
    // attribute itself is disallowed.
    '<div className={cn(`p-4`, active && "bg-card")} />;',
  ],
  invalid: [
    {
      code: "<div className={`flex ${active ? 'a' : 'b'}`} />;",
      errors: [{ messageId: "templateClassName" }],
    },
    {
      code: "<div className={`p-4`} />;",
      errors: [{ messageId: "templateClassName" }],
    },
  ],
});

ruleTester.run(
  "consts-before-functions",
  local.rules["consts-before-functions"],
  {
    valid: [
      `export const A = 1;
export function f() {}`,
      // Only `const` declarations are ordered; `let` and `var` stay allowed
      // after an exported function.
      `export let A = 1;
export function f() {}`,
      `export var A = 1;
export function f() {}`,
      `export function f() {}
export let A = 1;`,
      `export function f() {}
export var A = 1;`,
      // A class is not a function declaration, so the rule does not order it.
      `export function f() {}
export class C {}`,
      `export const A = 1;
export default function f() {}`,
      `export default function f() {}
export let A = 1;`,
      // A declaration-less `export { x }` is ignored: the rule cannot tell
      // whether the binding is a function, a const, an import or a class.
      // Resolving it would also have to compare the declaration's position
      // rather than the export statement's, which is a different rule.
      `export function f() {}
const A = 1;
export { A };`,
      `export { A };
export function f() {}
const A = 1;`,
      `export function f() {}
export { g };
function g() {}`,
      `export { g };
export const A = 1;
function g() {}`,
      // `export default` of a value or a class is not an exported function
      // declaration, so it does not start the const ordering.
      `export default someValue;
export const A = 1;`,
      `export default class C {}
export const A = 1;`,
    ],
    invalid: [
      {
        code: `export function f() {}
export const A = 1;`,
        errors: [{ messageId: "constAfterFunction" }],
      },
      {
        code: `export function f() {}
export function g() {}
export const A = 1, B = 2;`,
        errors: [{ messageId: "constAfterFunction" }],
      },
      {
        code: `export function f() {}
export const A = 1;
export const B = 2;`,
        errors: [
          { messageId: "constAfterFunction" },
          { messageId: "constAfterFunction" },
        ],
      },
      {
        code: `export const A = 1;
export function f() {}
export const B = 2;`,
        errors: [{ messageId: "constAfterFunction" }],
      },
      {
        code: `export function f() {}
export const { A } = source;`,
        errors: [{ messageId: "constAfterFunction" }],
      },
      {
        // `export default function` is an exported function declaration too.
        code: `export default function f() {}
export const A = 1;`,
        errors: [{ messageId: "constAfterFunction" }],
      },
      {
        code: `export default function () {}
export const A = 1;`,
        errors: [{ messageId: "constAfterFunction" }],
      },
      {
        code: `export default async function f() {}
export const A = 1;`,
        errors: [{ messageId: "constAfterFunction" }],
      },
      {
        // A const nested in a function body is not an exported declaration
        // and must not be reported; only the top-level B is.
        code: `export function f() {
  const A = 1;
}
export const B = 2;`,
        errors: [{ messageId: "constAfterFunction" }],
      },
    ],
  },
);
