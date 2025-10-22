import { Router, Request, Response } from 'express';
import { FunctionRegistryService } from '../services/function-registry-service';
import { createModuleLogger } from '../utils/logger';
const routerLogger = createModuleLogger('prompt-routes');

export const createPromptRoutes = (service: FunctionRegistryService): Router => {
  const router = Router();

  router.get('/:id/functions', async (req: Request, res: Response) => {
    const promptId = req.params.id;
    if (!promptId || typeof promptId !== 'string') {
      return res.status(400).json({ success: false, error: 'Invalid prompt id' });
    }

    try {
      const result = await service.getPromptFunctions(promptId);
      res.json(result);
    } catch (error: any) {
      routerLogger.error('Failed to fetch prompt functions', { error: error.message, promptId });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.patch('/:id/functions', async (req: Request, res: Response) => {
    const promptId = req.params.id;
    if (!promptId || typeof promptId !== 'string') {
      return res.status(400).json({ success: false, error: 'Invalid prompt id' });
    }

    try {
      const { functionIds, actor } = req.body;
      if (!Array.isArray(functionIds)) {
        return res.status(400).json({ success: false, error: 'functionIds must be an array' });
      }

      const result = await service.replacePromptBindings(promptId, {
        functionIds,
        actor
      });

      res.json(result);
    } catch (error: any) {
      routerLogger.error('Failed to update prompt bindings', {
        error: error.message,
        promptId
      });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
};
