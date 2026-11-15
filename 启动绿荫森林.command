#!/bin/bash
cd "$(dirname "$0")" || exit 1
if curl -fsS http://127.0.0.1:4196/ >/dev/null 2>&1; then
  open http://127.0.0.1:4196/
else
  shade_node="$(command -v node)"
  if [ -z "$shade_node" ]; then
    shade_node="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  fi
  if [ ! -x "$shade_node" ]; then
    printf '未找到 Node.js。请先安装 Node.js，再重新启动绿荫森林。\n'
    exit 1
  fi
  (
    for attempt in 1 2 3 4 5; do
      if curl -fsS http://127.0.0.1:4196/ >/dev/null 2>&1; then
        open http://127.0.0.1:4196/
        break
      fi
      sleep 1
    done
  ) &
  "$shade_node" server.mjs
fi
