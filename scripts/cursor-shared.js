"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const APP_PATHS = [
    "/Applications/Cursor.app",
    path.join(process.env.HOME || "", "Applications/Cursor.app"),
];

const CURSOR_PATCH_TARGET_REL_PATHS = [
    "out/vs/workbench/workbench.desktop.main.js",
    "out/nls.messages.json",
];

function sha256base64(content) {
    return crypto.createHash("sha256").update(content).digest("base64").replace(/=/g, "");
}

function findCursorAppInstall() {
    for (const appBasePath of APP_PATHS) {
        const appRoot = path.join(appBasePath, "Contents/Resources/app");
        if (fs.existsSync(path.join(appRoot, "product.json"))) {
            return { appBasePath, appRoot };
        }
    }
    return null;
}

function createScriptIo(isCliModule) {
    return {
        out(line) {
            process.stdout.write(`${line}\n`);
        },
        fail(message) {
            if (isCliModule) {
                process.stderr.write(`${message}\n`);
                process.exit(1);
            }
            throw new Error(message);
        },
    };
}

function syncProductChecksums(productJson, appRoot) {
    const checksums = productJson.checksums;
    if (!checksums || typeof checksums !== "object") {
        return 0;
    }
    let updateCount = 0;
    for (const relPath in checksums) {
        const fullPath = path.join(appRoot, "out", relPath);
        if (!fs.existsSync(fullPath)) continue;
        const fileContent = fs.readFileSync(fullPath);
        const newSum = sha256base64(fileContent);
        if (newSum !== checksums[relPath]) {
            checksums[relPath] = newSum;
            updateCount++;
        }
    }
    return updateCount;
}

module.exports = {
    APP_PATHS,
    CURSOR_PATCH_TARGET_REL_PATHS,
    sha256base64,
    findCursorAppInstall,
    createScriptIo,
    syncProductChecksums,
};
