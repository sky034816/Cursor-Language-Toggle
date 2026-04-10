"use strict";

const { isSafeSettingsKey } = require("./cursor-patcher");

function assert(name, condition) {
    if (!condition) {
        process.stderr.write(`verify-translation-safety: 失敗 — ${name}\n`);
        process.exit(1);
    }
}

assert("Rules 不應寫入 workbench JS（避免 case 污染）", isSafeSettingsKey("Rules") === false);
assert("Show 不應寫入 workbench JS", isSafeSettingsKey("Show") === false);
assert("含標點或長句仍應可替換", isSafeSettingsKey("No Rules Yet") === true);
assert("Commands 維持阻擋（commands）", isSafeSettingsKey("Commands") === false);

process.stdout.write("verify-translation-safety: 通過\n");
