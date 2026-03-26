#!/usr/bin/env node

/**
 * QQ Bot - Node.js进程管理器 (不依赖shell脚本)
 * 作为Python脚本的备用方案
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

// 颜色定义
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

class Logger {
  static info(msg) {
    console.log(`${colors.green}[INFO]${colors.reset} ${msg}`);
  }
  
  static warn(msg) {
    console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`);
  }
  
  static error(msg) {
    console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`);
  }
  
  static step(msg) {
    console.log(`${colors.blue}[STEP]${colors.reset} ${msg}`);
  }
  
  static success(msg) {
    console.log(`${colors.cyan}[SUCCESS]${colors.reset} ${msg}`);
  }
}

class ProcessManager {
  constructor() {
    this.projectRoot = path.join(__dirname, '..');
    this.modules = [
      {
        name: 'Provider Service',
        path: 'modules/provider-service',
        port: 8091,
        script: 'dev',
        installCheckPackages: ['express', 'ts-node']
      },
      {
        name: 'Admin Backend',
        path: 'modules/admin-panel/backend',
        port: 9080,
        script: 'dev',
        installCheckPackages: ['express', 'ts-node']
      },
      {
        name: 'Admin Frontend',
        path: 'modules/admin-panel/frontend',
        port: 3003,
        script: 'dev',
        installCheckPackages: ['vite', 'react']
      }
    ];
    
    this.processes = new Map();
    this.pidFile = path.join(__dirname, 'processes.json');
  }

  packageDir(nodeModulesPath, packageName) {
    if (packageName.startsWith('@')) {
      const [scope, scopedName] = packageName.split('/');
      return path.join(nodeModulesPath, scope, scopedName);
    }

    return path.join(nodeModulesPath, packageName);
  }

  hasValidInstall(modulePath, packageNames) {
    const nodeModules = path.join(modulePath, 'node_modules');
    if (!fs.existsSync(nodeModules)) {
      return false;
    }

    return packageNames.every(packageName => fs.existsSync(this.packageDir(nodeModules, packageName)));
  }

  // 检查端口是否被占用
  async isPortInUse(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(port, () => {
        server.once('close', () => {
          resolve(false);
        });
        server.close();
      });
      server.on('error', () => {
        resolve(true);
      });
    });
  }

  // 清理端口占用
  async cleanupPorts() {
    Logger.step('清理端口占用...');
    
    const ports = this.modules.map(m => m.port);
    const cleanupPromises = ports.map(port => this.killPortProcess(port));
    
    await Promise.all(cleanupPromises);
    Logger.info('端口清理完成');
  }

  // 杀死占用端口的进程
  killPortProcess(port) {
    return new Promise((resolve) => {
      // 跨平台端口查找和清理
      const isWindows = process.platform === 'win32';
      const cmd = isWindows 
        ? `netstat -ano | findstr :${port}` 
        : `lsof -ti :${port}`;

      exec(cmd, (error, stdout) => {
        if (error || !stdout) {
          resolve(false);
          return;
        }

        const lines = stdout.trim().split('\n');
        const pids = new Set();

        lines.forEach(line => {
          if (isWindows) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && !isNaN(pid)) {
              pids.add(pid);
            }
          } else {
            const pid = line.trim();
            if (pid && !isNaN(pid)) {
              pids.add(pid);
            }
          }
        });

        if (pids.size > 0) {
          Logger.warn(`清理端口 ${port} 占用进程: ${Array.from(pids).join(', ')}`);
          
          pids.forEach(pid => {
            const killCmd = isWindows ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`;
            exec(killCmd, () => {});
          });
        }

        resolve(true);
      });
    });
  }

  // 检查模块依赖
  checkDependencies() {
    Logger.step('检查模块依赖...');
    
    const missingDeps = [];
    
    for (const module of this.modules) {
      const modulePath = path.join(this.projectRoot, module.path);
      const packageJson = path.join(modulePath, 'package.json');
      
      if (!fs.existsSync(packageJson)) {
        Logger.error(`${module.name} package.json 不存在`);
        return false;
      }
      
      if (!this.hasValidInstall(modulePath, module.installCheckPackages)) {
        Logger.warn(`${module.name} 缺少有效依赖安装，需要运行 npm run install:all`);
        missingDeps.push(module);
      }
    }
    
    if (missingDeps.length > 0) {
      Logger.warn('发现缺少依赖的模块，请先运行: npm run install:all');
      return false;
    }
    
    Logger.info('依赖检查完成');
    return true;
  }

  // 启动单个模块
  async startModule(module) {
    Logger.step(`启动 ${module.name}...`);
    
    const modulePath = path.join(this.projectRoot, module.path);
    
    return new Promise((resolve) => {
      const child = spawn('npm', ['run', module.script], {
        cwd: modulePath,
        stdio: ['inherit', 'pipe', 'pipe']
      });

      // 保存进程信息
      this.processes.set(module.name, {
        pid: child.pid,
        process: child,
        port: module.port
      });

      // 监听启动状态
      let startupTimeout;
      let healthCheckInterval;
      
      const checkHealth = async () => {
        const inUse = await this.isPortInUse(module.port);
        if (inUse) {
          clearTimeout(startupTimeout);
          clearInterval(healthCheckInterval);
          Logger.success(`${module.name} 启动成功 (端口: ${module.port})`);
          resolve({ success: true, pid: child.pid });
        }
      };

      // 启动后立即开始健康检查
      healthCheckInterval = setInterval(checkHealth, 1000);
      
      // 设置启动超时
      startupTimeout = setTimeout(() => {
        clearInterval(healthCheckInterval);
        Logger.error(`${module.name} 启动超时`);
        child.kill();
        resolve({ success: false, pid: null });
      }, 60000); // 60秒超时

      // 进程退出处理
      child.on('exit', (code) => {
        clearTimeout(startupTimeout);
        clearInterval(healthCheckInterval);
        
        if (code !== 0) {
          Logger.error(`${module.name} 进程退出，代码: ${code}`);
          resolve({ success: false, pid: null });
        }
      });

      // 错误处理
      child.on('error', (err) => {
        clearTimeout(startupTimeout);
        clearInterval(healthCheckInterval);
        Logger.error(`启动 ${module.name} 失败: ${err.message}`);
        resolve({ success: false, pid: null });
      });
    });
  }

  // 启动所有模块
  async startAll() {
    Logger.info('🚀 开始启动所有模块...');
    
    // 清理端口
    await this.cleanupPorts();
    
    // 检查依赖
    if (!this.checkDependencies()) {
      return false;
    }

    // 并行启动后端模块
    const backendModules = this.modules.slice(0, 2);
    const frontendModule = this.modules[2];

    Logger.step('并行启动后端模块...');
    
    const backendPromises = backendModules.map(module => this.startModule(module));
    const backendResults = await Promise.all(backendPromises);
    
    const successCount = backendResults.filter(r => r.success).length;
    if (successCount !== backendModules.length) {
      Logger.error('后端模块启动失败');
      return false;
    }

    // 启动前端模块
    Logger.step('启动前端模块...');
    const frontendResult = await this.startModule(frontendModule);
    
    if (!frontendResult.success) {
      Logger.error('前端模块启动失败');
      return false;
    }

    // 保存PID信息
    this.savePids();

    // 验证服务
    await this.wait(3000);
    await this.verifyServices();

    Logger.success('🎉 所有模块启动完成!');
    this.printAccessUrls();

    return true;
  }

  // 停止所有模块
  stopAll() {
    Logger.step('停止所有服务...');
    
    let stoppedCount = 0;
    
    this.processes.forEach((processInfo, moduleName) => {
      try {
        if (processInfo.process && !processInfo.process.killed) {
          processInfo.process.kill();
          Logger.info(`已停止 ${moduleName} (PID: ${processInfo.pid})`);
          stoppedCount++;
        }
      } catch (error) {
        Logger.error(`停止 ${moduleName} 失败: ${error.message}`);
      }
    });

    this.processes.clear();

    // 删除PID文件
    if (fs.existsSync(this.pidFile)) {
      fs.unlinkSync(this.pidFile);
    }

    Logger.success(`已停止 ${stoppedCount} 个服务`);
  }

  // 验证服务状态
  async verifyServices() {
    Logger.step('验证服务健康状态...');
    
    for (const module of this.modules) {
      const inUse = await this.isPortInUse(module.port);
      if (inUse) {
        Logger.success(`${module.name} ✅`);
      } else {
        Logger.error(`${module.name} ❌`);
      }
    }
  }

  // 保存进程PID
  savePids() {
    const pids = {};
    this.processes.forEach((processInfo, moduleName) => {
      pids[moduleName] = processInfo.pid;
    });
    
    fs.writeFileSync(this.pidFile, JSON.stringify(pids, null, 2));
  }

  // 打印访问地址
  printAccessUrls() {
    Logger.info('访问地址:');
    this.modules.forEach(module => {
      Logger.info(`  - ${module.name}: http://localhost:${module.port}`);
    });
  }

  // 等待函数
  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 主函数
async function main() {
  const manager = new ProcessManager();
  
  // 信号处理
  process.on('SIGINT', () => {
    Logger.warn('收到中断信号，正在停止所有服务...');
    manager.stopAll();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    Logger.warn('收到终止信号，正在停止所有服务...');
    manager.stopAll();
    process.exit(0);
  });

  const command = process.argv[2] || 'start';

  try {
    switch (command) {
      case 'start':
        Logger.info('🚀 QQ Bot - Node.js进程管理器');
        Logger.info('='.repeat(50));
        
        const success = await manager.startAll();
        if (!success) {
          process.exit(1);
        }
        break;

      case 'stop':
        manager.stopAll();
        break;

      case 'restart':
        manager.stopAll();
        await manager.wait(2000);
        
        const restartSuccess = await manager.startAll();
        if (!restartSuccess) {
          process.exit(1);
        }
        break;

      case 'status':
        await manager.verifyServices();
        break;

      default:
        console.log(`用法: node ${path.basename(__filename)} {start|stop|restart|status}`);
        console.log('');
        console.log('  start   - 启动所有模块');
        console.log('  stop    - 停止所有模块');
        console.log('  restart - 重启所有模块');
        console.log('  status  - 检查服务状态');
        process.exit(1);
    }
  } catch (error) {
    Logger.error(`执行失败: ${error.message}`);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main().catch(error => {
    Logger.error(`未捕获的错误: ${error.message}`);
    process.exit(1);
  });
}

module.exports = ProcessManager;
