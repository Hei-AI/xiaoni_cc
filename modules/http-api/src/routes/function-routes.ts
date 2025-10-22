import { Router, Request, Response } from 'express';
import { FunctionRegistryService } from '../services/function-registry-service';
import { createModuleLogger } from '../utils/logger';

const routerLogger = createModuleLogger('function-routes');

const parseBoolean = (value?: string) => {
  if (value === undefined) return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
};

export const createFunctionRoutes = (service: FunctionRegistryService): Router => {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    try {
      const { search, category, tag, page = '1', limit = '20' } = req.query;
      const enabled = parseBoolean(req.query.enabled as string | undefined);
      const sideEffect = parseBoolean(req.query.sideEffect as string | undefined);

      const offset = (Number(page) - 1) * Number(limit);
      const result = await service.listFunctions({
        search: search as string | undefined,
        category: category as string | undefined,
        enabled,
        sideEffect,
        tag: tag as string | undefined,
        limit: Number(limit),
        offset
      });

      res.json(result);
    } catch (error: any) {
      routerLogger.error('Failed to list functions', { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      const functionDef = await service.createFunction(req.body);
      res.status(201).json(functionDef);
    } catch (error: any) {
      routerLogger.error('Failed to create function', { error: error.message });
      res.status(400).json({ success: false, error: error.message });
    }
  });

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const functionDef = await service.getFunction(req.params.id);
      if (!functionDef) {
        return res.status(404).json({ success: false, error: 'Function not found' });
      }
      res.json(functionDef);
    } catch (error: any) {
      routerLogger.error('Failed to fetch function', { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      const updated = await service.updateFunction(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ success: false, error: 'Function not found' });
      }
      res.json(updated);
    } catch (error: any) {
      routerLogger.error('Failed to update function', { error: error.message });
      res.status(400).json({ success: false, error: error.message });
    }
  });

  router.post('/:id/enable', async (req: Request, res: Response) => {
    try {
      const result = await service.setFunctionEnabled(req.params.id, true, req.body?.actor);
      if (!result) {
        return res.status(404).json({ success: false, error: 'Function not found' });
      }
      res.json({ success: true });
    } catch (error: any) {
      routerLogger.error('Failed to enable function', { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/:id/disable', async (req: Request, res: Response) => {
    try {
      const result = await service.setFunctionEnabled(req.params.id, false, req.body?.actor);
      if (!result) {
        return res.status(404).json({ success: false, error: 'Function not found' });
      }
      res.json({ success: true });
    } catch (error: any) {
      routerLogger.error('Failed to disable function', { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
};
