"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
class Logger {
    constructor() {
        this.loggers = new Map();
        this.logDir = 'logs';
        // 确保日志目录存在
        if (!fs_1.default.existsSync(this.logDir)) {
            fs_1.default.mkdirSync(this.logDir, { recursive: true });
        }
    }
    getLogger(module) {
        if (!this.loggers.has(module)) {
            const today = new Date().toISOString().split('T')[0];
            const logFile = path_1.default.join(this.logDir, `${module}_${today}.log`);
            const logger = winston_1.default.createLogger({
                level: 'info',
                format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json()),
                transports: [
                    new winston_1.default.transports.File({
                        filename: logFile
                    }),
                    new winston_1.default.transports.Console({
                        format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple())
                    })
                ]
            });
            this.loggers.set(module, logger);
        }
        return this.loggers.get(module);
    }
    log(level, module, message, extra) {
        const logger = this.getLogger(module);
        const logData = {
            module,
            message,
            ...(extra && { extra })
        };
        logger.log(level, logData);
    }
    debug(module, message, extra) {
        this.log('debug', module, message, extra);
    }
    info(module, message, extra) {
        this.log('info', module, message, extra);
    }
    warn(module, message, extra) {
        this.log('warn', module, message, extra);
    }
    error(module, message, extra) {
        this.log('error', module, message, extra);
    }
    createModuleLogger(module) {
        return {
            debug: (message, extra) => this.debug(module, message, extra),
            info: (message, extra) => this.info(module, message, extra),
            warn: (message, extra) => this.warn(module, message, extra),
            error: (message, extra) => this.error(module, message, extra)
        };
    }
}
exports.logger = new Logger();
exports.default = exports.logger;
//# sourceMappingURL=logger.js.map