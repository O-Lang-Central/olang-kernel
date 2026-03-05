// test-governance.js
const { RuntimeAPI } = require('./src/runtime/RuntimeAPI');

const workflow = {
  type: 'workflow',
  name: 'icu-bed-allocation',
  version: '1.0.0',
  allowedResolvers: ['@o-lang/llm-groq'],
  maxGenerations: 3,
  steps: [],
  returnValues: ['bed_id']
};

const rt = new RuntimeAPI({ verbose: true });

// Test 1: Governance hash
const govHash = rt._generateGovernanceProfileHash(workflow);
console.log('✅ Governance Hash:', govHash.substring(0, 16) + '...');

// Test 2: Runtime metadata
const meta = rt.getRuntimeMetadata();
console.log('✅ Kernel Version:', meta.version);

// Test 3: Audit entry structure
rt._createAuditEntry('test', {
  workflow_id: 'icu-bed-allocation@1.0.0',
  kernel_version: meta.version,
  governance_profile_hash: govHash
});

const entry = rt.auditLog[0].details;
console.log('✅ All 3 governance fields present:', 
  entry.workflow_id && entry.kernel_version && entry.governance_profile_hash
);

// Test 4: Export with Merkle root
const exported = rt.exportAuditLog();
console.log('✅ Merkle root:', exported.merkleRoot ? 'Present ✓' : 'Missing ✗');