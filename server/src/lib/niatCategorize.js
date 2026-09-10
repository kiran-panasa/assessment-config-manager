// Interview Coordinator has no dedicated "program" or "mastery type" field —
// interviews are matched by their template name instead. Tune these three
// substrings if real synced data doesn't match as expected.
// Kept in sync with src/constants/niatMastery.js (display labels only) on the frontend.

export const NIAT_TEMPLATE_MATCH = "niat";
export const PRODUCT_MASTERY_MATCH = "product mastery";
export const SYSTEMS_MASTERY_MATCH = "systems mastery";

export function isNiatInterview(templateName = "") {
  return templateName.toLowerCase().includes(NIAT_TEMPLATE_MATCH);
}

export function categorizeMastery(templateName = "") {
  const t = templateName.toLowerCase();
  if (t.includes(PRODUCT_MASTERY_MATCH)) return "product";
  if (t.includes(SYSTEMS_MASTERY_MATCH)) return "systems";
  return "other";
}
