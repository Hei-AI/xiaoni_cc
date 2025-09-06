import { spawn } from 'child_process';
import { logger } from '../utils/logger';
import { DatabaseManager } from './database';
import { RequirementData } from '../types';

export class RemoteClaudeService {
  private database: DatabaseManager;
  private moduleLogger = logger.createModuleLogger('remote-claude-service');
  private readonly sessionName = 'claude_remote';
  private readonly scriptPath = '/home/liahua/IdeaProject/qq_bot/scripts/remote_claude_command.sh';

  constructor(database: DatabaseManager) {
    this.database = database;
  }

  /**
   * 检查Claude Code远程会话是否存在
   */
  public async checkRemoteSession(): Promise<boolean> {
    try {
      const process = spawn('tmux', ['has-session', '-t', this.sessionName]);
      
      return new Promise((resolve) => {
        process.on('close', (code) => {
          resolve(code === 0);
        });
      });
    } catch (error) {
      this.moduleLogger.error('Failed to check remote session', { error });
      return false;
    }
  }

  /**
   * 处理需求 - 核心方法
   */
  public async processRequirement(requirementData: RequirementData): Promise<void> {
    const { id: requirementId, user_id: userId, message } = requirementData;

    try {
      this.moduleLogger.info('Starting requirement processing', {
        requirementId,
        userId,
        message: message.substring(0, 100) + (message.length > 100 ? '...' : '')
      });

      // 检查远程会话是否存在
      const sessionExists = await this.checkRemoteSession();
      if (!sessionExists) {
        throw new Error('Claude Code远程会话不存在，请先运行setup_remote_claude.sh');
      }

      // 更新状态为processing
      await this.database.updateRequirementStatus(requirementId, 'processing', {
        processing_start_time: new Date()
      });

      // 执行Claude Code命令
      const output = await this.executeClaudeCodeCommand(message);

      // 更新状态为completed
      await this.database.updateRequirementStatus(requirementId, 'completed', {
        processing_end_time: new Date(),
        claude_code_output: output,
        completion_details: 'Claude Code execution completed successfully'
      });

      this.moduleLogger.info('Requirement processing completed', {
        requirementId,
        outputLength: output.length
      });

    } catch (error) {
      this.moduleLogger.error('Requirement processing failed', {
        requirementId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // 更新状态为failed
      await this.database.updateRequirementStatus(requirementId, 'failed', {
        processing_end_time: new Date(),
        error_message: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;
    }
  }

  /**
   * 执行Claude Code命令并获取输出
   */
  private async executeClaudeCodeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.moduleLogger.debug('Executing Claude Code command', {
        command: command.substring(0, 100) + (command.length > 100 ? '...' : '')
      });

      // 使用remote_claude_command.sh脚本执行命令
      const process = spawn('bash', [this.scriptPath, command], {
        cwd: '/home/liahua/IdeaProject/qq_bot'
      });

      let stdout = '';
      let stderr = '';

      process.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          this.moduleLogger.debug('Claude Code command executed successfully', {
            stdoutLength: stdout.length,
            stderrLength: stderr.length
          });
          
          // 等待一段时间让Claude Code处理完成，然后获取实际输出
          setTimeout(async () => {
            try {
              const actualOutput = await this.captureClaudeCodeOutput();
              resolve(actualOutput);
            } catch (error) {
              this.moduleLogger.warn('Failed to capture Claude Code output, using command output', { error });
              resolve(stdout || '命令已发送到Claude Code会话，请检查tmux会话获取详细输出');
            }
          }, 2000); // 等待2秒让Claude Code处理

        } else {
          const errorMessage = `Command failed with code ${code}: ${stderr}`;
          this.moduleLogger.error('Claude Code command failed', {
            code,
            stderr,
            stdout
          });
          reject(new Error(errorMessage));
        }
      });

      process.on('error', (error) => {
        this.moduleLogger.error('Failed to spawn process', { error });
        reject(error);
      });

      // 设置超时
      setTimeout(() => {
        process.kill('SIGTERM');
        reject(new Error('Command execution timeout (30s)'));
      }, 30000);
    });
  }

  /**
   * 捕获Claude Code会话的输出
   */
  private async captureClaudeCodeOutput(): Promise<string> {
    return new Promise((resolve, reject) => {
      // 使用tmux capture-pane获取会话输出
      const process = spawn('tmux', [
        'capture-pane',
        '-t', this.sessionName,
        '-p'
      ]);

      let output = '';
      let errorOutput = '';

      process.stdout?.on('data', (data) => {
        output += data.toString();
      });

      process.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          // 清理输出，只保留最近的相关内容
          const cleanedOutput = this.cleanTmuxOutput(output);
          resolve(cleanedOutput);
        } else {
          reject(new Error(`Failed to capture output: ${errorOutput}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });

      // 设置超时
      setTimeout(() => {
        process.kill('SIGTERM');
        reject(new Error('Output capture timeout'));
      }, 5000);
    });
  }

  /**
   * 清理tmux输出，提取有用信息
   */
  private cleanTmuxOutput(rawOutput: string): string {
    const lines = rawOutput.split('\n');
    
    // 寻找Claude Code相关的输出行
    const claudeOutputStart = lines.findIndex(line => 
      line.includes('claude -p') || 
      line.includes('Claude Code') ||
      line.includes('✅') ||
      line.includes('❌') ||
      line.includes('📝')
    );

    if (claudeOutputStart !== -1) {
      // 提取从命令开始到最后的输出
      const relevantLines = lines.slice(claudeOutputStart);
      return relevantLines.join('\n').trim();
    }

    // 如果没有找到特定标记，返回最后几行
    const lastLines = lines.slice(-20);
    return lastLines.join('\n').trim();
  }

  /**
   * 获取处理状态统计
   */
  public async getProcessingStats(): Promise<{
    total: number;
    processing: number;
    completed: number;
    failed: number;
  }> {
    try {
      const stats = await this.database.executeQuery<{ status: string; count: number }>(`
        SELECT status, COUNT(*) as count 
        FROM requirements 
        GROUP BY status
      `);
      
      const result = {
        total: 0,
        processing: 0,
        completed: 0,
        failed: 0
      };

      stats.forEach(stat => {
        result.total += stat.count;
        switch (stat.status) {
          case 'processing':
            result.processing = stat.count;
            break;
          case 'completed':
            result.completed = stat.count;
            break;
          case 'failed':
            result.failed = stat.count;
            break;
        }
      });

      return result;
    } catch (error) {
      this.moduleLogger.error('Failed to get processing stats', { error });
      return { total: 0, processing: 0, completed: 0, failed: 0 };
    }
  }

  /**
   * 清理长时间处理中的需求 (超过1小时自动标记为失败)
   */
  public async cleanupStaleRequirements(): Promise<number> {
    try {
      const staleThreshold = new Date(Date.now() - 60 * 60 * 1000); // 1小时前
      
      const staleRequirements = await this.database.executeQuery<RequirementData>(
        `SELECT * FROM requirements 
         WHERE status = 'processing' 
         AND processing_start_time < ?`,
        [staleThreshold]
      );

      let cleanupCount = 0;
      for (const req of staleRequirements) {
        await this.database.updateRequirementStatus(req.id, 'failed', {
          processing_end_time: new Date(),
          error_message: 'Processing timeout - automatically cleaned up after 1 hour'
        });
        cleanupCount++;
      }

      if (cleanupCount > 0) {
        this.moduleLogger.info('Cleaned up stale requirements', { count: cleanupCount });
      }

      return cleanupCount;
    } catch (error) {
      this.moduleLogger.error('Failed to cleanup stale requirements', { error });
      return 0;
    }
  }

  /**
   * 健康检查
   */
  public async healthCheck(): Promise<{
    remoteSessionExists: boolean;
    scriptsAvailable: boolean;
    stats: any;
  }> {
    const remoteSessionExists = await this.checkRemoteSession();
    
    // 检查脚本文件是否存在
    const fs = require('fs');
    const scriptsAvailable = fs.existsSync(this.scriptPath);
    
    const stats = await this.getProcessingStats();

    return {
      remoteSessionExists,
      scriptsAvailable,
      stats
    };
  }
}

export default RemoteClaudeService;