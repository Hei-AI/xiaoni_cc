#!/usr/bin/env bash
# 执行容器隔离网(br-xexec)的宿主端口闸。幂等,可反复跑。
# 目标:执行容器只能到宿主 9977(浏览器桥),其余宿主端口(8317/18317 cli-proxy 等)一律拒。
# 容器到 provider/admin/postgres 的隔离由 docker 网络本身完成(不同 bridge),这里不重复。
# 外网(FORWARD/NAT)保持放行;只在 FORWARD 里补拦其它 RFC1918,防经路由绕到别的内网服务。
set -euo pipefail
BR=br-xexec
BRIDGE_PORT_ALLOW=9977

ipt() { iptables "$@"; }
ip6() { ip6tables "$@"; }

# ---- INPUT:宿主自身端口(执行容器 -> 宿主 host-gateway)----
# 先删旧规则(幂等),再按序插入。
ipt -D INPUT -i "$BR" -p tcp --dport "$BRIDGE_PORT_ALLOW" -j ACCEPT 2>/dev/null || true
ipt -D INPUT -i "$BR" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
ipt -D INPUT -i "$BR" -j DROP 2>/dev/null || true
# 允许已建立连接的回包、允许到 9977、其余到宿主一律拒。
ipt -I INPUT 1 -i "$BR" -j DROP
ipt -I INPUT 1 -i "$BR" -p tcp --dport "$BRIDGE_PORT_ALLOW" -j ACCEPT
ipt -I INPUT 1 -i "$BR" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# ---- FORWARD(DOCKER-USER):执行容器 -> 其它内网 兜底拦,外网放行 ----
ipt -N XEXEC 2>/dev/null || true
ipt -F XEXEC
ipt -A XEXEC -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16; do
  ipt -A XEXEC -d "$net" -j DROP
done
ipt -A XEXEC -j RETURN   # 其余(公网)交回 DOCKER-USER 后续/默认放行
ipt -D DOCKER-USER -i "$BR" -j XEXEC 2>/dev/null || true
ipt -I DOCKER-USER 1 -i "$BR" -j XEXEC

# ---- IPv6:该桥全丢(隔离网不跑 v6,避免绕过)----
ip6 -D INPUT -i "$BR" -j DROP 2>/dev/null || true
ip6 -I INPUT 1 -i "$BR" -j DROP
ip6 -D DOCKER-USER -i "$BR" -j DROP 2>/dev/null || true
ip6 -I DOCKER-USER 1 -i "$BR" -j DROP 2>/dev/null || true

echo "[xiaoni-exec-firewall] applied on $BR (allow host:$BRIDGE_PORT_ALLOW, drop rest + RFC1918 forward + v6)"
