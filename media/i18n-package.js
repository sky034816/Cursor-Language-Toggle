(() => {
  const dictionaries = {
    en: {
      pageTitle: "{{extensionName}}",
      panelTitle: "{{extensionName}}",
      uninstallButtonLabel: "Uninstall",
      cursorSettingsSelectLabel: "{{appName}} Settings",
      systemLocaleSelectLabel: "System Locale",
      languageOptionOriginal: "English",
      languageOptionTraditionalChinese: "Traditional Chinese",
      languageOptionSimplifiedChinese: "Simplified Chinese",
      languageOptionJapanese: "Japanese",
      guideTitle: "Usage Guide",
      guideSummary: "This tool only provides language switching and restore. Read the full guide first.",
      guideFeature: "Feature: This tool only provides language switching and restore.",
      guideCompatibility: "Compatibility: Supports Cursor version 3.0.13 and above.",
      guideRisk: "Risk: Version updates or environment differences may cause partial translation failures or display issues.",
      guidePrivacy: "Privacy: This tool does not collect, upload, or share any personal data.",
      guideLiability: "Liability: This tool is provided as-is. Please evaluate and assume usage risk yourself.",
      guideRestore: "Restore Advice: If issues occur, restore English and reload the window first.",
      currentVersion: "Current Version: {{version}}",
    },
    "zh-Hant": {
      pageTitle: "{{extensionName}}",
      panelTitle: "{{extensionName}}",
      uninstallButtonLabel: "解除安裝",
      cursorSettingsSelectLabel: "{{appName}}設定選單",
      systemLocaleSelectLabel: "系統語系選單",
      languageOptionOriginal: "英文",
      languageOptionTraditionalChinese: "繁體中文",
      languageOptionSimplifiedChinese: "簡體中文",
      languageOptionJapanese: "日文",
      guideTitle: "使用說明",
      guideSummary: "本工具僅提供語言切換與還原，請先閱讀完整說明。",
      guideFeature: "功能說明：本工具僅提供語言切換與還原功能。",
      guideCompatibility: "適用版本：適用於 Cursor 版本 3.0.13 以上。",
      guideRisk: "風險提示：版本更新或環境差異可能造成部分翻譯失效或顯示異常。",
      guidePrivacy: "隱私聲明：本工具不蒐集、不上傳、不分享任何個人資料。",
      guideLiability: "責任限制：本工具按現況提供，請自行評估並承擔使用風險。",
      guideRestore: "還原建議：如遇異常，請先還原英文並重啟視窗。",
      currentVersion: "目前版本：{{version}}",
    },
    "zh-Hans": {
      pageTitle: "{{extensionName}}",
      panelTitle: "{{extensionName}}",
      uninstallButtonLabel: "卸载",
      cursorSettingsSelectLabel: "{{appName}}设置选单",
      systemLocaleSelectLabel: "系统语言选单",
      languageOptionOriginal: "英文",
      languageOptionTraditionalChinese: "繁体中文",
      languageOptionSimplifiedChinese: "简体中文",
      languageOptionJapanese: "日文",
      guideTitle: "使用说明",
      guideSummary: "本工具仅提供语言切换与还原，请先阅读完整说明。",
      guideFeature: "功能说明：本工具仅提供语言切换与还原功能。",
      guideCompatibility: "适用版本：适用于 Cursor 版本 3.0.13 及以上。",
      guideRisk: "风险提示：版本更新或环境差异可能导致部分翻译失效或显示异常。",
      guidePrivacy: "隐私声明：本工具不收集、不上传、不分享任何个人数据。",
      guideLiability: "责任限制：本工具按现状提供，请自行评估并承担使用风险。",
      guideRestore: "还原建议：如遇异常，请先还原英文并重启窗口。",
      currentVersion: "当前版本：{{version}}",
    },
    "ja-JP": {
      pageTitle: "{{extensionName}}",
      panelTitle: "{{extensionName}}",
      uninstallButtonLabel: "アンインストール",
      cursorSettingsSelectLabel: "{{appName}}設定メニュー",
      systemLocaleSelectLabel: "システム言語メニュー",
      languageOptionOriginal: "英語",
      languageOptionTraditionalChinese: "繁体字中国語",
      languageOptionSimplifiedChinese: "簡体字中国語",
      languageOptionJapanese: "日本語",
      guideTitle: "ご利用ガイド",
      guideSummary: "このツールは言語の切り替えと復元のみを提供します。ご利用前に説明をご確認ください。",
      guideFeature: "機能: このツールは言語の切り替えと復元のみを提供します。",
      guideCompatibility: "対応バージョン: Cursor 3.0.13 以降に対応しています。",
      guideRisk: "ご注意: バージョン更新や環境差異により、一部の翻訳が反映されない場合があります。",
      guidePrivacy: "プライバシー: 本ツールは個人データを収集・送信・共有しません。",
      guideLiability: "免責事項: 本ツールは現状有姿で提供されます。ご利用に伴うリスクはご自身でご判断ください。",
      guideRestore: "復元の案内: 問題が発生した場合は、先に英語へ戻してウィンドウを再読み込みしてください。",
      currentVersion: "現在のバージョン: {{version}}",
    },
  };

  function normalizeLocale(rawLocale) {
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

  function getDictionary(rawLocale) {
    const normalizedLocale = normalizeLocale(rawLocale);
    return {
      locale: normalizedLocale,
      texts: dictionaries[normalizedLocale] || dictionaries.en,
    };
  }

  window.cursorI18nPackage = {
    getDictionary,
  };
})();
