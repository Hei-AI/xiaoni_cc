#!/usr/bin/env bash
# 执行容器沙箱加固部署。**不要在没跟小腻打招呼前跑。** 会 recreate 执行容器(清 /tmp)。
# 顺序:重新快照 /tmp → 构建执行容器新镜像(烘 pip) → recreate executor + agent-service
#       → 恢复 /tmp → 装 host 防火墙 → 重启浏览器桥(带模型 UI 拦截)→ 验收。
set -euo pipefail
ROOT=/home/liahua/IdeaProject/qq_bot
SNAP=/home/liahua/.qqbot-local/executor-snapshot-$(date +%Y%m%d-%H%M%S)
cd "$ROOT"

echo "== 1. 重新快照执行容器挂载外内容(/tmp + /usr/local/bin + /root config)"
mkdir -p "$SNAP"
docker cp qqbot-xiaoni-executor:/tmp "$SNAP/tmp" || true
docker cp qqbot-xiaoni-executor:/usr/local/bin "$SNAP/usr-local-bin" || true
docker cp qqbot-xiaoni-executor:/root/.config "$SNAP/root-config" 2>/dev/null || true
docker cp qqbot-xiaoni-executor:/root/.gitconfig "$SNAP/root-gitconfig" 2>/dev/null || true
echo "   snapshot -> $SNAP"

echo "== 2. 冻结缓存用例门(agent-service 改了 relay 路由,必须先全绿)"
( cd modules/agent-service && for f in cache-replay-consistency fork-cache-alignment recover-energy-rejected-wake-anchor; do npx tsx --test src/__tests__/$f.test.ts >/dev/null 2>&1 || { echo "FROZEN TEST FAIL: $f — 中止部署"; exit 1; }; done ) || exit 1

echo "== 3. 构建镜像(执行容器烘 pip;agent-service 带 relay 路由)"
docker compose build xiaoni-executor agent-service

echo "== 4. recreate agent-service(接入隔离网+relay)+ executor(移出主网/去 sock)"
docker compose up -d agent-service xiaoni-executor

echo "== 5. 恢复 /tmp(她的临时工作区)到新容器"
if [ -d "$SNAP/tmp" ]; then
  docker cp "$SNAP/tmp/." qqbot-xiaoni-executor:/tmp/ || true
fi

echo "== 6. 装 host 防火墙 unit + timer"
sudo cp deploy/executor-sandbox/xiaoni-exec-firewall.service /etc/systemd/system/
sudo cp deploy/executor-sandbox/xiaoni-exec-firewall.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now xiaoni-exec-firewall.service xiaoni-exec-firewall.timer

echo "== 7. 重启浏览器桥(加载模型 UI 导航拦截)"
systemctl --user restart xiaoni-playwright-cli-bridge.service

echo "== 完成。跑 verify.sh 验收。"
