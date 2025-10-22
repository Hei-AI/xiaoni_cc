import { Router, Request, Response } from 'express';
import { FunctionRegistryService } from '../services/function-registry-service';
import { createModuleLogger } from '../utils/logger';

const routerLogger = createModuleLogger('invoke-routes');

export const createInvocationRoutes = (service: FunctionRegistryService): Router => {
  const router = Router();

  router.post('/:id/invoke', async (req: Request, res: Response) => {
    try {
      if (!req.body || typeof req.body !== 'object' || req.body.arguments === undefined) {
        return res.status(400).json({ success: false, error: 'Missing arguments in request body' });
      }
      const result = await service.invokeFunction(req.params.id, req.body);
      res.json(result);
    } catch (error: any) {
      routerLogger.error('Function invocation failed', { error: error.message, functionId: req.params.id });
      res.status(400).json({ success: false, error: error.message });
    }
  });

  return router;
};
