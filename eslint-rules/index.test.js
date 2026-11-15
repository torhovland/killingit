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
