const fs = require('fs');
const path = require('path');
const crypto = require('crypto'); // ✅ CRYPTOGRAPHIC AUDIT LOGS

// ✅ O-Lang Kernel Version (Safety Logic & Governance Rules)
const KERNEL_VERSION = '1.2.20-alpha'; // 🔁 Update when safety rules change

class RuntimeAPI {
  constructor({ verbose = false } = {}) {
    //  console.log('✅ KERNEL FIX VERIFIED - Unwrapping active');
    this.context = {};
    this.resources = {};
    this.agentMap = {};
    this.events = {};
    this.workflowSteps = [];
    this.allowedResolvers = new Set();
    this.verbose = verbose;
    this.__warnings = [];
    const logsDir = path.resolve('./logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    this.disallowedLogFile = path.join(logsDir, 'disallowed_resolvers.json');
    this.disallowedAttempts = [];
    
    // ✅ NEW: Database client setup
    this.dbClient = null;
    this._initDbClient();
    
    // ✅ NEW: Cryptographically verifiable audit logs
    this.auditLog = [];
    this.previousHash = 'GENESIS';
    this.auditLogPrivateKey = process.env.OLANG_AUDIT_PRIVATE_KEY;
    this.auditLogFile = path.join(logsDir, 'audit_log.json');
    this.enableAuditLog = process.env.OLANG_AUDIT_LOG === 'true';
    
    if (this.enableAuditLog && this.verbose) {
      console.log('🔐 Cryptographically verifiable audit logging enabled');
    }
  }

  // ✅ NEW: Initialize database client
  _initDbClient() {
    const dbType = process.env.OLANG_DB_TYPE; // 'postgres', 'mysql', 'mongodb', 'sqlite'
    if (!dbType) return; // DB persistence disabled
    try {
      switch (dbType.toLowerCase()) {
        case 'postgres':
        case 'postgresql':
          const { Pool } = require('pg');
          this.dbClient = {
            type: 'postgres',
            client: new Pool({
              host: process.env.DB_HOST || 'localhost',
              port: parseInt(process.env.DB_PORT) || 5432,
              user: process.env.DB_USER,
              password: process.env.DB_PASSWORD,
              database: process.env.DB_NAME
            })
          };
          break;
        case 'mysql':
          const mysql = require('mysql2/promise');
          this.dbClient = {
            type: 'mysql',
            client: mysql.createPool({
              host: process.env.DB_HOST || 'localhost',
              port: parseInt(process.env.DB_PORT) || 3306,
              user: process.env.DB_USER,
              password: process.env.DB_PASSWORD,
              database: process.env.DB_NAME
            })
          };
          break;
        case 'mongodb':
          const { MongoClient } = require('mongodb');
          const uri = process.env.MONGO_URI || `mongodb://${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 27017}`;
          this.dbClient = {
            type: 'mongodb',
            client: new MongoClient(uri)
          };
          break;
        case 'sqlite':
          const Database = require('better-sqlite3');
          const dbPath = process.env.SQLITE_PATH || './olang.db';
          const dbDir = path.dirname(path.resolve(dbPath));
          if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
          this.dbClient = {
            type: 'sqlite',
            client: new Database(dbPath)
          };
          break;
        default:
          throw new Error(`Unsupported database type: ${dbType}`);
      }
      if (this.verbose) {
        console.log(`🗄️  Database client initialized: ${dbType}`);
      }
    } catch (e) {
      this.addWarning(`Failed to initialize DB client: ${e.message}`);
      this.dbClient = null;
    }
  }

  // ================================
  // ✅ CRYPTOGRAPHIC AUDIT LOG METHODS
  // ================================

  /**
   * Create a hash of data using SHA-256
   */
  _hash(data) {
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }

  /**
   * Sign data with private key (if available)
   */
  _sign(data) {
    if (!this.auditLogPrivateKey) return null;
    try {
      const sign = crypto.createSign('SHA256');
      sign.update(data);
      sign.end();
      return sign.sign(this.auditLogPrivateKey, 'base64');
    } catch (e) {
      this.addWarning(`Audit log signing failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Create a cryptographically verifiable audit log entry
   */
  _createAuditEntry(event, details, context = {}) {
    const timestamp = new Date().toISOString();
    const entryData = {
      timestamp,
      event,
      details,
      workflow: this.context.workflow_name,
      contextSnapshot: this._captureContextSnapshot(context),
      previousHash: this.previousHash,
      sequenceNumber: this.auditLog.length + 1
    };
    
    // Create hash of this entry
    const entryHash = this._hash(entryData);
    
    // Sign the entry if private key available
    const signature = this._sign(entryHash);
    
    const entry = {
      ...entryData,
      hash: entryHash,
      signature,
      publicKey: this.auditLogPrivateKey ? 
        crypto.createPublicKey(this.auditLogPrivateKey).export({ 
          type: 'spki', 
          format: 'pem' 
        }) : null
    };
    
    // Update chain
    this.previousHash = entryHash;
    this.auditLog.push(entry);
    
    // Persist to file if enabled
    if (this.enableAuditLog) {
      this._persistAuditLog();
    }
    
    return entry;
  }

  /**
   * Capture relevant context snapshot for audit
   */
  _captureContextSnapshot(keys = []) {
    const snapshot = {};
    const keysToCapture = keys.length > 0 ? keys : [
      'workflow_name',
      'current_step',
      'agent_id'
    ];
    
    for (const key of keysToCapture) {
      if (this.context[key] !== undefined) {
        snapshot[key] = this.context[key];
      }
    }
    
    return snapshot;
  }

  /**
   * Persist audit log to file
   */
  _persistAuditLog() {
    try {
      fs.writeFileSync(
        this.auditLogFile,
        JSON.stringify(this.auditLog, null, 2),
        'utf8'
      );
      
      // Also persist to DB if configured
      if (this.dbClient && process.env.OLANG_AUDIT_DB_PERSIST === 'true') {
        this._persistAuditLogToDB();
      }
    } catch (e) {
      this.addWarning(`Failed to persist audit log: ${e.message}`);
    }
  }

  /**
   * Persist audit log to database
   */
  async _persistAuditLogToDB() {
    try {
      const latestEntry = this.auditLog[this.auditLog.length - 1];
      if (!latestEntry) return;
      
      switch (this.dbClient.type) {
        case 'postgres':
          await this.dbClient.client.query(
            `INSERT INTO audit_log (hash, previous_hash, event, details, timestamp, workflow_name, signature, sequence_number)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              latestEntry.hash,
              latestEntry.previousHash,
              latestEntry.event,
              JSON.stringify(latestEntry.details),
              latestEntry.timestamp,
              latestEntry.workflow,
              latestEntry.signature,
              latestEntry.sequenceNumber
            ]
          );
          break;
          
        case 'mysql':
          await this.dbClient.client.execute(
            `INSERT INTO audit_log (hash, previous_hash, event, details, timestamp, workflow_name, signature, sequence_number)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              latestEntry.hash,
              latestEntry.previousHash,
              latestEntry.event,
              JSON.stringify(latestEntry.details),
              latestEntry.timestamp,
              latestEntry.workflow,
              latestEntry.signature,
              latestEntry.sequenceNumber
            ]
          );
          break;
          
        case 'mongodb':
          const db = this.dbClient.client.db(process.env.DB_NAME || 'olang');
          await db.collection('audit_log').insertOne({
            hash: latestEntry.hash,
            previous_hash: latestEntry.previousHash,
            event: latestEntry.event,
            details: latestEntry.details,
            timestamp: new Date(latestEntry.timestamp),
            workflow_name: latestEntry.workflow,
            signature: latestEntry.signature,
            sequence_number: latestEntry.sequenceNumber
          });
          break;
          
        case 'sqlite':
          const stmt = this.dbClient.client.prepare(
            `INSERT INTO audit_log (hash, previous_hash, event, details, timestamp, workflow_name, signature, sequence_number)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          );
          stmt.run(
            latestEntry.hash,
            latestEntry.previousHash,
            latestEntry.event,
            JSON.stringify(latestEntry.details),
            latestEntry.timestamp,
            latestEntry.workflow,
            latestEntry.signature,
            latestEntry.sequenceNumber
          );
          break;
      }
    } catch (e) {
      this.addWarning(`Failed to persist audit log to DB: ${e.message}`);
    }
  }

  /**
   * Verify the integrity of the audit log chain
   */
  verifyAuditLogIntegrity(auditLog = null) {
    const log = auditLog || this.auditLog;
    if (log.length === 0) {
      return { valid: true, message: 'Audit log is empty' };
    }
    
    // Verify genesis block
    if (log[0].previousHash !== 'GENESIS') {
      return { valid: false, error: 'Invalid genesis block', failedAtIndex: 0 };
    }
    
    // Verify chain integrity
    let previousHash = 'GENESIS';
    for (let i = 0; i < log.length; i++) {
      const entry = log[i];
      
      // Check previous hash linkage
      if (entry.previousHash !== previousHash) {
        return { 
          valid: false, 
          error: `Hash chain broken at entry ${i}`,
          failedAtIndex: i,
          expected: previousHash,
          actual: entry.previousHash
        };
      }
      
      // Verify entry hash
      const entryData = {
        timestamp: entry.timestamp,
        event: entry.event,
        details: entry.details,
        workflow: entry.workflow,
        contextSnapshot: entry.contextSnapshot,
        previousHash: entry.previousHash,
        sequenceNumber: entry.sequenceNumber
      };
      
      const calculatedHash = this._hash(entryData);
      if (calculatedHash !== entry.hash) {
        return { 
          valid: false, 
          error: `Entry hash mismatch at index ${i}`,
          failedAtIndex: i,
          expected: calculatedHash,
          actual: entry.hash
        };
      }
      
      // Verify signature if present
      if (entry.signature && entry.publicKey) {
        try {
          const verify = crypto.createVerify('SHA256');
          verify.update(entry.hash);
          verify.end();
          const isValid = verify.verify(entry.publicKey, entry.signature, 'base64');
          if (!isValid) {
            return { 
              valid: false, 
              error: `Signature verification failed at entry ${i}`,
              failedAtIndex: i
            };
          }
        } catch (e) {
          return { 
            valid: false, 
            error: `Signature verification error at entry ${i}: ${e.message}`,
            failedAtIndex: i
          };
        }
      }
      
      previousHash = entry.hash;
    }
    
    return { 
      valid: true, 
      message: `Audit log verified successfully (${log.length} entries)`,
      totalEntries: log.length,
      lastHash: previousHash
    };
  }

  /**
   * Get audit log excerpt with proof
   */
  getAuditExcerpt(startIndex, endIndex) {
    const excerpt = this.auditLog.slice(startIndex, endIndex + 1);
    const proof = {
      excerpt,
      previousHash: startIndex > 0 ? this.auditLog[startIndex - 1].hash : 'GENESIS',
      nextHash: endIndex < this.auditLog.length - 1 ? this.auditLog[endIndex + 1].hash : null,
      totalEntries: this.auditLog.length
    };
    
    return proof;
  }

  /**
   * Export audit log with verification data
   */
  exportAuditLog() {
    const verification = this.verifyAuditLogIntegrity();
    return {
      auditLog: this.auditLog,
      verification,
      exportedAt: new Date().toISOString(),
      totalEntries: this.auditLog.length,
      merkleRoot: this._calculateMerkleRoot()
    };
  }

  /**
   * Calculate Merkle root of audit log
   */
  _calculateMerkleRoot() {
    if (this.auditLog.length === 0) return null;
    
    let hashes = this.auditLog.map(entry => entry.hash);
    
    while (hashes.length > 1) {
      const newLevel = [];
      for (let i = 0; i < hashes.length; i += 2) {
        const left = hashes[i];
        const right = i + 1 < hashes.length ? hashes[i + 1] : left;
        newLevel.push(this._hash(left + right));
      }
      hashes = newLevel;
    }
    
    return hashes[0];
  }

  /**
   * Get audit summary
   */
  getAuditSummary() {
    const verification = this.verifyAuditLogIntegrity();
    return {
      totalEntries: this.auditLog.length,
      integrity: verification,
      events: this.auditLog.map(e => e.event),
      merkleRoot: this._calculateMerkleRoot()
    };
  }

  // ================================
  // ✅ GOVERNANCE METADATA HELPERS
  // ================================

  /**
   * Generate immutable hash of governance profile
   * Includes: allowed resolvers, constraints, policy flags
   */
  _generateGovernanceProfileHash(workflow) {
    const profile = {
      version: '1.0',
      allowedResolvers: Array.from(this.allowedResolvers).sort(),
      maxGenerations: workflow.maxGenerations,
      strictInputs: process.env.OLANG_STRICT_INPUTS === 'true',
      semanticValidation: true,
      hallucinationPrevention: true,
      resolverPolicy: 'allowlist-only',
      timestamp: new Date().toISOString()
    };
    
    return crypto.createHash('sha256')
      .update(JSON.stringify(profile))
      .digest('hex');
  }

  /**
   * Get runtime metadata for external verification
   */
  getRuntimeMetadata() {
    return {
      runtime: 'O-Lang Kernel',
      version: KERNEL_VERSION,
      features: {
        semanticValidation: true,
        hallucinationPrevention: true,
        cryptographicAudit: true,
        multiDatabaseSupport: true
      },
      environment: {
        auditEnabled: this.enableAuditLog,
        dbType: this.dbClient?.type || 'none',
        strictMode: process.env.OLANG_STRICT_INPUTS === 'true'
      }
    };
  }

  // -----------------------------
  // ✅ SEMANTIC ENFORCEMENT HELPER
  // -----------------------------
  _requireSemantic(symbol, stepType) {
    const value = this.context[symbol];
    if (value === undefined) {
      const error = {
        type: 'semantic_violation',
        symbol: symbol,
        expected: 'defined value',
        used_by: stepType,
        phase: 'execution'
      };
      // Emit semantic event (for observability)
      this.emit('semantic_violation', error);
      // Log as error (not warning)
      if (this.verbose) {
        console.error(`[O-Lang SEMANTIC] Missing required symbol "${symbol}" for ${stepType}`);
      }
      return false;
    }
    return true;
  }

  // -----------------------------
  // Parser/runtime warnings
  // -----------------------------
  addWarning(message) {
    const entry = { message, timestamp: new Date().toISOString() };
    this.__warnings.push(entry);
    if (this.verbose) console.warn(`[O-Lang WARNING] ${message}`);
  }

  getWarnings() {
    return this.__warnings;
  }

  // -----------------------------
  // Event handling
  // -----------------------------
  on(eventName, cb) {
    if (!this.events[eventName]) this.events[eventName] = [];
    this.events[eventName].push(cb);
  }

  emit(eventName, payload) {
    if (this.events[eventName]) {
      this.events[eventName].forEach(cb => cb(payload));
    }
  }

  // -----------------------------
  // Disallowed resolver handling
  // -----------------------------
  logDisallowedResolver(resolverName, stepAction) {
    const entry = { resolver: resolverName, step: stepAction, timestamp: new Date().toISOString() };
    fs.appendFileSync(this.disallowedLogFile, JSON.stringify(entry) + '\n', 'utf8');
    this.disallowedAttempts.push(entry);
    
    // ✅ AUDIT LOG: Security violation with governance context
    this._createAuditEntry('security_violation', {
      type: 'disallowed_resolver',
      resolver: resolverName,
      step: stepAction,
      severity: 'high',
      kernel_version: KERNEL_VERSION,
      governance_profile_hash: this._generateGovernanceProfileHash({ 
        allowedResolvers: Array.from(this.allowedResolvers),
        maxGenerations: null 
      })
    });
    
    if (this.verbose) {
      console.warn(`[O-Lang] Disallowed resolver blocked: ${resolverName} | step: ${stepAction}`);
    }
  }

  printDisallowedSummary() {
    if (!this.disallowedAttempts.length) return;
    console.log('\n[O-Lang] ⚠️ Disallowed resolver summary:');
    console.log(`Total blocked attempts: ${this.disallowedAttempts.length}`);
    const displayCount = Math.min(5, this.disallowedAttempts.length);
    this.disallowedAttempts.slice(0, displayCount).forEach((e, i) => {
      console.log(`${i + 1}. Resolver: ${e.resolver}, Step: ${e.step}, Time: ${e.timestamp}`);
    });
    if (this.disallowedAttempts.length > displayCount) {
      console.log(`...and ${this.disallowedAttempts.length - displayCount} more entries logged in ${this.disallowedLogFile}`);
    }
  }

  // -----------------------------
  // ✅ ADDITION 1 — External Resolver Detection
  // -----------------------------
  _isExternalResolver(resolver) {
    return Boolean(
      resolver &&
      resolver.manifest &&
      typeof resolver.manifest === 'object' &&
      typeof resolver.manifest.protocol === 'string' &&
      resolver.manifest.protocol.startsWith('http')
    );
  }

  // -----------------------------
  // ✅ ADDITION 2 — External Resolver Invocation (HTTP Enforcement)
  // -----------------------------
  async _callExternalResolver(resolver, action, context) {
    const manifest = resolver.manifest;
    const endpoint = manifest.endpoint;
    const timeoutMs = manifest.timeout_ms || 30000;
    const payload = {
      action,
      context,
      resolver: resolver.resolverName,
      workflow: context.workflow_name,
      timestamp: new Date().toISOString()
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${endpoint}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const json = await res.json();
      if (json?.error) {
        throw new Error(json.error.message || 'External resolver error');
      }
      return json.result;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`External resolver timeout after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // -----------------------------
  // Utilities
  // -----------------------------
  getNested(obj, path) {
    if (!path) return undefined;
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
  }

   evaluateCondition(cond, ctx) {
    cond = cond.trim();

    // ✅ 1. Handle Logical OR (|| or 'or')
    if (/\|\||\bor\b/i.test(cond)) {
      return cond.split(/\|\||\bor\b/i).some(c => this.evaluateCondition(c.trim(), ctx));
    }
    // ✅ 2. Handle Logical AND (&& or 'and')
    if (/&&|\band\b/i.test(cond)) {
      return cond.split(/&&|\band\b/i).every(c => this.evaluateCondition(c.trim(), ctx));
    }

    // ✅ 3. Handle == or === (works with or without {})
    const eqMatch = cond.match(/^(?:\{(.+)\}|(\w+))\s*===?\s*"(.*)"$/);
    if (eqMatch) {
      const key = eqMatch[1] || eqMatch[2];
      return this.getNested(ctx, key) === eqMatch[3];
    }

    // ✅ 4. Keep original O-Lang syntax
    const oldEq = cond.match(/^\{(.+)\}\s+equals\s+"(.*)"$/);
    if (oldEq) return this.getNested(ctx, oldEq[1]) == oldEq[2];

    const gt = cond.match(/^\{(.+)\}\s+greater than\s+(\d+\.?\d*)$/);
    if (gt) return parseFloat(this.getNested(ctx, gt[1])) > parseFloat(gt[2]);

    const lt = cond.match(/^\{(.+)\}\s+less than\s+(\d+\.?\d*)$/);
    if (lt) return parseFloat(this.getNested(ctx, lt[1])) < parseFloat(lt[2]);

    // Fallback: truthy check
    return Boolean(this.getNested(ctx, cond.replace(/\{|\}/g, '')));
  }
  mathFunctions = {
    add: (a, b) => a + b,
    subtract: (a, b) => a - b,
    multiply: (a, b) => a * b,
    divide: (a, b) => a / b,
    equals: (a, b) => a === b,
    greater: (a, b) => a > b,
    less: (a, b) => a < b,
    sum: arr => arr.reduce((acc, val) => acc + val, 0),
    avg: arr => arr.reduce((acc, val) => acc + val, 0) / arr.length,
    min: arr => Math.min(...arr),
    max: arr => Math.max(...arr),
    increment: a => a + 1,
    decrement: a => a - 1,
    round: a => Math.round(a),
    floor: a => Math.floor(a),
    ceil: a => Math.ceil(a),
    abs: a => Math.abs(a)
  };

  evaluateMath(expr) {
    expr = expr.replace(/\{([^\}]+)\}/g, (_, path) => {
      const value = this.getNested(this.context, path.trim());
      if (typeof value === 'string') return `"${value.replace(/"/g, '\\"')}"`;
      return value !== undefined ? value : 0;
    });
    const funcNames = Object.keys(this.mathFunctions);
    const safeFunc = {};
    funcNames.forEach(fn => safeFunc[fn] = this.mathFunctions[fn]);
    try {
      const f = new Function(...funcNames, `return ${expr};`);
      return f(...funcNames.map(fn => safeFunc[fn]));
    } catch (e) {
      this.addWarning(`Failed to evaluate math expression "${expr}": ${e.message}`);
      return 0;
    }
  }

  findLastSummaryStep() {
    for (let i = this.workflowSteps.length - 1; i >= 0; i--) {
      const step = this.workflowSteps[i];
      if (step.type === 'action' && step.actionRaw?.startsWith('Ask ') && step.saveAs) return step;
    }
    return null;
  }

  // -----------------------------
  // ✅ SAFE INTERPOLATION HELPER (CRITICAL FOR HALLUCINATION PREVENTION)
  // -----------------------------
  _safeInterpolate(template, context, contextType = 'action') {
    return template.replace(/\{([^\}]+)\}/g, (_, path) => {
      const value = this.getNested(context, path.trim());
      if (value === undefined) {
        return `{${path}}`; // Preserve placeholder for downstream validation
      }
      // 🔒 SAFETY GUARD: Block object/array interpolation into string contexts
      if (value !== null && typeof value === 'object') {
        const type = Array.isArray(value) ? 'array' : 'object';
        const keys = Object.keys(value).length > 0
          ? Object.keys(value).join(', ')
          : '(empty)';
        throw new Error(
          `[O-Lang SAFETY] Cannot interpolate ${type} "{${path}}" into ${contextType}.\n` +
          `  → Contains fields: ${keys}\n` +
          `  → Use dot notation: "{${path}.field}" (e.g., {account_info.balance})\n` +
          `\n🛑 Halting to prevent data corruption → LLM hallucination.`
        );
      }
      return String(value);
    });
  }

  // -----------------------------
  // ✅ KERNEL-LEVEL INPUT VALIDATION (Pre-Flight Safety)
  // -----------------------------
  // -----------------------------
  // ✅ KERNEL-LEVEL INPUT VALIDATION (Pre-Flight Safety)
  // -----------------------------
  _validateInputs(inputs) {
    // Only scan specific input fields that contain user text
    const fieldsToScan = ['user_message', 'user_question', 'text', 'prompt'];
    
    for (const field of fieldsToScan) {
      const text = inputs[field];
      if (!text || typeof text !== 'string') continue;

      // 🔒 CONJUGATION-AWARE + EVASION-RESISTANT PAN-AFRICAN INTENT DETECTION (INPUT)
      const forbiddenPatterns = [
        // ────────────────────────────────────────────────
        // 🇳🇬 NIGERIAN LANGUAGES (Fixed Unicode Boundaries)
        // ────────────────────────────────────────────────
        
        // YORUBA: Removed trailing \b after 'ṣẹ' to fix Unicode matching
        { pattern: /fi\s+(?:owo|ẹ̀wọ̀|ewo|ku|fun|s'ọkọọ)/i, capability: 'transfer', lang: 'yo' },
        { pattern: /ranṣẹ\s+(?:owo|pesa|kuɗi|ego)/i, capability: 'transfer', lang: 'yo' },
        { pattern: /fi\s+\w+\s+\w+\s+ranṣẹ/i, capability: 'transfer', lang: 'yo' }, // Catches "Fi 5000 naira ranṣẹ"
        { pattern: /san\s+(?:owo|ẹ̀wọ̀|ewo|fun|wo)/i, capability: 'payment', lang: 'yo' },
        { pattern: /gba\s+owo/i, capability: 'withdrawal', lang: 'yo' },
        { pattern: /\bti\s+(?:fi|san|gba|da|lo)/i, capability: 'unauthorized_action', lang: 'yo' },
        { pattern: /\b(?:ń|ǹ|n)\s+(?:fi|san|gba)/i, capability: 'unauthorized_action', lang: 'yo' },
        { pattern: /\b(mo\s+ti\s+(?:fi|san|gba))/i, capability: 'unauthorized_action', lang: 'yo' },

        // HAUSA: ✅ FIXED - Aggressive Substring Match (No Boundaries)
        { pattern: /aika.{0,30}ku(?:ɗ|d)i/iu, capability: 'transfer', lang: 'ha' },
        { pattern: /ciyar\s*(?:da)?/i, capability: 'transfer', lang: 'ha' },
        { pattern: /shiga\s+ku(?:ɗ|d)i/iu, capability: 'transfer', lang: 'ha' },
        { pattern: /turo\s+.*\s+aika/i, capability: 'transfer', lang: 'ha' },
        { pattern: /biya\s*(?:da)?/i, capability: 'payment', lang: 'ha' },
        { pattern: /sahaw[ae]\s+ku(?:ɗ|d)i/iu, capability: 'withdrawal', lang: 'ha' },
        { pattern: /(?:ya|ta|su)\s+(?:ciyar|biya|sahawa|sake)/i, capability: 'unauthorized_action', lang: 'ha' },
        { pattern: /(?:za\s+a|za\s+ta)\s+(?:ciyar|biya)/i, capability: 'unauthorized_action', lang: 'ha' },
        { pattern: /ina\s+(?:ciyar|biya|sahawa)/i, capability: 'unauthorized_action', lang: 'ha' },


        // IGBO: Removed trailing \b after 'igo'
        { pattern: /zipu\s+(?:ego|moni|isi|na)/i, capability: 'transfer', lang: 'ig' },
        { pattern: /buru\s+(?:ego|moni|isi)/i, capability: 'transfer', lang: 'ig' },
        { pattern: /zi\s+.*\s+zipu/i, capability: 'transfer', lang: 'ig' },
        { pattern: /tinye\s+(?:ego|moni|isi)/i, capability: 'deposit', lang: 'ig' },
        { pattern: /(?:ziri|bururu|tinyere|gbara)/i, capability: 'unauthorized_action', lang: 'ig' },
        { pattern: /m\s+(?:ziri|buru|zipuru|tinyere)/i, capability: 'unauthorized_action', lang: 'ig' },

        // SWAHILI: ✅ FIXED - Catch Conjugated Forms (ni-li-pe, a-li-pe)
        { pattern: /tuma\s+(?:pesa|fedha)/i, capability: 'transfer', lang: 'sw' },
        { pattern: /pelek[ae]?\s+(?:pesa|fedha)/i, capability: 'transfer', lang: 'sw' },
        { pattern: /wasilisha/i, capability: 'transfer', lang: 'sw' },
        { pattern: /\b\w*lip[ae]\w*/i, capability: 'payment', lang: 'sw' },
        { pattern: /maliza\s+malipo/i, capability: 'payment', lang: 'sw' },
        { pattern: /ongez[ae]?\s*(?:kiasi|pesa|fedha)/i, capability: 'deposit', lang: 'sw' },
        { pattern: /wek[ae]?\s+(?:katika|ndani)\s+(?:akaunti|hisa)/i, capability: 'deposit', lang: 'sw' },
        { pattern: /nime(?:tuma|lipa|ongeza|weka|peleka)/i, capability: 'unauthorized_action', lang: 'sw' },


        // OTHER AFRICAN: ✅ FIXED - Direct Unicode Substring
        // Amharic: Match roots anywhere
    { pattern: /\u120b\u12ad/u, capability: 'transfer', lang: 'am' },
    { pattern: /\u1308\u1263/u, capability: 'deposit', lang: 'am' },
    { pattern: /\u12ad\u134c\u120d/u, capability: 'payment', lang: 'am' },
    { pattern: /[\u1200-\u137F]{0,4}(?:\u1270\u120b\u120b\u1348|\u120b\u12ad|\u12ad\u134c\u120d|\u1338\u121d\u122d|\u12c8\u1323|\u1308\u1263)[\u1200-\u137F]{0,2}/u, capability: 'financial_action', lang: 'am' },
        
        // Somali
        { pattern: /dir\s+(?:lacag|maal|qarsoon)/i, capability: 'transfer', lang: 'so' },
        { pattern: /bixi|bixis\s*o/i, capability: 'payment', lang: 'so' },
        
        // Zulu: ✅ FIXED - Handle Subject Concords (u-thumela, ngi-hlawule)
        { pattern: /thumel/i, capability: 'transfer', lang: 'zu' }, // Matches root inside uthumela, ngithumela
        { pattern: /thumel.*imali/i, capability: 'transfer', lang: 'zu' },
        { pattern: /hlawul/i, capability: 'payment', lang: 'zu' },  // Matches root inside hlawula, ngihlawule
        { pattern: /hlawul.*imali/i, capability: 'payment', lang: 'zu' },

        // ────────────────────────────────────────────────
        // 🌐 GLOBAL LANGUAGES
        // ────────────────────────────────────────────────
        { pattern: /\b(transfer(?:red|ring)?|send(?:t|ing)?|wire(?:d)?|pay(?:ed|ing)?|withdraw(?:n)?|deposit(?:ed|ing)?)\b/i, capability: 'financial_action', lang: 'en' },
        { pattern: /\bI\s+(?:can|will|am able to|have|'ve|did|already)\s+(?:transfer|send|pay|withdraw|deposit|wire)\b/i, capability: 'unauthorized_action', lang: 'en' },
        { pattern: /\b(virer|transférer|envoyer|payer|retirer|déposer)\b/i, capability: 'financial_action', lang: 'fr' },
        { pattern: /[\u0600-\u06FF]{0,3}(?:حوّل|أرسل|ادفع|اودع|سحب)[\u0600-\u06FF]{0,3}/u, capability: 'financial_action', lang: 'ar' },
        { pattern: /[\u4e00-\u9fff]{0,2}(?:转账 | 支付 | 存款 | 取款)[\u4e00-\u9fff]{0,2}/u, capability: 'financial_action', lang: 'zh' },

        // ────────────────────────────────────────────────
        // 🛡️ PII & EVASION
        // ────────────────────────────────────────────────
       { pattern: /\b(?:\+?234\s*|0)(?:70|80|81|90|91)\d{8}\b/, capability: 'pii_exposure', lang: 'multi' },
       { pattern: /\b(?:bvn|bank\s+verification\s+number)\b.{0,20}\d{11}/i, capability: 'pii_exposure', lang: 'multi' },
       { pattern: /(?:account|acct|a\/c|akaunti|asusu|hesabu|namba|#)\s*[:\-—–]?\s*(\d{6,})/i, capability: 'pii_exposure', lang: 'multi' },
       { pattern: /\b(successful(?:ly)?|confirmed|approved|completed|processed|verified|imethibitishwa|imefanikiwa)\b/i, capability: 'deceptive_claim', lang: 'multi' },
      ];

      for (const { pattern, capability, lang } of forbiddenPatterns) {
        if (pattern.test(text)) {
          const match = text.match(pattern);
          const isAfrican = ['yo', 'ig', 'ha', 'sw', 'zu', 'am', 'om', 'ff', 'so', 'sn'].includes(lang);
          const isFinancial = ['transfer', 'payment', 'withdrawal', 'deposit', 'financial_action'].includes(capability);

          // ✅ AUDIT LOG: Input Safety Violation
          this._createAuditEntry('input_safety_violation', {
            type: 'blocked_input',
            field: field,
            detected_phrase: match ? match[0].trim() : 'unknown pattern',
            capability: capability,
            language: lang,
            african_language_detected: isAfrican,
            financial_expression_found: isFinancial,
            severity: 'high'
          });

          throw new Error(
            `[O-Lang SAFETY] Blocked Input in "${lang}":\n` +
            `  → Detected: "${match ? match[0].trim() : 'Pattern Match'}"\n` +
            `  → Capability: ${capability}\n` +
            `  → Field: ${field}\n` +
            `  → African Language Detected: ${isAfrican}\n` +
            `  → Financial Expression: ${isFinancial}\n` +
            `\n🛑 Workflow halted before execution.`
          );
        }
      }
    }
    return { passed: true };
  }

// -----------------------------
  // ✅ KERNEL-LEVEL LLM HALLUCINATION PREVENTION (CONJUGATION-AWARE + EVASION-RESISTANT)
  // -----------------------------
  _validateLLMOutput(output, actionContext) {
    if (!output || typeof output !== 'string') return { passed: true };

    // ── __verified_intent takes priority ──────────────────────────────────────
    // If the workflow author has defined intent rules, use those exclusively.
    // This makes governance dynamic — skip hardcoded patterns entirely.
    const intent = this.context.__verified_intent;
    if (intent) {
      if (intent.prohibited_actions && Array.isArray(intent.prohibited_actions)) {
        const lower = output.toLowerCase();
        for (const action of intent.prohibited_actions) {
          if (lower.includes(action.toLowerCase())) {
            return {
              passed: false,
              reason: `Output violates prohibited action "${action}" defined in __verified_intent`,
              detected: action,
              language: 'multi'
            };
          }
        }
      }

      if (intent.prohibited_topics && Array.isArray(intent.prohibited_topics)) {
        const lower = output.toLowerCase();
        for (const topic of intent.prohibited_topics) {
          if (lower.includes(topic.toLowerCase())) {
            return {
              passed: false,
              reason: `Output violates prohibited topic "${topic}" defined in __verified_intent`,
              detected: topic,
              language: 'multi'
            };
          }
        }
      }

      // __verified_intent present and passed — skip hardcoded patterns
      return { passed: true };
    }

    // ── No __verified_intent — fall through to hardcoded patterns ─────────────
    // 🔑 Extract allowed capabilities from workflow allowlist
    const allowedCapabilities = Array.from(this.allowedResolvers)
      .filter(name => !name.startsWith('llm-') && name !== 'builtInMathResolver')
      .map(name => name.replace('@o-lang/', '').replace(/-resolver$/, ''));

    // 🔒 CONJUGATION-AWARE + EVASION-RESISTANT PAN-AFRICAN INTENT DETECTION
const forbiddenPatterns = [
  // ────────────────────────────────────────────────
  // 🇳🇬 NIGERIAN LANGUAGES
  // ────────────────────────────────────────────────

  // YORUBA
  { pattern: /fi\s+(?:owo|ẹ̀wọ̀|ewo|ku|fun|s'ọkọọ)/i, capability: 'transfer', lang: 'yo' },
  { pattern: /san\s+(?:owo|ẹ̀wọ̀|ewo|fun|wo)/i, capability: 'payment', lang: 'yo' },
  { pattern: /gba\s+owo/i, capability: 'withdrawal', lang: 'yo' },
  { pattern: /fi\s+\w+\s+\w+\s+ranṣẹ/i, capability: 'transfer', lang: 'yo' },
  { pattern: /ranṣẹ\s+(?:owo|pesa|kuɗi|ego)/i, capability: 'transfer', lang: 'yo' },
  { pattern: /\bti\s+(?:fi|san|gba|da|lo)/i, capability: 'unauthorized_action', lang: 'yo' },
  { pattern: /\b(?:ń|ǹ|n)\s+(?:fi|san|gba)/i, capability: 'unauthorized_action', lang: 'yo' },
  { pattern: /\b(mo\s+ti\s+(?:fi|san|gba))/i, capability: 'unauthorized_action', lang: 'yo' },

  // HAUSA
  { pattern: /aika.{0,30}ku(?:ɗ|d)i/iu, capability: 'transfer', lang: 'ha' },
  { pattern: /ciyar\s*(?:da)?/i, capability: 'transfer', lang: 'ha' },
  { pattern: /shiga\s+ku(?:ɗ|d)i/iu, capability: 'transfer', lang: 'ha' },
  { pattern: /turo\s+.*\s+aika/i, capability: 'transfer', lang: 'ha' },
  { pattern: /biya\s*(?:da)?/i, capability: 'payment', lang: 'ha' },
  { pattern: /sahaw[ae]\s+ku(?:ɗ|d)i/iu, capability: 'withdrawal', lang: 'ha' },
  { pattern: /(?:ya|ta|su)\s+(?:ciyar|biya|sahawa|sake)/i, capability: 'unauthorized_action', lang: 'ha' },
  { pattern: /(?:za\s+a|za\s+ta)\s+(?:ciyar|biya)/i, capability: 'unauthorized_action', lang: 'ha' },
  { pattern: /ina\s+(?:ciyar|biya|sahawa)/i, capability: 'unauthorized_action', lang: 'ha' },

  // IGBO
  { pattern: /zipu\s+(?:ego|moni|isi|na)/i, capability: 'transfer', lang: 'ig' },
  { pattern: /buru\s+(?:ego|moni|isi)/i, capability: 'transfer', lang: 'ig' },
  { pattern: /zi\s+.*\s+zipu/i, capability: 'transfer', lang: 'ig' },
  { pattern: /tinye\s+(?:ego|moni|isi)/i, capability: 'deposit', lang: 'ig' },
  { pattern: /(?:ziri|bururu|tinyere|gbara)/i, capability: 'unauthorized_action', lang: 'ig' },
  { pattern: /m\s+(?:ziri|buru|zipuru|tinyere)/i, capability: 'unauthorized_action', lang: 'ig' },

  // SWAHILI
  { pattern: /tuma\s+(?:pesa|fedha)/i, capability: 'transfer', lang: 'sw' },
  { pattern: /pelek[ae]?\s+(?:pesa|fedha)/i, capability: 'transfer', lang: 'sw' },
  { pattern: /wasilisha/i, capability: 'transfer', lang: 'sw' },
  { pattern: /\b\w*lip[ae]\w*/i, capability: 'payment', lang: 'sw' },
  { pattern: /maliza\s+malipo/i, capability: 'payment', lang: 'sw' },
  { pattern: /ongez[ae]?\s*(?:kiasi|pesa|fedha)/i, capability: 'deposit', lang: 'sw' },
  { pattern: /wek[ae]?\s+(?:katika|ndani)\s+(?:akaunti|hisa)/i, capability: 'deposit', lang: 'sw' },
  { pattern: /nime(?:tuma|lipa|ongeza|weka|peleka)/i, capability: 'unauthorized_action', lang: 'sw' },
  { pattern: /(?:ni|u|a|tu|m|wa|ki|vi|zi|i)\s*me\s*(?:ongeza|weka|tuma|peleka|lipa|wasilisha)/i, capability: 'unauthorized_action', lang: 'sw' },

  // ────────────────────────────────────────────────
  // 🌍 OTHER AFRICAN LANGUAGES
  // ────────────────────────────────────────────────

  // AMHARIC - Unicode escapes to avoid encoding issues
  { pattern: /\u120b\u12ad/u, capability: 'transfer', lang: 'am' },
  { pattern: /\u1308\u1263/u, capability: 'deposit', lang: 'am' },
  { pattern: /\u12ad\u134c\u120d/u, capability: 'payment', lang: 'am' },
  { pattern: /[\u1200-\u137F]{0,4}(?:\u1270\u120b\u120b\u1348|\u120b\u12ad|\u12ad\u134c\u120d|\u1338\u121d\u122d|\u12c8\u1323|\u1308\u1263)[\u1200-\u137F]{0,2}/u, capability: 'financial_action', lang: 'am' },

  // SOMALI
  { pattern: /dir\s+(?:lacag|maal|qarsoon)/i, capability: 'transfer', lang: 'so' },
  { pattern: /bixi|bixis\s*o/i, capability: 'payment', lang: 'so' },

  // ZULU
  { pattern: /thumel/i, capability: 'transfer', lang: 'zu' },
  { pattern: /thumel.*imali/i, capability: 'transfer', lang: 'zu' },
  { pattern: /hlawul/i, capability: 'payment', lang: 'zu' },
  { pattern: /hlawul.*imali/i, capability: 'payment', lang: 'zu' },

  // ────────────────────────────────────────────────
  // 🌐 GLOBAL LANGUAGES
  // ────────────────────────────────────────────────
  { pattern: /\b(?:have|has|had)\s+(?:transferred|sent|paid|withdrawn|deposited|wire[d])\b/i, capability: 'unauthorized_action', lang: 'en' },
  { pattern: /\b(?:was|were|been)\s+(?:added|credited|transferred|sent|paid)\b/i, capability: 'unauthorized_action', lang: 'en' },
  { pattern: /\b(transfer(?:red|ring)?|send(?:ing)?|wire(?:d)?|pay(?:ed|ing)?|withdraw(?:n)?|deposit(?:ed|ing)?|disburse(?:d)?)\b/i, capability: 'financial_action', lang: 'en' },
  { pattern: /\bI\s+(?:can|will|am able to|have|'ve|did|already)\s+(?:transfer|send|pay|withdraw|deposit|wire)\b/i, capability: 'unauthorized_action', lang: 'en' },
  { pattern: /\b(?:j'?ai|tu as|il a|elle a|nous avons|vous avez|ils ont|elles ont)\s+(?:viré|transféré|envoyé|payé|retiré|déposé)\b/i, capability: 'unauthorized_action', lang: 'fr' },
  { pattern: /\b(virer|transférer|envoyer|payer|retirer|déposer|débiter|créditer)\b/i, capability: 'financial_action', lang: 'fr' },
  { pattern: /[\u0600-\u06FF]{0,3}(?:حوّل|أرسل|ادفع|اودع|سحب)[\u0600-\u06FF]{0,3}(?:ت|نا|تم|تا|تِ|تُ|تَ)[\u0600-\u06FF]{0,3}/u, capability: 'financial_action', lang: 'ar' },
  { pattern: /[\u0600-\u06FF]{0,3}(?:أنا|تم|لقد)\s*(?:حوّلت|أرسلت|دفعت|اودعت)[\u0600-\u06FF]{0,3}/u, capability: 'unauthorized_action', lang: 'ar' },
  { pattern: /[\u4e00-\u9fff]{0,2}(?:转账|支付|存款|取款)[\u4e00-\u9fff]{0,2}(?:了)[\u4e00-\u9fff]{0,2}/u, capability: 'financial_action', lang: 'zh' },
  { pattern: /[\u4e00-\u9fff]{0,2}(?:转账|转帐|支付|付款|提款|取款|存款|存入|汇款|存)[\u4e00-\u9fff]{0,2}/u, capability: 'financial_action', lang: 'zh' },
  { pattern: /[\u4e00-\u9fff]{0,2}(?:我|已|已经)\s*(?:转账|支付|提款|存款)[\u4e00-\u9fff]{0,2}/u, capability: 'unauthorized_action', lang: 'zh' },

  // ────────────────────────────────────────────────
  // 🛡️ PII & EVASION
  // ────────────────────────────────────────────────
  { pattern: /\b(?:\+?234\s*|0)(?:70|80|81|90|91)\d{8}\b/, capability: 'pii_exposure', lang: 'multi' },
  { pattern: /\b(?:bvn|bank\s+verification\s+number)\b.{0,20}\d{11}/i, capability: 'pii_exposure', lang: 'multi' },
  { pattern: /(?:account|acct|a\/c|akaunti|asusu|hesabu|namba|#)\s*[:\-—–]?\s*(\d{6,})/i, capability: 'pii_exposure', lang: 'multi' },
  { pattern: /\b(successful(?:ly)?|confirmed|approved|completed|processed|accepted|verified|imethibitishwa|imefanikiwa|amthibitishwa|ti\s+da|ti\s+ṣe|gụnyere|kimefanyika|yamekamilika)\b/i, capability: 'deceptive_claim', lang: 'multi' },
];

    // 🔍 SCAN OUTPUT FOR FORBIDDEN INTENTS
    for (const { pattern, capability, lang } of forbiddenPatterns) {
      if (pattern.test(output)) {
        const hasCapability = allowedCapabilities.some(c =>
          c.includes(capability) ||
          c.includes('transfer') ||
          c.includes('payment') ||
          c.includes('financial') ||
          c.includes('deposit') ||
          c.includes('withdraw')
        );

        if (!hasCapability) {
          const match = output.match(pattern);
          
          // ✅ Explicitly flag African & Financial context for Audit Logs
          const isAfrican = ['yo', 'ig', 'ha', 'sw', 'zu', 'am', 'om', 'ff', 'so', 'sn'].includes(lang);
          const isFinancial = ['transfer', 'payment', 'withdrawal', 'deposit', 'financial_action'].includes(capability);

          return {
            passed: false,
            reason: `Hallucinated "${capability}" capability in ${lang}...`,
            detected: match ? match[0].trim() : 'unknown pattern',
            language: lang,
            african_language_detected: isAfrican,      
            financial_expression_found: isFinancial,
            capability_attempted: capability 
          };
        }
      }
    }
    return { passed: true };
  }

  // -----------------------------
  // ✅ CRITICAL FIX: Resolver output unwrapping helper
  // -----------------------------
  _unwrapResolverResult(result) {
    if (result && typeof result === 'object' && 'output' in result && result.output !== undefined) {
      return result.output;
    }
    return result;
  }

  // -----------------------------
  // Step execution (WHERE RESOLVERS ARE INVOKED)
  // -----------------------------
  async executeStep(step, agentResolver) {
    const stepType = step.type;
    
    // ✅ Enforce per-step constraints (basic validation)
    if (step.constraints && Object.keys(step.constraints).length > 0) {
      for (const [key, value] of Object.entries(step.constraints)) {
        if (['max_time_sec', 'cost_limit', 'allowed_resolvers'].includes(key)) {
          this.addWarning(`Per-step constraint "${key}=${value}" is parsed but not yet enforced`);
        } else {
          this.addWarning(`Unknown per-step constraint: ${key}=${value}`);
        }
      }
    }

    // ✅ ADDITION 3 — Resolver Policy Enforcement (External + Local)
    const enforceResolverPolicy = (resolver, step) => {
      const resolverName = resolver?.resolverName || resolver?.name;
      if (!resolverName) {
        throw new Error('[O-Lang] Resolver missing resolverName');
      }
      if (!this.allowedResolvers.has(resolverName)) {
        this.logDisallowedResolver(resolverName, step.actionRaw || step.type);
        throw new Error(
          `[O-Lang] Resolver "${resolverName}" blocked by workflow policy`
        );
      }
      if (this._isExternalResolver(resolver)) {
        if (!resolver.manifest.endpoint) {
          throw new Error(
            `[O-Lang] External resolver "${resolverName}" missing endpoint`
          );
        }
      }
    };

    // ✅ CORRECTED: Strict safety WITH dynamic diagnostics
    const runResolvers = async (action) => {
      const mathPattern =
        /^(Add|Subtract|Multiply|Divide|Sum|Avg|Min|Max|Round|Floor|Ceil|Abs)\b/i;
      if (
        step.actionRaw &&
        mathPattern.test(step.actionRaw) &&
        !this.allowedResolvers.has('builtInMathResolver')
      ) {
        this.allowedResolvers.add('builtInMathResolver');
      }

      let resolversToRun = [];
      if (agentResolver && Array.isArray(agentResolver._chain)) {
        resolversToRun = agentResolver._chain;
      } else if (Array.isArray(agentResolver)) {
        resolversToRun = agentResolver;
      } else if (agentResolver) {
        resolversToRun = [agentResolver];
      }

      const resolverAttempts = [];
      for (let idx = 0; idx < resolversToRun.length; idx++) {
        const resolver = resolversToRun[idx];
        const resolverName = resolver?.resolverName || resolver?.name || `resolver-${idx}`;
        enforceResolverPolicy(resolver, step);

        try {
          let result;
          if (this._isExternalResolver(resolver)) {
            result = await this._callExternalResolver(
              resolver,
              action,
              this.context
            );
          } else {
            result = await resolver(action, this.context);
          }

          if (result !== undefined && result !== null) {
            this.context[`__resolver_${idx}`] = result;
            return this._unwrapResolverResult(result);
          }
          
          resolverAttempts.push({
            name: resolverName,
            status: 'skipped',
            reason: 'Action not recognized'
          });
        } catch (e) {
          const diagnostics = {
            error: e.message || String(e),
            requiredEnvVars: e.requiredEnvVars || [],
            missingInputs: e.missingInputs || [],
            documentationUrl: resolver?.documentationUrl ||
              (resolver?.manifest?.documentationUrl) || null
          };
          resolverAttempts.push({
            name: resolverName,
            status: 'failed',
            diagnostics
          });
          this.addWarning(`Resolver "${resolverName}" failed for action "${action}": ${diagnostics.error}`);
        }
      }

      let errorMessage = `[O-Lang SAFETY] No resolver handled action: "${action}\n`;
      errorMessage += `Attempted resolvers:\n`;
      resolverAttempts.forEach((attempt, i) => {
        const namePad = attempt.name.padEnd(30);
        if (attempt.status === 'skipped') {
          errorMessage += `  ${i + 1}. ${namePad} → SKIPPED (action not recognized)\n`;
        } else {
          errorMessage += `  ${i + 1}. ${namePad} → FAILED\n`;
          errorMessage += `     Error: ${attempt.diagnostics.error}\n`;
          if (attempt.diagnostics.requiredEnvVars?.length) {
            errorMessage += `     Required env vars: ${attempt.diagnostics.requiredEnvVars.join(', ')}\n`;
          }
          if (attempt.diagnostics.documentationUrl) {
            errorMessage += `     Docs: ${attempt.diagnostics.documentationUrl}\n`;
          }
        }
      });

      const failed = resolverAttempts.filter(a => a.status === 'failed');
      const allSkipped = failed.length === 0;
      errorMessage += `\n💡 How to fix:\n`;
      if (allSkipped) {
        errorMessage += `  • Verify the action matches a resolver's capabilities:\n`;
        errorMessage += `    → Check resolver documentation for supported actions\n`;
        errorMessage += `    → Ensure correct resolver package is installed\n`;
        errorMessage += `    → Run with --verbose to see resolver matching details\n`;
      } else {
        errorMessage += `  • Address resolver errors shown above:\n`;
        errorMessage += `    → Set required environment variables (if listed)\n`;
        errorMessage += `    → Verify inputs exist in workflow context\n`;
        errorMessage += `    → Check resolver documentation for requirements\n`;
        const envVarPattern = /environment variable|env\.|process\.env|missing.*path/i;
        if (failed.some(f => envVarPattern.test(f.diagnostics.error))) {
          errorMessage += `    → Example (PowerShell): $env:VARIABLE="value"\n`;
          errorMessage += `    → Example (Linux/macOS): export VARIABLE="value"\n`;
        }
        const dbPattern = /database|db\.|sqlite|postgres|mysql|mongodb/i;
        if (failed.some(f => dbPattern.test(f.diagnostics.error))) {
          errorMessage += `    → Ensure database file/connection exists and path is correct\n`;
        }
        const authPattern = /auth|api key|token|credential/i;
        if (failed.some(f => authPattern.test(f.diagnostics.error))) {
          errorMessage += `    → Verify API keys/tokens are set in environment variables\n`;
        }
      }
      
      errorMessage += `\n• Resolver documentation:\n`;
      let hasDocs = false;
      resolverAttempts.forEach(attempt => {
        if (attempt.diagnostics?.documentationUrl) {
          errorMessage += `    → ${attempt.name}: ${attempt.diagnostics.documentationUrl}\n`;
          hasDocs = true;
        }
      });
      if (!hasDocs) {
        errorMessage += `    → Visit https://www.npmjs.com/search?q=%40o-lang     for resolver packages\n`;
      }
      errorMessage += `\n🛑 Workflow halted to prevent unsafe data propagation to LLMs.`;
      throw new Error(errorMessage);
    };

    switch (stepType) {
      case 'calculate': {
        const result = this.evaluateMath(step.expression || step.actionRaw);
        if (step.saveAs) this.context[step.saveAs] = result;
        break;
      }
      
      case 'action': {
        let action = this._safeInterpolate(
          step.actionRaw,
          this.context,
          'action step'
        );

        if (action.startsWith('Ask ')) {
          action = 'Action ' + action.slice(4);
        } else if (action.startsWith('Use ')) {
          action = 'Action ' + action.slice(4);
        }

        if (!action.startsWith('Action ')) {
          throw new Error(
            `[O-Lang SAFETY] Non-canonical action received: "${action}\n` +
            `  → Expected format: Action <resolver> <args>\n` +
            `  → This indicates a kernel or workflow authoring error.`
          );
        }

        const mathCall = action.match(
          /^(add|subtract|multiply|divide|sum|avg|min|max|round|floor|ceil|abs)\((.*)\)$/i
        );
        if (mathCall) {
          const fn = mathCall[1].toLowerCase();
          const args = mathCall[2].split(',').map(s => {
            s = s.trim();
            if (!isNaN(s)) return parseFloat(s);
            return this.getNested(this.context, s.replace(/^\{|\}$/g, ''));
          });
          if (this.mathFunctions[fn]) {
            const value = this.mathFunctions[fn](...args);
            if (step.saveAs) this.context[step.saveAs] = value;
            break;
          }
        }

        const rawResult = await runResolvers(action);
        const unwrapped = this._unwrapResolverResult(rawResult);

        const isLLMAction = action.toLowerCase().includes('groq') ||
          action.toLowerCase().includes('openai') ||
          action.toLowerCase().includes('anthropic') ||
          action.toLowerCase().includes('claude') ||
          action.toLowerCase().includes('gpt') ||
          action.toLowerCase().includes('gemini') ||
          action.toLowerCase().includes('google') ||
          action.toLowerCase().includes('llama') ||
          action.toLowerCase().includes('meta') ||
          action.toLowerCase().includes('mistral') ||
          action.toLowerCase().includes('mixtral') ||
          action.toLowerCase().includes('cohere') ||
          action.toLowerCase().includes('huggingface') ||
          action.toLowerCase().includes('hugging-face') ||
          action.toLowerCase().includes('together') ||
          action.toLowerCase().includes('perplexity') ||
          action.toLowerCase().includes('fireworks') ||
          action.toLowerCase().includes('bedrock') ||
          action.toLowerCase().includes('azure') ||
          action.toLowerCase().includes('ollama') ||
          action.toLowerCase().includes('replicate') ||
          action.toLowerCase().includes('deepseek') ||
          action.toLowerCase().includes('qwen') ||
          action.toLowerCase().includes('falcon') ||
          action.toLowerCase().includes('phi') ||
          action.toLowerCase().includes('gemma') ||
          action.toLowerCase().includes('stablelm') ||
          action.toLowerCase().includes('yi') ||
          action.toLowerCase().includes('dbrx') ||
          action.toLowerCase().includes('command') ||
          action.toLowerCase().includes('llm');

        const llmText = unwrapped?.response ||
          unwrapped?.text ||
          unwrapped?.content ||
          unwrapped?.answer ||
          (typeof unwrapped === 'string' ? unwrapped : null);

        if (isLLMAction && typeof llmText === 'string') {
          const safetyCheck = this._validateLLMOutput(llmText, action);
          if (!safetyCheck.passed) {
            throw new Error(
              `[O-Lang SAFETY] LLM hallucinated unauthorized capability:\n` +
              `  → Detected: "${safetyCheck.detected}"\n` +
              `  → Reason: ${safetyCheck.reason}\n` +
              `  → Workflow allowlist: ${Array.from(this.allowedResolvers).join(', ')}\n` +
              `\n🛑 Halting to prevent deceptive user experience.`
            );
          }
        }

        if (step.saveAs) {
          this.context[step.saveAs] = unwrapped;
        }
        break;
      }
      
      case 'use': {
        const tool = this._safeInterpolate(step.tool, this.context, 'tool name');
        const rawResult = await runResolvers(`Use ${tool}`);
        const unwrapped = this._unwrapResolverResult(rawResult);
        if (step.saveAs) this.context[step.saveAs] = unwrapped;
        break;
      }
      
      case 'ask': {
        const target = this._safeInterpolate(step.target, this.context, 'LLM prompt');
        if (/{[^}]+}/.test(target)) {
          throw new Error(`[O-Lang] Unresolved variables in prompt: "${target}"`);
        }
        const rawResult = await runResolvers(`Action ${target}`);
        const unwrapped = this._unwrapResolverResult(rawResult);

        if (typeof unwrapped?.output === 'string') {
          const safetyCheck = this._validateLLMOutput(unwrapped.output, target);
          if (!safetyCheck.passed) {
            throw new Error(
              `[O-Lang SAFETY] LLM hallucinated unauthorized capability:\n` +
              `  → Detected: "${safetyCheck.detected}"\n` +
              `  → Reason: ${safetyCheck.reason}\n` +
              `  → Workflow allowlist: ${Array.from(this.allowedResolvers).join(', ')}\n` +
              `\n🛑 Halting to prevent deceptive user experience.`
            );
          }
        }

        if (step.saveAs) this.context[step.saveAs] = unwrapped;
        break;
      }
      
      case 'evolve': {
        const { targetResolver, feedback } = step;
        if (this.verbose) {
          console.log(`🔄 Evolve step: ${targetResolver} with feedback: "${feedback}"`);
        }
        const evolutionResult = {
          resolver: targetResolver,
          feedback: feedback,
          status: 'evolution_requested',
          timestamp: new Date().toISOString(),
          workflow: this.context.workflow_name
        };
        if (process.env.OLANG_EVOLUTION_API_KEY) {
          evolutionResult.status = 'advanced_evolution_enabled';
          evolutionResult.message = 'Advanced evolution service would process this request';
        }
        if (step.saveAs) {
          this.context[step.saveAs] = evolutionResult;
        }
        break;
      }
      
      case 'if': {
        if (this.evaluateCondition(step.condition, this.context)) {
          for (const s of step.body) await this.executeStep(s, agentResolver);
        }
        break;
      }
      
      case 'parallel': {
        const { steps, timeout } = step;
        if (timeout !== undefined && timeout > 0) {
          const timeoutPromise = new Promise(resolve => {
            setTimeout(() => resolve({ timedOut: true }), timeout);
          });
          const parallelPromise = Promise.all(
            steps.map(s => this.executeStep(s, agentResolver))
          ).then(() => ({ timedOut: false }));
          const result = await Promise.race([timeoutPromise, parallelPromise]);
          this.context.timed_out = result.timedOut;
          if (result.timedOut) {
            this.emit('parallel_timeout', { duration: timeout, steps: steps.length });
            if (this.verbose) {
              console.log(`⏰ Parallel execution timed out after ${timeout}ms`);
            }
          }
        } else {
          await Promise.all(steps.map(s => this.executeStep(s, agentResolver)));
          this.context.timed_out = false;
        }
        break;
      }
      
      case 'escalation': {
        const { levels } = step;
        let finalResult = null;
        let currentTimeout = 0;
        let completedLevel = null;
        for (const level of levels) {
          if (level.timeout === 0) {
            const levelSteps = require('./parser').parseBlock(level.steps);
            for (const levelStep of levelSteps) {
              await this.executeStep(levelStep, agentResolver);
            }
            if (levelSteps.length > 0) {
              const lastStep = levelSteps[levelSteps.length - 1];
              if (lastStep.saveAs && this.context[lastStep.saveAs] !== undefined) {
                finalResult = this.context[lastStep.saveAs];
                completedLevel = level.levelNumber;
                break;
              }
            }
          } else {
            currentTimeout += level.timeout;
            const timeoutPromise = new Promise(resolve => {
              setTimeout(() => resolve({ timedOut: true }), level.timeout);
            });
            const levelPromise = (async () => {
              const levelSteps = require('./parser').parseBlock(level.steps);
              for (const levelStep of levelSteps) {
                await this.executeStep(levelStep, agentResolver);
              }
              return { timedOut: false };
            })();
            const result = await Promise.race([timeoutPromise, levelPromise]);
            if (!result.timedOut) {
              if (levelSteps && levelSteps.length > 0) {
                const lastStep = levelSteps[levelSteps.length - 1];
                if (lastStep.saveAs && this.context[lastStep.saveAs] !== undefined) {
                  finalResult = this.context[lastStep.saveAs];
                  completedLevel = level.levelNumber;
                  break;
                }
              }
            }
          }
        }
        this.context.escalation_completed = finalResult !== null;
        this.context.timed_out = finalResult === null;
        if (completedLevel !== null) {
          this.context.escalation_level = completedLevel;
        }
        break;
      }
      
      case 'connect': {
        this.resources[step.resource] = step.endpoint;
        break;
      }
      
      case 'agent_use': {
        this.agentMap[step.logicalName] = step.resource;
        break;
      }
      
      case 'debrief': {
        if (step.message.includes('{')) {
          const symbols = step.message.match(/\{([^\}]+)\}/g) || [];
          for (const symbolMatch of symbols) {
            const symbol = symbolMatch.replace(/[{}]/g, '');
            this._requireSemantic(symbol, 'debrief');
          }
        }
        this.emit('debrief', { agent: step.agent, message: step.message });
        break;
      }
      
      case 'prompt': {
        if (this.verbose) {
          console.log(`❓ Prompt: ${step.question}`);
        }
        break;
      }
      
      case 'emit': {
        const payloadTemplate = step.payload;
        const symbols = [...new Set(payloadTemplate.match(/\{([^\}]+)\}/g) || [])];
        let shouldEmit = true;
        for (const symbolMatch of symbols) {
          const symbol = symbolMatch.replace(/[{}]/g, '');
          if (!this._requireSemantic(symbol, 'emit')) {
            shouldEmit = false;
          }
        }
        if (!shouldEmit) {
          if (this.verbose) {
            console.log(`⏭️ Skipped emit due to missing semantic symbols`);
          }
          break;
        }
        const payload = this._safeInterpolate(step.payload, this.context, 'emit payload');
        this.emit(step.event, {
          payload: payload,
          workflow: this.context.workflow_name,
          timestamp: new Date().toISOString()
        });
        if (this.verbose) {
          console.log(`📤 Emit event "${step.event}" with payload: ${payload}`);
        }
        break;
      }
      
      case 'persist': {
        if (!this._requireSemantic(step.variable, 'persist')) {
          if (this.verbose) {
            console.log(`⏭️ Skipped persist for undefined "${step.variable}"`);
          }
          break;
        }
        const sourceValue = this.context[step.variable];
        const outputPath = path.resolve(process.cwd(), step.target);
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        let content;
        if (step.target.endsWith('.json')) {
          content = JSON.stringify(sourceValue, null, 2);
        } else {
          content = String(sourceValue);
        }
        fs.writeFileSync(outputPath, content, 'utf8');
        if (this.verbose) {
          console.log(`💾 Persisted "${step.variable}" to ${step.target}`);
        }
        break;
      }
      
      case 'persist-db': {
        if (!this.dbClient) {
          this.addWarning(`DB persistence skipped (no DB configured). Set OLANG_DB_TYPE env var.`);
          break;
        }
        if (!this._requireSemantic(step.variable, 'persist-db')) {
          if (this.verbose) {
            console.log(`⏭️ Skipped DB persist for undefined "${step.variable}"`);
          }
          break;
        }
        const sourceValue = this.context[step.variable];
        try {
          switch (this.dbClient.type) {
            case 'postgres':
            case 'mysql':
              if (this.dbClient.type === 'postgres') {
                await this.dbClient.client.query(
                  `INSERT INTO "${step.collection}" (workflow_name, data, created_at) VALUES ($1, $2, NOW())`,
                  [this.context.workflow_name || 'unknown', JSON.stringify(sourceValue)]
                );
              } else {
                await this.dbClient.client.execute(
                  `INSERT INTO ?? (workflow_name, data, created_at) VALUES (?, ?, NOW())`,
                  [step.collection, this.context.workflow_name || 'unknown', JSON.stringify(sourceValue)]
                );
              }
              break;
            case 'mongodb':
              const db = this.dbClient.client.db(process.env.DB_NAME || 'olang');
              await db.collection(step.collection).insertOne({
                workflow_name: this.context.workflow_name || 'unknown',
                 sourceValue,
                created_at: new Date()
              });
              break;
            case 'sqlite':
              const stmt = this.dbClient.client.prepare(
                `INSERT INTO ${step.collection} (workflow_name, data, created_at) VALUES (?, ?, ?)`
              );
              stmt.run(
                this.context.workflow_name || 'unknown',
                JSON.stringify(sourceValue),
                new Date().toISOString()
              );
              break;
          }
          if (this.verbose) {
            console.log(`🗄️  Persisted "${step.variable}" to DB collection ${step.collection}`);
          }
        } catch (e) {
          this.addWarning(`DB persist failed for "${step.variable}": ${e.message}`);
        }
        break;
      }
    }

    if (this.verbose) {
      console.log(`\n[Step: ${step.type} | saveAs: ${step.saveAs || 'N/A'}]`);
      console.log(JSON.stringify(this.context, null, 2));
    }
  }

  async executeWorkflow(workflow, inputs, agentResolver) {
    if (workflow.type !== 'workflow') {
      throw new Error(`Unknown workflow type: ${workflow.type}`);
    }
    
    this.context = {
      ...inputs,
      workflow_name: workflow.name
    };

       // ✅ NEW: Validate Inputs BEFORE any step runs
    this._validateInputs(inputs); 

    // ✅ AUDIT LOG: Workflow start (ENHANCED with governance metadata)
    const governanceHash = this._generateGovernanceProfileHash(workflow);
    
    this._createAuditEntry('workflow_started', {
      workflow_id: `${workflow.name}@${workflow.version || 'unversioned'}`, // ✅ Workflow ID
      workflow_name: workflow.name,
      workflow_version: workflow.version || null,
      kernel_version: KERNEL_VERSION,  // ✅ Kernel Version
      runtime_version: KERNEL_VERSION, // ✅ Runtime Version (same as kernel for now)
      governance_profile_hash: governanceHash,  // ✅ Governance Profile Hash
      inputs_count: Object.keys(inputs).length,
      steps_count: workflow.steps.length,
      allowed_resolvers: workflow.allowedResolvers || [],
      constraints: {
        max_generations: workflow.maxGenerations,
        strict_inputs: process.env.OLANG_STRICT_INPUTS === 'true'
      }
    });

    // Optional strict mode: enforce resolver-originated inputs
    if (process.env.OLANG_STRICT_INPUTS === 'true') {
      if (!inputs.__resolver_origin) {
        throw new Error(
          '[O-Lang SAFETY] Inputs must originate from a certified resolver. ' +
          'Use @o-lang/input-validator to validate external data.'
        );
      }
    }

    const currentGeneration = inputs.__generation || 1;
    if (workflow.maxGenerations !== null && currentGeneration > workflow.maxGenerations) {
      throw new Error(`Workflow generation ${currentGeneration} exceeds Constraint: max_generations = ${workflow.maxGenerations}`);
    }

    this.workflowSteps = workflow.steps;
    this.allowedResolvers = new Set(workflow.allowedResolvers || []);
    const mathPattern =
      /^(Add|Subtract|Multiply|Divide|Sum|Avg|Min|Max|Round|Floor|Ceil|Abs)\b/i;
    for (const step of workflow.steps) {
      if (step.type === 'calculate' || (step.actionRaw && mathPattern.test(step.actionRaw))) {
        this.allowedResolvers.add('builtInMathResolver');
      }
    }

    for (const step of workflow.steps) {
      await this.executeStep(step, agentResolver);
    }
    
    // ✅ AUDIT LOG: Workflow completion (ENHANCED)
    this._createAuditEntry('workflow_completed', {
      workflow_id: `${workflow.name}@${workflow.version || 'unversioned'}`,
      workflow_name: workflow.name,
      kernel_version: KERNEL_VERSION,
      runtime_version: KERNEL_VERSION,
      governance_profile_hash: governanceHash,
      return_values: workflow.returnValues,
      total_steps: workflow.steps.length,
      execution_summary: {
        warnings: this.__warnings.length,
        disallowed_attempts: this.disallowedAttempts.length
      }
    });

    this.printDisallowedSummary();
    if (this.__warnings.length) {
      console.log(`\n[O-Lang] ⚠️ Parser/Runtime Warnings (${this.__warnings.length}):`);
      this.__warnings.slice(0, 5).forEach((w, i) => {
        console.log(`${i + 1}. ${w.timestamp} | ${w.message}`);
      });
    }

    // ✅ SEMANTIC VALIDATION: For return values
    const result = {};
    for (const key of workflow.returnValues) {
      if (this._requireSemantic(key, 'return')) {
        result[key] = this.context[key];
      }
    }
    return result;
  }
}

async function execute(workflow, inputs, agentResolver, verbose = false) {
  const rt = new RuntimeAPI({ verbose });
  return rt.executeWorkflow(workflow, inputs, agentResolver);
}

module.exports = { execute, RuntimeAPI };