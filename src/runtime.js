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
    if (lt) return parseFloat(this.getNested(ctx, lt[1])) < parseFloat(gt[2]);
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

      if (agentResolver && Array.isArray(agentResolver._chain)) {
        for (let idx = 0; idx < agentResolver._chain.length; idx++) {
          const resolver = agentResolver._chain[idx];
          validateResolver(resolver);

          try {
            const out = await resolver(action, this.context);
            outputs.push(out);
            this.context[`__resolver_${idx}`] = out;
          } catch (e) {
            this.addWarning(`Resolver ${resolver?.name || idx} failed for action "${action}": ${e.message}`);
            outputs.push(null);
          }
        }
      } else {
        validateResolver(agentResolver);
        const out = await agentResolver(action, this.context);
        outputs.push(out);
        this.context['__resolver_0'] = out;
      }

      return outputs[outputs.length - 1];
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
    }

    if (this.verbose) {
      console.log(`\n[Step: ${step.type} | saveAs: ${step.saveAs || 'N/A'}]`);
      console.log(JSON.stringify(this.context, null, 2));
    }
  }

  async executeWorkflow(workflow, inputs, agentResolver) {
    this.context = { ...inputs };
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
