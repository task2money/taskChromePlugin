/**
 * 打包期注入的运行时域名配置值（唯一来源：conf/base.yaml → scripts/pack-crx.sh）。
 *
 * 源码树里始终是空对象：扩展不内置任何默认域名，未配置时由 Popup「服务器地址」引导
 * 用户填写。发布包由打包脚本在暂存目录整体覆盖本文件（仓库内容保持不变），因此
 * 「换域名只改配置」对扩展同样成立，且不存在代码兜底常量。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
globalThis.__TASKPLUGIN_RUNTIME_CONFIG__ = globalThis.__TASKPLUGIN_RUNTIME_CONFIG__ || {};
}
