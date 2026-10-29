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

export default {
  rules: {
    "consts-before-functions": constsBeforeFunctions,
  },
};
