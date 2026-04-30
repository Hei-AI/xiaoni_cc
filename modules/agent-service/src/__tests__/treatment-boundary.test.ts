import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const servicesDir = path.resolve(__dirname, '../services');

const expectedTreatmentFiles = [
  'mini-treatment-runner.ts',
  'mini-treatment-service.ts',
  'treatment-runner.ts',
  'treatment-service.ts'
];

const treatmentFileNamePattern = /(?:^|[-_])(?:mini[-_])?treatment(?:[-_](?:runner|service|worker))?\.ts$/;

const filesToScan = new Set<string>();

for (const fileName of expectedTreatmentFiles) {
  const absolutePath = path.join(servicesDir, fileName);
  if (fs.existsSync(absolutePath)) {
    filesToScan.add(absolutePath);
  }
}

for (const fileName of fs.readdirSync(servicesDir)) {
  if (treatmentFileNamePattern.test(fileName) && fileName !== 'treatment-deps.ts') {
    filesToScan.add(path.join(servicesDir, fileName));
  }
}

const forbiddenImportSources = [
  /from\s+['"][^'"]*agent-loop-service['"]/,
  /from\s+['"][^'"]*runtime-store['"]/,
  /from\s+['"][^'"]*tool[^'"]*['"]/,
  /from\s+['"][^'"]*provider[^'"]*send[^'"]*['"]/
];

const forbiddenSymbols = [
  'AgentLoopService',
  'RuntimeStore',
  'executeTool',
  'sendMessage',
  'requestImageTask',
  'markRunDeliveryCommitted',
  'markFeedbackReflectionsHit',
  'logTimelineEvent',
  'deliveryStateStore',
  'feedbackMemoryWriter',
  'createMediaObservation',
  'createImageTask'
];

function stripCommentsAndStrings(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*\1/g, '""');
}

test('mini treatment runner files do not import or call production side-effect tools', () => {
  const violations: string[] = [];

  for (const filePath of Array.from(filesToScan).sort()) {
    const source = fs.readFileSync(filePath, 'utf8');
    const code = stripCommentsAndStrings(source);
    const relativePath = path.relative(process.cwd(), filePath);

    for (const pattern of forbiddenImportSources) {
      if (pattern.test(source)) {
        violations.push(`${relativePath}: forbidden import source matched ${pattern}`);
      }
    }

    for (const symbol of forbiddenSymbols) {
      const symbolPattern = new RegExp(`\\b${symbol}\\b`);
      if (symbolPattern.test(code)) {
        violations.push(`${relativePath}: forbidden production symbol ${symbol}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
