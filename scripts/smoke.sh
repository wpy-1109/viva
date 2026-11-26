#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
rm -rf data/smoke
mkdir -p artifacts
VIVA_HOST=127.0.0.1 VIVA_PORT=43129 VIVA_DATA_DIR=data/smoke node dist/server/main.js > artifacts/smoke-server.log 2>&1 &
server=$!
cleanup() { kill "$server" >/dev/null 2>&1 || true; }
trap cleanup EXIT
for _ in $(seq 1 50); do
  if curl -sf http://127.0.0.1:43129/api/health >/dev/null; then break; fi
  sleep 0.1
done
token=$(cat data/smoke/token)
auth=(-H "x-viva-token: $token" -H "x-viva-request: 1" -H "content-type: application/json")
curl -sf -X POST http://127.0.0.1:43129/api/demo/seed "${auth[@]}" >/dev/null
source_id=$(curl -sf http://127.0.0.1:43129/api/sources "${auth[@]}" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write(JSON.parse(s).sources[0].id))")
curl -sf -X POST "http://127.0.0.1:43129/api/sources/${source_id}/sync" "${auth[@]}" >/dev/null
proposal=$(curl -sf http://127.0.0.1:43129/api/proposals "${auth[@]}" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write(JSON.parse(s).proposals[0].id))")
curl -sf -X POST "http://127.0.0.1:43129/api/proposals/${proposal}/approve" "${auth[@]}" >/dev/null
curl -sf -X POST http://127.0.0.1:43129/api/ask "${auth[@]}" --data '{"query":"演示数据说明检索不是向量"}' | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s); if(!j.citations||!j.citations.length||!String(j.answer).includes('演示提供者')) process.exit(1)})"
curl -sf -X POST http://127.0.0.1:43129/api/autopilot/stop "${auth[@]}" >/dev/null
VIVA_DATA_DIR=data/smoke node dist/worker/main.js > artifacts/smoke-worker.log 2>&1 &
worker=$!
sleep 1
kill "$worker"
wait "$worker" 2>/dev/null || true
desired=$(curl -sf http://127.0.0.1:43129/api/autopilot "${auth[@]}" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write(JSON.parse(s).desired))")
test "$desired" = "stopped"
curl -sf -X POST http://127.0.0.1:43129/api/backup "${auth[@]}" >/dev/null
test ! -f data/smoke/backups/*/secrets.json
echo "smoke ok"
