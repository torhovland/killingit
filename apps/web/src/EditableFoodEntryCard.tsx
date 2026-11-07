import { useState } from "react";
import type { FoodEntry } from "@killingit/shared";
import { EditFoodEntryForm } from "./EditFoodEntryForm";
import { FoodEntryCard } from "./FoodEntryCard";

/**
 * One meal on the Diet page, with an Edit action that swaps the card for the
 * edit form. The saved meal is handed back so the page can refresh its totals.
 */
export function EditableFoodEntryCard({
  entry,
  onUpdated,
}: {
  entry: FoodEntry;
  onUpdated: (entry: FoodEntry) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <EditFoodEntryForm
        entry={entry}
        onSaved={(saved) => {
          setEditing(false);
          onUpdated(saved);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <FoodEntryCard entry={entry} compact onEdit={() => setEditing(true)} />
  );
}
