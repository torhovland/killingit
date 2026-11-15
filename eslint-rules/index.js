/**
 * Local ESLint rules.
 *
 * These rules encode repository conventions that are not covered by the
 * upstream plugins.
 */

/** Requires top-level `export const` declarations to precede `export function`. */
const constsBeforeFunctions = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require exported const declarations to come before exported function declarations.",
    },
    schema: [],
    messages: {
      constAfterFunction:
        "Move this exported const above the exported function declarations.",
    },
  },

  create(context) {
    let seenExportedFunction = false;

    return {
      ExportNamedDeclaration(node) {
        if (node.declaration?.type === "FunctionDeclaration") {
          seenExportedFunction = true;
          return;
        }

        if (
          seenExportedFunction &&
          node.declaration?.type === "VariableDeclaration" &&
          node.declaration.kind === "const"
        ) {
          context.report({ node, messageId: "constAfterFunction" });
        }
      },
    };
  },
};

/**
 * Requires a JSX `className` to be composed with `cn()`, not a template
 * literal. `cn()` merges conflicting utilities and drops empty fragments, so a
 * conditional class never leaves a stray space or skips tailwind-merge. A
 * template literal passed to `cn()` is the intended dynamic input and stays
 * allowed.
 */
const noTemplateClassName = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow template literals as a JSX className value; compose the classes with cn().",
    },
    schema: [],
    messages: {
      templateClassName:
        "Compose className with cn() instead of a template literal, so conflicting classes merge and empty fragments disappear.",
    },
  },

  create(context) {
    return {
      JSXAttribute(node) {
        if (
          node.name.type !== "JSXIdentifier" ||
          node.name.name !== "className"
        ) {
          return;
        }

        const value = node.value;
        if (
          value?.type === "JSXExpressionContainer" &&
          value.expression.type === "TemplateLiteral"
        ) {
          context.report({ node: value, messageId: "templateClassName" });
        }
      },
    };
  },
};

export default {
  rules: {
    "consts-before-functions": constsBeforeFunctions,
    "no-template-classname": noTemplateClassName,
  },
};
