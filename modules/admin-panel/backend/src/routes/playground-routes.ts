import express from 'express';
import { DatabaseManager } from '../services/database';
import winston from 'winston';
import { PlaygroundCaseBuilder } from '../services/playground-case-builder';
import { PlaygroundRunService } from '../services/playground-run-service';

export function createPlaygroundRoutes(database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();
  const caseBuilder = new PlaygroundCaseBuilder(database, logger);
  const runService = new PlaygroundRunService(database, logger, caseBuilder);
  const ready = caseBuilder.ensureTables();

  router.get('/playground/cases', async (req, res) => {
    try {
      await ready;
      const payload = await caseBuilder.listLibrary({
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        promptId: typeof req.query.promptId === 'string' ? req.query.promptId : null
      });

      res.json({
        success: true,
        data: payload,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to list playground library', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to load playground library',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.post('/playground/cases/from-traffic/:trafficId', async (req, res) => {
    try {
      await ready;
      const trafficId = Number(req.params.trafficId);
      if (!Number.isFinite(trafficId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid traffic ID',
          timestamp: new Date().toISOString()
        });
      }

      const record = await caseBuilder.createCaseFromTraffic(
        trafficId,
        typeof req.body?.promptId === 'string' ? req.body.promptId : null
      );

      res.json({
        success: true,
        data: record,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to create playground case from traffic', { error, trafficId: req.params.trafficId });
      res.status(500).json({
        success: false,
        error: 'Failed to create playground case from traffic',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.post('/playground/cases/from-conversation/:conversationId', async (req, res) => {
    try {
      await ready;
      const record = await caseBuilder.createCaseFromConversation(
        req.params.conversationId,
        typeof req.body?.promptId === 'string' ? req.body.promptId : null
      );

      res.json({
        success: true,
        data: record,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to create playground case from conversation', { error, conversationId: req.params.conversationId });
      res.status(500).json({
        success: false,
        error: 'Failed to create playground case from conversation',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/playground/cases/:caseId', async (req, res) => {
    try {
      await ready;
      const record = await caseBuilder.getCaseById(req.params.caseId);
      if (!record) {
        return res.status(404).json({
          success: false,
          error: 'Playground case not found',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: record,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to load playground case', { error, caseId: req.params.caseId });
      res.status(500).json({
        success: false,
        error: 'Failed to load playground case',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.put('/playground/cases/:caseId', async (req, res) => {
    try {
      await ready;
      const record = await caseBuilder.updateCase(req.params.caseId, req.body || {});
      if (!record) {
        return res.status(404).json({
          success: false,
          error: 'Playground case not found',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: record,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to update playground case', { error, caseId: req.params.caseId });
      res.status(500).json({
        success: false,
        error: 'Failed to update playground case',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/playground/cases/:caseId/runs', async (req, res) => {
    try {
      await ready;
      const runs = await caseBuilder.listRunsByCase(req.params.caseId);
      res.json({
        success: true,
        data: runs,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to list playground runs', { error, caseId: req.params.caseId });
      res.status(500).json({
        success: false,
        error: 'Failed to list playground runs',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.post('/playground/runs', async (req, res) => {
    try {
      await ready;
      const record = await runService.createRun({
        caseId: req.body.caseId,
        promptMode: req.body.promptMode,
        promptId: req.body.promptId,
        providerConfig: req.body.providerConfig,
        promptInput: req.body.promptInput,
        draftPrompt: req.body.draftPrompt,
        executedBy: req.body.executedBy
      });

      res.json({
        success: true,
        data: record,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to execute playground run', { error, body: req.body });
      res.status(500).json({
        success: false,
        error: 'Failed to execute playground run',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/playground/runs/:runId', async (req, res) => {
    try {
      await ready;
      const record = await caseBuilder.getRunById(req.params.runId);
      if (!record) {
        return res.status(404).json({
          success: false,
          error: 'Playground run not found',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: record,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to load playground run', { error, runId: req.params.runId });
      res.status(500).json({
        success: false,
        error: 'Failed to load playground run',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.post('/playground/runs/:runId/clone', async (req, res) => {
    try {
      await ready;
      const record = await runService.cloneRun(req.params.runId);
      res.json({
        success: true,
        data: record,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to clone playground run', { error, runId: req.params.runId });
      res.status(500).json({
        success: false,
        error: 'Failed to clone playground run',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
}
