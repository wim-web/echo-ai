#!/usr/bin/env bash
# oracle-zoff 上で実行され、alexa-hermes-bridge を docker compose で起動/更新する
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/alexa-hermes-bridge}"
REPO_URL="${REPO_URL:-https://github.com/wim-web/echo-ai.git}"
BRANCH="${BRANCH:-main}"

if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "ERROR: $APP_DIR/.env がありません。.env.example を元に作成してください。" >&2
  exit 1
fi

docker compose up -d --build
docker compose ps
