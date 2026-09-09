# 执行容器沙箱加固(2026-09-09)

## 目标
只挡一件事:小腻写的**程序**消耗我们出资的模型额度(Anthropic/OpenAI/Codex/Gemini)替第三方干活。
明确不挡:她主 agent 用我们的模型(那是她本人);她程序调用对方自带 key 的模型。

## 到"我们模型"的四条路 → 封法
- A 直连 provider 内部模型口(:8090 llm/debug 等)→ 执行容器移出 qq_bot_network,docker 网络隔离,连不到。
- B admin-backend 代调(:9080)→ 同上,不在隔离网。
- C 宿主 cli-proxy(host 8317/18317)→ 这些口打模型全 401(要鉴权);删 docker.sock 后她拿不到任何 key,故本就打不动。无需专门拦。
- D docker.sock 偷各服务 key 后走开放外网 → 删 docker.sock 挂载(执行容器自身 env/挂载无 key,唯一偷法就是 sock)。
- 浏览器桥(9977):**明确不设防(user 2026-09-09 决定:只防沙箱里的内容,浏览器不管)**。执行容器仍可达 9977,
  也仍能驱动带登录态的浏览器 —— 这条白嫖残留是被接受的,不在本次范围。

## 核心机制(回答"为什么不是纯 Docker 网络")
到我们模型的路,靠两样就全封:① Docker 网络隔离 —— 执行容器移出 qq_bot_network,与 provider/admin/postgres
不同网桥、无路由,天然连不到(A/B/postgres);② 删 docker.sock —— 她读不到任何容器 env 里的 key,
偷不到 key 就用不了宿主 cli-proxy(C,它本来就 401)、也无法直连外网模型厂商(D,401)。
iptables 不是必需,只是叠加的宿主纵深,默认不启。

## 改动清单
- docker-compose.yml:执行容器去 docker.sock、移到隔离网 xiaoni_exec_net(固定桥名 br-xexec);agent-service 同时接两张网(保 exec 8093 / notify / qq-usage / qq-send-image 不断);新增网络定义。
- modules/xiaoni-executor/Dockerfile + runtime-requirements.txt:烘入她运行时手动装的 pip 工具(recreate 不再丢)。
- deploy/executor-sandbox/:deploy.sh、verify.sh;firewall 脚本/unit/timer 为**可选纵深**,默认不装。

## 保留 / 已知残留
- notify → 唤醒她本人主 agent、她醒着自己选择答访客 = 她的意志,非程序白嫖。保留。
- (仅当启用可选防火墙时)重启空窗:host 重启后 docker 可能在防火墙 unit 前拉起执行容器(秒级),timer 每分钟重装兜底。默认不装防火墙则无此问题。
- register-local(provider :8090)随隔离被切:local-image-visibility 的注册路失效(她的本地图缩略预览降级)。如要保留,后续在 agent-service 加一条 relay 路(不在本次)。
- 仓库仍 rw:她能改仓库文件,但改的是 agent-service 镜像外的源码(不影响运行中的 agent-service,需人工重建才生效),与"程序白嫖模型"目标弱相关。repo 只读留作后续纵深。

- 浏览器路(9977):被接受的残留 —— 程序仍能经桥驱动我们登录态的模型 UI 白嫖。user 决定不在沙箱层管浏览器。

## 部署(务必先跟小腻说)
先跑快照(deploy.sh 第 1 步已含),再 `deploy.sh`,最后 `verify.sh`。快照已存 ~/.qqbot-local/executor-snapshot-20260909(/tmp 96M + pip 清单 + 她改的 start 脚本)。
