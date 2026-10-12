#!/bin/zsh
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then
  echo 'Install Node.js 20 or newer, then open this launcher again.'
  read -k 1
  exit 1
fi
if [[ ! -d node_modules ]]; then npm ci; fi
npm run build
printf '\nOpen http://127.0.0.1:4318 in Chrome. Keep this window open while using ApplyWeave.\n\n'
npm start
