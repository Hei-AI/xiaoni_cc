# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## QQ智能机器人 - 4模块微服务架构

This is a sophisticated QQ bot system built with a microservices architecture, implementing intelligent AI conversation features with advanced decision-making engines.

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
- `DatabaseManager`: MySQL database operations with connection pooling
- `AIService`: Gemini API integration with intelligent token rotation
- `WebSocketClient`: OneBot 11 protocol implementation
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

## Database Schema

The system uses a sophisticated database schema with tables for:
- **Core**: `conversations`, `requirements`, `user_profiles`, `group_chat_settings`
- **Token Management**: `api_tokens`, `token_logs`, `token_health_configs`  
- **Session Management**: `sessions`, `session_transitions`
- **Context**: `conversation_windows`, `window_messages`, `user_context`
- **Monitoring**: `debug_logs`, `message_chains`

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

### AI Integration Best Practices
- Multi-token system with health checking and blacklisting
- Token usage analytics and quota management
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