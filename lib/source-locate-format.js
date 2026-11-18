/**
 * Format source-locate results for task descriptions / IDE deep links.
 * Pure; no DOM and no chrome API.
 */

'use strict';

if (!globalThis.__taskpluginContentBoot?.skip) {
(function (global) {
  const MAX_PATH = 200;
  const BLOCK_NOTE = '源码行号来自本页公开 source map，对应生成本次建议时的构建产物；如与仓库不一致，以仓库为准。';

  function sanitizePath(path) {
    return String(path || '')
      .replace(/`/g, 'ˋ')
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_PATH);
  }

  function confidenceLabel(confidence) {
    if (confidence === 'high') return '高';
    if (confidence === 'medium') return '中';
    return '低';
  }

  function isWritable(confidence) {
    return confidence === 'high' || confidence === 'medium';
  }

  function location(result) {
    if (!result) return '';
    const file = sanitizePath(result.file);
    const line = Number(result.line);
    if (!file || !Number.isInteger(line) || line <= 0) return '';
    return `${file}:${line}`;
  }

  function formatElementLine(result, index) {
    if (!result || !isWritable(result.confidence)) return '';
    const loc = location(result);
    if (!loc) return '';
    const label = Number(index) > 0 ? `源码定位 ${Number(index)}` : '源码定位';
    return `- **${label}**: \`${loc}\`（source map，置信度${confidenceLabel(result.confidence)}）`;
  }

  function formatSuggestionLine(result) {
    if (!result || !isWritable(result.confidence)) return '';
    const loc = location(result);
    if (!loc) return '';
    return `- **源码**: \`${loc}\``;
  }

  function formatBlockNote() {
    return BLOCK_NOTE;
  }

  const SourceLocateFormat = {
    MAX_PATH,
    sanitizePath,
    confidenceLabel,
    isWritable,
    formatElementLine,
    formatSuggestionLine,
    formatBlockNote,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SourceLocateFormat;
  }
  global.SourceLocateFormat = SourceLocateFormat;
}(typeof globalThis !== 'undefined' ? globalThis : this));
}
