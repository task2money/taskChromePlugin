#!/bin/bash
# Chrome extension signing key lives in gitignored conf-local (ADR-0054).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
KEY="${ROOT}/conf-local/taskChromePlugin/key_pkcs8.pem"
if [[ ! -f "$KEY" ]]; then
  echo "missing $KEY (copy PEM into conf-local/taskChromePlugin/)" >&2
  exit 1
fi
openssl pkey -in "$KEY" -pubout -outform DER | base64 -w0
