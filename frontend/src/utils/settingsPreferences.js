export const SETTINGS_PREFERENCE_TOGGLES = Object.freeze([
  Object.freeze({
    apiKey: "darkMode",
    dbKey: "dark_mode",
    iconKey: "darkMode",
    titleKey: "darkModeTitle",
    descriptionKey: "darkModeDesc",
  }),
  Object.freeze({
    apiKey: "budgetGuardrails",
    dbKey: "budget_guardrails",
    iconKey: "budgetGuardrails",
    titleKey: "budgetGuardrailsTitle",
    descriptionKey: "budgetGuardrailsDesc",
  }),
  Object.freeze({
    apiKey: "autoAnalyzeInvoices",
    dbKey: "auto_analyze_invoices",
    iconKey: "autoAnalyzeInvoices",
    titleKey: "autoAnalyzeTitle",
    descriptionKey: "autoAnalyzeDesc",
  }),
]);

export function createPreferenceTogglePatch(preferences, definition) {
  return { [definition.apiKey]: !Boolean(preferences?.[definition.dbKey]) };
}
