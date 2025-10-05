/**
 * 流量重放模板管理路由
 * 提供模板的CRUD操作
 */

import express from 'express';
import { DatabaseManager } from '../services/database';
import winston from 'winston';

export function createTemplateRoutes(database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  // 获取模板列表
  router.get('/traffic/replay/templates', async (req, res) => {
    try {
      const apiType = req.query.api_type as string;
      const search = req.query.search as string;
      const isActive = req.query.is_active;

      const filters = [];
      const params = [];

      if (apiType) {
        filters.push('target_api_type = ?');
        params.push(apiType);
      }

      if (search) {
        filters.push('(template_name LIKE ? OR description LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
      }

      if (isActive !== undefined) {
        filters.push('is_active = ?');
        params.push(isActive === 'true' ? 1 : 0);
      }

      const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

      const templates = await database.executeQuery<any>(
        `SELECT * FROM traffic_replay_templates
         ${whereClause}
         ORDER BY usage_count DESC, created_at DESC`,
        params
      );

      // 解析JSON字段
      const parsedTemplates = templates.map(template => ({
        ...template,
        header_modifications: parseJson(template.header_modifications),
        body_modifications: parseJson(template.body_modifications),
        query_modifications: parseJson(template.query_modifications)
      }));

      res.json({
        success: true,
        data: parsedTemplates,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to fetch templates', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch templates',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 创建模板
  router.post('/traffic/replay/templates', async (req, res) => {
    try {
      const {
        template_name,
        description,
        target_api_type,
        target_host_pattern,
        target_path_pattern,
        header_modifications,
        body_modifications,
        query_modifications,
        url_replacement_pattern,
        url_replacement_value
      } = req.body;

      // 验证必填字段
      if (!template_name) {
        return res.status(400).json({
          success: false,
          error: 'Template name is required',
          timestamp: new Date().toISOString()
        });
      }

      // 检查模板名是否已存在
      const existing = await database.executeQuery<any>(
        'SELECT id FROM traffic_replay_templates WHERE template_name = ?',
        [template_name]
      );

      if (existing.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Template name already exists',
          timestamp: new Date().toISOString()
        });
      }

      // 插入新模板
      const result = await database.executeInsert(
        `INSERT INTO traffic_replay_templates (
          template_name,
          description,
          target_api_type,
          target_host_pattern,
          target_path_pattern,
          header_modifications,
          body_modifications,
          query_modifications,
          url_replacement_pattern,
          url_replacement_value,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          template_name,
          description || null,
          target_api_type || null,
          target_host_pattern || null,
          target_path_pattern || null,
          header_modifications ? JSON.stringify(header_modifications) : null,
          body_modifications ? JSON.stringify(body_modifications) : null,
          query_modifications ? JSON.stringify(query_modifications) : null,
          url_replacement_pattern || null,
          url_replacement_value || null,
          'admin'  // TODO: 从请求上下文获取实际用户
        ]
      );

      res.json({
        success: true,
        data: {
          id: result.insertId,
          template_name,
          created_at: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to create template', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to create template',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 更新模板
  router.put('/traffic/replay/templates/:id', async (req, res) => {
    try {
      const templateId = parseInt(req.params.id);

      if (isNaN(templateId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid template ID',
          timestamp: new Date().toISOString()
        });
      }

      // 检查模板是否存在
      const existing = await database.executeQuery<any>(
        'SELECT id FROM traffic_replay_templates WHERE id = ?',
        [templateId]
      );

      if (existing.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Template not found',
          timestamp: new Date().toISOString()
        });
      }

      const {
        template_name,
        description,
        target_api_type,
        target_host_pattern,
        target_path_pattern,
        header_modifications,
        body_modifications,
        query_modifications,
        url_replacement_pattern,
        url_replacement_value,
        is_active
      } = req.body;

      // 构建更新语句
      const updates = [];
      const params = [];

      if (template_name !== undefined) {
        updates.push('template_name = ?');
        params.push(template_name);
      }

      if (description !== undefined) {
        updates.push('description = ?');
        params.push(description);
      }

      if (target_api_type !== undefined) {
        updates.push('target_api_type = ?');
        params.push(target_api_type);
      }

      if (target_host_pattern !== undefined) {
        updates.push('target_host_pattern = ?');
        params.push(target_host_pattern);
      }

      if (target_path_pattern !== undefined) {
        updates.push('target_path_pattern = ?');
        params.push(target_path_pattern);
      }

      if (header_modifications !== undefined) {
        updates.push('header_modifications = ?');
        params.push(JSON.stringify(header_modifications));
      }

      if (body_modifications !== undefined) {
        updates.push('body_modifications = ?');
        params.push(JSON.stringify(body_modifications));
      }

      if (query_modifications !== undefined) {
        updates.push('query_modifications = ?');
        params.push(JSON.stringify(query_modifications));
      }

      if (url_replacement_pattern !== undefined) {
        updates.push('url_replacement_pattern = ?');
        params.push(url_replacement_pattern);
      }

      if (url_replacement_value !== undefined) {
        updates.push('url_replacement_value = ?');
        params.push(url_replacement_value);
      }

      if (is_active !== undefined) {
        updates.push('is_active = ?');
        params.push(is_active ? 1 : 0);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No fields to update',
          timestamp: new Date().toISOString()
        });
      }

      params.push(templateId);

      await database.executeUpdate(
        `UPDATE traffic_replay_templates SET ${updates.join(', ')} WHERE id = ?`,
        params
      );

      res.json({
        success: true,
        data: {
          id: templateId,
          updated_at: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to update template', { error, id: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Failed to update template',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 删除模板
  router.delete('/traffic/replay/templates/:id', async (req, res) => {
    try {
      const templateId = parseInt(req.params.id);

      if (isNaN(templateId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid template ID',
          timestamp: new Date().toISOString()
        });
      }

      // 检查模板是否存在
      const existing = await database.executeQuery<any>(
        'SELECT id FROM traffic_replay_templates WHERE id = ?',
        [templateId]
      );

      if (existing.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Template not found',
          timestamp: new Date().toISOString()
        });
      }

      // 删除模板
      await database.executeUpdate(
        'DELETE FROM traffic_replay_templates WHERE id = ?',
        [templateId]
      );

      res.json({
        success: true,
        message: 'Template deleted successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to delete template', { error, id: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Failed to delete template',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 获取单个模板详情
  router.get('/traffic/replay/templates/:id', async (req, res) => {
    try {
      const templateId = parseInt(req.params.id);

      if (isNaN(templateId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid template ID',
          timestamp: new Date().toISOString()
        });
      }

      const templates = await database.executeQuery<any>(
        'SELECT * FROM traffic_replay_templates WHERE id = ?',
        [templateId]
      );

      if (templates.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Template not found',
          timestamp: new Date().toISOString()
        });
      }

      const template = templates[0];

      // 解析JSON字段
      template.header_modifications = parseJson(template.header_modifications);
      template.body_modifications = parseJson(template.body_modifications);
      template.query_modifications = parseJson(template.query_modifications);

      res.json({
        success: true,
        data: template,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to fetch template', { error, id: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch template',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
}

// 辅助函数：解析JSON字段
function parseJson(value: any): any {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

export default createTemplateRoutes;
