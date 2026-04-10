"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const vscode = require("vscode");
const { applyPatch } = require("./scripts/cursor-patcher");
const { restoreOriginal } = require("./scripts/restore-cursor");
const { findCursorAppInstall } = require("./scripts/cursor-shared");

const CURSOR_SETTINGS_KEY = "cursorZhPatch.settingsLocale";
const SYSTEM_LOCALE_KEY = "cursorZhPatch.systemLocale";
const LEGACY_BOOL_KEY = "cursorZhPatch.enableTraditionalChinese";
const DEFAULT_LOCALE = "original";
// 維護提醒：新增語言時請同步更新 main.js、media/i18n-package.js、media/panel.js、
// package.json、package.nls*.json、scripts/cursor-patcher.js 與 translations/settings.<locale>.json。
// 完整清單請見 README「新增語言需同步修改清單」章節。
const LOCALES = ["original", "zh-TW", "zh-CN", "ja-JP"];

const VIEW_ID = "cursorZhPatch.controlView";
const COMMAND_SET_ORIGINAL = "cursorZhPatch.setLocaleOriginal";
const COMMAND_SET_ZH_TW = "cursorZhPatch.setLocaleZhTW";
const COMMAND_SET_ZH_CN = "cursorZhPatch.setLocaleZhCN";
const COMMAND_SET_JA_JP = "cursorZhPatch.setLocaleJaJP";
const COMMAND_RELOAD = "cursorZhPatch.reloadWindow";
const FIRST_INSTALL_RELOAD_HINT_KEY = "cursorZhPatch.firstInstallReloadHintShown";
const LAST_PATCHED_CURSOR_SIGNATURE_KEY = "cursorZhPatch.lastPatchedCursorSignature";
const ZH_HANT_LANGUAGE_PACK_ID = "ms-ceintl.vscode-language-pack-zh-hant";
const ZH_HANS_LANGUAGE_PACK_ID = "ms-ceintl.vscode-language-pack-zh-hans";
const JA_LANGUAGE_PACK_ID = "ms-ceintl.vscode-language-pack-ja";

let isRunning = false;
let isSystemLocaleRunning = false;
let isInternalConfigUpdate = false;
let isInternalSystemLocaleConfigUpdate = false;
let isUninstallingSelf = false;
let panelProvider = null;
let userBaselinePath = null;
let extensionId = "";

function getCurrentCursorInstallSignature() {
    try {
        const install = findCursorAppInstall();
        if (!install || !install.appRoot) {
            return "";
        }

        const productJsonPath = path.join(install.appRoot, "product.json");
        let version = "";
        if (fs.existsSync(productJsonPath)) {
            try {
                const productRaw = fs.readFileSync(productJsonPath, "utf8");
                const productJson = JSON.parse(productRaw);
                if (productJson && typeof productJson.version === "string") {
                    version = productJson.version.trim();
                }
            } catch {
                version = "";
            }
        }

        const workbenchPath = path.join(
            install.appRoot,
            "out",
            "vs",
            "workbench",
            "workbench.desktop.main.js",
        );
        let fallbackSignature = "";
        if (fs.existsSync(workbenchPath)) {
            const stat = fs.statSync(workbenchPath);
            fallbackSignature = `${stat.size}:${Math.floor(stat.mtimeMs)}`;
        }

        if (version && fallbackSignature) {
            return `version:${version}|workbench:${fallbackSignature}`;
        }
        if (version) {
            return `version:${version}`;
        }
        if (fallbackSignature) {
            return `workbench:${fallbackSignature}`;
        }
        return "";
    } catch {
        return "";
    }
}

async function tryAutoReapplyOnCursorUpdate(context) {
    const locale = getCurrentCursorSettingsLocale();
    if (!locale || locale === "original") {
        return;
    }

    const currentSignature = getCurrentCursorInstallSignature();
    if (!currentSignature) {
        return;
    }

    const lastSignature = String(
        context.globalState.get(LAST_PATCHED_CURSOR_SIGNATURE_KEY, ""),
    ).trim();

    if (lastSignature === currentSignature) {
        return;
    }

    const result = await runCursorSettingsSwitch(locale, { suppressReloadPrompt: true });
    if (result && result.ok) {
        await context.globalState.update(LAST_PATCHED_CURSOR_SIGNATURE_KEY, currentSignature);
        void vscode.window.showInformationMessage("已偵測到 Cursor 更新，已自動重新套用語言設定。");
    }
}

function resolveSystemAppName() {
    const appName = String(vscode.env.appName || "").trim();
    if (!appName) return "Cursor";
    const normalized = appName.replace(/\s+/g, " ");
    if (normalized.toLowerCase().includes("cursor")) {
        return "Cursor";
    }
    return normalized;
}

function resolveLocalizedExtensionName(locale) {
    const appName = resolveSystemAppName();
    if (locale === "zh-Hans") return `${appName} 语言切换`;
    if (locale === "ja-JP") return `${appName} 言語切替`;
    if (locale === "en") return `${appName} Language Toggle`;
    return `${appName} 語言切換`;
}

class ControlPanelViewProvider {
    constructor(extensionUri, extensionVersion) {
        this.extensionUri = extensionUri;
        this.extensionVersion = extensionVersion || "0.0.0";
        this.view = null;
    }

    resolveWebviewView(webviewView) {
        this.view = webviewView;
        const webview = webviewView.webview;
        const mediaRoot = vscode.Uri.joinPath(this.extensionUri, "media");
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "panel.css"));
        const i18nPackageUri = webview.asWebviewUri(
            vscode.Uri.joinPath(mediaRoot, "i18n-package.js"),
        );
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "panel.js"));
        const nonce = getNonce();

        webview.options = {
            enableScripts: true,
            localResourceRoots: [mediaRoot],
        };
        webview.html = this.getHtml({
            cssUri,
            i18nPackageUri,
            jsUri,
            nonce,
            cspSource: webview.cspSource,
            locale: vscode.env.language,
            supportedLocales: LOCALES,
        });
        webview.onDidReceiveMessage(async (message) => {
            if (!message || typeof message.type !== "string") return;

            switch (message.type) {
                case "setCursorSettingsLocale":
                    if (typeof message.locale !== "string") return;
                    await handleSetCursorSettingsLocale(message.locale);
                    break;
                case "setSystemLocale":
                    if (typeof message.locale !== "string") return;
                    await handleSetSystemLocale(message.locale);
                    break;
                case "uninstallSelf":
                    await runUninstallFlow();
                    break;
                default:
                    break;
            }
        });

        this.postState(getPanelState());
    }

    postState(state) {
        if (!this.view) return;
        this.view.webview.postMessage({
            type: "state",
            payload: state,
        });
    }

    getHtml({ cssUri, i18nPackageUri, jsUri, nonce, cspSource, locale, supportedLocales }) {
        const localesJson = JSON.stringify(supportedLocales);
        const normalizedLocale = normalizeUiLocale(locale);
        const appName = resolveSystemAppName();
        const extensionName = resolveLocalizedExtensionName(normalizedLocale);
        return `<!DOCTYPE html>
<html lang="zh-Hant" data-locale="${locale}" data-app-name="${escapeHtmlAttribute(appName)}" data-extension-name="${escapeHtmlAttribute(extensionName)}" data-version="${escapeHtmlAttribute(this.extensionVersion)}">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https:; style-src ${cspSource}; script-src ${cspSource} 'nonce-${nonce}';">
    <link rel="stylesheet" href="${cssUri}" />
    <title data-i18n="pageTitle">${escapeHtml(extensionName)}</title>
</head>
<body>
    <main class="sidebar">
        <header class="topbar">
            <h1 data-i18n="panelTitle">${escapeHtml(extensionName)}</h1>
            <button class="uninstall-button" type="button" id="uninstallButton" data-i18n="uninstallButtonLabel">解除安裝</button>
        </header>

        <nav class="menu">
            <section class="menu-item menu-group">
                <div class="group-content">
                    <label class="status-caption" for="cursorSettingsSelect" data-i18n="cursorSettingsSelectLabel">${escapeHtml(appName)} 設定選單</label>
                    <select class="language-select" id="cursorSettingsSelect">
                        <option value="original" lang="en" data-locale-option="original" data-i18n="languageOptionOriginal">English</option>
                        <option value="zh-TW" lang="zh-Hant" data-locale-option="zh-TW" data-i18n="languageOptionTraditionalChinese">繁體中文</option>
                        <option value="zh-CN" lang="zh-Hans" data-locale-option="zh-CN" data-i18n="languageOptionSimplifiedChinese">简体中文</option>
                        <option value="ja-JP" lang="ja-JP" data-locale-option="ja-JP" data-i18n="languageOptionJapanese">日本語</option>
                    </select>
                </div>
                <div class="group-content">
                    <label class="status-caption" for="systemLocaleSelect" data-i18n="systemLocaleSelectLabel">系統語系選單</label>
                    <select class="language-select" id="systemLocaleSelect">
                        <option value="original" lang="en" data-locale-option="original" data-i18n="languageOptionOriginal">English</option>
                        <option value="zh-TW" lang="zh-Hant" data-locale-option="zh-TW" data-i18n="languageOptionTraditionalChinese">繁體中文</option>
                        <option value="zh-CN" lang="zh-Hans" data-locale-option="zh-CN" data-i18n="languageOptionSimplifiedChinese">简体中文</option>
                        <option value="ja-JP" lang="ja-JP" data-locale-option="ja-JP" data-i18n="languageOptionJapanese">日本語</option>
                    </select>
                </div>
            </section>
            <section class="menu-item disclaimer-card">
                <button class="disclaimer-toggle" type="button" id="disclaimerToggle" aria-expanded="false" aria-controls="disclaimerContent">
                    <span data-i18n="guideTitle">使用說明</span>
                    <span class="disclaimer-arrow" id="disclaimerArrow">▾</span>
                </button>
                <p class="disclaimer-summary" data-i18n="guideSummary">本工具僅提供語言切換與還原，請先閱讀完整說明。</p>
                <div class="disclaimer-content is-collapsed" id="disclaimerContent">
                    <p data-i18n="guideFeature">功能說明：本工具僅提供語言切換與還原功能。</p>
                    <p data-i18n="guideCompatibility">適用版本：適用於 Cursor 版本 3.0.13 以上。</p>
                    <p data-i18n="guideRisk">風險提示：版本更新或環境差異可能造成部分翻譯失效或顯示異常。</p>
                    <p data-i18n="guidePrivacy">隱私聲明：本工具不蒐集、不上傳、不分享任何個人資料。</p>
                    <p data-i18n="guideLiability">責任限制：本工具按現況提供，請自行評估並承擔使用風險。</p>
                    <p data-i18n="guideRestore">還原建議：如遇異常，請先還原英文並重啟視窗。</p>
                    <p class="disclaimer-updated" data-i18n="currentVersion">目前版本：${escapeHtml(this.extensionVersion)}</p>
                </div>
            </section>
        </nav>
    </main>
    <script nonce="${nonce}">window.__SUPPORTED_LOCALES__=${localesJson};</script>
    <script nonce="${nonce}" src="${i18nPackageUri}"></script>
    <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
    }
}

function getCurrentCursorSettingsLocale() {
    const config = vscode.workspace.getConfiguration();
    const locale = config.get(CURSOR_SETTINGS_KEY, DEFAULT_LOCALE);
    return LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
}

function getCurrentSystemLocale() {
    const activeLocale = getActiveSystemLocaleFromUi();
    if (activeLocale) {
        return activeLocale;
    }

    const argvLocale = readSystemLocaleFromArgv();
    if (argvLocale && LOCALES.includes(argvLocale)) {
        return argvLocale;
    }

    const config = vscode.workspace.getConfiguration();
    const locale = config.get(SYSTEM_LOCALE_KEY, DEFAULT_LOCALE);
    return LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
}

function getActiveSystemLocaleFromUi() {
    const activeUiLocale = normalizeUiLocale(vscode.env.language);
    if (activeUiLocale === "zh-Hant") return "zh-TW";
    if (activeUiLocale === "zh-Hans") return "zh-CN";
    if (activeUiLocale === "ja-JP") return "ja-JP";
    if (activeUiLocale === "en") return "original";
    return null;
}

function getPanelState() {
    return {
        isRunning,
        isSystemLocaleRunning,
        cursorSettingsLocale: getCurrentCursorSettingsLocale(),
        systemLocale: getCurrentSystemLocale(),
    };
}

function broadcastPanelState() {
    if (!panelProvider) return;
    panelProvider.postState(getPanelState());
}

function getNonce() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let text = "";
    for (let i = 0; i < 32; i += 1) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

function escapeHtmlAttribute(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

const LOCALE_PROGRESS_TITLES = {
    original: "正在還原英文...",
    "zh-TW": "正在套用繁體中文...",
    "zh-CN": "正在套用簡體中文...",
    "ja-JP": "日本語を適用中...",
};

const LOCALE_COMPLETION_MESSAGES = {
    original: "已還原英文。建議立即重啟視窗以生效。",
    "zh-TW": "已套用繁體中文。建議立即重啟視窗以生效。",
    "zh-CN": "已套用簡體中文。建議立即重啟視窗以生效。",
    "ja-JP": "日本語を適用しました。反映するにはウィンドウの再読み込みをおすすめします。",
};

const SYSTEM_LOCALE_PROGRESS_TITLES = {
    original: "正在切換系統語系為英文...",
    "zh-TW": "正在切換系統語系為繁體中文...",
    "zh-CN": "正在切換系統語系為簡體中文...",
    "ja-JP": "正在切換系統語系為日文...",
};

const SYSTEM_DISPLAY_LOCALE_MAP = {
    original: "en",
    "zh-TW": "zh-tw",
    "zh-CN": "zh-cn",
    "ja-JP": "ja",
};

const DISPLAY_TO_SYSTEM_LOCALE_MAP = {
    en: "original",
    "zh-tw": "zh-TW",
    "zh-cn": "zh-CN",
    "zh-hant": "zh-TW",
    "zh-hans": "zh-CN",
    ja: "ja-JP",
};

function resolveArgvJsonPath() {
    const cursorHomeArgvPath = path.join(os.homedir(), ".cursor", "argv.json");
    if (fs.existsSync(cursorHomeArgvPath)) {
        return cursorHomeArgvPath;
    }
    if (process.env.VSCODE_PORTABLE) {
        return path.join(process.env.VSCODE_PORTABLE, "user-data", "argv.json");
    }
    if (process.platform === "darwin") {
        return path.join(os.homedir(), "Library", "Application Support", vscode.env.appName, "argv.json");
    }
    if (process.platform === "win32") {
        const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
        return path.join(appData, vscode.env.appName, "argv.json");
    }
    const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    return path.join(xdgConfigHome, vscode.env.appName.toLowerCase(), "argv.json");
}

function readSystemLocaleFromArgv() {
    const argvPath = resolveArgvJsonPath();
    if (!fs.existsSync(argvPath)) {
        return null;
    }

    try {
        const raw = fs.readFileSync(argvPath, "utf8");
        if (!raw.trim()) {
            return null;
        }
        const match = raw.match(/"locale"\s*:\s*"([^"]+)"/m);
        const displayLocale = String((match && match[1]) || "")
            .trim()
            .toLowerCase();
        if (!displayLocale) {
            return null;
        }
        return DISPLAY_TO_SYSTEM_LOCALE_MAP[displayLocale] || null;
    } catch {
        return null;
    }
}

function progressTitleForLocale(locale) {
    return LOCALE_PROGRESS_TITLES[locale] ?? LOCALE_PROGRESS_TITLES["zh-TW"];
}

function completionMessageForLocale(locale) {
    return LOCALE_COMPLETION_MESSAGES[locale] ?? LOCALE_COMPLETION_MESSAGES["zh-TW"];
}

function systemProgressTitleForLocale(locale) {
    return SYSTEM_LOCALE_PROGRESS_TITLES[locale] ?? SYSTEM_LOCALE_PROGRESS_TITLES["zh-TW"];
}

function normalizeUiLocale(rawLocale) {
    const locale = String(rawLocale || "").toLowerCase();
    if (locale.startsWith("zh-cn") || locale.startsWith("zh-sg") || locale.startsWith("zh-hans")) {
        return "zh-Hans";
    }
    if (locale.startsWith("zh")) {
        return "zh-Hant";
    }
    if (locale.startsWith("ja")) {
        return "ja-JP";
    }
    return "en";
}

function getUninstallConfirmTexts() {
    const locale = normalizeUiLocale(vscode.env.language);
    if (locale === "zh-Hans") {
        return {
            message: "确认要解除安装此插件吗？",
            confirm: "继续",
            cancel: "取消",
        };
    }
    if (locale === "ja-JP") {
        return {
            message: "この拡張機能をアンインストールしますか？",
            confirm: "続行",
            cancel: "キャンセル",
        };
    }
    if (locale === "en") {
        return {
            message: "Do you want to uninstall this extension?",
            confirm: "Continue",
            cancel: "Cancel",
        };
    }
    return {
        message: "是否要解除安裝此插件？",
        confirm: "繼續",
        cancel: "取消",
    };
}

function getFirstInstallReloadHintTexts() {
    const locale = normalizeUiLocale(vscode.env.language);
    if (locale === "zh-Hans") {
        return {
            message: "首次安装后，建议重载窗口以套用界面本地化名称。",
            action: "立即重载窗口",
        };
    }
    if (locale === "ja-JP") {
        return {
            message: "初回インストール後、UI のローカライズ名を反映するためウィンドウの再読み込みを推奨します。",
            action: "今すぐ再読み込み",
        };
    }
    if (locale === "en") {
        return {
            message: "After first install, reload the window to apply localized UI names.",
            action: "Reload Window",
        };
    }
    return {
        message: "首次安裝後，建議重啟視窗以套用介面在地化名稱。",
        action: "立即重啟視窗",
    };
}

async function notifyReloadOnFirstInstall(context) {
    const shown = context.globalState.get(FIRST_INSTALL_RELOAD_HINT_KEY, false);
    if (shown) {
        return;
    }

    await context.globalState.update(FIRST_INSTALL_RELOAD_HINT_KEY, true);
    const { message, action } = getFirstInstallReloadHintTexts();
    const pick = await vscode.window.showInformationMessage(message, action);
    if (pick === action) {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
}

function isExtensionInstalled(extensionId) {
    const id = String(extensionId || "").toLowerCase();
    return vscode.extensions.all.some((ext) => String(ext.id || "").toLowerCase() === id);
}

function getLanguagePackIdForLocale(locale) {
    if (locale === "zh-TW") return ZH_HANT_LANGUAGE_PACK_ID;
    if (locale === "zh-CN") return ZH_HANS_LANGUAGE_PACK_ID;
    if (locale === "ja-JP") return JA_LANGUAGE_PACK_ID;
    return null;
}

async function ensureLanguagePackInstalled({ id, displayName }) {
    if (isExtensionInstalled(id)) {
        return { ok: true, installedNow: false };
    }

    try {
        await vscode.commands.executeCommand("workbench.extensions.installExtension", id);
        return { ok: true, installedNow: true };
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        void vscode.window.showWarningMessage(`${displayName}市集安裝失敗：${errMsg}`);
        return { ok: false, installedNow: false };
    }
}

async function runCursorSettingsSwitch(targetLocale, options) {
    const opts = options && typeof options === "object" ? options : {};
    const suppressReloadPrompt = Boolean(opts.suppressReloadPrompt);
    if (!LOCALES.includes(targetLocale)) {
        return;
    }

    if (isRunning) {
        void vscode.window.showWarningMessage("語系切換作業進行中，請稍候。");
        return;
    }

    isRunning = true;
    broadcastPanelState();
    let switchResult = { ok: true, error: "" };
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: progressTitleForLocale(targetLocale),
            cancellable: false,
        },
        async () => {
            try {
                const hasBaseline =
                    typeof userBaselinePath === "string" &&
                    userBaselinePath.length > 0 &&
                    fs.existsSync(userBaselinePath);

                // 首次切換且尚未有 baseline 時，不需要先還原。
                if (targetLocale === "original") {
                    if (hasBaseline) {
                        restoreOriginal({ baselinePath: userBaselinePath, silent: true });
                    }
                } else {
                    if (hasBaseline) {
                        restoreOriginal({ baselinePath: userBaselinePath, silent: true });
                    }
                }

                if (targetLocale !== "original") {
                    applyPatch({
                        locale: targetLocale,
                        baselinePath: userBaselinePath,
                        silent: true,
                    });
                }

                if (!suppressReloadPrompt) {
                    const action = "立即重啟視窗";
                    const message = completionMessageForLocale(targetLocale);
                    const pick = await vscode.window.showInformationMessage(message, action);
                    if (pick === action) {
                        await vscode.commands.executeCommand("workbench.action.reloadWindow");
                    }
                }
            } catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                switchResult = { ok: false, error: errMsg };
                void vscode.window.showErrorMessage(`切換失敗：${errMsg}`);
            } finally {
                isRunning = false;
                broadcastPanelState();
            }
        },
    );
    return switchResult;
}

async function runSystemLocaleSwitch(targetLocale) {
    if (!LOCALES.includes(targetLocale)) {
        return;
    }

    if (isSystemLocaleRunning) {
        void vscode.window.showWarningMessage("系統語系切換作業進行中，請稍候。");
        return;
    }

    isSystemLocaleRunning = true;
    broadcastPanelState();
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: systemProgressTitleForLocale(targetLocale),
            cancellable: false,
        },
        async () => {
            try {
                const nextPackId = getLanguagePackIdForLocale(targetLocale);

                if (nextPackId) {
                    const packDisplayName =
                        targetLocale === "zh-TW"
                            ? "繁中語言包"
                            : targetLocale === "zh-CN"
                              ? "簡中語言包"
                              : "日文語言包";
                    const installResult = await ensureLanguagePackInstalled({
                        id: nextPackId,
                        displayName: packDisplayName,
                    });
                    if (installResult && !installResult.ok) {
                        return;
                    }
                }

                const displayLocale = SYSTEM_DISPLAY_LOCALE_MAP[targetLocale] ?? "en";
                try {
                    await vscode.commands.executeCommand("workbench.action.configureLocale", displayLocale);
                } catch (error) {
                    const errMsg = error instanceof Error ? error.message : String(error);
                    throw new Error(`無法啟動內建語系切換流程：${errMsg}`);
                }
            } catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                void vscode.window.showErrorMessage(`系統語系切換失敗：${errMsg}`);
            } finally {
                isSystemLocaleRunning = false;
                broadcastPanelState();
            }
        },
    );
}

async function handleSetCursorSettingsLocale(targetLocale) {
    if (!LOCALES.includes(targetLocale)) {
        return;
    }
    const config = vscode.workspace.getConfiguration();
    const current = config.get(CURSOR_SETTINGS_KEY, DEFAULT_LOCALE);
    if (current === targetLocale) {
        await runCursorSettingsSwitch(targetLocale);
        return;
    }
    isInternalConfigUpdate = true;
    await config.update(CURSOR_SETTINGS_KEY, targetLocale, vscode.ConfigurationTarget.Global);
}

async function handleSetSystemLocale(targetLocale) {
    if (!LOCALES.includes(targetLocale)) {
        return;
    }
    const config = vscode.workspace.getConfiguration();
    const current = config.get(SYSTEM_LOCALE_KEY, DEFAULT_LOCALE);
    if (current === targetLocale) {
        await runSystemLocaleSwitch(targetLocale);
        return;
    }
    isInternalSystemLocaleConfigUpdate = true;
    await config.update(SYSTEM_LOCALE_KEY, targetLocale, vscode.ConfigurationTarget.Global);
}

async function runUninstallFlow() {
    if (isRunning || isSystemLocaleRunning) {
        void vscode.window.showWarningMessage("目前有語系切換作業進行中，請稍候再試。");
        return;
    }

    const texts = getUninstallConfirmTexts();
    const pick = await vscode.window.showWarningMessage(texts.message, texts.confirm, texts.cancel);
    if (pick !== texts.confirm) {
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "正在還原英文並移除插件...",
            cancellable: false,
        },
        async () => {
            try {
                isUninstallingSelf = true;
                isInternalConfigUpdate = true;
                const config = vscode.workspace.getConfiguration();
                await config.update(CURSOR_SETTINGS_KEY, DEFAULT_LOCALE, vscode.ConfigurationTarget.Global);
                const restoreResult = await runCursorSettingsSwitch(DEFAULT_LOCALE, {
                    suppressReloadPrompt: true,
                });
                if (!restoreResult || !restoreResult.ok) {
                    const reason =
                        restoreResult && typeof restoreResult.error === "string"
                            ? restoreResult.error
                            : "未知錯誤";
                    const hint = reason.includes("尚未建立本機備份")
                        ? "請先在 Cursor 設定選單切換一次語系以建立本機備份，再重新執行卸載。"
                        : "請先確認可正常執行「還原英文」，成功後再重新執行卸載。";
                    void vscode.window.showErrorMessage(
                        `還原英文失敗，已中止卸載：${reason} ${hint}`,
                    );
                    return;
                }
                if (extensionId) {
                    await vscode.commands.executeCommand("workbench.extensions.uninstallExtension", extensionId);
                }
                await vscode.commands.executeCommand("workbench.action.reloadWindow");
            } catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                void vscode.window.showErrorMessage(`移除插件失敗：${errMsg}`);
            } finally {
                isUninstallingSelf = false;
            }
        },
    );
}

async function migrateLegacyBooleanSetting() {
    const config = vscode.workspace.getConfiguration();
    const legacyInspect = config.inspect(LEGACY_BOOL_KEY);
    const legacyGlobal = legacyInspect && legacyInspect.globalValue;
    const legacyWorkspace = legacyInspect && legacyInspect.workspaceValue;
    const legacyFolder = legacyInspect && legacyInspect.workspaceFolderValue;

    const hadLegacyDefined =
        legacyGlobal !== undefined || legacyWorkspace !== undefined || legacyFolder !== undefined;

    if (!hadLegacyDefined) {
        return;
    }

    if (legacyGlobal !== undefined) {
        await config.update(LEGACY_BOOL_KEY, undefined, vscode.ConfigurationTarget.Global);
    }
    if (legacyWorkspace !== undefined) {
        await config.update(LEGACY_BOOL_KEY, undefined, vscode.ConfigurationTarget.Workspace);
    }
    if (legacyFolder !== undefined) {
        await config.update(LEGACY_BOOL_KEY, undefined, vscode.ConfigurationTarget.WorkspaceFolder);
    }
}

async function activate(context) {
    extensionId = context.extension.id;
    fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
    userBaselinePath = path.join(context.globalStorageUri.fsPath, "cursor-original-baseline.json");

    await migrateLegacyBooleanSetting();
    await notifyReloadOnFirstInstall(context);
    await tryAutoReapplyOnCursorUpdate(context);

    panelProvider = new ControlPanelViewProvider(context.extensionUri, context.extension.packageJSON.version);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(VIEW_ID, panelProvider),
        vscode.commands.registerCommand(COMMAND_SET_ORIGINAL, async () => {
            await handleSetCursorSettingsLocale("original");
        }),
        vscode.commands.registerCommand(COMMAND_SET_ZH_TW, async () => {
            await handleSetCursorSettingsLocale("zh-TW");
        }),
        vscode.commands.registerCommand(COMMAND_SET_ZH_CN, async () => {
            await handleSetCursorSettingsLocale("zh-CN");
        }),
        vscode.commands.registerCommand(COMMAND_SET_JA_JP, async () => {
            await handleSetCursorSettingsLocale("ja-JP");
        }),
        vscode.commands.registerCommand(COMMAND_RELOAD, async () => {
            await vscode.commands.executeCommand("workbench.action.reloadWindow");
        }),
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (isUninstallingSelf) {
                return;
            }
            if (event.affectsConfiguration(CURSOR_SETTINGS_KEY)) {
                if (isInternalConfigUpdate) {
                    isInternalConfigUpdate = false;
                }
                const config = vscode.workspace.getConfiguration();
                const locale = config.get(CURSOR_SETTINGS_KEY, DEFAULT_LOCALE);
                await runCursorSettingsSwitch(locale);
                broadcastPanelState();
            }
            if (event.affectsConfiguration(SYSTEM_LOCALE_KEY)) {
                if (isInternalSystemLocaleConfigUpdate) {
                    isInternalSystemLocaleConfigUpdate = false;
                }
                const config = vscode.workspace.getConfiguration();
                const locale = config.get(SYSTEM_LOCALE_KEY, DEFAULT_LOCALE);
                await runSystemLocaleSwitch(locale);
                broadcastPanelState();
            }
        }),
    );
    broadcastPanelState();
}

function deactivate() {}

module.exports = {
    activate,
    deactivate,
};
