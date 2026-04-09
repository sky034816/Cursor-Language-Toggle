"use strict";

const fs = require("fs");
const path = require("path");
const { captureBaseline } = require("./restore-cursor");
const {
    CURSOR_PATCH_TARGET_REL_PATHS,
    createScriptIo,
    findCursorAppInstall,
    syncProductChecksums,
} = require("./cursor-shared");

const IS_CLI = require.main === module;
const { out, fail } = createScriptIo(IS_CLI);

/**
 * Cursor 繁體中文補丁整合工具 (安全版)
 * 功能：翻譯 UI + 修復誠信檢查 (isPure: true) + 更新校驗和
 */

const TOOL_ROOT = path.resolve(__dirname, "..");
const TRANSLATION_PATH_BY_LOCALE = {
    "zh-TW": path.join(TOOL_ROOT, "translations", "settings.zh-TW.json"),
    "zh-CN": path.join(TOOL_ROOT, "translations", "settings.zh-CN.json"),
    "ja-JP": path.join(TOOL_ROOT, "translations", "settings.ja-JP.json"),
};

function resolveTranslationPath(locale) {
    const resolved = TRANSLATION_PATH_BY_LOCALE[locale];
    if (!resolved) {
        fail(`不支援的語系：${locale}`);
    }
    return resolved;
}

const RISK_TRANSLATION_KEYS = new Set([
    "files",
    "file",
    "command",
    "commands",
    "model",
    "models",
    "content",
    "id",
    "ids",
    "type",
    "types",
    "role",
    "name",
    "path",
    "uri",
    "url",
    "data",
    "payload",
    "tool",
    "tools",
    "result",
    "results",
    "input",
    "output",
    "image",
    "images",
    "message",
    "messages",
]);

const SAFE_LOWERCASE_SETTINGS_KEYS = new Set([
    "cloud",
]);

const SAFE_EXACT_SETTINGS_KEYS = new Set([
    "Tools",
]);

const SETTINGS_SCOPE_HINTS = [
    "Settings",
    "Cursor Account",
    "Manage Settings",
    "Editor Settings",
    "Keyboard Shortcuts",
    "Indexing",
    "Docs",
    "Notifications",
    "Privacy",
    "Network",
    "Tab",
    "Agent",
    "Subagent",
    "Rules",
    "Skills",
    "Hooks",
    "MCP",
    "Git",
    "Browser",
    "Terminal",
    "Marketplace",
    "Tool",
    "Codebase",
    "Auto",
    "Status Bar",
    "Title Bar",
    "Layout",
];

function readTranslations(filePath) {
    if (!fs.existsSync(filePath)) fail(`找不到翻譯檔：${filePath}`);
    const raw = fs.readFileSync(filePath, "utf8");
    try {
        const parsed = JSON.parse(raw);
        // 備註：
        // 1) 含有 Don\u2019t / haven\u2019t / you\u2019ve 這類字串時，翻譯 key 優先使用 \u2019 版本。
        // 2) 替換層仍允許 ' 與 ’ 互相匹配，兼容不同版本原文字元。
        // 3) 動態模板字串（例如 ${Gs?"\\u2318 + ":"Ctrl + "}Enter 或 ${Gs?"\\u2318":"Ctrl+"}K）必須完整照原文作為 key。
        //    只寫「Submit with ⌘ + Enter」通常不會命中被模板組合出的最終字串。
        // 避免短字串（如 "Show"）先替換，污染長句替換結果。
        return Object.entries(parsed).sort((a, b) => {
            const lenDiff = b[0].length - a[0].length;
            if (lenDiff !== 0) return lenDiff;
            return a[0].localeCompare(b[0]);
        });
    } catch (error) {
        fail(`翻譯檔不是合法 JSON：${error.message}`);
    }
}

function isSafeSettingsKey(source) {
    if (!source || typeof source !== "string") return false;
    const key = source.trim();
    if (!key) return false;

    if (SAFE_EXACT_SETTINGS_KEYS.has(key)) return true;

    if (RISK_TRANSLATION_KEYS.has(key.toLowerCase())) return false;

    const isLowerIdentifier = /^[a-z][a-z0-9_]*$/.test(key);
    if (isLowerIdentifier && !SAFE_LOWERCASE_SETTINGS_KEYS.has(key)) {
        return false;
    }
    if (SAFE_LOWERCASE_SETTINGS_KEYS.has(key)) return true;

    const hasSettingsHint = SETTINGS_SCOPE_HINTS.some((hint) => key.includes(hint));
    if (hasSettingsHint) return true;

    const hasUiPunctuation = /[\s:&\-\.,\(\)\[\]\$\{\}"'`]/.test(key);
    const hasUpperCase = /[A-Z]/.test(key);
    return hasUiPunctuation || hasUpperCase;
}

function escapeTranslationSourceForRegex(source) {
    return source
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/['’]/g, "['’]")
        .replace(/⌘/g, "(?:⌘|\\\\u2318)")
        .replace(/\\\\u2318/g, "(?:⌘|\\\\u2318)");
}

function replaceWithWordBoundaries(text, source, target) {
    const escapedSource = escapeTranslationSourceForRegex(source);
    let pattern = escapedSource;
    if (/^[a-zA-Z0-9_]/.test(source)) pattern = "\\b" + pattern;
    if (/[a-zA-Z0-9_]$/.test(source)) pattern = pattern + "\\b";

    const regex = new RegExp(pattern, "g");
    let count = 0;
    const newText = text.replace(regex, () => {
        count++;
        return target;
    });
    return { text: newText, count };
}

function applyTranslationsToContent(content, translations, useWordBoundary) {
    let nextContent = content;
    const replaced = [];
    for (const [source, target] of translations) {
        if (!isSafeSettingsKey(source)) continue;
        const result = useWordBoundary
            ? replaceWithWordBoundaries(nextContent, source, target)
            : (() => {
                  const escapedSource = escapeTranslationSourceForRegex(source);
                  const regex = new RegExp(escapedSource, "g");
                  let count = 0;
                  const text = nextContent.replace(regex, () => {
                      count++;
                      return target;
                  });
                  return { text, count };
              })();
        if (result.count > 0) {
            nextContent = result.text;
            replaced.push({ source, target, count: result.count });
        }
    }
    return { content: nextContent, replaced };
}

function applyPatch(localeOrOptions) {
    let locale = "zh-TW";
    let baselinePath = "";
    let silent = false;
    if (typeof localeOrOptions === "string") {
        locale = localeOrOptions;
    } else if (localeOrOptions && typeof localeOrOptions === "object") {
        if (typeof localeOrOptions.locale === "string") {
            locale = localeOrOptions.locale;
        }
        if (typeof localeOrOptions.baselinePath === "string" && localeOrOptions.baselinePath.length > 0) {
            baselinePath = localeOrOptions.baselinePath;
        }
        silent = Boolean(localeOrOptions.silent);
    }
    if (locale !== "zh-TW" && locale !== "zh-CN" && locale !== "ja-JP") {
        fail(`不支援的語系：${locale}`);
    }
    const log = silent ? function () {} : out;
    const translations = readTranslations(resolveTranslationPath(locale));

    const install = findCursorAppInstall();
    if (!install) {
        throw new Error("找不到 Cursor 安裝路徑。");
    }
    const { appBasePath, appRoot } = install;

    if (baselinePath && !fs.existsSync(baselinePath)) {
        captureBaseline({ baselinePath, silent });
    }

    const productJsonPath = path.join(appRoot, "product.json");
    const patchTargets = CURSOR_PATCH_TARGET_REL_PATHS.map((relPath) => ({
        relPath,
        fullPath: path.join(appRoot, relPath),
    })).filter((item) => fs.existsSync(item.fullPath));

    log(`>>> 開始處理：${appBasePath}`);
    if (patchTargets.length === 0) {
        throw new Error("找不到可修補的目標檔案。");
    }

    const mergedReplaced = new Map();

    for (const target of patchTargets) {
        const originalContent = fs.readFileSync(target.fullPath, "utf8");
        const useWordBoundary = target.relPath.endsWith(".js");
        const translated = applyTranslationsToContent(
            originalContent,
            translations,
            useWordBoundary,
        );
        let patchedContent = translated.content;

        if (target.relPath === CURSOR_PATCH_TARGET_REL_PATHS[0]) {
            const targetNotify = "_showNotification(){";
            const replacementNotify = "_showNotification(){return;";
            if (patchedContent.includes(targetNotify)) {
                patchedContent = patchedContent.replace(targetNotify, replacementNotify);
                log("[3/4] 已屏蔽損壞通知提示。");
            }

            const isPureRegex = /isPure:([a-z]===[a-z])/;
            if (isPureRegex.test(patchedContent)) {
                patchedContent = patchedContent.replace(isPureRegex, "isPure:!0");
                log("[3/4] 已強制設置 isPure 為 true。");
            }
        }

        fs.writeFileSync(target.fullPath, patchedContent, "utf8");

        for (const item of translated.replaced) {
            const prev = mergedReplaced.get(item.source);
            if (prev) {
                prev.count += item.count;
            } else {
                mergedReplaced.set(item.source, {
                    source: item.source,
                    target: item.target,
                    count: item.count,
                });
            }
        }
    }
    const replaced = Array.from(mergedReplaced.values()).sort((a, b) => b.count - a.count);
    log(`[1/3] 已完成 ${replaced.length} 項 UI 字串翻譯。`);

    const productJson = JSON.parse(fs.readFileSync(productJsonPath, "utf8"));
    const updateCount = syncProductChecksums(productJson, appRoot);

    if (updateCount > 0) {
        fs.writeFileSync(productJsonPath, JSON.stringify(productJson, null, "\t"), "utf8");
        log(`[2/3] 已更新 ${updateCount} 個檔案的校驗和。`);
    }
    log(`[3/3] 已套用完成。`);
    log(`\n>>> 修補完成！請完全結束 Cursor 並重新啟動。`);
    return {
        replaced,
        updateCount,
    };
}

if (require.main === module) {
    try {
        const args = process.argv.slice(2);
        let locale = "zh-TW";
        for (const a of args) {
            if (a === "--zh-cn" || a === "--locale=zh-CN") {
                locale = "zh-CN";
            } else if (a === "--zh-tw" || a === "--locale=zh-TW") {
                locale = "zh-TW";
            } else if (a === "--ja-jp" || a === "--locale=ja-JP") {
                locale = "ja-JP";
            }
        }
        applyPatch(locale);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fail(message);
    }
}

module.exports = {
    applyPatch,
};
