const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;

const FALLBACK_LOCALES = ["original", "zh-TW", "zh-CN", "ja-JP"];
const SUPPORTED_LOCALES =
  Array.isArray(window.__SUPPORTED_LOCALES__) && window.__SUPPORTED_LOCALES__.length > 0
    ? window.__SUPPORTED_LOCALES__
    : FALLBACK_LOCALES;

const cursorSettingsSelect = document.getElementById("cursorSettingsSelect");
const systemLocaleSelect = document.getElementById("systemLocaleSelect");
const uninstallButton = document.getElementById("uninstallButton");
const disclaimerToggle = document.getElementById("disclaimerToggle");
const disclaimerContent = document.getElementById("disclaimerContent");
const disclaimerArrow = document.getElementById("disclaimerArrow");
const i18nNodes = Array.from(document.querySelectorAll("[data-i18n]"));
const LANGUAGE_OPTION_I18N_KEYS = new Set([
  "languageOptionOriginal",
  "languageOptionTraditionalChinese",
  "languageOptionSimplifiedChinese",
  "languageOptionJapanese",
]);
const i18nVariables = {
  appName: document.documentElement.dataset.appName || "Cursor",
  extensionName: document.documentElement.dataset.extensionName || "Cursor 語言切換",
  version: document.documentElement.dataset.version || "0.0.0",
};

function applyTemplateVariables(rawText) {
  if (typeof rawText !== "string") return rawText;
  return rawText.replace(/\{\{\s*(appName|extensionName|version)\s*\}\}/g, (_, key) =>
    i18nVariables[key] || "",
  );
}

function applyI18n() {
  if (!window.cursorI18nPackage || typeof window.cursorI18nPackage.getDictionary !== "function") {
    return;
  }
  const htmlLocale = document.documentElement.dataset.locale || navigator.language;
  const { locale, texts } = window.cursorI18nPackage.getDictionary(htmlLocale);
  document.documentElement.lang = locale;
  for (const node of i18nNodes) {
    const key = node.dataset.i18n;
    if (LANGUAGE_OPTION_I18N_KEYS.has(key)) continue;
    if (!key || !texts[key]) continue;
    node.textContent = applyTemplateVariables(texts[key]);
  }
}

function normalizeLocaleValue(raw) {
  if (typeof raw !== "string") return "original";
  return SUPPORTED_LOCALES.includes(raw) ? raw : "original";
}

function applyLanguageSelectFont(selectNode, localeValue) {
  if (!selectNode) return;
  const normalized = normalizeLocaleValue(localeValue);
  selectNode.setAttribute("data-selected-locale", normalized);
}

function updateState(state) {
  if (!state) return;

  const cursorBusy = Boolean(state.isRunning);
  const systemBusy = Boolean(state.isSystemLocaleRunning);
  const uninstallBusy = cursorBusy || systemBusy;
  const cursorLocale = normalizeLocaleValue(state.cursorSettingsLocale);
  const systemLocale = normalizeLocaleValue(state.systemLocale);
  if (cursorSettingsSelect) {
    cursorSettingsSelect.disabled = cursorBusy;
    cursorSettingsSelect.value = cursorLocale;
  }
  if (systemLocaleSelect) {
    systemLocaleSelect.disabled = systemBusy;
    systemLocaleSelect.value = systemLocale;
  }
  if (uninstallButton) {
    uninstallButton.disabled = uninstallBusy;
  }
  applyLanguageSelectFont(cursorSettingsSelect, cursorLocale);
  applyLanguageSelectFont(systemLocaleSelect, systemLocale);
}

function getPreviewState() {
  return {
    isRunning: false,
    isSystemLocaleRunning: false,
    cursorSettingsLocale: "original",
    systemLocale: "original",
  };
}

if (cursorSettingsSelect) {
  applyLanguageSelectFont(cursorSettingsSelect, cursorSettingsSelect.value);
  cursorSettingsSelect.addEventListener("change", () => {
    if (cursorSettingsSelect.disabled) return;
    const nextLocale = normalizeLocaleValue(cursorSettingsSelect.value);
    applyLanguageSelectFont(cursorSettingsSelect, nextLocale);
    if (!vscode) {
      updateState({ isRunning: false, cursorSettingsLocale: nextLocale });
      return;
    }
    vscode.postMessage({ type: "setCursorSettingsLocale", locale: nextLocale });
  });
}

if (systemLocaleSelect) {
  applyLanguageSelectFont(systemLocaleSelect, systemLocaleSelect.value);
  systemLocaleSelect.addEventListener("change", () => {
    if (systemLocaleSelect.disabled) return;
    const nextLocale = normalizeLocaleValue(systemLocaleSelect.value);
    applyLanguageSelectFont(systemLocaleSelect, nextLocale);
    if (!vscode) {
      updateState({ isSystemLocaleRunning: false, systemLocale: nextLocale });
      return;
    }
    vscode.postMessage({ type: "setSystemLocale", locale: nextLocale });
  });
}

if (uninstallButton) {
  uninstallButton.addEventListener("click", () => {
    if (uninstallButton.disabled) return;
    if (!vscode) return;
    vscode.postMessage({ type: "uninstallSelf" });
  });
}

if (disclaimerToggle && disclaimerContent) {
  disclaimerToggle.addEventListener("click", () => {
    const willExpand = disclaimerContent.classList.contains("is-collapsed");
    disclaimerContent.classList.toggle("is-collapsed", !willExpand);
    disclaimerToggle.setAttribute("aria-expanded", willExpand ? "true" : "false");
    if (disclaimerArrow) {
      disclaimerArrow.textContent = willExpand ? "▴" : "▾";
    }
  });
}

applyI18n();

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "state") return;
  updateState(data.payload);
});

if (!vscode) {
  updateState(getPreviewState());
}
