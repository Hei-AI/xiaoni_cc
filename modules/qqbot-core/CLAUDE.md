# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## QQ智能机器人 - 4模块微服务架构

This is a sophisticated QQ bot system built with a microservices architecture, implementing intelligent AI conversation features with advanced decision-making engines.

## 🔥 最新更新 - Token-Model绑定架构

**核心增强 (2025-09-11):**
- **Model-aware Token管理**: TokenManager支持按模型选择Token
- **被动健康检查**: 移除定时器，改为使用时被动更新
- **5分钟黑名单**: 429/403/401错误自动5分钟黑名单
- **数据库连接池优化**: 修复连接泄露，优化配置参数
- **调用链追踪**: 修复websocket_logs和conversations表关联

## Development Commands

### Project Management
```bash
# Install all dependencies across modules
npm run install:all

# Start all services (uses Python orchestration script)
npm start                    # Full startup with dependency checks
npm run start:fast          # Skip dependency installation

# Stop all services 
npm stop

# Development mode (individual modules)
npm run dev:qqbot-core      # Core bot service
npm run dev:http-api        # HTTP API gateway
npm run dev:admin-backend   # Admin panel backend
npm run dev:admin-frontend  # Admin panel frontend

# Build and test
npm run build:all           # Build all modules
npm run test:all           # Run all tests
npm run lint:all           # Lint all TypeScript code
```

### Module-specific Commands (from module directories)
```bash
# In modules/qqbot-core/
npm run dev                 # Start with ts-node
npm run build              # TypeScript compilation
npm test                   # Jest tests
npm run lint              # ESLint

# Similar pattern for other modules
```

### Port Management
```bash
npm run clean-ports        # Kill processes on configured ports
npm run health-check       # Check service status
```

## Architecture Overview

### Core Components

**QQBot Core Service** (`modules/qqbot-core/`)
- Main bot logic and message handling
- **Stage 1 Intelligence Engines**:
  - `DecisionEngine`: Determines whether to respond to messages using rule-based + AI analysis
  - `PersonaEngine`: Adapts response style based on context and user relationship
  - `ContextEngine`: Manages conversation context and message history
- WebSocket client for QQ message handling (OneBot 11 protocol)
- Database integration with comprehensive conversation tracking
- AI service integration (Gemini API with token management)

**HTTP API Gateway** (`modules/http-api/`)
- External API interface for the bot system
- RESTful endpoints for bot management and data access

**Admin Panel** (`modules/admin-panel/`)
- **Backend**: Express.js API server for admin functionality
- **Frontend**: React-based dashboard for bot administration

### Key Architectural Patterns

**Service Layer Pattern**: Each major functionality is encapsulated in service classes:
- `DatabaseManager`: MySQL database operations with **优化连接池** (修复泄露问题)
- `AIService`: Gemini API integration with **Model-aware Token管理**
- `TokenManager`: **被动健康检查**, Model-specific token选择与黑名单管理
- `WebSocketClient`: OneBot 11 protocol implementation with **Trace ID生成**
- `SessionManager`: Conversation session tracking and management
- `ContextManager`: Builds comprehensive message context from chat history

**Intelligence Engine Architecture** (Stage 1):
```
Message → DecisionEngine → PersonaEngine → ContextEngine → Response
    ↓           ↓              ↓             ↓
Rule-based   AI Analysis    Style         Context
filtering    for intent    adaptation    awareness
```

**Multi-Database Strategy**:
- Core conversations and bot data in MySQL
- Rich type definitions in `src/types/index.ts` covering all database schemas
- Comprehensive API response types for frontend integration

## Database Schema (🔥 更新)

The system uses a sophisticated database schema with tables for:
- **Core**: `conversations` (🆕 trace_id), `requirements`, `user_profiles`, `group_chat_settings`
- **Token Management**: `api_tokens` (🆕 model_blacklist JSON), `agent_prompts` (🆕 model_name, allowed_token_ids)  
- **Session Management**: `sessions`, `session_transitions`
- **Context**: `conversation_windows`, `window_messages`, `user_context`
- **Monitoring**: `websocket_logs` (关联trace_id), `debug_logs`, `message_chains`

**重要字段更新:**
- `conversations.trace_id`: 关联WebSocket日志的追踪ID
- `api_tokens.model_blacklist`: JSON字段，按模型存储黑名单时间
- `agent_prompts.model_name`: 绑定的模型名称 (如gemini-2.5-flash)
- `agent_prompts.allowed_token_ids`: JSON数组，允许使用的token ID

See `src/types/index.ts` for complete type definitions.

## Development Guidelines

### Configuration Management
- Environment-based configuration pattern used throughout
- No hardcoded credentials (uses environment variables and config files)
- Token health checking and automatic rotation system

### Message Processing Flow
1. **WebSocket Event Reception**: OneBot 11 protocol messages received
2. **Decision Engine Analysis**: Rule-based + AI-powered decision on whether to respond
3. **Context Building**: Previous 20 messages + user/group information gathered
4. **Persona Enhancement**: Response style adapted based on user relationship and time context
5. **Database Persistence**: All conversations logged with metadata

### AI Integration Best Practices (🔥 更新)
- **Model-aware Token System**: 按模型独立选择和管理Token
- **被动健康检查**: Token使用时自动更新状态，无定时器开销
- **5分钟快速黑名单**: 429/403/401错误自动5分钟黑名单，快速恢复
- **架构分离**: QQ Bot被动更新，Admin Panel主动检查
- **连接池优化**: 修复数据库连接泄露，优化配置参数
- Graceful fallback when AI services are unavailable
- Context-aware prompt engineering for different conversation types

### Testing Strategy
- Jest testing framework configured across all modules
- Integration tests for AI service and database operations
- End-to-end testing capabilities for full conversation flows

## Important Files

- `src/index.ts`: Main bot orchestration and message handling
- `src/engines/`: Stage 1 intelligence engines for smart response decisions
- `src/services/`: Core service layer implementations
- `src/types/index.ts`: Comprehensive type definitions for entire system
- `scripts/start_modules.py`: Python orchestration script for multi-service startup
- `package.json`: Workspace configuration with module management commands

## Stage 1 Intelligence Features

The bot implements a sophisticated "Stage 1" intelligence system:

**Smart Response Decisions**: Analyzes @mentions, private messages, and contextual conversations to determine appropriate responses.

**Persona Adaptation**: Dynamically adjusts response tone and style based on:
- User relationship (new/occasional/frequent)
- Time of day context
- Conversation topic and urgency
- Group vs private message context

**Contextual Awareness**: Maintains conversation windows with 20-message history, user profiles, and group activity tracking for more informed responses.