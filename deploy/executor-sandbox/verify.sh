#!/usr/bin/env bash
# 验收:从执行容器内确认到"我们模型"的路全断、合法出口正常。
set -uo pipefail
E="docker exec -i qqbot-xiaoni-executor"
pass=0; fail=0
chk() { # desc  expect(open/closed)  host  port
  local d="$1" exp="$2" h="$3" p="$4"
  if $E bash -c "timeout 3 bash -c 'exec 3<>/dev/tcp/$h/$p' 2>/dev/null"; then r=open; else r=closed; fi
  if [ "$r" = "$exp" ]; then echo "PASS [$r] $d"; pass=$((pass+1)); else echo "FAIL [$r!=$exp] $d"; fail=$((fail+1)); fi
}
echo "== 应全部 closed(到我们模型的路)=="
chk "provider 容器网(A)"        closed qqbot-provider-service 8090
chk "admin-backend(B)"          closed qqbot-admin-backend 9080
chk "postgres"                  closed qqbot-postgres 5432
chk "宿主 cli-proxy 8317(C)"    closed host.docker.internal 8317
chk "宿主 cli-proxy 18317"      closed host.docker.internal 18317
chk "宿主 8090"                 closed host.docker.internal 8090
chk "宿主 SSH 22"               closed host.docker.internal 22
echo "== 应 open / 无 sock =="
chk "agent-service(合法出口)"    open   qqbot-agent-service 8092
chk "宿主浏览器桥 9977"          open   host.docker.internal 9977
if $E test -S /var/run/docker.sock; then echo "FAIL docker.sock 还在"; fail=$((fail+1)); else echo "PASS docker.sock 已移除"; pass=$((pass+1)); fi
echo "== 外网(她程序要用,允许)=="
chk "api.anthropic.com(外网通,但无 key)" open api.anthropic.com 443
echo "== 她的 pip 工具在(重建没丢)=="
$E python3 -c "import fitz, yt_dlp, numpy" 2>/dev/null && { echo "PASS pymupdf/yt-dlp/numpy 在"; pass=$((pass+1)); } || { echo "FAIL pip 工具丢了"; fail=$((fail+1)); }
echo "---- pass=$pass fail=$fail ----"
[ "$fail" = 0 ] && echo "验收通过" || echo "有失败项,别放行"
