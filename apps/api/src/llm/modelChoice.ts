/** The athlete-facing reason a stored model cannot run, naming the fix. */
export function modelChoiceMessage(
  model: string,
  role: "season" | "daily",
  availability: "retired" | "missing",
): string {
  const roleLabel = role === "season" ? "season planning" : "day-to-day";
  const state =
    availability === "retired" ? "is retired" : "is no longer available";
  return `Your ${roleLabel} model ${model} ${state}. Open Settings and choose another model.`;
}
