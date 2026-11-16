/**
 * Local ESLint rules.
 *
 * These rules encode repository conventions that are not covered by the
 * upstream plugins.
 */

/**
 * Requires top-level `export const` declarations to precede exported function
 * declarations.
 *
 * An exported function declaration is either `export function` or
 * `export default function`; the latter wraps the declaration in an
 * `ExportDefaultDeclaration`, so it needs its own visitor.
 *
 * A declaration-less `export { x }` is deliberately not inspected. The
 * specifier may name a function, a const, an import, a re-export, a class or a
 * type, and the rule would have to compare the declaration's position rather
 * than the export statement's to match its message. Resolving the binding would
 * either guess or report a false positive, so this form is a documented
 * limitation rather than a rule.
 */
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
      ExportDefaultDeclaration(node) {
        if (node.declaration.type === "FunctionDeclaration") {
          seenExportedFunction = true;
        }
      },

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
 * conditional class never leaves a stray space or skips tailwind-merge. The
 * rule covers a template literal assigned to a variable that is later passed
 * directly as `className` too, but a template literal passed to `cn()` is the
 * intended dynamic input and stays allowed.
 */
const noTemplateClassName = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow template literals as a JSX className value, directly or through a variable; compose the classes with cn().",
    },
    schema: [],
    messages: {
      templateClassName:
        "Compose className with cn() instead of a template literal, so conflicting classes merge and empty fragments disappear.",
    },
  },

  create(context) {
    const templateVariables = new WeakSet();

    return {
      VariableDeclarator(node) {
        if (
          node.id.type !== "Identifier" ||
          node.init?.type !== "TemplateLiteral"
        ) {
          return;
        }

        for (const variable of context.sourceCode.getDeclaredVariables(node)) {
          templateVariables.add(variable);
        }
      },

      JSXAttribute(node) {
        if (
          node.name.type !== "JSXIdentifier" ||
          node.name.name !== "className"
        ) {
          return;
        }

        const value = node.value;
        if (value?.type !== "JSXExpressionContainer") {
          return;
        }

        const expression = value.expression;
        if (expression.type === "TemplateLiteral") {
          context.report({ node: value, messageId: "templateClassName" });
          return;
        }

        if (expression.type !== "Identifier") {
          return;
        }

        const variable = findVariable(
          context.sourceCode.getScope(expression),
          expression.name,
        );
        if (variable !== null && templateVariables.has(variable)) {
          context.report({ node: value, messageId: "templateClassName" });
        }
      },
    };
  },
};

/** The variable an identifier resolves to, walking the scope chain. */
function findVariable(scope, name) {
  for (let current = scope; current !== null; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) return variable;
  }
  return null;
}

/**
 * Requires an optional value to be forwarded with a `T | undefined` field
 * type, not through a conditional object spread that exists only to satisfy
 * `exactOptionalPropertyTypes`.
 *
 * The rule matches the whole workaround: a spread of either
 * `...(value !== undefined ? { value } : {})` or its reverse, where the object
 * branch's single property forwards the very reference the test compares.
 * A conditional spread with another purpose — an array/prompt fragment, a
 * nullish fallback, an extra condition such as a length check, or a property
 * that transforms the value — is not reported.
 */
const noOptionalSpread = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow conditional object spreads that only work around exactOptionalPropertyTypes.",
    },
    schema: [],
    messages: {
      optionalSpread:
        "Type the field `T | undefined` and forward it directly instead of spreading it conditionally.",
    },
  },

  create(context) {
    return {
      SpreadElement(node) {
        const argument = node.argument;
        if (argument.type !== "ConditionalExpression") {
          return;
        }

        const comparison = undefinedComparison(argument.test);
        if (comparison === null) {
          return;
        }

        const objectBranch = comparison.valueIsConsequent
          ? argument.consequent
          : argument.alternate;
        const emptyBranch = comparison.valueIsConsequent
          ? argument.alternate
          : argument.consequent;
        if (!isEmptyObject(emptyBranch)) {
          return;
        }

        const property = singleProperty(objectBranch);
        if (
          property === null ||
          !sameReference(comparison.subject, property.value)
        ) {
          return;
        }

        context.report({ node, messageId: "optionalSpread" });
      },
    };
  },
};

/** The reference a comparison tests, when it is a bare `undefined` check. */
function undefinedComparison(test) {
  if (test.type !== "BinaryExpression") return null;
  if (test.operator !== "===" && test.operator !== "!==") return null;

  const leftIsUndefined = isUndefined(test.left);
  const rightIsUndefined = isUndefined(test.right);
  if (leftIsUndefined === rightIsUndefined) return null;

  return {
    subject: leftIsUndefined ? test.right : test.left,
    // `value !== undefined` keeps the object in the consequent; `===` swaps it.
    valueIsConsequent: test.operator === "!==",
  };
}

function isUndefined(node) {
  return node.type === "Identifier" && node.name === "undefined";
}

function isEmptyObject(node) {
  return node.type === "ObjectExpression" && node.properties.length === 0;
}

/** The only property of a plain object literal, or null for any other shape. */
function singleProperty(node) {
  if (node.type !== "ObjectExpression" || node.properties.length !== 1) {
    return null;
  }
  const [property] = node.properties;
  if (property.type !== "Property" || property.computed) {
    return null;
  }
  return property;
}

/**
 * Compares two member paths, ignoring optional chaining. `stored?.route` and
 * `stored.route` are the same reference for this rule's purpose.
 */
function referencePath(node) {
  if (node.type === "ChainExpression") return referencePath(node.expression);
  if (node.type === "Identifier") return { root: node.name, path: [] };
  if (
    node.type !== "MemberExpression" ||
    node.computed ||
    node.property.type !== "Identifier"
  ) {
    return null;
  }
  const object = referencePath(node.object);
  return object === null
    ? null
    : { root: object.root, path: [...object.path, node.property.name] };
}

function sameReference(left, right) {
  const a = referencePath(left);
  const b = referencePath(right);
  return (
    a !== null &&
    b !== null &&
    a.root === b.root &&
    a.path.length === b.path.length &&
    a.path.every((part, index) => part === b.path[index])
  );
}

export default {
  rules: {
    "consts-before-functions": constsBeforeFunctions,
    "no-optional-spread": noOptionalSpread,
    "no-template-classname": noTemplateClassName,
  },
};
