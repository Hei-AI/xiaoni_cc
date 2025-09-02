import { LogLevel } from '../types';
declare class Logger {
    private loggers;
    private logDir;
    constructor();
    private getLogger;
    log(level: LogLevel, module: string, message: string, extra?: Record<string, any>): void;
    debug(module: string, message: string, extra?: Record<string, any>): void;
    info(module: string, message: string, extra?: Record<string, any>): void;
    warn(module: string, message: string, extra?: Record<string, any>): void;
    error(module: string, message: string, extra?: Record<string, any>): void;
    createModuleLogger(module: string): {
        debug: (message: string, extra?: Record<string, any>) => void;
        info: (message: string, extra?: Record<string, any>) => void;
        warn: (message: string, extra?: Record<string, any>) => void;
        error: (message: string, extra?: Record<string, any>) => void;
    };
}
export declare const logger: Logger;
export default logger;
//# sourceMappingURL=logger.d.ts.map