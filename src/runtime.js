const fs = require('fs');
const path = require('path');

class RuntimeAPI {
  constructor({ verbose = false } = {}) {
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
  // Step execution
  // -----------------------------
  async executeStep(step, agentResolver) {
    const stepType = step.type;

    const validateResolver = (resolver) => {
      const resolverName = (resolver?.resolverName || resolver?.name || '').trim();
      if (!resolverName) throw new Error('[O-Lang] Resolver missing name metadata');

      const allowed = Array.from(this.allowedResolvers || []).map(r => r.trim());

      if (!allowed.includes(resolverName)) {
        this.logDisallowedResolver(resolverName, step.actionRaw || step.tool || step.target);
        throw new Error(`[O-Lang] Resolver "${resolverName}" is not allowed by workflow policy`);
      }
    };

    const runResolvers = async (action) => {
      const outputs = [];

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
        // Resolver chain mode
        resolversToRun = agentResolver._chain;
      } else if (Array.isArray(agentResolver)) {
        // Array of resolvers mode (what npx olang passes with -r flags)
        resolversToRun = agentResolver;
      } else if (agentResolver) {
        // Single resolver mode
        resolversToRun = [agentResolver];
      }

      // ✅ Return the FIRST resolver that returns a non-undefined result
      for (let idx = 0; idx < resolversToRun.length; idx++) {
        const resolver = resolversToRun[idx];
        validateResolver(resolver);

        try {
          const out = await resolver(action, this.context);
          outputs.push(out);
          this.context[`__resolver_${idx}`] = out;
          
          // ✅ If resolver handled the action (returned non-undefined), use it immediately
          if (out !== undefined) {
            return out;
          }
        } catch (e) {
          this.addWarning(`Resolver ${resolver?.resolverName || resolver?.name || idx} failed for action "${action}": ${e.message}`);
          outputs.push(null);
          this.context[`__resolver_${idx}`] = null;
        }
      }

      // If no resolver handled the action, return undefined
      return undefined;
    };

    switch (stepType) {
      case 'calculate': {
        const result = this.evaluateMath(step.expression || step.actionRaw);
        if (step.saveAs) this.context[step.saveAs] = result;
        break;
      }

      case 'action': {
        const action = step.actionRaw.replace(/\{([^\}]+)\}/g, (_, path) => {
          const value = this.getNested(this.context, path.trim());
          return value !== undefined ? String(value) : `{${path}}`;
        });

        const mathCall = action.match(/^(add|subtract|multiply|divide|sum|avg|min|max|round|floor|ceil|abs)\((.*)\)$/i);
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

        const res = await runResolvers(action);
        if (step.saveAs) this.context[step.saveAs] = res;
        break;
      }

      case 'use': {
        const res = await runResolvers(`Use ${step.tool}`);
        if (step.saveAs) this.context[step.saveAs] = res;
        break;
      }

      case 'ask': {
        const res = await runResolvers(`Ask ${step.target}`);
        if (step.saveAs) this.context[step.saveAs] = res;
        break;
      }

      case 'evolve': {
        // ✅ Handle in-workflow Evolve steps
        const { targetResolver, feedback } = step;
        
        if (this.verbose) {
          console.log(`🔄 Evolve step: ${targetResolver} with feedback: "${feedback}"`);
        }
        
        // Basic evolution: record the request (free tier)
        const evolutionResult = {
          resolver: targetResolver,
          feedback: feedback,
          status: 'evolution_requested',
          timestamp: new Date().toISOString(),
          workflow: this.context.workflow_name
        };
        
        // ✅ Check for Advanced Evolution Service (paid tier)
      // ✅ Check for Advanced Evolution Service (paid tier)
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
        await Promise.all(step.steps.map(s => this.executeStep(s, agentResolver)));
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
        this.emit('debrief', { agent: step.agent, message: step.message });
        break;
      }

      // ✅ File Persist step handler
      case 'persist': {
        const sourceValue = this.getNested(this.context, step.source);
        if (sourceValue === undefined) {
          this.addWarning(`Cannot persist undefined value from "${step.source}" to "${step.destination}"`);
          break;
        }

        const outputPath = path.resolve(process.cwd(), step.destination);
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        let content;
        if (step.destination.endsWith('.json')) {
          content = JSON.stringify(sourceValue, null, 2);
        } else {
          content = String(sourceValue);
        }

        fs.writeFileSync(outputPath, content, 'utf8');

        if (this.verbose) {
          console.log(`💾 Persisted "${step.source}" to ${step.destination}`);
        }
        break;
      }

      // ✅ NEW: Database persist handler
      case 'persist-db': {
        if (!this.dbClient) {
          this.addWarning(`DB persistence skipped (no DB configured). Set OLANG_DB_TYPE env var.`);
          break;
        }

        const sourceValue = this.getNested(this.context, step.source);
        if (sourceValue === undefined) {
          this.addWarning(`Cannot persist undefined value from "${step.source}" to DB collection "${step.collection}"`);
          break;
        }

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
                data: sourceValue,
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
            console.log(`🗄️  Persisted "${step.source}" to DB collection ${step.collection}`);
          }
        } catch (e) {
          this.addWarning(`DB persist failed for "${step.source}": ${e.message}`);
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
    // Handle regular workflows only (Evolve is a step type now)
    if (workflow.type !== 'workflow') {
      throw new Error(`Unknown workflow type: ${workflow.type}`);
    }

    // ✅ Inject workflow name into context
    this.context = { 
      ...inputs, 
      workflow_name: workflow.name 
    };
    
    // ✅ Check generation constraint from Constraint: max_generations = X
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

    const result = {};
    for (const key of workflow.returnValues) {
      result[key] = this.getNested(this.context, key);
    }
    return result;
  }
}

async function execute(workflow, inputs, agentResolver, verbose = false) {
  const rt = new RuntimeAPI({ verbose });
  return rt.executeWorkflow(workflow, inputs, agentResolver);
}

module.exports = { execute, RuntimeAPI };