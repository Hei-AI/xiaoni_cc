import { Request, Response } from 'express';
import { DatabaseManager } from './database';
export declare class SessionApiHandlers {
    private database;
    private moduleLogger;
    constructor(database: DatabaseManager);
    handleGetSessions(req: Request, res: Response): Promise<void>;
    handleGetSession(req: Request, res: Response): Promise<void>;
    handleSwitchSessionService(req: Request, res: Response): Promise<void>;
    handleCleanupSessions(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=session-api-handlers.d.ts.map