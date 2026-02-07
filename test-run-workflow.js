// test-run-workflow.js
const fs = require('fs');
const path = require('path');
const { execute } = require('./src/runtime');

// Adjust the workflow path if needed
const workflowPath = path.join(__dirname, 'examples', 'workflow.ol');

async function testWorkflow() {
  try {
    const content = fs.readFileSync(workflowPath, 'utf8');

    console.log('=== Running workflow ===\n');

    const results = await execute(content, {}, { verbose: true });

    console.log('\n=== Workflow Execution Results ===');
    results.forEach((res, idx) => {
      console.log(`Step ${idx + 1}:`, res);
    });

    console.log('\n✅ Workflow completed successfully!');
  } catch (err) {
    console.error('\n❌ Workflow execution failed:', err);
  }
}

testWorkflow();
