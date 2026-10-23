#!/usr/bin/env bash
# Postgres 16 chạy thẳng trên máy (không qua Colima) cho phiên UAT.
# Dùng: pg-native.sh install | start <port> | stop <port> | createdb <port> <db>
# Thư mục ở ~/.cache vì /private/tmp bị xoá khi máy khởi động lại.
set -euo pipefail
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
BASE=$HOME/.cache/tubu-uat
PKG=$BASE/pgbin/node_modules/@embedded-postgres/darwin-arm64
BIN=$PKG/native/bin
API=/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat/apps/api

cmd=${1:-}
case "$cmd" in
  install)
    mkdir -p $BASE/pgbin
    cd $BASE/pgbin
    [ -f package.json ] || echo '{"name":"pgbin","private":true}' > package.json
    npm i --ignore-scripts @embedded-postgres/darwin-arm64@16.14.0-beta.17 >/dev/null
    (cd $PKG && node scripts/hydrate-symlinks.js)
    # dyld từ chối binary chưa ký lại sau khi giải nén
    find $PKG/native -type f \( -name "*.dylib" -o -perm -u+x \) -print0 | xargs -0 -n 20 codesign --force --sign - 2>/dev/null || true
    $BIN/postgres --version
    ;;
  start)
    port=$2; data=$BASE/data-$port
    if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then
      if [ -f $data/postmaster.pid ]; then echo "đã chạy $port"; exit 0; fi
      echo "cổng $port đang bị tiến trình khác giữ, dừng" >&2; exit 1
    fi
    [ -d $data ] || $BIN/initdb -D $data -U tubu --auth=trust -E UTF8 --locale=C >/dev/null
    $BIN/pg_ctl -D $data -l $BASE/pg-$port.log -w start -o "-p $port -c listen_addresses=127.0.0.1 -c unix_socket_directories= -c max_connections=300 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c timezone=UTC"
    ;;
  stop)
    port=$2; $BIN/pg_ctl -D $BASE/data-$port -m fast stop
    ;;
  createdb)
    port=$2; db=$3
    cd $API
    echo "DROP DATABASE IF EXISTS $db WITH (FORCE); " | npx prisma db execute --url "postgresql://tubu@127.0.0.1:$port/postgres" --stdin
    echo "CREATE DATABASE $db;" | npx prisma db execute --url "postgresql://tubu@127.0.0.1:$port/postgres" --stdin
    ;;
  *) echo "dùng: $0 install|start <port>|stop <port>|createdb <port> <db>" >&2; exit 2 ;;
esac
