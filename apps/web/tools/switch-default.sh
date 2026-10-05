#!/usr/bin/env bash
# Switch the hosted site's default engine backend in one step (no code change):
#   tools/switch-default.sh <backend-id>      e.g. wasm-worker | http
# Sets the repo variable DEFAULT_ENGINE, dispatches the pages workflow, waits for it, then checks the live
# build-info.json. Visitors who never picked a backend follow the new default; explicit choices are kept.
# Needs gh authenticated with repo admin on EX-CT/EXFA-App (GH_TOKEN). Undo: run it again with wasm-worker.
set -euo pipefail
REPO=EX-CT/EXFA-App
SITE=https://ex-ct.github.io/EXFA-App
id=${1:?backend id}
cd "$(dirname "$0")/.."
grep -q "id: '$id'" src/engine/adapter.ts || { echo "unknown backend '$id' (not in BACKENDS on this checkout; merge its PR first)"; exit 2; }
case "$id" in
  wasm-worker)    f=engines/f/exfa_wasm.wasm ;;
  *)              f= ;;
esac
if [ -n "$f" ]; then curl -sfI "$SITE/$f" >/dev/null || { echo "$SITE/$f is not deployed; refusing to make $id the default"; exit 3; }; fi
gh variable set DEFAULT_ENGINE -b "$id" -R "$REPO"
gh workflow run pages -R "$REPO" --ref main
sleep 10
run=$(gh run list -R "$REPO" -w pages -e workflow_dispatch -L 1 --json databaseId --jq '.[0].databaseId')
echo "pages run: https://github.com/$REPO/actions/runs/$run"
gh run watch "$run" -R "$REPO" --exit-status >/dev/null
sleep 20
curl -s "$SITE/build-info.json?$(date +%s)"; echo
curl -s "$SITE/build-info.json?$(date +%s)" | grep -q "\"default_engine\":\"$id\"" && echo "live default is now $id" || { echo "live build-info does not show $id yet (Pages cache?)"; exit 4; }
