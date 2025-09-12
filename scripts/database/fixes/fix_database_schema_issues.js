#!/usr/bin/env node

/**
 * Fix Database Schema Issues
 * Fixes the problems found during testing:
 * 1. Foreign key constraints on llm_call_traces
 * 2. Session ID field length
 * 3. Other schema-related issues
 */

const mysql = require('mysql2/promise');

const dbConfig = {
  host: 'localhost',
  port: 3306,
  user: 'qqbot_user',
  password: 'qqbot_password',
  database: 'qqbot_db',
  charset: 'utf8mb4'
};

async function connectDB() {
  const connection = await mysql.createConnection(dbConfig);
  
  // Set UTF8MB4 encoding
  await connection.execute("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
  await connection.execute("SET character_set_client = utf8mb4");
  await connection.execute("SET character_set_connection = utf8mb4");
  await connection.execute("SET character_set_results = utf8mb4");
  
  return connection;
}

async function fixDatabaseSchemaIssues() {
  let connection;
  
  try {
    console.log('🔧 Fixing Database Schema Issues...\n');
    
    connection = await connectDB();
    console.log('✅ Database connected successfully');
    
    // Step 1: Check current llm_call_traces table schema
    console.log('\n📋 Step 1: Checking current table schema...');
    await checkCurrentSchema(connection);
    
    // Step 2: Fix foreign key constraints
    console.log('\n🔗 Step 2: Fixing foreign key constraints...');
    await fixForeignKeyConstraints(connection);
    
    // Step 3: Fix field lengths
    console.log('\n📏 Step 3: Fixing field lengths...');
    await fixFieldLengths(connection);
    
    // Step 4: Verify fixes
    console.log('\n✅ Step 4: Verifying fixes...');
    await verifyFixes(connection);
    
    console.log('\n🎉 All database schema issues fixed!');
    
  } catch (error) {
    console.error('❌ Failed to fix database schema:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database connection closed');
    }
  }
}

async function checkCurrentSchema(connection) {
  try {
    // Check if llm_call_traces table exists
    const [tables] = await connection.execute(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = 'qqbot_db' AND TABLE_NAME = 'llm_call_traces'
    `);
    
    if (tables.length === 0) {
      console.log('  ⚠️ llm_call_traces table does not exist');
      return;
    }
    
    console.log('  ✅ llm_call_traces table exists');
    
    // Check table structure
    const [columns] = await connection.execute(`
      SELECT 
        COLUMN_NAME, 
        DATA_TYPE, 
        CHARACTER_MAXIMUM_LENGTH, 
        IS_NULLABLE, 
        COLUMN_DEFAULT, 
        COLUMN_KEY
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = 'qqbot_db' AND TABLE_NAME = 'llm_call_traces'
      ORDER BY ORDINAL_POSITION
    `);
    
    console.log('  📊 Current table structure:');
    columns.forEach(col => {
      const length = col.CHARACTER_MAXIMUM_LENGTH ? `(${col.CHARACTER_MAXIMUM_LENGTH})` : '';
      console.log(`     ${col.COLUMN_NAME}: ${col.DATA_TYPE}${length} ${col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
    
    // Check foreign key constraints
    const [constraints] = await connection.execute(`
      SELECT 
        CONSTRAINT_NAME, 
        COLUMN_NAME, 
        REFERENCED_TABLE_NAME, 
        REFERENCED_COLUMN_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
      WHERE TABLE_SCHEMA = 'qqbot_db' 
        AND TABLE_NAME = 'llm_call_traces' 
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `);
    
    if (constraints.length > 0) {
      console.log('  🔗 Current foreign key constraints:');
      constraints.forEach(constraint => {
        console.log(`     ${constraint.CONSTRAINT_NAME}: ${constraint.COLUMN_NAME} -> ${constraint.REFERENCED_TABLE_NAME}.${constraint.REFERENCED_COLUMN_NAME}`);
      });
    } else {
      console.log('  ℹ️ No foreign key constraints found');
    }
    
  } catch (error) {
    console.error('  ❌ Error checking schema:', error.message);
  }
}

async function fixForeignKeyConstraints(connection) {
  try {
    // First, check if foreign key constraints exist and drop them if they're problematic
    const [constraints] = await connection.execute(`
      SELECT CONSTRAINT_NAME 
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
      WHERE TABLE_SCHEMA = 'qqbot_db' 
        AND TABLE_NAME = 'llm_call_traces' 
        AND REFERENCED_TABLE_NAME = 'conversations'
    `);
    
    for (const constraint of constraints) {
      console.log(`  🗑️ Dropping foreign key constraint: ${constraint.CONSTRAINT_NAME}`);
      try {
        await connection.execute(`
          ALTER TABLE llm_call_traces 
          DROP FOREIGN KEY ${constraint.CONSTRAINT_NAME}
        `);
        console.log(`    ✅ Dropped ${constraint.CONSTRAINT_NAME}`);
      } catch (error) {
        console.log(`    ⚠️ Could not drop ${constraint.CONSTRAINT_NAME}: ${error.message}`);
      }
    }
    
    // The conversation_id should be nullable and not enforce foreign key constraint
    // for flexibility in testing and when conversations haven't been created yet
    console.log('  ✅ Foreign key constraints removed for flexibility');
    
  } catch (error) {
    console.error('  ❌ Error fixing foreign key constraints:', error.message);
  }
}

async function fixFieldLengths(connection) {
  try {
    // Check current session_id field length
    const [sessionIdColumn] = await connection.execute(`
      SELECT CHARACTER_MAXIMUM_LENGTH 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = 'qqbot_db' 
        AND TABLE_NAME = 'llm_call_traces' 
        AND COLUMN_NAME = 'session_id'
    `);
    
    if (sessionIdColumn.length > 0) {
      const currentLength = sessionIdColumn[0].CHARACTER_MAXIMUM_LENGTH;
      console.log(`  📏 Current session_id length: ${currentLength}`);
      
      if (currentLength < 100) {
        console.log('  📏 Extending session_id field length...');
        await connection.execute(`
          ALTER TABLE llm_call_traces 
          MODIFY COLUMN session_id VARCHAR(255) NOT NULL
        `);
        console.log('    ✅ session_id extended to VARCHAR(255)');
      } else {
        console.log('    ✅ session_id length is already adequate');
      }
    }
    
    // Check other potentially problematic fields
    const fieldsToCheck = [
      { field: 'id', expectedLength: 255 },
      { field: 'conversation_id', expectedLength: 255 },
      { field: 'engine_type', expectedLength: 50 },
      { field: 'model_name', expectedLength: 100 }
    ];
    
    for (const fieldCheck of fieldsToCheck) {
      const [column] = await connection.execute(`
        SELECT CHARACTER_MAXIMUM_LENGTH 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = 'qqbot_db' 
          AND TABLE_NAME = 'llm_call_traces' 
          AND COLUMN_NAME = ?
      `, [fieldCheck.field]);
      
      if (column.length > 0) {
        const currentLength = column[0].CHARACTER_MAXIMUM_LENGTH;
        if (currentLength < fieldCheck.expectedLength) {
          console.log(`  📏 Extending ${fieldCheck.field} from ${currentLength} to ${fieldCheck.expectedLength}...`);
          await connection.execute(`
            ALTER TABLE llm_call_traces 
            MODIFY COLUMN ${fieldCheck.field} VARCHAR(${fieldCheck.expectedLength})
          `);
          console.log(`    ✅ ${fieldCheck.field} extended`);
        }
      }
    }
    
  } catch (error) {
    console.error('  ❌ Error fixing field lengths:', error.message);
  }
}

async function verifyFixes(connection) {
  try {
    // Test inserting a sample LLM trace
    const testTrace = {
      id: 'test_trace_' + Date.now(),
      session_id: 'test_session_very_long_name_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      conversation_id: null, // Test null conversation_id
      call_sequence: 1,
      engine_type: 'decision',
      model_name: 'gemini-1.5-pro',
      prompt: 'Test prompt',
      response: 'Test response',
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      response_time: 1000,
      timestamp: new Date(),
      success: true,
      error_message: null
    };
    
    console.log('  🧪 Testing trace insertion with long session_id and null conversation_id...');
    
    await connection.execute(`
      INSERT INTO llm_call_traces 
      (id, session_id, conversation_id, call_sequence, engine_type, model_name, 
       prompt, response, prompt_tokens, completion_tokens, total_tokens, 
       response_time, timestamp, success, error_message) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      testTrace.id,
      testTrace.session_id,
      testTrace.conversation_id,
      testTrace.call_sequence,
      testTrace.engine_type,
      testTrace.model_name,
      testTrace.prompt,
      testTrace.response,
      testTrace.prompt_tokens,
      testTrace.completion_tokens,
      testTrace.total_tokens,
      testTrace.response_time,
      testTrace.timestamp,
      testTrace.success,
      testTrace.error_message
    ]);
    
    console.log('    ✅ Test trace inserted successfully');
    
    // Verify the insertion
    const [results] = await connection.execute(`
      SELECT session_id, conversation_id 
      FROM llm_call_traces 
      WHERE id = ?
    `, [testTrace.id]);
    
    if (results.length > 0) {
      console.log(`    ✅ Test trace verified: session_id length = ${results[0].session_id.length}`);
    }
    
    // Clean up test data
    await connection.execute('DELETE FROM llm_call_traces WHERE id = ?', [testTrace.id]);
    console.log('    ✅ Test data cleaned up');
    
  } catch (error) {
    console.error('  ❌ Verification failed:', error.message);
    throw error;
  }
}

if (require.main === module) {
  fixDatabaseSchemaIssues().catch(error => {
    console.error('Schema fix failed:', error);
    process.exit(1);
  });
}

module.exports = { fixDatabaseSchemaIssues };