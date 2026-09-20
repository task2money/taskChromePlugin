#!/usr/bin/env bash
# 验收：dist zip 可解压加载为扩展，manifest 版本与 dual-read 正确（OPT-20260920-032）。
# 优先用 Playwright --load-extension 做 Reload 等价验证；无 DISPLAY 时用 xvfb-run。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./manifest.json').version")"
ZIP="$ROOT/dist/task-chrome-plugin-v${VERSION}.zip"

if [ ! -f "$ZIP" ]; then
  echo "verify: packing zip first..." >&2
  bash scripts/publish-dist-zip.sh
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
unzip -q -o "$ZIP" -d "$STAGE"

ZIP_VER="$(node -p "require('$STAGE/manifest.json').version")"
if [ "$ZIP_VER" != "$VERSION" ]; then
  echo "FAIL: zip version $ZIP_VER != source $VERSION" >&2
  exit 1
fi
grep -q "allow_auto_run" "$STAGE/lib/project-auto-run-label.js" || {
  echo "FAIL: unpacked zip missing allow_auto_run" >&2
  exit 1
}

# 纯 Node：从 zip 抽出的 lib 跑 projectAllowsAutoRun 对新键为 true
node --input-type=commonjs <<EOF
globalThis.__taskpluginContentBoot = { skip: false };
globalThis.tx = (k) => ({ autoRunBadgeAllowed: '可自动运行', autoRunBadgeDisallowed: '不可自动运行' }[k] || k);
require('$STAGE/lib/project-auto-run-label.js');
const ok = globalThis.projectAllowsAutoRun({
  id: 'p',
  server_run_template: { allow_auto_run: true, platform: 'aliyun' },
});
if (!ok) {
  console.error('FAIL: projectAllowsAutoRun(allow_auto_run:true) === false');
  process.exit(1);
}
console.log('verify-dist-zip-reload: static dual-read OK version=$ZIP_VER');
EOF

HELPER_JS="$(node -p "JSON.stringify(require('path').resolve('e2e/helpers/launchExtensionContext.js'))")"
PW_SCRIPT="$STAGE/_verify_pw.js"
cat > "$PW_SCRIPT" <<NODE
const { chromium } = require('@playwright/test');
const { launchExtensionContext } = require(${HELPER_JS});

(async () => {
  const stage = process.env.STAGE;
  const expectVer = process.env.EXPECT_VER;
  const ctx = await launchExtensionContext(chromium, stage, { headless: false });
  try {
    let sw = null;
    for (let i = 0; i < 50; i++) {
      const workers = ctx.serviceWorkers();
      if (workers.length) {
        sw = workers[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!sw) throw new Error('no service worker after load-extension (Reload equivalent failed)');
    const ver = await sw.evaluate(async () => {
      const m = await chrome.runtime.getManifest();
      return m && m.version;
    });
    if (ver !== expectVer) {
      throw new Error('loaded extension version ' + ver + ' != ' + expectVer);
    }
    console.log('verify-dist-zip-reload: Playwright load-extension OK version=' + ver);
  } finally {
    await ctx.close();
  }
})().catch((e) => {
  console.error('FAIL:', e && e.message ? e.message : e);
  process.exit(1);
});
NODE

if [ -d "$ROOT/node_modules/@playwright/test" ] || [ -d "$ROOT/../node_modules/@playwright/test" ]; then
  export STAGE EXPECT_VER="$VERSION"
  export NODE_PATH="${ROOT}/node_modules${NODE_PATH:+:$NODE_PATH}"
  if [ -n "${DISPLAY:-}" ]; then
    node "$PW_SCRIPT"
  elif command -v xvfb-run >/dev/null 2>&1; then
    xvfb-run -a env STAGE="$STAGE" EXPECT_VER="$VERSION" NODE_PATH="$NODE_PATH" node "$PW_SCRIPT"
  else
    echo "verify-dist-zip-reload: no DISPLAY/xvfb — static checks only (Playwright skipped)" >&2
  fi
else
  echo "verify-dist-zip-reload: Playwright not installed — static checks only" >&2
fi

echo "verify-dist-zip-reload: PASS"
