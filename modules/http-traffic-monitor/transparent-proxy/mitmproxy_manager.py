#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mitmproxy Manager - 统一管理工具
用于启动、停止、配置mitmproxy透明代理
"""

import os
import sys
import subprocess
import signal
import time
import json
import socket
from pathlib import Path
from typing import Optional, List, Dict
import click
from colorama import Fore, Style, init

# 初始化colorama
init(autoreset=True)

# 项目路径配置
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
MITMPROXY_DIR = PROJECT_ROOT / "modules/http-traffic-monitor/transparent-proxy/mitmproxy-data"
TRAFFIC_LOG_DIR = PROJECT_ROOT / "logs/qqbot-traffic"  # 流量日志统一输出目录
PID_FILE = Path("/tmp/mitmproxy.pid")
CONFIG_FILE = PROJECT_ROOT / "modules/http-traffic-monitor/transparent-proxy/config.json"

# 默认配置
DEFAULT_CONFIG = {
    "listen_port": 15001,
    "docker_network": "qq_bot_network",
    "clash_port": 7890,
    "sudo_password": "liahua",
    "mitmproxy_script": "modules/http-traffic-monitor/mitmproxy/addon.py",
    "log_level": "info",
    "fake_ip_range": "198.18.0.0/15",
    "enable_http2": True,
    "enable_showhost": True,
    "enable_host_output_intercept": True,
    "host_output_uid": os.getuid(),
    "host_output_bypass_hosts": []
}


class Colors:
    """彩色输出辅助类"""
    @staticmethod
    def info(msg: str):
        click.echo(f"{Fore.GREEN}[INFO]{Style.RESET_ALL} {msg}")

    @staticmethod
    def warn(msg: str):
        click.echo(f"{Fore.YELLOW}[WARN]{Style.RESET_ALL} {msg}")

    @staticmethod
    def error(msg: str):
        click.echo(f"{Fore.RED}[ERROR]{Style.RESET_ALL} {msg}")

    @staticmethod
    def success(msg: str):
        click.echo(f"{Fore.GREEN}✅ {msg}{Style.RESET_ALL}")


class MitmproxyManager:
    """mitmproxy管理器"""

    def __init__(self, config: Dict = None):
        self.config = config or self.load_config()
        self.mitmproxy_dir = MITMPROXY_DIR
        self.pid_file = PID_FILE

    def load_config(self) -> Dict:
        """加载配置文件"""
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    user_config = json.load(f)
                    return {**DEFAULT_CONFIG, **user_config}
            except json.JSONDecodeError as e:
                Colors.error(f"配置文件JSON格式错误: {e}")
                Colors.warn("使用默认配置")
                return DEFAULT_CONFIG
            except Exception as e:
                Colors.error(f"加载配置文件失败: {e}")
                Colors.warn("使用默认配置")
                return DEFAULT_CONFIG
        return DEFAULT_CONFIG

    def get_runtime_home(self) -> Path:
        """获取真实用户的HOME目录，即使mitmproxy以root运行。"""
        sudo_user = os.environ.get('SUDO_USER')
        if sudo_user:
            try:
                import pwd
                return Path(pwd.getpwnam(sudo_user).pw_dir)
            except Exception:
                pass
        return Path.home()

    def save_config(self):
        """保存配置到文件"""
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(self.config, f, indent=2, ensure_ascii=False)
        Colors.success(f"配置已保存到: {CONFIG_FILE}")

    def get_default_gateway(self) -> str:
        """获取WSL2默认网关IP（Windows宿主机IP）"""
        try:
            result = subprocess.run(
                ["ip", "route", "show", "default"],
                capture_output=True, text=True, check=True
            )
            # 输出格式: default via 172.26.144.1 dev eth0
            gateway = result.stdout.split()[2]
            return gateway
        except Exception as e:
            Colors.error(f"无法获取默认网关: {e}")
            return "172.26.144.1"  # fallback

    def get_upstream_proxy(self) -> str:
        """获取上游代理地址"""
        if "UPSTREAM_HTTP" in os.environ:
            return os.environ["UPSTREAM_HTTP"]

        gateway = self.get_default_gateway()
        clash_port = self.config.get("clash_port", 7890)
        return f"http://{gateway}:{clash_port}"

    def _parse_proxy_address(self, proxy_url: str) -> tuple:
        """解析代理地址，返回(host, port)"""
        import re

        # 移除协议前缀 http:// 或 https://
        proxy_addr = proxy_url.replace("http://", "").replace("https://", "")

        # 提取host和port
        match = re.match(r'^([^:]+):(\d+)$', proxy_addr)
        if match:
            return (match.group(1), int(match.group(2)))
        else:
            Colors.warn(f"无法解析代理地址: {proxy_url}")
            return (None, None)

    def _find_mitmdump(self) -> str:
        """查找mitmdump可执行文件完整路径（支持sudo环境）"""
        # 获取实际用户的HOME目录（即使在sudo环境下）
        sudo_user = os.environ.get('SUDO_USER')
        if sudo_user:
            import pwd
            user_home = pwd.getpwnam(sudo_user).pw_dir
        else:
            user_home = os.path.expanduser("~")

        # 尝试多种方式查找mitmdump
        search_paths = [
            # 实际用户的bin目录
            f"{user_home}/.local/bin/mitmdump",
            # 系统路径
            "/usr/local/bin/mitmdump",
            "/usr/bin/mitmdump",
        ]

        # 首先检查预定义路径
        for path in search_paths:
            if os.path.isfile(path) and os.access(path, os.X_OK):
                Colors.info(f"找到mitmdump: {path}")
                return path

        # 尝试使用which命令查找
        try:
            result = subprocess.run(
                ["which", "mitmdump"],
                capture_output=True, text=True, check=True
            )
            path = result.stdout.strip()
            if path:
                Colors.info(f"通过which找到mitmdump: {path}")
                return path
        except subprocess.CalledProcessError:
            pass

        # 如果都找不到，抛出错误
        raise FileNotFoundError(
            "无法找到mitmdump可执行文件。请确认mitmproxy已正确安装。\n"
            f"已搜索路径: {', '.join(search_paths)}"
        )

    def is_running(self) -> bool:
        """检查mitmproxy是否运行"""
        try:
            result = subprocess.run(
                ["pgrep", "-f", "mitmdump.*transparent"],
                capture_output=True, text=True
            )
            return result.returncode == 0
        except Exception:
            return False

    def get_pid(self) -> Optional[int]:
        """获取mitmproxy进程PID"""
        if self.pid_file.exists():
            try:
                return int(self.pid_file.read_text().strip())
            except:
                pass

        # 从进程列表获取
        try:
            result = subprocess.run(
                ["pgrep", "-f", "mitmdump.*transparent"],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return int(result.stdout.strip().split()[0])
        except:
            pass

        return None

    def start(self, daemon: bool = True, apply_iptables: bool = False) -> bool:
        """启动mitmproxy"""
        if self.is_running():
            Colors.warn("mitmproxy已在运行")
            pid = self.get_pid()
            if pid:
                Colors.info(f"当前PID: {pid}")
            return True

        Colors.info("正在启动mitmproxy...")

        # 环境变量准备
        upstream_proxy = self.get_upstream_proxy()
        Colors.info(f"上游代理: {upstream_proxy}")

        # 确保目录存在
        self.mitmproxy_dir.mkdir(parents=True, exist_ok=True)
        log_dir = TRAFFIC_LOG_DIR
        log_dir.mkdir(parents=True, exist_ok=True)

        # 生成带时间戳的日志文件
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        log_file = log_dir / f"mitmproxy-{timestamp}.log"

        # 解析代理地址
        proxy_host, proxy_port = self._parse_proxy_address(upstream_proxy)

        # 构建完整的环境变量
        runtime_home = self.get_runtime_home()
        env = os.environ.copy()
        env.update({
            "PATH": f"{runtime_home}/.local/bin:{env.get('PATH', '')}",
            "MITMPROXY_DIR": str(self.mitmproxy_dir),
            "UPSTREAM_HTTP": upstream_proxy,
            "TRAFFIC_LOG_DIR": str(log_dir),
            "FAKE_IP_RANGE": self.config.get("fake_ip_range", "198.18.0.0/15"),
            "HTTP_PROXY": upstream_proxy,
            "HTTPS_PROXY": upstream_proxy,
            "CODEX_POOL_STORE_DIR": str(runtime_home / ".qqbot-local" / "codex-accounts"),
            "CODEX_ACTIVE_AUTH_PATH": str(runtime_home / ".codex" / "auth.json"),
        })

        # 添加解析后的代理地址（给addon.py使用）
        if proxy_host and proxy_port:
            env["CLASH_PROXY_HOST"] = proxy_host
            env["CLASH_PROXY_PORT"] = str(proxy_port)
            Colors.info(f"Clash代理配置: {proxy_host}:{proxy_port}")

        # 打印环境变量（调试用）
        Colors.info("环境变量 for addon.py:")
        Colors.info(f"  TRAFFIC_LOG_DIR={log_dir}")
        Colors.info(f"  FAKE_IP_RANGE={env['FAKE_IP_RANGE']}")
        Colors.info(f"  CLASH_PROXY_HOST={env.get('CLASH_PROXY_HOST', '<not set>')}")
        Colors.info(f"  CLASH_PROXY_PORT={env.get('CLASH_PROXY_PORT', '<not set>')}")

        # 构建完整的启动命令（与bash脚本等效）
        script_path = PROJECT_ROOT / self.config["mitmproxy_script"]
        listen_port = self.config.get("listen_port", 15001)
        log_level = self.config.get("log_level", "info")

        # 查找mitmdump完整路径（支持sudo环境）
        mitmdump_path = self._find_mitmdump()

        base_cmd = [
            mitmdump_path,
            "--mode", "transparent",
        ]

        # 可选参数 --showhost 必须在 --mode transparent 之后
        if self.config.get("enable_showhost", True):
            base_cmd.append("--showhost")

        # 添加其余参数
        base_cmd.extend([
            "--listen-host", "0.0.0.0",
            "--listen-port", str(listen_port),
            "--set", f"confdir={self.mitmproxy_dir}",
            "--set", "block_global=false",
            "--set", "connection_strategy=laziest",
            "--set", f"console_eventlog_verbosity={log_level}",
            "--set", "ssl_insecure=true",
            "--set", "upstream_cert=false",
            "--set", "tls_version_client_min=TLS1_2",
            "--set", "tls_version_server_min=TLS1_2",
            "--scripts", str(script_path)
        ])

        if self.config.get("enable_http2", True):
            base_cmd.extend(["--set", "http2=true"])

        ignore_hosts = self.config.get("ignore_hosts", [])
        for pattern in ignore_hosts:
            if pattern:
                base_cmd.extend(["--ignore-hosts", str(pattern)])

        # 添加上游代理配置
        if upstream_proxy:
            base_cmd.extend(["--set", f"upstream_http={upstream_proxy}"])
            base_cmd.extend(["--set", f"upstream_https={upstream_proxy}"])

        cmd = ["sudo", "-S", "env"] + [f"{key}={value}" for key, value in env.items()] + base_cmd

        Colors.info(f"启动命令: {' '.join(base_cmd[:5])} (via sudo root)...")

        try:
            if daemon:
                # 后台启动 - 输出到日志文件
                Colors.info(f"日志文件: {log_file}")

                with open(log_file, 'w', encoding='utf-8') as log_f:
                    proc = subprocess.Popen(
                        cmd,
                        stdin=subprocess.PIPE,
                        stdout=log_f,
                        stderr=subprocess.STDOUT,
                        start_new_session=True,
                        text=True
                    )
                    proc.stdin.write(f"{self.config['sudo_password']}\n")
                    proc.stdin.flush()
                    proc.stdin.close()

                # 保存PID
                time.sleep(2)
                pid = self.get_pid()
                self.pid_file.write_text(str(pid or proc.pid))

                # 等待启动
                if self.is_running():
                    Colors.success(f"mitmproxy已启动, PID: {pid or proc.pid}")
                    Colors.info(f"监听端口: {listen_port}")
                    Colors.info(f"日志目录: {log_dir}")

                    if apply_iptables:
                        Colors.info("")
                        return self.apply_iptables()
                    return True
                else:
                    Colors.error("mitmproxy启动失败")
                    Colors.info(f"请查看日志: {log_file}")
                    return False
            else:
                # 前台启动 - 直接显示输出
                subprocess.run(cmd, input=f"{self.config['sudo_password']}\n", text=True)
                return True

        except Exception as e:
            Colors.error(f"启动失败: {e}")
            return False

    def stop(self, cleanup_iptables: bool = False) -> bool:
        """停止mitmproxy"""
        if not self.is_running():
            Colors.warn("mitmproxy未运行")
            return True

        Colors.info("正在停止mitmproxy...")

        try:
            # 尝试优雅停止
            subprocess.run(["pkill", "-f", "mitmdump.*transparent"], check=False)
            time.sleep(2)

            # 检查是否已停止
            if self.is_running():
                Colors.warn("进程未完全停止，强制终止...")
                subprocess.run(["pkill", "-9", "-f", "mitmdump.*transparent"], check=False)
                time.sleep(1)

            if self.is_running():
                Colors.error("无法停止mitmproxy进程")
                return False

            Colors.success("mitmproxy已停止")

            # 清理PID文件
            if self.pid_file.exists():
                self.pid_file.unlink()
                Colors.info("PID文件已清理")

            # 清理iptables
            if cleanup_iptables:
                Colors.info("")
                self.remove_iptables()

            return True

        except Exception as e:
            Colors.error(f"停止失败: {e}")
            return False

    def get_docker_network_cidr(self) -> Optional[str]:
        """获取Docker网络CIDR"""
        net_name = self.config["docker_network"]
        try:
            result = subprocess.run(
                ["docker", "network", "inspect", net_name,
                 "-f", "{{(index .IPAM.Config 0).Subnet}}"],
                capture_output=True, text=True, check=True
            )
            cidr = result.stdout.strip()
            return cidr if cidr else None
        except:
            return None

    def apply_iptables(self) -> bool:
        """应用iptables规则"""
        Colors.info("正在应用iptables规则...")

        # 获取Docker网络信息
        cidr = self.get_docker_network_cidr()
        if not cidr:
            Colors.error(f"无法获取Docker网络 '{self.config['docker_network']}' 的CIDR")
            return False

        Colors.info(f"Docker网络: {self.config['docker_network']} ({cidr})")
        Colors.info(f"监听端口: {self.config['listen_port']}")

        listen_port = self.config['listen_port']
        sudo_pwd = self.config['sudo_password']
        host_output_uid = int(self.config.get('host_output_uid', os.getuid()))
        enable_host_output_intercept = bool(self.config.get('enable_host_output_intercept', True))
        host_output_bypass_hosts = list(self.config.get('host_output_bypass_hosts', []))

        try:
            # 启用IP转发
            self._sudo_run(sudo_pwd, ["sysctl", "-w", "net.ipv4.ip_forward=1"])

            # 清理旧网段残留规则，避免网段迁移后出现重复条目
            self._cleanup_stale_redirect_rules(sudo_pwd, listen_port, cidr, "PREROUTING")
            if enable_host_output_intercept:
                self._cleanup_stale_redirect_rules(sudo_pwd, listen_port, None, "OUTPUT")

            # 清理旧规则（如果存在）
            self._remove_iptables_rule(sudo_pwd, "nat", "PREROUTING",
                ["-s", cidr, "-p", "tcp", "--dport", "80",
                 "-j", "REDIRECT", "--to-ports", str(listen_port)])
            self._remove_iptables_rule(sudo_pwd, "nat", "PREROUTING",
                ["-s", cidr, "-p", "tcp", "--dport", "443",
                 "-j", "REDIRECT", "--to-ports", str(listen_port)])

            if enable_host_output_intercept:
                self._remove_host_output_bypass_rules(sudo_pwd, host_output_uid, host_output_bypass_hosts)
                self._remove_iptables_rule(sudo_pwd, "nat", "OUTPUT",
                    ["-m", "owner", "--uid-owner", str(host_output_uid), "-m", "addrtype", "!", "--dst-type", "LOCAL",
                     "-p", "tcp", "--dport", "80", "-j", "REDIRECT", "--to-ports", str(listen_port)])
                self._remove_iptables_rule(sudo_pwd, "nat", "OUTPUT",
                    ["-m", "owner", "--uid-owner", str(host_output_uid), "-m", "addrtype", "!", "--dst-type", "LOCAL",
                     "-p", "tcp", "--dport", "443", "-j", "REDIRECT", "--to-ports", str(listen_port)])

            # 添加HTTP重定向规则
            Colors.info("配置HTTP(80)流量重定向...")
            self._add_iptables_rule(sudo_pwd, "nat", "PREROUTING",
                ["-s", cidr, "-p", "tcp", "--dport", "80",
                 "-j", "REDIRECT", "--to-ports", str(listen_port)])

            # 添加HTTPS重定向规则
            Colors.info("配置HTTPS(443)流量重定向...")
            self._add_iptables_rule(sudo_pwd, "nat", "PREROUTING",
                ["-s", cidr, "-p", "tcp", "--dport", "443",
                 "-j", "REDIRECT", "--to-ports", str(listen_port)])

            if enable_host_output_intercept:
                self._add_host_output_bypass_rules(sudo_pwd, host_output_uid, host_output_bypass_hosts)
                Colors.info(f"配置Host UID {host_output_uid} 的HTTP/HTTPS OUTPUT重定向...")
                self._add_iptables_rule(sudo_pwd, "nat", "OUTPUT",
                    ["-m", "owner", "--uid-owner", str(host_output_uid), "-m", "addrtype", "!", "--dst-type", "LOCAL",
                     "-p", "tcp", "--dport", "80", "-j", "REDIRECT", "--to-ports", str(listen_port)])
                self._add_iptables_rule(sudo_pwd, "nat", "OUTPUT",
                    ["-m", "owner", "--uid-owner", str(host_output_uid), "-m", "addrtype", "!", "--dst-type", "LOCAL",
                     "-p", "tcp", "--dport", "443", "-j", "REDIRECT", "--to-ports", str(listen_port)])

            # 检查并添加MASQUERADE规则
            if not self._check_iptables_rule(sudo_pwd, "nat", "POSTROUTING",
                ["-j", "MASQUERADE"]):
                Colors.info("添加MASQUERADE规则...")
                self._add_iptables_rule(sudo_pwd, "nat", "POSTROUTING",
                    ["-j", "MASQUERADE"])

            Colors.success("iptables规则已应用")
            return True

        except Exception as e:
            Colors.error(f"应用iptables规则失败: {e}")
            return False

    def remove_iptables(self) -> bool:
        """移除iptables规则"""
        Colors.info("正在清理iptables规则...")

        cidr = self.get_docker_network_cidr()
        if not cidr:
            Colors.warn("无法获取Docker网络CIDR，跳过iptables清理")
            return True

        listen_port = self.config['listen_port']
        sudo_pwd = self.config['sudo_password']
        host_output_uid = int(self.config.get('host_output_uid', os.getuid()))
        enable_host_output_intercept = bool(self.config.get('enable_host_output_intercept', True))
        host_output_bypass_hosts = list(self.config.get('host_output_bypass_hosts', []))

        try:
            # 清理旧网段残留规则，防止历史规则影响当前网络
            self._cleanup_stale_redirect_rules(sudo_pwd, listen_port, cidr, "PREROUTING")
            if enable_host_output_intercept:
                self._cleanup_stale_redirect_rules(sudo_pwd, listen_port, None, "OUTPUT")

            # 删除HTTP重定向规则
            Colors.info("清理HTTP(80)重定向规则...")
            self._remove_iptables_rule(sudo_pwd, "nat", "PREROUTING",
                ["-s", cidr, "-p", "tcp", "--dport", "80",
                 "-j", "REDIRECT", "--to-ports", str(listen_port)])

            # 删除HTTPS重定向规则
            Colors.info("清理HTTPS(443)重定向规则...")
            self._remove_iptables_rule(sudo_pwd, "nat", "PREROUTING",
                ["-s", cidr, "-p", "tcp", "--dport", "443",
                 "-j", "REDIRECT", "--to-ports", str(listen_port)])

            if enable_host_output_intercept:
                self._remove_host_output_bypass_rules(sudo_pwd, host_output_uid, host_output_bypass_hosts)
                Colors.info(f"清理Host UID {host_output_uid} 的OUTPUT重定向规则...")
                self._remove_iptables_rule(sudo_pwd, "nat", "OUTPUT",
                    ["-m", "owner", "--uid-owner", str(host_output_uid), "-m", "addrtype", "!", "--dst-type", "LOCAL",
                     "-p", "tcp", "--dport", "80", "-j", "REDIRECT", "--to-ports", str(listen_port)])
                self._remove_iptables_rule(sudo_pwd, "nat", "OUTPUT",
                    ["-m", "owner", "--uid-owner", str(host_output_uid), "-m", "addrtype", "!", "--dst-type", "LOCAL",
                     "-p", "tcp", "--dport", "443", "-j", "REDIRECT", "--to-ports", str(listen_port)])

            Colors.success("iptables规则已清理")

            # 检查MASQUERADE规则
            if self._check_iptables_rule(sudo_pwd, "nat", "POSTROUTING",
                ["-j", "MASQUERADE"]):
                Colors.warn("检测到全局MASQUERADE规则（如果是专为mitmproxy添加的，建议手动删除）")

            return True

        except Exception as e:
            Colors.error(f"清理iptables规则失败: {e}")
            return False

    def _sudo_run(self, password: str, cmd: List[str]):
        """执行sudo命令"""
        full_cmd = ["sudo", "-S"] + cmd
        proc = subprocess.Popen(
            full_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        stdout, stderr = proc.communicate(input=f"{password}\n")
        if proc.returncode != 0 and stderr:
            raise Exception(stderr)
        return stdout

    def _check_iptables_rule(self, password: str, table: str, chain: str, rule: List[str]) -> bool:
        """检查iptables规则是否存在"""
        try:
            self._sudo_run(password, ["iptables", "-t", table, "-C", chain] + rule)
            return True
        except:
            return False

    def _add_iptables_rule(self, password: str, table: str, chain: str, rule: List[str]):
        """添加iptables规则（如果不存在）"""
        if not self._check_iptables_rule(password, table, chain, rule):
            self._sudo_run(password, ["iptables", "-t", table, "-A", chain] + rule)
            Colors.info(f"已添加规则: iptables -t {table} -A {chain} {' '.join(rule)}")
        else:
            Colors.info(f"规则已存在: iptables -t {table} -C {chain} {' '.join(rule)}")

    def _insert_iptables_rule(self, password: str, table: str, chain: str, rule: List[str], position: int = 1):
        """插入iptables规则（如果不存在）"""
        if not self._check_iptables_rule(password, table, chain, rule):
            self._sudo_run(password, ["iptables", "-t", table, "-I", chain, str(position)] + rule)
            Colors.info(f"已插入规则: iptables -t {table} -I {chain} {position} {' '.join(rule)}")
        else:
            Colors.info(f"规则已存在: iptables -t {table} -C {chain} {' '.join(rule)}")

    def _remove_iptables_rule(self, password: str, table: str, chain: str, rule: List[str]):
        """删除iptables规则（如果存在）"""
        count = 0
        while self._check_iptables_rule(password, table, chain, rule):
            self._sudo_run(password, ["iptables", "-t", table, "-D", chain] + rule)
            Colors.info(f"已删除规则: iptables -t {table} -D {chain} {' '.join(rule)}")
            count += 1
            if count > 10:
                raise Exception("删除规则失败（循环次数过多）")

    def _resolve_host_output_bypass_ips(self, host: str) -> List[str]:
        try:
            infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        except OSError as error:
            Colors.warn(f"无法解析Host OUTPUT bypass主机 {host}: {error}")
            return []

        ips: List[str] = []
        seen = set()
        for info in infos:
            ip = info[4][0]
            if ":" in ip or ip in seen:
                continue
            seen.add(ip)
            ips.append(ip)
        return ips

    def _host_output_bypass_rule(self, host_output_uid: int, ip: str) -> List[str]:
        return [
            "-m", "owner", "--uid-owner", str(host_output_uid),
            "-p", "tcp",
            "-d", ip,
            "--dport", "443",
            "-j", "RETURN"
        ]

    def _add_host_output_bypass_rules(self, password: str, host_output_uid: int, hosts: List[str]):
        if not hosts:
            return
        Colors.info(f"配置Host OUTPUT helper bypass: {', '.join(hosts)}")
        for host in hosts:
            ips = self._resolve_host_output_bypass_ips(host)
            if not ips:
                Colors.warn(f"Host OUTPUT bypass主机未解析到IPv4地址: {host}")
                continue
            for ip in ips:
                self._insert_iptables_rule(password, "nat", "OUTPUT", self._host_output_bypass_rule(host_output_uid, ip), position=1)

    def _remove_host_output_bypass_rules(self, password: str, host_output_uid: int, hosts: List[str]):
        if not hosts:
            return
        for host in hosts:
            ips = self._resolve_host_output_bypass_ips(host)
            for ip in ips:
                self._remove_iptables_rule(password, "nat", "OUTPUT", self._host_output_bypass_rule(host_output_uid, ip))

    def _cleanup_stale_redirect_rules(self, password: str, listen_port: int, current_cidr: Optional[str], chain: str):
        """清理旧网段残留的HTTP/HTTPS重定向规则"""
        try:
            output = self._sudo_run(password, ["iptables", "-t", "nat", "-S", chain])
        except Exception as e:
            Colors.warn(f"无法读取iptables规则: {e}")
            return

        for line in output.splitlines():
            if "REDIRECT" not in line or f"--to-ports {listen_port}" not in line:
                continue

            tokens = line.split()
            if len(tokens) < 3 or tokens[0] != "-A" or tokens[1] != chain:
                continue

            # 跳过当前CIDR对应的规则
            rule_cidr = None
            if "-s" in tokens:
                try:
                    rule_cidr = tokens[tokens.index("-s") + 1]
                except IndexError:
                    rule_cidr = None

            if current_cidr and rule_cidr == current_cidr:
                continue

            rule_spec = tokens[2:]
            try:
                self._sudo_run(password, ["iptables", "-t", "nat", "-D", chain] + rule_spec)
                Colors.info(f"已清理过期规则: iptables -t nat -D {chain} {' '.join(rule_spec)}")
            except Exception as err:
                Colors.warn(f"删除旧规则失败: {err}")

    def status(self):
        """显示运行状态"""
        click.echo("=" * 50)
        click.echo(f"{Fore.CYAN}mitmproxy 透明代理状态{Style.RESET_ALL}")
        click.echo("=" * 50)

        # 进程状态
        if self.is_running():
            pid = self.get_pid()
            Colors.success(f"运行状态: 运行中 (PID: {pid})")
        else:
            Colors.warn("运行状态: 未运行")

        # 配置信息
        click.echo(f"\n{Fore.CYAN}配置信息:{Style.RESET_ALL}")
        click.echo(f"  监听端口: {self.config['listen_port']}")
        click.echo(f"  Docker网络: {self.config['docker_network']}")
        cidr = self.get_docker_network_cidr()
        if cidr:
            click.echo(f"  网络CIDR: {cidr}")
            click.echo(f"  上游代理: {self.get_upstream_proxy()}")
            click.echo(f"  数据目录: {self.mitmproxy_dir}")
            click.echo(f"  Host OUTPUT拦截: {'开启' if self.config.get('enable_host_output_intercept', True) else '关闭'}")
            click.echo(f"  Host OUTPUT UID: {self.config.get('host_output_uid', os.getuid())}")

        # iptables状态
        cidr = self.get_docker_network_cidr()
        if cidr:
            click.echo(f"\n{Fore.CYAN}iptables规则:{Style.RESET_ALL}")
            listen_port = self.config['listen_port']
            sudo_pwd = self.config['sudo_password']

            http_exists = self._check_iptables_rule(sudo_pwd, "nat", "PREROUTING",
                ["-s", cidr, "-p", "tcp", "--dport", "80",
                 "-j", "REDIRECT", "--to-ports", str(listen_port)])
            https_exists = self._check_iptables_rule(sudo_pwd, "nat", "PREROUTING",
                ["-s", cidr, "-p", "tcp", "--dport", "443",
                 "-j", "REDIRECT", "--to-ports", str(listen_port)])
            host_http_exists = self._check_iptables_rule(sudo_pwd, "nat", "OUTPUT",
                ["-m", "owner", "--uid-owner", str(self.config.get('host_output_uid', os.getuid())), "-m", "addrtype", "!", "--dst-type", "LOCAL",
                 "-p", "tcp", "--dport", "80", "-j", "REDIRECT", "--to-ports", str(listen_port)])
            host_https_exists = self._check_iptables_rule(sudo_pwd, "nat", "OUTPUT",
                ["-m", "owner", "--uid-owner", str(self.config.get('host_output_uid', os.getuid())), "-m", "addrtype", "!", "--dst-type", "LOCAL",
                 "-p", "tcp", "--dport", "443", "-j", "REDIRECT", "--to-ports", str(listen_port)])

            click.echo(f"  HTTP(80)重定向: {'✅ 已配置' if http_exists else '❌ 未配置'}")
            click.echo(f"  HTTPS(443)重定向: {'✅ 已配置' if https_exists else '❌ 未配置'}")
            click.echo(f"  Host HTTP(80) OUTPUT重定向: {'✅ 已配置' if host_http_exists else '❌ 未配置'}")
            click.echo(f"  Host HTTPS(443) OUTPUT重定向: {'✅ 已配置' if host_https_exists else '❌ 未配置'}")

        click.echo("=" * 50)

    def get_latest_log(self) -> Optional[Path]:
        """获取最新的日志文件"""
        log_dir = TRAFFIC_LOG_DIR
        if not log_dir.exists():
            return None

        log_files = sorted(log_dir.glob("mitmproxy-*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
        return log_files[0] if log_files else None

    def show_logs(self, lines: int = 50, follow: bool = False):
        """显示日志内容"""
        log_file = self.get_latest_log()

        if not log_file:
            Colors.warn("没有找到日志文件")
            return

        Colors.info(f"日志文件: {log_file}")
        click.echo("=" * 50)

        try:
            if follow:
                # 实时跟踪日志
                import subprocess
                subprocess.run(["tail", "-f", str(log_file)])
            else:
                # 显示最后N行
                with open(log_file, 'r', encoding='utf-8') as f:
                    all_lines = f.readlines()
                    display_lines = all_lines[-lines:] if len(all_lines) > lines else all_lines
                    for line in display_lines:
                        click.echo(line.rstrip())
        except Exception as e:
            Colors.error(f"读取日志失败: {e}")


# ============= CLI命令定义 =============

@click.group()
@click.pass_context
def cli(ctx):
    """mitmproxy透明代理管理工具"""
    ctx.ensure_object(dict)
    ctx.obj['manager'] = MitmproxyManager()


@cli.command()
@click.option('--daemon/--foreground', default=True, help='后台运行模式')
@click.option('--iptables', is_flag=True, help='同时应用iptables规则')
@click.pass_context
def start(ctx, daemon, iptables):
    """启动mitmproxy"""
    manager: MitmproxyManager = ctx.obj['manager']
    if manager.start(daemon=daemon, apply_iptables=iptables):
        sys.exit(0)
    else:
        sys.exit(1)


@cli.command()
@click.option('--cleanup', is_flag=True, help='同时清理iptables规则')
@click.pass_context
def stop(ctx, cleanup):
    """停止mitmproxy"""
    manager: MitmproxyManager = ctx.obj['manager']
    if manager.stop(cleanup_iptables=cleanup):
        sys.exit(0)
    else:
        sys.exit(1)


@cli.command()
@click.pass_context
def restart(ctx):
    """重启mitmproxy"""
    manager: MitmproxyManager = ctx.obj['manager']
    Colors.info("正在重启mitmproxy...")
    manager.stop(cleanup_iptables=True)
    time.sleep(1)
    if manager.start(daemon=True, apply_iptables=True):
        Colors.success("重启成功")
        sys.exit(0)
    else:
        Colors.error("重启失败")
        sys.exit(1)


@cli.command()
@click.pass_context
def status(ctx):
    """查看运行状态"""
    manager: MitmproxyManager = ctx.obj['manager']
    manager.status()


@cli.group()
def iptables():
    """管理iptables规则"""
    pass


@iptables.command('apply')
@click.pass_context
def iptables_apply(ctx):
    """应用iptables规则"""
    manager: MitmproxyManager = ctx.obj['manager']
    if manager.apply_iptables():
        sys.exit(0)
    else:
        sys.exit(1)


@iptables.command('remove')
@click.pass_context
def iptables_remove(ctx):
    """移除iptables规则"""
    manager: MitmproxyManager = ctx.obj['manager']
    if manager.remove_iptables():
        sys.exit(0)
    else:
        sys.exit(1)


@cli.group()
def config():
    """管理配置"""
    pass


@config.command('show')
@click.pass_context
def config_show(ctx):
    """显示当前配置"""
    manager: MitmproxyManager = ctx.obj['manager']
    click.echo(json.dumps(manager.config, indent=2, ensure_ascii=False))


@config.command('set')
@click.argument('key')
@click.argument('value')
@click.pass_context
def config_set(ctx, key, value):
    """设置配置项"""
    manager: MitmproxyManager = ctx.obj['manager']

    # 类型转换
    try:
        if key in ['listen_port', 'clash_port']:
            value = int(value)
        elif key in ['enable_http2', 'enable_showhost']:
            value = value.lower() in ('true', '1', 'yes')
    except ValueError as e:
        Colors.error(f"值转换失败: {e}")
        sys.exit(1)

    manager.config[key] = value
    manager.save_config()
    Colors.success(f"已设置 {key} = {value}")


@cli.command()
@click.option('-n', '--lines', default=50, help='显示的行数')
@click.option('-f', '--follow', is_flag=True, help='实时跟踪日志')
@click.pass_context
def logs(ctx, lines, follow):
    """查看mitmproxy日志"""
    manager: MitmproxyManager = ctx.obj['manager']
    manager.show_logs(lines=lines, follow=follow)


if __name__ == '__main__':
    cli(obj={})
