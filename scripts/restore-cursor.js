"use strict";

const fs = require("fs");
const path = require("path");
const {
    CURSOR_PATCH_TARGET_REL_PATHS,
    createScriptIo,
    findCursorAppInstall,
    syncProductChecksums,
} = require("./cursor-shared");

const IS_CLI = require.main === module;
const { out, fail } = createScriptIo(IS_CLI);

/**
 * Cursor 還原工具（快照版）
 * 目的：將目前乾淨狀態保存成快照，後續可精準還原。
 * Extension 模式下 baseline 寫入 globalStorage；CLI 預設寫入 scripts/restore-baseline.json。
 */

const BASELINE_PATH = path.join(__dirname, "restore-baseline.json");

const ERR_USER_BASELINE_MISSING =
    "尚未建立本機備份。請先套用繁體中文或簡體中文一次以建立備份；若已更新 Cursor，建議先重裝或確認安裝完整。";

function findAppRoot() {
    const install = findCursorAppInstall();
    return install ? install.appRoot : null;
}

function resolveBaselineWritePath(options) {
    const opts = options && typeof options === "object" ? options : {};
    const explicit = opts.baselinePath;
    if (typeof explicit === "string" && explicit.length > 0) {
        return explicit;
    }
    return BASELINE_PATH;
}

function updateChecksums(appRoot) {
    const productJsonPath = path.join(appRoot, "product.json");
    const productJson = JSON.parse(fs.readFileSync(productJsonPath, "utf8"));
    const updateCount = syncProductChecksums(productJson, appRoot);
    fs.writeFileSync(productJsonPath, JSON.stringify(productJson, null, "\t"), "utf8");
    return updateCount;
}

function captureBaseline(options) {
    const baselinePath = resolveBaselineWritePath(options);
    const opts = options && typeof options === "object" ? options : {};
    const silent = Boolean(opts.silent);
    const log = silent ? function () {} : out;

    const appRoot = findAppRoot();
    if (!appRoot) {
        throw new Error("找不到 Cursor 安裝路徑，無法建立基準快照。");
    }

    log(`>>> 偵測到 Cursor 路徑：${appRoot}`);
    log(">>> 開始建立還原基準快照...\n");

    const files = [];
    for (const relPath of CURSOR_PATCH_TARGET_REL_PATHS) {
        const targetPath = path.join(appRoot, relPath);
        if (!fs.existsSync(targetPath)) {
            throw new Error(`建立快照失敗，找不到目標檔案：${relPath}`);
        }
        files.push({
            relPath,
            content: fs.readFileSync(targetPath, "utf8"),
        });
        log(`[快照] 已記錄：${relPath}`);
    }

    const payload = {
        version: 1,
        createdAt: new Date().toISOString(),
        appRootHint: appRoot,
        files,
    };

    const dir = path.dirname(baselinePath);
    if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(baselinePath, JSON.stringify(payload, null, 2), "utf8");
    log(`\n[完成] 已建立快照：${baselinePath}`);
    log(">>> 之後執行 restore-cursor.js（不帶參數）即可還原到此狀態。");
    return { baselinePath, fileCount: files.length };
}

function readBaseline(options) {
    const opts = options && typeof options === "object" ? options : {};
    const explicit = opts.baselinePath;
    const userScoped = typeof explicit === "string" && explicit.length > 0;
    const baselinePath = userScoped ? explicit : BASELINE_PATH;

    if (!fs.existsSync(baselinePath)) {
        if (userScoped) {
            throw new Error(ERR_USER_BASELINE_MISSING);
        }
        throw new Error(
            `找不到還原快照：${baselinePath}\n請先執行：node scripts/restore-cursor.js --capture-baseline`,
        );
    }

    const raw = fs.readFileSync(baselinePath, "utf8");
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`還原快照 JSON 格式錯誤：${message}`);
    }

    if (!parsed || !Array.isArray(parsed.files) || parsed.files.length === 0) {
        throw new Error("還原快照內容無效，請重新建立基準快照。");
    }

    for (const item of parsed.files) {
        const isValidItem =
            item &&
            typeof item.relPath === "string" &&
            item.relPath.length > 0 &&
            typeof item.content === "string";
        if (!isValidItem) {
            throw new Error("還原快照內容無效，檔案項目格式錯誤，請重新建立基準快照。");
        }
    }

    return parsed;
}

function restoreOriginal(options) {
    const opts = options && typeof options === "object" ? options : {};
    const silent = Boolean(opts.silent);
    const log = silent ? function () {} : out;

    const appRoot = findAppRoot();
    if (!appRoot) {
        throw new Error("找不到 Cursor 安裝路徑，無法進行還原。");
    }

    log(`>>> 偵測到 Cursor 路徑：${appRoot}`);
    log(">>> 開始以快照進行還原...\n");

    const baseline = readBaseline({ baselinePath: opts.baselinePath });
    const summary = [];
    for (const file of baseline.files) {
        const relPath = file.relPath;
        const targetPath = path.join(appRoot, relPath);
        if (!fs.existsSync(targetPath)) {
            throw new Error(`還原失敗，找不到目標檔案：${relPath}`);
        }

        fs.writeFileSync(targetPath, file.content, "utf8");
        summary.push({ relPath });
        log(`[成功] 已還原：${relPath}`);
    }

    const updateCount = updateChecksums(appRoot);
    log(`[完成] 已更新 ${updateCount} 個檔案的校驗和。`);
    log(`\n>>> 還原作業完成！請完全結束 Cursor 並重新啟動。`);
    return { summary, updateCount };
}

if (require.main === module) {
    try {
        const args = process.argv.slice(2);
        if (args.includes("--capture-baseline")) {
            captureBaseline();
        } else {
            restoreOriginal();
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fail(message);
    }
}

module.exports = {
    restoreOriginal,
    captureBaseline,
};
