/**
 * 版本号 Beta 标记与更新下载提示。独立文件，避免撑大 i18n-messages.js。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function (global) {
  const zh = {
    popupVersionBetaLabel: 'v{version} Beta',
    popupVersionBetaAria: '插件版本 {version}，开发者模式 Beta',
    popupVersionUpdate: '有新版本 v{latest} 可下载',
    popupVersionUpdateAria: '下载插件新版本 v{latest}',
    popupVersionChecking: '正在检测版本…',
    popupVersionUpToDate: '已是最新',
    popupVersionCheckFailed: '版本检测失败',
    popupVersionCheckHint: '双击检测新版本',
  };
  const en = {
    popupVersionBetaLabel: 'v{version} Beta',
    popupVersionBetaAria: 'Extension version {version}, developer-mode Beta',
    popupVersionUpdate: 'Newer version v{latest} is available to download',
    popupVersionUpdateAria: 'Download extension version v{latest}',
    popupVersionChecking: 'Checking for updates…',
    popupVersionUpToDate: 'Up to date',
    popupVersionCheckFailed: 'Update check failed',
    popupVersionCheckHint: 'Double-click to check for updates',
  };
  if (global.AidevpushI18n) {
    global.AidevpushI18n.registerMessages({ 'zh-CN': zh, en });
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { zh, en };
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
