import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createPreferenceTogglePatch,
  SETTINGS_PREFERENCE_TOGGLES,
} from "../frontend/src/utils/settingsPreferences.js";

test("settings expose only supported non-email preference toggles", () => {
  assert.deepEqual(
    SETTINGS_PREFERENCE_TOGGLES.map(({ apiKey, dbKey }) => ({ apiKey, dbKey })),
    [
      { apiKey: "darkMode", dbKey: "dark_mode" },
      { apiKey: "budgetGuardrails", dbKey: "budget_guardrails" },
      { apiKey: "autoAnalyzeInvoices", dbKey: "auto_analyze_invoices" },
    ],
  );
  assert.equal(
    SETTINGS_PREFERENCE_TOGGLES.some((definition) => /email/i.test(`${definition.apiKey} ${definition.dbKey}`)),
    false,
  );
});

test("preference toggle patches invert only the selected persisted value", () => {
  const guardrailDefinition = SETTINGS_PREFERENCE_TOGGLES.find(
    ({ apiKey }) => apiKey === "budgetGuardrails",
  );

  assert.deepEqual(
    createPreferenceTogglePatch({ budget_guardrails: true }, guardrailDefinition),
    { budgetGuardrails: false },
  );
  assert.deepEqual(
    createPreferenceTogglePatch({ budget_guardrails: false }, guardrailDefinition),
    { budgetGuardrails: true },
  );
});

test("settings UI and translations no longer expose the email-alert preference", () => {
  const settingsSource = readFileSync(
    new URL("../frontend/src/pages/Settings.jsx", import.meta.url),
    "utf8",
  );
  const translationsSource = readFileSync(
    new URL("../frontend/src/i18n/translations.js", import.meta.url),
    "utf8",
  );

  for (const removedToken of [
    "emailAlerts",
    "email_alerts",
    "emailAlertsTitle",
    "emailAlertsDesc",
    "Email alerts",
    "Cảnh báo email",
  ]) {
    assert.equal(settingsSource.includes(removedToken), false, `${removedToken} remains in Settings.jsx`);
    assert.equal(translationsSource.includes(removedToken), false, `${removedToken} remains in translations.js`);
  }
});

test("preferences API, database service, and fresh schema omit the removed field", () => {
  const runtimeSources = [
    "../src/handlers/profileHandler.js",
    "../src/services/db.service.js",
    "../schema.sql",
  ].map((relativePath) => ({
    relativePath,
    source: readFileSync(new URL(relativePath, import.meta.url), "utf8"),
  }));

  for (const { relativePath, source } of runtimeSources) {
    assert.equal(source.includes("emailAlerts"), false, `emailAlerts remains in ${relativePath}`);
    assert.equal(source.includes("email_alerts"), false, `email_alerts remains in ${relativePath}`);
  }
});
