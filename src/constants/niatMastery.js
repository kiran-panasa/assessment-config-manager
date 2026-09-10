// Display labels only — actual categorization runs server-side at sync time
// (server/src/lib/niatCategorize.js) and is stored per-record as `masteryType`,
// so there's no risk of the frontend and backend disagreeing.
export const MASTERY_LABELS = {
  product: "Product Mastery",
  systems: "Systems Mastery",
  other: "Uncategorized",
};
