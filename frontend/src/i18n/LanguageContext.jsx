import { createContext, useContext, useMemo, useState } from "react";
import { LANGUAGE_STORAGE_KEY, defaultLanguage, translations } from "./translations.js";

const LanguageContext = createContext(null);

function getStoredLanguage() {
  try {
    const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return translations[storedLanguage] ? storedLanguage : defaultLanguage;
  } catch {
    return defaultLanguage;
  }
}

function resolveTranslation(language, key) {
  return key.split(".").reduce((value, segment) => value?.[segment], translations[language]);
}

function interpolate(value, params = {}) {
  if (typeof value !== "string") return value;

  return value.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    return params[name] ?? "";
  });
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(getStoredLanguage);

  function setLanguage(nextLanguage) {
    const safeLanguage = translations[nextLanguage] ? nextLanguage : defaultLanguage;
    setLanguageState(safeLanguage);

    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, safeLanguage);
    } catch {
      // Ignore storage failures so the UI remains usable in private browsing modes.
    }
  }

  const value = useMemo(() => {
    function t(key, params) {
      const translatedValue =
        resolveTranslation(language, key) ?? resolveTranslation(defaultLanguage, key) ?? key;
      return interpolate(translatedValue, params);
    }

    return { language, setLanguage, t };
  }, [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider.");
  }

  return context;
}
