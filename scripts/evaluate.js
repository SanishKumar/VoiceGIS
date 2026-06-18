import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCommand } from '../src/parser/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runEvaluation() {
  console.log('🎙️  Starting VoiceGIS Evaluation Harness...\n');
  
  const benchmarksPath = path.join(__dirname, '../src/evaluation/benchmarks.json');
  let benchmarks;
  
  try {
    const data = await fs.readFile(benchmarksPath, 'utf-8');
    benchmarks = JSON.parse(data);
  } catch (err) {
    console.error('❌ Failed to load benchmarks.json:', err.message);
    process.exit(1);
  }

  let total = benchmarks.length;
  let passed = 0;
  let failed = [];
  
  const categoryStats = {};

  const startTime = Date.now();

  for (const test of benchmarks) {
    const result = await parseCommand(test.text, { enableGeocoding: false });
    
    let isPass = result.intent === test.intent;
    
    if (isPass && test.payload) {
      for (const [key, val] of Object.entries(test.payload)) {
        if (result.payload[key] !== val) {
          isPass = false;
          break;
        }
      }
    }

    const category = test.category || 'Uncategorized';
    if (!categoryStats[category]) {
      categoryStats[category] = { total: 0, passed: 0 };
    }
    
    categoryStats[category].total++;

    if (isPass) {
      passed++;
      categoryStats[category].passed++;
      process.stdout.write('✅ ');
    } else {
      process.stdout.write('❌ ');
      failed.push({
        text: test.text,
        expectedIntent: test.intent,
        actualIntent: result.intent,
        expectedPayload: test.payload,
        actualPayload: result.payload,
        category: category
      });
    }
  }

  const duration = Date.now() - startTime;
  const overallAccuracy = (passed / total) * 100;
  
  console.log(`\n\n📊 Evaluation Complete in ${duration}ms`);
  console.log(`Accuracy: ${overallAccuracy.toFixed(1)}% (${passed}/${total} passed)`);
  
  // Build Markdown Table
  let mdTable = `| Category | Cases | Accuracy | Notes |\n|---|---|---|---|\n`;
  for (const [cat, stats] of Object.entries(categoryStats)) {
    const catAcc = ((stats.passed / stats.total) * 100).toFixed(1);
    mdTable += `| ${cat} | ${stats.total} | ${catAcc}% | |\n`;
  }
  mdTable += `| **Overall** | **${total}** | **${overallAccuracy.toFixed(1)}%** | |\n`;

  console.log('\n' + mdTable);

  const report = {
    timestamp: new Date().toISOString(),
    total,
    passed,
    failedCount: failed.length,
    overallAccuracy,
    categoryStats,
    failed
  };

  await fs.writeFile('evaluation-results.json', JSON.stringify(report, null, 2));
  console.log('📝 Wrote detailed results to evaluation-results.json');

  if (overallAccuracy < 90) {
    console.log(`\n❌ Overall accuracy ${overallAccuracy.toFixed(1)}% is below the 90% threshold!`);
    process.exit(1);
  } else {
    console.log('\n🎉 Accuracy meets the 90% threshold.');
    process.exit(0);
  }
}

runEvaluation();
