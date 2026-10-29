import { Fragment, type ReactNode } from "react";

/**
 * The middot that separates inline metadata. Its margin is three times the
 * width of the word space it replaces, so dense lines stay easy to scan.
 */
export function Bullet() {
  return <span className="mx-[0.75em]">·</span>;
}

/** Renders inline parts with a bullet between each pair. */
export function Bullets({ parts }: { parts: ReactNode[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <Bullet />}
          {part}
        </Fragment>
      ))}
    </>
  );
}
