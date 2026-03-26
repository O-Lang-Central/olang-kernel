// src/runtime/index.js
const { RuntimeAPI } = require('./RuntimeAPI');
const { parse } = require('../parser');

async function execute(workflow, inputs, agentResolver, verbose = false) {
  const rt = new RuntimeAPI({ verbose });
  
  // run the workflow — result only contains Return values
  const result = await rt.executeWorkflow(workflow, inputs, agentResolver);

  // rt is still alive here — grab audit before it dies
  const lastEntry  = rt.auditLog.at(-1);
  const firstEntry = rt.auditLog.at(0);

  result.__audit = {
    execution_hash:          lastEntry?.hash ?? null,
    previous_hash:           firstEntry?.hash ?? 'GENESIS',
    merkle_root:             rt._calculateMerkleRoot(),
    kernel_version:          lastEntry?.details?.kernel_version ?? null,
    governance_profile_hash: lastEntry?.details?.governance_profile_hash ?? null,
    signature:               lastEntry?.signature ?? null,
    integrity:               rt.verifyAuditLogIntegrity(),
    chain:                   rt.auditLog,
  };

  return result;
}

module.exports = { execute, parse };