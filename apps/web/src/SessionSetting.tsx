import { Bullet } from "./Bullet";

/**
 * Suffix that states whether the coach planned a session indoors or outdoors.
 * Missing is treated as outdoor, but showing no suffix avoids claiming a
 * setting for plans stored before the field existed.
 */
export function SessionSetting({ outdoor }: { outdoor: boolean | undefined }) {
  if (outdoor === undefined) {
    return null;
  }
  return (
    <>
      <Bullet />
      {outdoor ? "outdoor" : "indoor"}
    </>
  );
}
