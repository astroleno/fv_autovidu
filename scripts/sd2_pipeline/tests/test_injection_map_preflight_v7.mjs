import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  loadKnowledgeSlicesV6,
  validateInjectionMapPaths,
} from '../lib/knowledge_slices_v6.mjs';

let passed = 0;
let failed = 0;

function assert(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  PASS ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}`, extra ?? '');
  }
}

function writeFile(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd2-injection-'));
  writeFile(
    root,
    'injection_map.yaml',
    [
      'version: "2.1"',
      'director:',
      '  always:',
      '    - slice_id: critical_a',
      '      path: director/critical_a.md',
      '      max_tokens: 100',
      '      priority: 10',
      '  conditional:',
      '    - slice_id: optional_a',
      '      path: director/optional_a.md',
      '      max_tokens: 100',
      '      priority: 20',
      '      match:',
      '        has_kva:',
      '          equals: true',
      'prompter:',
      '  always: []',
      'rules:',
      '  max_total_tokens_per_consumer:',
      '    director: 1000',
      '    prompter: 1000',
    ].join('\n'),
  );
  writeFile(root, 'director/critical_a.md', 'critical');
  return root;
}

console.log('-- validateInjectionMapPaths');
{
  const root = makeRoot();
  const result = validateInjectionMapPaths(root);
  assert('present critical and missing optional returns ok with warning', result.ok === true, result.warnings.some((w) => w.includes('optional_a')), result);
}

console.log('-- missing critical fails');
{
  const root = makeRoot();
  fs.unlinkSync(path.join(root, 'director/critical_a.md'));
  const result = validateInjectionMapPaths(root);
  assert('missing always slice fails production preflight', result.ok === false, result.errors);
  assert('error names critical slice id', result.errors.some((e) => e.includes('critical_a')), result.errors);
  let threw = false;
  try {
    loadKnowledgeSlicesV6({
      consumer: 'director',
      routing: {},
      aspectRatio: '16:9',
      hasKva: true,
      slicesRoot: root,
    });
  } catch (err) {
    threw = String(err instanceof Error ? err.message : err).includes('critical_a');
  }
  assert('runtime loader throws for missing critical slice', threw);
}

console.log('-- review bundle mode downgrades missing critical');
{
  const root = makeRoot();
  fs.unlinkSync(path.join(root, 'director/critical_a.md'));
  const result = validateInjectionMapPaths(root, { reviewBundleMode: true });
  assert('review bundle mode does not fail hard', result.ok === true, result.review_bundle_mode === true, result);
  assert('review bundle mode records critical warning', result.warnings.some((w) => w.includes('critical_a')), result.warnings);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
