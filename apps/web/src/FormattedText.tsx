import { Fragment, type ReactNode } from "react";

type TextBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "ordered"; items: string[]; start: number };

const BULLET_LINE = /^\s*[-*•]\s+(.*)$/;
const NUMBERED_LINE = /^\s*(\d+)[.)]\s+(.*)$/;

/**
 * Renders the coach's long text. The model is asked for blank-line-separated
 * paragraphs, "- " bullets and "1. " numbered items, so those become real HTML
 * paragraphs and lists instead of literal marker text. Inline "**bold**" is
 * supported as a safety net for a model that adds it anyway.
 */
export function FormattedText({
  text,
  className,
  testId,
}: {
  text: string;
  className?: string;
  /** Test id for the wrapper, so callers keep their existing hooks. */
  testId?: string;
}) {
  const blocks = parseTextBlocks(text);
  if (blocks.length === 0) {
    return null;
  }
  return (
    <div
      className={
        className ? `flex flex-col gap-2 ${className}` : "flex flex-col gap-2"
      }
      data-testid={testId}
    >
      {blocks.map((block, index) => {
        if (block.kind === "paragraph") {
          return <p key={index}>{renderInline(block.text)}</p>;
        }
        if (block.kind === "bullets") {
          return (
            <ul key={index} className="list-disc pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        return (
          <ol
            key={index}
            className="list-decimal pl-5"
            start={block.start === 1 ? undefined : block.start}
          >
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item)}</li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}

/** Splits the coach text into paragraphs and lists. */
function parseTextBlocks(text: string): TextBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: TextBlock[] = [];
  let paragraph: string[] = [];
  let list: Extract<TextBlock, { kind: "bullets" | "ordered" }> | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    const joined = paragraph.join(" ").trim();
    if (joined !== "") {
      blocks.push({ kind: "paragraph", text: joined });
    }
    paragraph = [];
  };
  const flushList = () => {
    if (list !== null) {
      blocks.push(list);
      list = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      // A blank line ends a paragraph. Keep a list open so a model that leaves
      // an empty line between items still produces one HTML list.
      flushParagraph();
      continue;
    }

    const bullet = BULLET_LINE.exec(line);
    if (bullet !== null) {
      flushParagraph();
      if (list?.kind !== "bullets") {
        flushList();
        list = { kind: "bullets", items: [] };
      }
      list.items.push(bullet[1]?.trim() ?? "");
      continue;
    }

    const numbered = NUMBERED_LINE.exec(line);
    if (numbered !== null) {
      flushParagraph();
      if (list?.kind !== "ordered") {
        flushList();
        list = {
          kind: "ordered",
          items: [],
          start: Number(numbered[1]),
        };
      }
      list.items.push(numbered[2]?.trim() ?? "");
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Renders "**bold**" as strong while leaving every other character alone. */
function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*.+?\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}
