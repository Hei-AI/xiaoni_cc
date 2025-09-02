#!/usr/bin/env ts-node

/**
 * Token迁移脚本
 * 将resource/token.properties中的token迁移到数据库
 */

import * as fs from 'fs';
import * as path from 'path';
import { getDatabaseManager } from '../src/services/database';
import { logger } from '../src/utils/logger';
import { config } from '../src/config';

interface TokenData {
  token: string;
  projectName: string;
  projectId: string;
}

class TokenMigrator {
  private moduleLogger = logger.createModuleLogger('token-migrator');
  private database = getDatabaseManager(config.database);

  async migrate(): Promise<void> {
    try {
      this.moduleLogger.info('开始Token迁移过程');
      
      // 1. 执行数据库迁移脚本
      await this.runMigrationSql();
      
      // 2. 读取并解析token.properties文件
      const tokens = await this.parseTokenFile();
      this.moduleLogger.info(`解析到${tokens.length}个token`);
      
      // 3. 检查数据库中是否已有token数据
      const existingTokens = await this.getExistingTokens();
      if (existingTokens.length > 0) {
        this.moduleLogger.warn(`数据库中已存在${existingTokens.length}个token，将跳过重复的token`);
      }
      
      // 4. 插入新token到数据库
      let insertedCount = 0;
      for (const tokenData of tokens) {
        const inserted = await this.insertToken(tokenData);
        if (inserted) insertedCount++;
      }
      
      this.moduleLogger.info(`成功迁移${insertedCount}个token到数据库`);
      
      // 5. 验证迁移结果
      await this.verifyMigration();
      
      this.moduleLogger.info('Token迁移完成！');
      
    } catch (error) {
      this.moduleLogger.error('Token迁移失败', { error });
      throw error;
    }
  }

  private async runMigrationSql(): Promise<void> {
    const migrationFile = path.join(__dirname, '../database/migrations/001_create_api_tokens_table.sql');
    
    if (!fs.existsSync(migrationFile)) {
      throw new Error(`迁移脚本文件不存在: ${migrationFile}`);
    }
    
    const sqlContent = fs.readFileSync(migrationFile, 'utf-8');
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    for (const statement of statements) {
      try {
        await this.database.executeUpdate(statement);
        this.moduleLogger.debug('执行SQL语句成功', { statement: statement.substring(0, 50) + '...' });
      } catch (error) {
        // 忽略表已存在的错误
        if (error instanceof Error && error.message.includes('already exists')) {
          this.moduleLogger.debug('表已存在，跳过创建');
        } else {
          throw error;
        }
      }
    }
    
    this.moduleLogger.info('数据库迁移脚本执行完成');
  }

  private async parseTokenFile(): Promise<TokenData[]> {
    const tokenFilePath = path.join(__dirname, '../resource/token.properties');
    
    if (!fs.existsSync(tokenFilePath)) {
      throw new Error(`Token文件不存在: ${tokenFilePath}`);
    }

    const content = fs.readFileSync(tokenFilePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
    
    const tokenMap: { [key: string]: { name: string; token: string } } = {};

    // 解析properties文件
    for (const line of lines) {
      const [key, value] = line.split('=').map(s => s.trim());
      if (!key || !value) continue;

      if (key.endsWith('.token')) {
        const projectKey = key.replace('.token', '');
        if (!tokenMap[projectKey]) tokenMap[projectKey] = { name: '', token: '' };
        tokenMap[projectKey].token = value;
      } else if (key.startsWith('project.name_')) {
        const projectKey = key;
        if (!tokenMap[projectKey]) tokenMap[projectKey] = { name: '', token: '' };
        tokenMap[projectKey].name = value;
      }
    }

    // 转换为TokenData数组
    const tokens: TokenData[] = [];
    for (const [projectKey, data] of Object.entries(tokenMap)) {
      if (data.token && data.token.length > 10) {
        const projectId = data.name || projectKey.replace('project.name_', '');
        tokens.push({
          token: data.token,
          projectName: projectKey,
          projectId: projectId
        });
      }
    }

    return tokens;
  }

  private async getExistingTokens(): Promise<string[]> {
    try {
      const results = await this.database.executeQuery<{token: string}>(
        'SELECT token FROM api_tokens'
      );
      return results.map(row => row.token);
    } catch (error) {
      // 表不存在时返回空数组
      return [];
    }
  }

  private async insertToken(tokenData: TokenData): Promise<boolean> {
    try {
      // 检查token是否已存在
      const existing = await this.database.executeQuery<{id: number}>(
        'SELECT id FROM api_tokens WHERE token = ?',
        [tokenData.token]
      );

      if (existing.length > 0) {
        this.moduleLogger.debug('Token已存在，跳过插入', { projectName: tokenData.projectName });
        return false;
      }

      // 插入新token
      const insertSql = `
        INSERT INTO api_tokens 
        (token, project_name, project_id, is_active, is_healthy, daily_limit, priority) 
        VALUES (?, ?, ?, TRUE, TRUE, 1000, 1)
      `;
      
      const affectedRows = await this.database.executeUpdate(insertSql, [
        tokenData.token,
        tokenData.projectName,
        tokenData.projectId
      ]);

      if (affectedRows > 0) {
        this.moduleLogger.info('Token插入成功', { 
          projectName: tokenData.projectName,
          projectId: tokenData.projectId,
          tokenPrefix: tokenData.token.substring(0, 8) + '...'
        });
        return true;
      }

      return false;
    } catch (error) {
      this.moduleLogger.error('Token插入失败', { 
        error, 
        projectName: tokenData.projectName 
      });
      return false;
    }
  }

  private async verifyMigration(): Promise<void> {
    const tokenCount = await this.database.executeQuery<{count: number}>(
      'SELECT COUNT(*) as count FROM api_tokens WHERE is_active = TRUE'
    );
    
    const logCount = await this.database.executeQuery<{count: number}>(
      'SELECT COUNT(*) as count FROM api_token_logs'
    );
    
    const configCount = await this.database.executeQuery<{count: number}>(
      'SELECT COUNT(*) as count FROM api_token_health_config'
    );

    this.moduleLogger.info('迁移结果验证', {
      activeTokens: tokenCount[0]?.count || 0,
      logRecords: logCount[0]?.count || 0,
      configRecords: configCount[0]?.count || 0
    });

    if ((tokenCount[0]?.count || 0) === 0) {
      throw new Error('迁移验证失败：数据库中没有活跃的token');
    }

    if ((configCount[0]?.count || 0) === 0) {
      throw new Error('迁移验证失败：健康检查配置未正确插入');
    }
  }
}

// 主函数
async function main() {
  try {
    const migrator = new TokenMigrator();
    await migrator.migrate();
    
    console.log('✅ Token迁移成功完成！');
    process.exit(0);
  } catch (error) {
    console.error('❌ Token迁移失败:', error);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main();
}

export { TokenMigrator };