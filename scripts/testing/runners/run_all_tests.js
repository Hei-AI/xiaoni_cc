#!/usr/bin/env node

/**
 * Master Test Runner
 * Runs all QQ bot fix verification tests and generates a comprehensive report
 */

const path = require('path');
const fs = require('fs');

// Test modules
const { testMessageStorageFix } = require('./test_message_storage_fix.js');
const { testLLMCallTracking } = require('./test_llm_call_tracking.js');
const { testIntegrationFlow } = require('./test_integration_flow.js');
const { testDatabaseOperations } = require('./test_database_operations.js');

// Test configuration
const testConfig = {
  timeout: 120000, // 2 minutes per test suite
  reportFile: path.join(__dirname, 'test_report.json'),
  summaryFile: path.join(__dirname, 'test_summary.txt')
};

// Test suites configuration
const testSuites = [
  {
    name: 'Message Storage Fix',
    description: 'Verifies original user messages are stored correctly and raw_request contains complete data',
    testFunction: testMessageStorageFix,
    critical: true
  },
  {
    name: 'LLM Call Tracking',
    description: 'Tests LLM trace creation, storage, aggregation, cost calculation, and linkage',
    testFunction: testLLMCallTracking,
    critical: true
  },
  {
    name: 'Integration Flow',
    description: 'Tests complete message processing flow from input to storage',
    testFunction: testIntegrationFlow,
    critical: false // May fail if HTTP server not running
  },
  {
    name: 'Database Operations',
    description: 'Tests all database methods, query performance, and data integrity',
    testFunction: testDatabaseOperations,
    critical: true
  }
];

// Global test state
const testResults = {
  startTime: new Date(),
  endTime: null,
  totalDuration: 0,
  suites: [],
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    critical_failed: 0
  }
};

async function runAllTests() {
  console.log('🚀 QQ Bot Fix Verification Test Suite');
  console.log('=' .repeat(60));
  console.log(`Start Time: ${testResults.startTime.toISOString()}`);
  console.log(`Test Suites: ${testSuites.length}`);
  console.log(`Timeout per suite: ${testConfig.timeout / 1000}s`);
  console.log('');

  for (const suite of testSuites) {
    await runTestSuite(suite);
  }

  // Generate final report
  testResults.endTime = new Date();
  testResults.totalDuration = testResults.endTime - testResults.startTime;
  
  await generateTestReport();
  displaySummary();
  
  // Exit with appropriate code
  const exitCode = testResults.summary.critical_failed > 0 ? 1 : 0;
  process.exit(exitCode);
}

async function runTestSuite(suite) {
  const suiteResult = {
    name: suite.name,
    description: suite.description,
    critical: suite.critical,
    startTime: new Date(),
    endTime: null,
    duration: 0,
    status: 'running',
    error: null,
    output: []
  };
  
  testResults.suites.push(suiteResult);
  testResults.summary.total++;

  console.log(`\n📋 Running: ${suite.name}`);
  console.log(`   ${suite.description}`);
  console.log(`   Critical: ${suite.critical ? 'Yes' : 'No'}`);
  console.log('   ' + '-'.repeat(50));

  // Capture console output
  const originalConsole = {
    log: console.log,
    error: console.error,
    info: console.info,
    warn: console.warn
  };

  const capturedOutput = [];
  
  const captureFunction = (level) => (...args) => {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    
    capturedOutput.push({ level, message, timestamp: new Date() });
    
    // Also output to original console with prefix
    originalConsole[level](`   ${message}`);
  };

  console.log = captureFunction('log');
  console.error = captureFunction('error');
  console.info = captureFunction('info');
  console.warn = captureFunction('warn');

  try {
    // Run test with timeout
    await Promise.race([
      suite.testFunction(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Test timeout after ${testConfig.timeout}ms`)), testConfig.timeout)
      )
    ]);

    suiteResult.status = 'passed';
    testResults.summary.passed++;
    console.log(`   ✅ ${suite.name} PASSED`);

  } catch (error) {
    suiteResult.status = 'failed';
    suiteResult.error = {
      message: error.message,
      stack: error.stack,
      name: error.name
    };
    
    testResults.summary.failed++;
    
    if (suite.critical) {
      testResults.summary.critical_failed++;
      console.log(`   ❌ ${suite.name} FAILED (CRITICAL)`);
    } else {
      console.log(`   ⚠️ ${suite.name} FAILED (NON-CRITICAL)`);
    }
    
    console.log(`   Error: ${error.message}`);
    
    // Log stack trace for debugging
    if (process.env.DEBUG || process.env.VERBOSE) {
      console.log(`   Stack: ${error.stack}`);
    }
  
  } finally {
    // Restore console
    Object.assign(console, originalConsole);
    
    suiteResult.endTime = new Date();
    suiteResult.duration = suiteResult.endTime - suiteResult.startTime;
    suiteResult.output = capturedOutput;
    
    console.log(`   Duration: ${suiteResult.duration}ms`);
  }
}

async function generateTestReport() {
  console.log('\n📊 Generating Test Report...');

  // Create detailed JSON report
  const detailedReport = {
    metadata: {
      testRunner: 'QQ Bot Fix Verification',
      version: '1.0.0',
      environment: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        memory: process.memoryUsage()
      },
      startTime: testResults.startTime.toISOString(),
      endTime: testResults.endTime.toISOString(),
      totalDuration: testResults.totalDuration
    },
    summary: testResults.summary,
    suites: testResults.suites.map(suite => ({
      name: suite.name,
      description: suite.description,
      critical: suite.critical,
      status: suite.status,
      duration: suite.duration,
      startTime: suite.startTime.toISOString(),
      endTime: suite.endTime ? suite.endTime.toISOString() : null,
      error: suite.error,
      outputCount: suite.output.length
    })),
    recommendations: generateRecommendations()
  };

  // Write detailed report
  try {
    await fs.promises.writeFile(
      testConfig.reportFile,
      JSON.stringify(detailedReport, null, 2),
      'utf8'
    );
    console.log(`   ✅ Detailed report: ${testConfig.reportFile}`);
  } catch (error) {
    console.log(`   ⚠️ Failed to write detailed report: ${error.message}`);
  }

  // Generate text summary
  const summary = generateTextSummary();
  
  try {
    await fs.promises.writeFile(
      testConfig.summaryFile,
      summary,
      'utf8'
    );
    console.log(`   ✅ Summary report: ${testConfig.summaryFile}`);
  } catch (error) {
    console.log(`   ⚠️ Failed to write summary report: ${error.message}`);
  }
}

function generateRecommendations() {
  const recommendations = [];
  
  // Check for critical failures
  if (testResults.summary.critical_failed > 0) {
    recommendations.push({
      type: 'critical',
      title: 'Critical Tests Failed',
      description: 'Critical functionality is broken and must be fixed before deployment',
      action: 'Review failed test details and fix underlying issues'
    });
  }
  
  // Check for non-critical failures
  if (testResults.summary.failed > testResults.summary.critical_failed) {
    recommendations.push({
      type: 'warning',
      title: 'Non-Critical Tests Failed',
      description: 'Some optional features may not be working correctly',
      action: 'Review non-critical failures when time permits'
    });
  }
  
  // Performance recommendations
  const longRunningTests = testResults.suites.filter(s => s.duration > 30000);
  if (longRunningTests.length > 0) {
    recommendations.push({
      type: 'performance',
      title: 'Slow Test Performance',
      description: `${longRunningTests.length} test(s) took longer than 30 seconds`,
      action: 'Consider optimizing database queries or test data size',
      details: longRunningTests.map(t => `${t.name}: ${t.duration}ms`)
    });
  }
  
  // Success recommendations
  if (testResults.summary.critical_failed === 0) {
    recommendations.push({
      type: 'success',
      title: 'Core Functionality Verified',
      description: 'All critical tests passed - core fixes are working correctly',
      action: 'System is ready for deployment'
    });
  }
  
  return recommendations;
}

function generateTextSummary() {
  const lines = [];
  
  lines.push('QQ Bot Fix Verification Test Summary');
  lines.push('=' .repeat(50));
  lines.push('');
  
  // Basic stats
  lines.push(`Test Run: ${testResults.startTime.toISOString()}`);
  lines.push(`Duration: ${(testResults.totalDuration / 1000).toFixed(1)}s`);
  lines.push(`Total Suites: ${testResults.summary.total}`);
  lines.push(`Passed: ${testResults.summary.passed}`);
  lines.push(`Failed: ${testResults.summary.failed}`);
  lines.push(`Critical Failures: ${testResults.summary.critical_failed}`);
  lines.push('');
  
  // Suite details
  lines.push('Test Suite Results:');
  lines.push('-' .repeat(30));
  
  testResults.suites.forEach(suite => {
    const status = suite.status === 'passed' ? '✅' : '❌';
    const critical = suite.critical ? ' [CRITICAL]' : '';
    const duration = `(${suite.duration}ms)`;
    
    lines.push(`${status} ${suite.name}${critical} ${duration}`);
    
    if (suite.status === 'failed' && suite.error) {
      lines.push(`   Error: ${suite.error.message}`);
    }
  });
  
  lines.push('');
  
  // Recommendations
  const recommendations = generateRecommendations();
  if (recommendations.length > 0) {
    lines.push('Recommendations:');
    lines.push('-' .repeat(20));
    
    recommendations.forEach((rec, idx) => {
      lines.push(`${idx + 1}. ${rec.title} [${rec.type.toUpperCase()}]`);
      lines.push(`   ${rec.description}`);
      lines.push(`   Action: ${rec.action}`);
      
      if (rec.details) {
        lines.push(`   Details: ${rec.details.join(', ')}`);
      }
      
      lines.push('');
    });
  }
  
  // Final verdict
  lines.push('Final Verdict:');
  lines.push('-' .repeat(15));
  
  if (testResults.summary.critical_failed === 0) {
    lines.push('🎉 ALL CRITICAL TESTS PASSED');
    lines.push('The QQ bot fixes are working correctly and ready for deployment.');
  } else {
    lines.push('❌ CRITICAL TESTS FAILED');
    lines.push('The QQ bot has critical issues that must be fixed before deployment.');
  }
  
  if (testResults.summary.failed > testResults.summary.critical_failed) {
    lines.push('⚠️ Some non-critical features may need attention.');
  }
  
  return lines.join('\n');
}

function displaySummary() {
  console.log('\n' + '='.repeat(60));
  console.log('🏁 TEST SUITE COMPLETED');
  console.log('='.repeat(60));
  
  console.log(`\n📊 Results Summary:`);
  console.log(`   Total Test Suites: ${testResults.summary.total}`);
  console.log(`   Passed: ${testResults.summary.passed}`);
  console.log(`   Failed: ${testResults.summary.failed}`);
  console.log(`   Critical Failures: ${testResults.summary.critical_failed}`);
  console.log(`   Total Duration: ${(testResults.totalDuration / 1000).toFixed(1)}s`);
  
  // Show critical failures
  const criticalFailures = testResults.suites.filter(s => s.status === 'failed' && s.critical);
  if (criticalFailures.length > 0) {
    console.log(`\n❌ Critical Failures:`);
    criticalFailures.forEach(suite => {
      console.log(`   • ${suite.name}: ${suite.error.message}`);
    });
  }
  
  // Show non-critical failures
  const nonCriticalFailures = testResults.suites.filter(s => s.status === 'failed' && !s.critical);
  if (nonCriticalFailures.length > 0) {
    console.log(`\n⚠️ Non-Critical Failures:`);
    nonCriticalFailures.forEach(suite => {
      console.log(`   • ${suite.name}: ${suite.error.message}`);
    });
  }
  
  // Final verdict
  console.log('\n🎯 Final Verdict:');
  if (testResults.summary.critical_failed === 0) {
    console.log('   🎉 ALL CRITICAL TESTS PASSED');
    console.log('   ✅ QQ bot fixes verified and ready for deployment');
  } else {
    console.log('   ❌ CRITICAL TESTS FAILED');
    console.log('   🚫 System is NOT ready for deployment');
  }
  
  console.log(`\n📄 Detailed reports generated:`);
  console.log(`   • JSON Report: ${testConfig.reportFile}`);
  console.log(`   • Text Summary: ${testConfig.summaryFile}`);
  
  console.log('\n' + '='.repeat(60));
}

// Handle process signals
process.on('SIGINT', () => {
  console.log('\n\n⚠️ Test run interrupted by user');
  testResults.endTime = new Date();
  testResults.totalDuration = testResults.endTime - testResults.startTime;
  
  // Mark running tests as skipped
  testResults.suites.forEach(suite => {
    if (suite.status === 'running') {
      suite.status = 'skipped';
      suite.endTime = new Date();
      suite.duration = suite.endTime - suite.startTime;
      testResults.summary.skipped++;
    }
  });
  
  displaySummary();
  process.exit(2);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

if (require.main === module) {
  runAllTests().catch(error => {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = { runAllTests };