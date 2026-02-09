const fs = require('fs');
const path = require('path');

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
    const eq = cond.match(/^\{(.+)\}\s+equals\s+"(.*)"$/);
    if (eq) return this.getNested(ctx, eq[1]) == eq[2];
    const gt = cond.match(/^\{(.+)\}\s+greater than\s+(\d+\.?\d*)$/);
    if (gt) return parseFloat(this.getNested(ctx, gt[1])) > parseFloat(gt[2]);
    const lt = cond.match(/^\{(.+)\}\s+less than\s+(\d+\.?\d*)$/);
    if (lt) return parseFloat(this.getNested(ctx, lt[1])) < parseFloat(lt[2]);
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
// ✅ KERNEL-LEVEL LLM HALLUCINATION PREVENTION (CONJUGATION-AWARE + EVASION-RESISTANT)
// -----------------------------
_validateLLMOutput(output, actionContext) {
  if (!output || typeof output !== 'string') return { passed: true };

  // 🔑 Extract allowed capabilities from workflow allowlist
  const allowedCapabilities = Array.from(this.allowedResolvers)
    .filter(name => !name.startsWith('llm-') && name !== 'builtInMathResolver')
    .map(name => name.replace('@o-lang/', '').replace(/-resolver$/, ''));

  // 🔒 CONJUGATION-AWARE + EVASION-RESISTANT PAN-AFRICAN INTENT DETECTION
  const forbiddenPatterns = [
    // ────────────────────────────────────────────────
    // 🇳🇬 NIGERIAN LANGUAGES (Conjugation-aware)
    // ────────────────────────────────────────────────
    
    // Yoruba (yo) - Perfective "ti" + Progressive "ń/ǹ/n"
    { pattern: /\bti\s+(?:fi|san|gba|da|lo)\b/i, capability: 'unauthorized_action', lang: 'yo' }, // "has transferred/paid/withdrawn"
    { pattern: /\b(?:ń|ǹ|n)\s+(?:fi|san|gba)\b/i, capability: 'unauthorized_action', lang: 'yo' }, // Progressive "is transferring/paying"
    { pattern: /\b(fi\s+(?:owo|ẹ̀wọ̀|ewo|ku|fun|s'ọkọọ))\b/i, capability: 'transfer', lang: 'yo' },
    { pattern: /\b(san\s+(?:owo|ẹ̀wọ̀|ewo|fun|wo))\b/i, capability: 'payment', lang: 'yo' },
    { pattern: /\b(gba\s+owo)\b/i, capability: 'withdrawal', lang: 'yo' },
    { pattern: /\b(mo\s+ti\s+(?:fi|san|gba))\b/i, capability: 'unauthorized_action', lang: 'yo' },
    
    // Hausa (ha) - Perfective "ya/ta/su" + Future "za a/za ta"
    { pattern: /\b(?:ya|ta|su)\s+(?:ciyar|biya|sahawa|sake)\b/i, capability: 'unauthorized_action', lang: 'ha' }, // "he/she/they transferred/paid/withdrew/deposited"
    { pattern: /\b(?:za\sa|za\s+ta)\s+(?:ciyar|biya)\b/i, capability: 'unauthorized_action', lang: 'ha' }, // Future "will transfer/pay"
    { pattern: /\b(ciyar\s*(?:da)?|ciya\s*(?:da)?|shiga\s+kuɗi)\b/i, capability: 'transfer', lang: 'ha' },
    { pattern: /\b(biya\s*(?:da)?)\b/i, capability: 'payment', lang: 'ha' },
    { pattern: /\b(sahaw[ae]\s+kuɗi)\b/i, capability: 'withdrawal', lang: 'ha' },
    { pattern: /\b(ina\s+(?:ciyar|biya|sahawa))\b/i, capability: 'unauthorized_action', lang: 'ha' },
    
    // Igbo (ig) - Perfective suffixes
    { pattern: /\b(?:ziri|bururu|tinyere|gbara)\b/i, capability: 'unauthorized_action', lang: 'ig' }, // "has sent/carried/deposited/withdrawn"
    { pattern: /\b(zipu\s+(?:ego|moni|isi|na))\b/i, capability: 'transfer', lang: 'ig' },
    { pattern: /\b(buru\s+(?:ego|moni|isi))\b/i, capability: 'transfer', lang: 'ig' },
    { pattern: /\b(tinye\s+(?:ego|moni|isi))\b/i, capability: 'deposit', lang: 'ig' },
    { pattern: /\b(m\s+(?:ziri|buru|zipuru|tinyere))\b/i, capability: 'unauthorized_action', lang: 'ig' },
    
    // ────────────────────────────────────────────────
    // 🌍 PAN-AFRICAN LANGUAGES (Conjugation-aware + Evasion-resistant)
    // ────────────────────────────────────────────────
    
    // Swahili (sw) - ALL ASPECTS: Perfect, Continuous Passive, Future
    { pattern: /\b(?:ni|u|a|tu|m|wa|ki|vi|zi|i)\s*me\s*(?:ongeza|weka|tuma|peleka|lipa|wasilisha)\b/i, capability: 'unauthorized_action', lang: 'sw' }, // Perfect: "nimeongeza" (I have added)
    { pattern: /\b(?:kime|lime|ime|ume|nime|vime|zyme|yame|mame)(?:ongezwa|wekwa|tumwa|pelekwa|lipwa|wasilishwa|fanyika)\b/i, capability: 'unauthorized_action', lang: 'sw' }, // Passive perfect: "kimeongezwa" (has been added)
    { pattern: /\b(?:ki|vi|mi|ma|u|wa|i|zi|ya|li|tu|mu|a|pa|ku)na(?:cho|vyo|yo|lo|mo|o)?(?:tum|pelek|wasil|ongez|wek|lip)\w*wa\b/i, capability: 'unauthorized_action', lang: 'sw' }, // Continuous passive: "kinachowasilishwa" (is being delivered) ← CRITICAL FIX
    { pattern: /\b(?:ki|vi|mi|ma|u|wa|i|zi|ya|li|tu|mu|a|pa|ku)ta(?:tum|pelek|wasil|ongez|wek|lip)\w*\b/i, capability: 'unauthorized_action', lang: 'sw' }, // Future: "kitatuma" (will send)
    { pattern: /\b(tuma\s+(?:pesa|fedha)|pelek[ae]?\s+(?:pesa|fedha)|wasilisha)\b/i, capability: 'transfer', lang: 'sw' },
    { pattern: /\b(lipa|maliza\s+malipo)\b/i, capability: 'payment', lang: 'sw' },
    { pattern: /\b(ongez[ae]?\s*(?:kiasi|pesa|fedha)|wek[ae]?\s+(?:katika|ndani)\s+(?:akaunti|hisa))\b/i, capability: 'deposit', lang: 'sw' },
    { pattern: /\b(nime(?:tuma|lipa|ongeza|weka|peleka))\b/i, capability: 'unauthorized_action', lang: 'sw' },
    
    // Amharic (am) - Perfective suffix (Ethiopic script)
    { pattern: /[\u1200-\u137F]{0,4}(?:ተላላፈ|ላክ|ክፈል|ጨምር|ወጣ|ገባ)[\u1200-\u137F]{0,2}(?:\u1205|\u122d|\u1265)[\u1200-\u137F]{0,2}/u, capability: 'financial_action', lang: 'am' },
    
    // Oromo (om) - Perfective "ni...e"
    { pattern: /\bni\s+(?:kuufe|dhiibe|kennine|gurgure)\b/i, capability: 'unauthorized_action', lang: 'om' },
    { pattern: /\b(kuuf\s+(?:qilleensaa|bilbila)|dhiib\s+(?:qilleensaa|bilbila))\b/i, capability: 'transfer', lang: 'om' },
    { pattern: /\b(kenn\s*i|gurgur\s*i)\b/i, capability: 'payment', lang: 'om' },
    
    // Fula (ff)
    { pattern: /\b(sakkit\s+(?:ndo|ndoo)|tawt\s+(?:ndo|ndoo))\b/i, capability: 'transfer', lang: 'ff' },
    { pattern: /\b(jokk\s*i|soodug\s*i)\b/i, capability: 'payment', lang: 'ff' },
    
    // Somali (so) - Perfective "waxaa"
    { pattern: /\bwaxaa\s+(?:diray|bixiyay|ku\s+daray|sameeyay)\b/i, capability: 'unauthorized_action', lang: 'so' },
    { pattern: /\b(dir\s+(?:lacag|maal|qarsoon))\b/i, capability: 'transfer', lang: 'so' },
    { pattern: /\b(bixi|bixis\s*o)\b/i, capability: 'payment', lang: 'so' },
    
    // Zulu (zu) - Perfective "-ile"
    { pattern: /\b(?:thumel|hlawul|fik)\s*ile\b/i, capability: 'unauthorized_action', lang: 'zu' },
    { pattern: /\b(thumel\s*a\s+(?:imali|imali))\b/i, capability: 'transfer', lang: 'zu' },
    { pattern: /\b(hlawul\s*a|hlawulel\s*a)\b/i, capability: 'payment', lang: 'zu' },
    { pattern: /\b(siyithumel\s*e|siyihlawul\s*e)\b/i, capability: 'unauthorized_action', lang: 'zu' },
    
    // Shona (sn) - Perfective "-a/-e"
    { pattern: /\b(?:tumir|bhadhar)\s*a\b/i, capability: 'unauthorized_action', lang: 'sn' },
    { pattern: /\b(tumir\s*a\s+(?:mhando|ari))\b/i, capability: 'transfer', lang: 'sn' },
    { pattern: /\b(bhadhara|bhadharis\s*o)\b/i, capability: 'payment', lang: 'sn' },
    
    // ────────────────────────────────────────────────
    // 🌐 GLOBAL LANGUAGES (Conjugation-aware)
    // ────────────────────────────────────────────────
    
    // English (en) - Perfective + Passive
    { pattern: /\b(?:have|has|had)\s+(?:transferred|sent|paid|withdrawn|deposited|wire[d])\b/i, capability: 'unauthorized_action', lang: 'en' },
    { pattern: /\b(?:was|were|been)\s+(?:added|credited|transferred|sent|paid)\b/i, capability: 'unauthorized_action', lang: 'en' },
    { pattern: /\b(transfer(?:red|ring)?|send(?:t|ing)?|wire(?:d)?|pay(?:ed|ing)?|withdraw(?:n)?|deposit(?:ed|ing)?|disburse(?:d)?)\b/i, capability: 'financial_action', lang: 'en' },
    { pattern: /\bI\s+(?:can|will|am able to|have|'ve|did|already)\s+(?:transfer|send|pay|withdraw|deposit|wire)\b/i, capability: 'unauthorized_action', lang: 'en' },
    
    // French (fr) - Past participle
    { pattern: /\b(?:j'?ai|tu as|il a|elle a|nous avons|vous avez|ils ont|elles ont)\s+(?:viré|transféré|envoyé|payé|retiré|déposé)\b/i, capability: 'unauthorized_action', lang: 'fr' },
    { pattern: /\b(virer|transférer|envoyer|payer|retirer|déposer|débiter|créditer)\b/i, capability: 'financial_action', lang: 'fr' },
    
    // Arabic (ar) - Perfective past tense
    { pattern: /[\u0600-\u06FF]{0,3}(?:حوّل|أرسل|ادفع|اودع|سحب)[\u0600-\u06FF]{0,3}(?:ت|نا|تم|تا|تِ|تُ|تَ)[\u0600-\u06FF]{0,3}/u, capability: 'financial_action', lang: 'ar' },
    { pattern: /[\u0600-\u06FF]{0,3}(?:أنا|تم|لقد)\s*(?:حوّلت|أرسلت|دفعت|اودعت)[\u0600-\u06FF]{0,3}/u, capability: 'unauthorized_action', lang: 'ar' },
    
    // Chinese (zh) - Perfective "le" particle
    { pattern: /[\u4e00-\u9fff]{0,2}(?:转账|支付|存款|取款)[\u4e00-\u9fff]{0,2}(?:了)[\u4e00-\u9fff]{0,2}/u, capability: 'financial_action', lang: 'zh' },
    { pattern: /[\u4e00-\u9fff]{0,2}(?:转账|转帐|支付|付款|提款|取款|存款|存入|汇款|存)[\u4e00-\u9fff]{0,2}/u, capability: 'financial_action', lang: 'zh' },
    { pattern: /[\u4e00-\u9fff]{0,2}(?:我|已|已经)\s*(?:转账|支付|提款|存款)[\u4e00-\u9fff]{0,2}/u, capability: 'unauthorized_action', lang: 'zh' },
    
    // ────────────────────────────────────────────────
    // 🛡️ EVASION-RESISTANT NUMERIC DECEPTION (Catches obfuscated claims)
    // ────────────────────────────────────────────────
    
    // Number + account reference within 40 chars (catches "10,000 ... account 123")
    { 
      pattern: /(?:^|\s|[:\(\[])(?:\d{1,3}(?:[,\s.]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s*(?:naira|ngn|₦|\$|usd|kes|tzs|ugx|rwf|cdf|xof|xaf|ghs|zar))?.{0,40}(?:account|acct|a\/c|akaunti|asusu|akwụkwọ\s+ọkụ|hesabu|namba|#)\b/i,
      capability: 'unauthorized_action',
      lang: 'multi'
    },
    
    // ────────────────────────────────────────────────
    // 🔒 PII LEAKAGE PATTERNS
    // ────────────────────────────────────────────────
    
    // Account numbers (6+ digits)
    { pattern: /\b(?:account|acct|a\/c|akaunti|asusu|akwụkwọ\s+ọkụ|hesabu|namba|#)\s*[:\-—–]?\s*(\d{6,})\b/i, capability: 'pii_exposure', lang: 'multi' },
    
    // Nigerian BVN (11 digits)
    { pattern: /\b(?:bvn|bank verification number)\s*[:\-]?\s*(\d{11})\b/i, capability: 'pii_exposure', lang: 'multi' },
    
    // Nigerian phone numbers
    { pattern: /\b(?:\+?234\s*|0)(?:70|80|81|90|91)\d{8}\b/, capability: 'pii_exposure', lang: 'multi' },
    
    // ────────────────────────────────────────────────
    // ✅ FAKE CONFIRMATION PATTERNS
    // ────────────────────────────────────────────────
    
    { pattern: /\b(successful(?:ly)?|confirmed|approved|completed|processed|accepted|verified|imethibitishwa|imefanikiwa|amthibitishwa|ti\s+da|ti\s+ṣe|gụnyere|kimefanyika|yamekamilika)\b/i, capability: 'deceptive_claim', lang: 'multi' }
  ];

  // 🔍 SCAN OUTPUT FOR FORBIDDEN INTENTS
  for (const { pattern, capability, lang } of forbiddenPatterns) {
    if (pattern.test(output)) {
      // ✅ Only block if capability NOT in workflow allowlist
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
        return {
          passed: false,
          reason: `Hallucinated "${capability}" capability in ${lang} (not in workflow allowlist: ${allowedCapabilities.join(', ') || 'none'})`,
          detected: match ? match[0].trim() : 'unknown pattern',
          language: lang
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
    // Standard O-Lang resolver contract: { output: {...} } or { error: "..." }
    if (result && typeof result === 'object' && 'output' in result && result.output !== undefined) {
      return result.output;
    }
    // Legacy resolvers might return raw values
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
        // Log unsupported constraints (future extensibility)
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

      // External resolvers MUST be HTTP-only
      if (this._isExternalResolver(resolver)) {
        if (!resolver.manifest.endpoint) {
          throw new Error(
            `[O-Lang] External resolver "${resolverName}" missing endpoint`
          );
        }
      }
    };

    // ✅ CORRECTED: Strict safety WITH dynamic diagnostics (FIXED SCOPE ERROR)
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

      // Handle different resolver input formats
      let resolversToRun = [];
      
      if (agentResolver && Array.isArray(agentResolver._chain)) {
        resolversToRun = agentResolver._chain;
      } else if (Array.isArray(agentResolver)) {
        resolversToRun = agentResolver;
      } else if (agentResolver) {
        resolversToRun = [agentResolver];
      }

      // ✅ Track detailed resolver outcomes for diagnostics
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

          // ✅ ACCEPT valid result immediately (non-null/non-undefined)
          if (result !== undefined && result !== null) {
            // ✅ CRITICAL FIX: Save raw result for debugging (like __resolver_0)
            this.context[`__resolver_${idx}`] = result;
            
            // ✅ UNWRAP before returning to workflow logic
            return this._unwrapResolverResult(result);
          }

          // ⚪ Resolver skipped this action (normal behavior)
          resolverAttempts.push({
            name: resolverName,
            status: 'skipped',
            reason: 'Action not recognized'
          });

        } catch (e) {
          // ❌ Resolver attempted but failed — capture structured diagnostics
          const diagnostics = {
            error: e.message || String(e),
            requiredEnvVars: e.requiredEnvVars || [],          // Resolver can attach this
            missingInputs: e.missingInputs || [],              // Resolver can attach this
            documentationUrl: resolver?.documentationUrl || 
                             (resolver?.manifest?.documentationUrl) || null
          };

          resolverAttempts.push({
            name: resolverName,
            status: 'failed',
            diagnostics
          });
          
          // Log for verbose mode but continue chaining
          this.addWarning(`Resolver "${resolverName}" failed for action "${action}": ${diagnostics.error}`);
        }
      }

      // ✅ BUILD DYNAMIC, ACTIONABLE ERROR MESSAGE (FIXED: NO SCOPE ERRORS)
      let errorMessage = `[O-Lang SAFETY] No resolver handled action: "${action}"\n\n`;
      errorMessage += `Attempted resolvers:\n`;

      resolverAttempts.forEach((attempt, i) => {
        const namePad = attempt.name.padEnd(30);
        if (attempt.status === 'skipped') {
          errorMessage += `  ${i + 1}. ${namePad} → SKIPPED (action not recognized)\n`;
        } else {
          errorMessage += `  ${i + 1}. ${namePad} → FAILED\n`;
          errorMessage += `     Error: ${attempt.diagnostics.error}\n`;
          
          // ✅ DYNAMIC HINT: Resolver-provided env vars
          if (attempt.diagnostics.requiredEnvVars?.length) {
            errorMessage += `     Required env vars: ${attempt.diagnostics.requiredEnvVars.join(', ')}\n`;
          }
          
          // ✅ DYNAMIC HINT: Resolver-provided docs link
          if (attempt.diagnostics.documentationUrl) {
            errorMessage += `     Docs: ${attempt.diagnostics.documentationUrl}\n`;
          }
        }
      });

      // ✅ ACCURATE REMEDIATION (NO OBSOLETE "REMOVE ACTION KEYWORD" HINT)
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
        
        // Pattern-based hints (generic, not hardcoded)
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

      // ✅ FIXED: NO SCOPE ERROR IN FALLBACK DOCUMENTATION URL
      errorMessage += `\n  • Resolver documentation:\n`;
      let hasDocs = false;
      resolverAttempts.forEach(attempt => {
        if (attempt.diagnostics?.documentationUrl) {
          errorMessage += `    → ${attempt.name}: ${attempt.diagnostics.documentationUrl}\n`;
          hasDocs = true;
        }
      });
      if (!hasDocs) {
        errorMessage += `    → Visit https://www.npmjs.com/search?q=%40o-lang     for resolver packages\n`;  // ✅ FIXED
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
  // 🔒 Interpolate workflow variables first
  let action = this._safeInterpolate(
    step.actionRaw,
    this.context,
    'action step'
  );

  // ✅ CANONICALIZATION: Normalize DSL verbs → runtime Action
  if (action.startsWith('Ask ')) {
    action = 'Action ' + action.slice(4);
  } else if (action.startsWith('Use ')) {
    action = 'Action ' + action.slice(4);
  }

  // ❌ Reject non-canonical runtime actions early
  if (!action.startsWith('Action ')) {
    throw new Error(
      `[O-Lang SAFETY] Non-canonical action received: "${action}"\n` +
      `  → Expected format: Action <resolver> <args>\n` +
      `  → This indicates a kernel or workflow authoring error.`
    );
  }

  // ✅ Inline math support (language feature)
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

  // ✅ Resolver dispatch receives ONLY canonical actions
  const rawResult = await runResolvers(action);
  const unwrapped = this._unwrapResolverResult(rawResult);

// 🔒 KERNEL-ENFORCED: Block LLM hallucinations BEFORE saving to context
// Detect LLM resolver by action pattern (comprehensive coverage)
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
                    action.toLowerCase().includes('llm');  // Catch-all fallback
  
  // Extract actual text from resolver output (your llm-groq returns { response: "...", ... })
  const llmText = unwrapped?.response ||          // ✅ Primary field for @o-lang/llm-groq
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
        // ✅ SAFE INTERPOLATION for tool name
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

  // ✅ Ask → Action happens ONLY here (runtime)
  const rawResult = await runResolvers(`Action ${target}`);
  const unwrapped = this._unwrapResolverResult(rawResult);

  // 🔒 KERNEL-ENFORCED: Block LLM hallucinations BEFORE saving to context
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
          // Timed parallel execution
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
          // Normal parallel execution (no timeout)
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
            // Immediate execution (no timeout)
            const levelSteps = require('./parser').parseBlock(level.steps);
            for (const levelStep of levelSteps) {
              await this.executeStep(levelStep, agentResolver);
            }
            
            // Check if the target variable was set in this level
            if (levelSteps.length > 0) {
              const lastStep = levelSteps[levelSteps.length - 1];
              if (lastStep.saveAs && this.context[lastStep.saveAs] !== undefined) {
                finalResult = this.context[lastStep.saveAs];
                completedLevel = level.levelNumber;
                break;
              }
            }
          } else {
            // Timed execution for this level
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
              // Level completed successfully
              if (levelSteps && levelSteps.length > 0) {
                const lastStep = levelSteps[levelSteps.length - 1];
                if (lastStep.saveAs && this.context[lastStep.saveAs] !== undefined) {
                  finalResult = this.context[lastStep.saveAs];
                  completedLevel = level.levelNumber;
                  break;
                }
              }
            }
            // If timed out, continue to next level
          }
        }
        
        // Set escalation status in context
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
        // ✅ SEMANTIC VALIDATION: Check symbols in message
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

      // ✅ NEW: Prompt step handler
      case 'prompt': {
        if (this.verbose) {
          console.log(`❓ Prompt: ${step.question}`);
        }
        // In non-interactive mode, leave as no-op
        break;
      }

      // ✅ NEW: Emit step handler with semantic validation
      case 'emit': {
        // ✅ SEMANTIC VALIDATION: Check all symbols in payload
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
        
        // ✅ SAFE INTERPOLATION for emit payload
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

      // ✅ File Persist step handler with semantic validation
      case 'persist': {
        // ✅ SEMANTIC VALIDATION: Require symbol exists
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

      // ✅ NEW: Database persist handler with semantic validation
      case 'persist-db': {
        if (!this.dbClient) {
          this.addWarning(`DB persistence skipped (no DB configured). Set OLANG_DB_TYPE env var.`);
          break;
        }

        // ✅ SEMANTIC VALIDATION: Require symbol exists
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
                data: sourceValue,  // ✅ FIXED: Added property name "data" (was broken syntax)
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