#!/usr/bin/env python3
"""
QQ Bot - 3模块自动启动管理脚本
解决端口冲突，并行启动，错误处理
"""

import os
import sys
import time
import json
import signal
import shlex
import psutil
import socket
import subprocess
import threading
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

# 颜色定义
class Colors:
    RED = '\033[0;31m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    BLUE = '\033[0;34m'
    PURPLE = '\033[0;35m'
    CYAN = '\033[0;36m'
    RESET = '\033[0m'

class Logger:
    @staticmethod
    def info(msg: str):
        print(f"{Colors.GREEN}[INFO]{Colors.RESET} {msg}")
    
    @staticmethod
    def warn(msg: str):
        print(f"{Colors.YELLOW}[WARN]{Colors.RESET} {msg}")
    
    @staticmethod
    def error(msg: str):
        print(f"{Colors.RED}[ERROR]{Colors.RESET} {msg}")
    
    @staticmethod
    def step(msg: str):
        print(f"{Colors.BLUE}[STEP]{Colors.RESET} {msg}")
    
    @staticmethod
    def success(msg: str):
        print(f"{Colors.CYAN}[SUCCESS]{Colors.RESET} {msg}")

class ModuleManager:
    def __init__(self):
        self.project_root = Path(__file__).parent.parent
        self.local_state_dir = Path.home() / '.qqbot-local'
        self.local_frontend_access_file = self.local_state_dir / 'playwright' / 'local-frontend-access.json'
        self.root_project = {
            'name': 'Repository Root',
            'path': '.',
            'install_check_packages': ['axios', 'mysql2']
        }
        self.modules = [
            {
                'name': 'QQBot Core',
                'path': 'modules/qqbot-core', 
                'port': 8081,
                'health_endpoint': '/health',
                'npm_script': 'dev',
                'install_check_packages': ['express', 'ts-node']
            },
            {
                'name': 'Admin Backend',
                'path': 'modules/admin-panel/backend',
                'port': 9080,
                'health_endpoint': '/health', 
                'npm_script': 'dev',
                'install_check_packages': ['express', 'ts-node']
            },
            {
                'name': 'Admin Frontend',
                'path': 'modules/admin-panel/frontend',
                'port': 3003,
                'health_endpoint': '/',
                'npm_script': 'dev',
                'install_check_packages': ['vite', 'react']
            }
        ]
        self.processes = {}
        self.pid_file = self.project_root / 'scripts' / 'module_pids.json'

    def _get_host_access_ip(self) -> Optional[str]:
        """获取宿主机浏览器应访问的 WSL IP"""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.connect(('8.8.8.8', 80))
                ip_address = sock.getsockname()[0]
                if ip_address and not ip_address.startswith('127.'):
                    return ip_address
        except OSError:
            pass

        return None

    def _write_local_frontend_access_file(self) -> Optional[Path]:
        """写出本地前端访问信息，供宿主机 Chrome / Playwright MCP 使用"""
        host_access_ip = self._get_host_access_ip()
        payload = {
            'generated_at': int(time.time()),
            'frontend_localhost_url': 'http://localhost:3003',
            'frontend_host_browser_url': f'http://{host_access_ip}:3003' if host_access_ip else None,
            'host_access_ip': host_access_ip
        }

        self.local_frontend_access_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.local_frontend_access_file, 'w', encoding='utf-8') as file:
            json.dump(payload, file, indent=2, ensure_ascii=False)

        return self.local_frontend_access_file

    def _build_process_env(self, module: Dict) -> Dict[str, str]:
        env = os.environ.copy()

        if module['name'] == 'Admin Frontend':
            # Host Chrome attaches from Windows, so expose Vite on the WSL interface.
            env['VITE_DEV_HOST'] = env.get('VITE_DEV_HOST', '0.0.0.0')

        return env

    def _package_dir(self, node_modules: Path, package_name: str) -> Path:
        if package_name.startswith('@'):
            scope, scoped_name = package_name.split('/', 1)
            return node_modules / scope / scoped_name
        return node_modules / package_name

    def _has_valid_install(self, project_path: Path, package_names: List[str]) -> bool:
        node_modules = project_path / 'node_modules'
        if not node_modules.is_dir():
            return False

        return all(self._package_dir(node_modules, package_name).exists() for package_name in package_names)

    def _install_command(self, project_path: Path) -> List[str]:
        lockfile = project_path / 'package-lock.json'
        if lockfile.exists():
            return ['npm', 'ci', '--include=dev', '--no-audit', '--no-fund']
        return ['npm', 'install', '--no-audit', '--no-fund']

    def _quarantine_node_modules(self, project_path: Path) -> Optional[Path]:
        node_modules = project_path / 'node_modules'
        if not node_modules.exists():
            return None

        stale_path = project_path / f"node_modules.stale-{int(time.time())}"
        node_modules.rename(stale_path)
        return stale_path

    def _install_project_dependencies(self, project: Dict) -> bool:
        project_path = self.project_root / project['path']
        command = self._install_command(project_path)
        Logger.info(f"安装 {project['name']} 依赖: {' '.join(shlex.quote(part) for part in command)}")

        try:
            result = subprocess.run(
                command,
                cwd=project_path,
                capture_output=True,
                text=True,
                timeout=600
            )

            if result.returncode != 0:
                stderr = result.stderr.strip()

                # Historical root-owned node_modules can block npm ci cleanup.
                if 'EACCES' in stderr and command[1] == 'ci':
                    stale_path = self._quarantine_node_modules(project_path)
                    if stale_path is not None:
                        Logger.warn(
                            f"{project['name']} 现有 node_modules 权限异常，已隔离到 {stale_path.name} 后重试"
                        )
                        retry = subprocess.run(
                            command,
                            cwd=project_path,
                            capture_output=True,
                            text=True,
                            timeout=600
                        )
                        if retry.returncode == 0 and self._has_valid_install(project_path, project['install_check_packages']):
                            Logger.success(f"{project['name']} 依赖安装完成")
                            return True
                        stderr = retry.stderr.strip()

                Logger.error(f"{project['name']} 依赖安装失败: {stderr}")
                return False

            if not self._has_valid_install(project_path, project['install_check_packages']):
                Logger.error(f"{project['name']} 依赖安装后校验失败，node_modules 不完整")
                return False

            Logger.success(f"{project['name']} 依赖安装完成")
            return True
        except subprocess.TimeoutExpired:
            Logger.error(f"{project['name']} 依赖安装超时")
            return False
        except Exception as e:
            Logger.error(f"{project['name']} 依赖安装异常: {e}")
            return False
        
    def cleanup_ports(self) -> None:
        """清理端口占用"""
        Logger.step("清理端口占用...")
        
        ports = [module['port'] for module in self.modules]
        cleaned = []
        
        for port in ports:
            if self._is_port_in_use(port):
                if self._kill_port_processes(port):
                    cleaned.append(port)
                    time.sleep(1)
        
        if cleaned:
            Logger.info(f"已清理端口: {', '.join(map(str, cleaned))}")
        else:
            Logger.info("无需清理端口")
    
    def _is_port_in_use(self, port: int) -> bool:
        """检查端口是否被占用"""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(1)
                result = sock.connect_ex(('localhost', port))
                return result == 0
        except:
            return False
    
    def _kill_port_processes(self, port: int) -> bool:
        """杀死占用端口的进程"""
        try:
            for proc in psutil.process_iter(['pid', 'name']):
                try:
                    for conn in proc.connections():
                        if conn.laddr.port == port:
                            Logger.warn(f"终止占用端口 {port} 的进程 {proc.pid}")
                            proc.terminate()
                            time.sleep(0.5)
                            if proc.is_running():
                                proc.kill()
                            return True
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
            return False
        except Exception as e:
            Logger.error(f"清理端口 {port} 失败: {e}")
            return False
    
    def check_dependencies(self) -> bool:
        """检查模块依赖"""
        Logger.step("检查模块依赖...")
        
        missing_deps = []
        
        for module in self.modules:
            module_path = self.project_root / module['path']
            package_json = module_path / 'package.json'
            node_modules = module_path / 'node_modules'
            
            if not package_json.exists():
                Logger.error(f"{module['name']} package.json 不存在")
                return False
            
            if not self._has_valid_install(module_path, module['install_check_packages']):
                Logger.warn(f"{module['name']} 缺少有效依赖安装，需要运行 npm run install:all")
                missing_deps.append(module)
        
        if missing_deps:
            Logger.warn("发现缺少依赖的模块，建议运行: npm run install:all")
            return False
        
        Logger.info("依赖检查完成")
        return True
    
    def install_dependencies(self) -> bool:
        """并行安装所有模块依赖"""
        Logger.step("开始安装根仓库与模块依赖...")

        if not self._install_project_dependencies(self.root_project):
            Logger.error("根仓库依赖安装失败")
            return False
        
        # 并行安装
        with ThreadPoolExecutor(max_workers=len(self.modules)) as executor:
            futures = {
                executor.submit(self._install_project_dependencies, module): module
                for module in self.modules
            }
            
            success_count = 0
            for future in as_completed(futures):
                module = futures[future]
                try:
                    success = future.result()
                    if success:
                        success_count += 1
                except Exception as e:
                    Logger.error(f"安装 {module['name']} 依赖时出错: {e}")
        
        if success_count == len(self.modules):
            Logger.success("所有依赖安装完成")
            return True
        else:
            Logger.error(f"依赖安装失败，成功: {success_count}/{len(self.modules)}")
            return False
    
    def start_module(self, module: Dict) -> Tuple[bool, Optional[int]]:
        """启动单个模块"""
        module_path = self.project_root / module['path']
        Logger.step(f"启动 {module['name']}...")
        
        try:
            # 启动npm进程
            process = subprocess.Popen(
                ['npm', 'run', module['npm_script']],
                cwd=module_path,
                env=self._build_process_env(module),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            # 等待服务启动
            max_attempts = 60  # 60秒超时
            for attempt in range(max_attempts):
                if process.poll() is not None:
                    # 进程已退出
                    stdout, stderr = process.communicate()
                    Logger.error(f"{module['name']} 启动失败，进程已退出")
                    Logger.error(f"错误输出: {stderr}")
                    return False, None
                
                # 检查端口是否监听
                if self._is_port_in_use(module['port']):
                    Logger.success(f"{module['name']} 启动成功 (端口: {module['port']})")
                    return True, process.pid
                
                time.sleep(1)
                if attempt % 10 == 0:
                    print(f"等待 {module['name']} 启动... ({attempt}s)")
            
            # 启动超时
            Logger.error(f"{module['name']} 启动超时")
            process.terminate()
            return False, None
            
        except Exception as e:
            Logger.error(f"启动 {module['name']} 时出错: {e}")
            return False, None
    
    def start_all_modules(self) -> bool:
        """启动所有模块"""
        Logger.info("🚀 开始启动所有模块...")
        
        # 清理端口
        self.cleanup_ports()
        
        # 检查依赖
        if not self.check_dependencies():
            return False
        
        # 并行启动前三个模块
        frontend_module = self.modules.pop()  # 取出前端模块
        
        def start_single_module(module):
            return self.start_module(module)
        
        # 并行启动后端模块
        Logger.step("并行启动后端模块...")
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = {executor.submit(start_single_module, module): module for module in self.modules}
            
            success_count = 0
            for future in as_completed(futures):
                module = futures[future]
                try:
                    success, pid = future.result()
                    if success:
                        success_count += 1
                        self.processes[module['name']] = pid
                except Exception as e:
                    Logger.error(f"启动 {module['name']} 时出错: {e}")
        
        if success_count != len(self.modules):
            Logger.error("后端模块启动失败")
            return False
        
        # 启动前端模块
        Logger.step("启动前端模块...")
        success, pid = self.start_module(frontend_module)
        if success:
            self.processes[frontend_module['name']] = pid
            self.modules.append(frontend_module)  # 重新加入列表
        else:
            Logger.error("前端模块启动失败")
            return False
        
        # 保存PID信息
        self._save_pids()
        
        # 验证服务
        time.sleep(3)
        self.verify_services()
        
        Logger.success("🎉 所有模块启动完成!")
        self._print_access_urls()
        
        return True
    
    def verify_services(self) -> None:
        """验证服务健康状态"""
        Logger.step("验证服务健康状态...")
        
        import requests
        
        for module in self.modules:
            url = f"http://localhost:{module['port']}{module['health_endpoint']}"
            try:
                response = requests.get(url, timeout=5)
                if response.status_code == 200:
                    Logger.success(f"{module['name']} ✅")
                else:
                    Logger.error(f"{module['name']} ❌ (HTTP {response.status_code})")
            except Exception as e:
                Logger.error(f"{module['name']} ❌ (连接失败)")
    
    def stop_all_modules(self) -> None:
        """停止所有模块"""
        Logger.step("停止所有服务...")
        
        # 从PID文件读取进程信息
        pids = self._load_pids()
        
        stopped_count = 0
        for module_name, pid in pids.items():
            try:
                if psutil.pid_exists(pid):
                    proc = psutil.Process(pid)
                    proc.terminate()
                    
                    # 等待进程结束
                    try:
                        proc.wait(timeout=10)
                        Logger.info(f"已停止 {module_name} (PID: {pid})")
                        stopped_count += 1
                    except psutil.TimeoutExpired:
                        proc.kill()
                        Logger.warn(f"强制终止 {module_name} (PID: {pid})")
                        stopped_count += 1
                else:
                    Logger.warn(f"{module_name} 进程不存在 (PID: {pid})")
            except Exception as e:
                Logger.error(f"停止 {module_name} 失败: {e}")
        
        # 清理PID文件
        if self.pid_file.exists():
            self.pid_file.unlink()
        
        # 清理端口
        self.cleanup_ports()
        
        Logger.success(f"已停止 {stopped_count} 个服务")
    
    def _save_pids(self) -> None:
        """保存进程PID"""
        self.pid_file.parent.mkdir(exist_ok=True)
        with open(self.pid_file, 'w') as f:
            json.dump(self.processes, f, indent=2)
    
    def _load_pids(self) -> Dict[str, int]:
        """加载进程PID"""
        if self.pid_file.exists():
            try:
                with open(self.pid_file, 'r') as f:
                    return json.load(f)
            except:
                pass
        return {}
    
    def _print_access_urls(self) -> None:
        """打印访问地址"""
        access_file = self._write_local_frontend_access_file()
        host_access_ip = self._get_host_access_ip()
        Logger.info("访问地址:")
        for module in self.modules:
            if module['name'] == 'Admin Frontend':
                Logger.info(f"  - {module['name']} (WSL 内): http://localhost:{module['port']}")
                if host_access_ip:
                    Logger.info(f"  - {module['name']} (宿主机 Chrome / Playwright MCP): http://{host_access_ip}:{module['port']}")
                else:
                    Logger.warn(f"  - {module['name']} 宿主机地址解析失败，请查看 {access_file}")
            else:
                Logger.info(f"  - {module['name']}: http://localhost:{module['port']}")

        Logger.info(f"  - 本地前端访问元数据: {access_file}")

def main():
    """主函数"""
    manager = ModuleManager()
    
    # 设置信号处理
    def signal_handler(signum, frame):
        Logger.warn("收到中断信号，正在停止所有服务...")
        manager.stop_all_modules()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # 处理命令行参数
    command = sys.argv[1] if len(sys.argv) > 1 else 'start'
    
    if command == 'start':
        Logger.info("🚀 QQ Bot - 4模块自动启动脚本")
        Logger.info("=" * 50)
        success = manager.start_all_modules()
        if not success:
            sys.exit(1)
    
    elif command == 'stop':
        manager.stop_all_modules()
    
    elif command == 'restart':
        manager.stop_all_modules()
        time.sleep(2)
        success = manager.start_all_modules()
        if not success:
            sys.exit(1)
    
    elif command == 'status':
        manager.verify_services()
    
    elif command == 'install':
        success = manager.install_dependencies()
        if not success:
            sys.exit(1)
    
    elif command == 'clean-ports':
        manager.cleanup_ports()
    
    else:
        print(f"用法: python {sys.argv[0]} {{start|stop|restart|status|install|clean-ports}}")
        print("")
        print("  start       - 启动所有模块")
        print("  stop        - 停止所有模块") 
        print("  restart     - 重启所有模块")
        print("  status      - 检查服务状态")
        print("  install     - 安装所有依赖")
        print("  clean-ports - 清理端口占用")
        sys.exit(1)

if __name__ == '__main__':
    main()
