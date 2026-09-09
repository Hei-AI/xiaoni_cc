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
# 容器网服务:靠 docker 网络隔离,必须连不上(TCP closed)。
echo "== 容器网到我们模型/数据的路:必须 closed =="
chk "provider 容器网(A)"        closed qqbot-provider-service 8090
chk "admin-backend(B)"          closed qqbot-admin-backend 9080
chk "postgres"                  closed qqbot-postgres 5432
# 宿主口经 host-gateway TCP 可达(为 9977 保留),但打模型必须拿不到 200(要鉴权,她无 key)。
# 判据=不可利用,而非 TCP 关闭。200=可白嫖(FAIL);401/403/404/000=用不了(PASS)。
echo "== 宿主模型口:TCP 可达但必须不可利用(打模型非 200)=="
unusable() { # desc host port
  local d="$1" h="$2" p="$3"
  local c=$($E sh -c "timeout 6 curl -s -o /dev/null -w '%{http_code}' -X POST http://$h:$p/v1/chat/completions -H 'Content-Type: application/json' -d '{\"model\":\"x\",\"messages\":[]}' 2>/dev/null")
  if [ "$c" = "200" ]; then echo "FAIL [200 可白嫖] $d"; fail=$((fail+1)); else echo "PASS [$c 用不了] $d"; pass=$((pass+1)); fi
}
unusable "宿主 cli-proxy 8317(C)" host.docker.internal 8317
unusable "宿主 cli-proxy 18317"   host.docker.internal 18317
unusable "宿主 8090"              host.docker.internal 8090
# 无 key 兜底确认
if $E sh -c 'env | grep -qiE "api_key|anthropic|openai|codex_proxy|oauth"'; then echo "FAIL executor env 里有 key"; fail=$((fail+1)); else echo "PASS executor env 无任何模型 key"; pass=$((pass+1)); fi
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
