// src/runtime/index.js
const { RuntimeAPI } = require('./RuntimeAPI');
const { parse } = require('../parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ✅ Load kernel private key (cached)
let KERNEL_PRIVATE_KEY = null;
function getKernelPrivateKey() {
  if (KERNEL_PRIVATE_KEY) return KERNEL_PRIVATE_KEY;
  
  const keyPath = process.env.KERNEL_PRIVATE_KEY_PATH || './kernel-keys/kernel-private.pem';
  const absolutePath = path.isAbsolute(keyPath) ? keyPath : path.join(process.cwd(), keyPath);
  
  if (!fs.existsSync(absolutePath)) {
    console.warn('[kernel] Warning: Private key not found at', absolutePath);
    console.warn('[kernel] Audit entries will NOT be signed');
    return null;
  }
  
  KERNEL_PRIVATE_KEY = fs.readFileSync(absolutePath, 'utf8');
  console.log('[kernel] ✅ Private key loaded for signing');
  return KERNEL_PRIVATE_KEY;
}

// ✅ Sign audit data with ED25519 (Node.js crypto.sign)
function signAuditData(auditData, privateKeyPem) {
  if (!privateKeyPem) return null;
  
  try {
    // Serialize audit data EXACTLY as it will be verified (sorted keys)
    const serialized = JSON.stringify(auditData, Object.keys(auditData).sort());
    
    // ED25519 signing: use crypto.sign() directly
    const signature = crypto.sign(
      null,  // For ED25519, hash algorithm is implicit
      Buffer.from(serialized, 'utf8'),
      {
        key: privateKeyPem,
        dsaEncoding: 'ieee-p1363',  // Required for ED25519
      }
    );
    
    return signature.toString('hex');
  } catch (err) {
    console.error('[kernel] Signature error:', err.message);
    return null;
  }
}

async function execute(workflow, inputs, agentResolver, verbose = false) {
  const rt = new RuntimeAPI({ verbose });
  
  // run the workflow — result only contains Return values
  const result = await rt.executeWorkflow(workflow, inputs, agentResolver);

  // rt is still alive here — grab audit before it dies
  const lastEntry  = rt.auditLog.at(-1);
  const firstEntry = rt.auditLog.at(0);

  // Build audit object BEFORE signing
  const auditData = {
    execution_hash:          lastEntry?.hash ?? null,
    previous_hash:           firstEntry?.hash ?? 'GENESIS',
    merkle_root:             rt._calculateMerkleRoot(),
    kernel_version:          lastEntry?.details?.kernel_version ?? null,
    governance_profile_hash: lastEntry?.details?.governance_profile_hash ?? null,
    integrity:               rt.verifyAuditLogIntegrity(),
    chain:                   rt.auditLog,
  };

  // ✅ SIGN the audit data
  const privateKey = getKernelPrivateKey();
  const signature = signAuditData(auditData, privateKey);
  
  // Load public key for verification (optional but helpful)
  let publicKey = null;
  if (privateKey) {
    try {
      const pubKeyPath = process.env.KERNEL_PUBLIC_KEY_PATH || './kernel-keys/kernel-public.pem';
      const absolutePubPath = path.isAbsolute(pubKeyPath) 
        ? pubKeyPath 
        : path.join(process.cwd(), pubKeyPath);
      if (fs.existsSync(absolutePubPath)) {
        // Read and clean PEM for storage
        publicKey = fs.readFileSync(absolutePubPath, 'utf8')
          .replace('-----BEGIN PUBLIC KEY-----', '')
          .replace('-----END PUBLIC KEY-----', '')
          .replace(/\s/g, '');
      }
    } catch (err) {
      console.warn('[kernel] Could not load public key:', err.message);
    }
  }

  result.__audit = {
    ...auditData,
    signature,      // ✅ Cryptographic signature (hex string)
    publicKey,      // ✅ Public key for verification (cleaned PEM)
  };

  return result;
}

module.exports = { execute, parse };