# QQ Bot Scripts Directory

This directory contains all development, testing, debugging, and database management scripts for the QQ Bot project.

## Directory Structure

### 🧪 Testing (`testing/`)
Scripts for comprehensive testing of the QQ Bot system.

#### Comprehensive Tests (`testing/comprehensive/`)
- **`test_token_model_system.js`** - 🔥 **Master comprehensive test** for Token-Model binding system (mentioned in CLAUDE.md)
- **`test_system_comprehensive.js`** - System-wide comprehensive testing

#### Test Runners (`testing/runners/`)
- **`run_all_tests.js`** - Master test runner with reporting capabilities

#### Integration Tests (`testing/integration/`)
- `test_integration_flow.js` - End-to-end message processing flow tests
- `test_end_to_end_flow.js` - Complete system workflow tests
- `test_conversation_tracking.js` - Conversation tracking system tests

#### Unit Tests (`testing/unit/`)
- `test_api_endpoints.js` - HTTP API endpoint testing
- `test_database_operations.js` - Database methods testing
- `test_llm_call_tracking.js` - LLM call tracking functionality tests
- `test_conversation_history.js` - Conversation history functionality tests
- `test_private_message.js` - Private message handling tests
- `test_context_fix*.js` - Context handling tests (multiple versions)
- And many more specialized unit tests...

### 🗄️ Database Management (`database/`)
Scripts for database operations, validation, and maintenance.

#### Database Checks (`database/checks/`)
Complete validation suite for database integrity:
- `check_database_locks.js` - Database lock status monitoring
- `check_llm_tables.js` - LLM-related tables validation
- `check_websocket_logs.js` - WebSocket logs validation
- `check_tokens_*.js` - Token system validation
- `check_conversation_*.js` - Conversation data validation
- And 20+ other validation scripts...

#### Database Fixes (`database/fixes/`)
- **`fix_database_schema.js`** - Major database schema repair
- `fix_database_schema_issues.js` - Schema issue fixes
- `fix_conversations_query.js` - Query optimization fixes

#### Database Maintenance (`database/maintenance/`)
- **`backup_database.js`** - Database backup utility
- **`kill_connections.js`** - Database connection cleanup utility

#### Database Setup (`database/setup/`)
- `create_llm_traces_table.js` - LLM traces table creation
- `create_trace_tables.js` - Trace logging tables setup

### 🐛 Debugging (`debugging/`)
Advanced debugging and diagnostic tools.

#### Diagnostics (`debugging/diagnostics/`)
- **`deep_diagnostic.js`** - Comprehensive system diagnostics
- **`final_diagnosis.js`** - Root cause analysis tool

#### Analysis (`debugging/analysis/`)
- `debug_context.js` - Context manager debugging
- `debug_conversation_raw.js` - Raw conversation data analysis
- `debug_database_query.js` - Database query performance analysis
- **`query_conversation_trace.js`** - Conversation trace analysis tool

### 🔧 Development (`development/`)
Development utilities and simulation tools.

#### Simulators (`development/simulators/`)
- **`trigger_private_test.js`** - Private message simulation tool

## Usage Guidelines

### Running Comprehensive Tests
```bash
# Run the master comprehensive test (required for system validation)
node scripts/testing/comprehensive/test_token_model_system.js

# Run all tests
node scripts/testing/runners/run_all_tests.js
```

### Database Operations
```bash
# Check database health
node scripts/database/checks/check_database_locks.js

# Backup database
node scripts/database/maintenance/backup_database.js

# Run diagnostics
node scripts/debugging/diagnostics/deep_diagnostic.js
```

### Development Testing
```bash
# Test private messages
node scripts/development/simulators/trigger_private_test.js

# Debug conversation issues
node scripts/debugging/analysis/debug_conversation_raw.js
```

## Key Scripts Priority

### 🔥 Critical Scripts (Must Run)
1. **`test_token_model_system.js`** - System validation test mentioned in CLAUDE.md
2. **`backup_database.js`** - Essential database backup
3. **`deep_diagnostic.js`** - System health diagnostics

### 📊 Monitoring Scripts
- `check_database_locks.js` - Monitor database performance
- `query_conversation_trace.js` - Analyze conversation flows
- Various check_*.js scripts for system validation

### 🛠️ Maintenance Scripts
- `kill_connections.js` - Database connection cleanup
- `fix_database_schema.js` - Schema repairs
- Various debug_*.js scripts for troubleshooting

## Migration Notes

All these scripts were previously scattered in the project root directory and have been organized into this structured hierarchy for better maintenance and discoverability.

## Contributing

When adding new scripts:
1. Place them in the appropriate category directory
2. Follow the existing naming conventions
3. Add documentation to this README
4. Include proper error handling and logging

---

*This organization supports the QQ Bot project's development, testing, and maintenance workflows as described in the main CLAUDE.md file.*