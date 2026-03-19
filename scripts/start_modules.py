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
        self.modules = [
            {
                'name': 'QQBot Core',
                'path': 'modules/qqbot-core', 
                'port': 8081,
                'health_endpoint': '/health',
                'npm_script': 'dev'
            },
            {
                'name': 'Admin Backend',
                'path': 'modules/admin-panel/backend',
                'port': 9080,
                'health_endpoint': '/health', 
                'npm_script': 'dev'
            },
            {
                'name': 'Admin Frontend',
                'path': 'modules/admin-panel/frontend',
                'port': 3003,
                'health_endpoint': '/',
                'npm_script': 'dev'
            }
        ]
        self.processes = {}
        self.pid_file = self.project_root / 'scripts' / 'module_pids.json'
        
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
            
            if not node_modules.exists():
                Logger.warn(f"{module['name']} 缺少依赖，需要运行 npm install")
                missing_deps.append(module)
        
        if missing_deps:
            Logger.warn("发现缺少依赖的模块，建议运行: python scripts/start_modules.py install")
            return False
        
        Logger.info("依赖检查完成")
        return True
    
    def install_dependencies(self) -> bool:
        """并行安装所有模块依赖"""
        Logger.step("开始并行安装依赖...")
        
        def install_module_deps(module):
            module_path = self.project_root / module['path']
            Logger.info(f"安装 {module['name']} 依赖...")
            
            try:
                result = subprocess.run(
                    ['npm', 'install'],
                    cwd=module_path,
                    capture_output=True,
                    text=True,
                    timeout=300
                )
                
                if result.returncode == 0:
                    Logger.success(f"{module['name']} 依赖安装完成")
                    return True
                else:
                    Logger.error(f"{module['name']} 依赖安装失败: {result.stderr}")
                    return False
            except subprocess.TimeoutExpired:
                Logger.error(f"{module['name']} 依赖安装超时")
                return False
            except Exception as e:
                Logger.error(f"{module['name']} 依赖安装异常: {e}")
                return False
        
        # 并行安装
        with ThreadPoolExecutor(max_workers=len(self.modules)) as executor:
            futures = {executor.submit(install_module_deps, module): module for module in self.modules}
            
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
        Logger.info("访问地址:")
        for module in self.modules:
            Logger.info(f"  - {module['name']}: http://localhost:{module['port']}")

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
