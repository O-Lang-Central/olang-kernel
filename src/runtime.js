const fs = require('fs');

class RuntimeAPI {
  constructor({ verbose = false } = {}) {
    this.context = {};
    this.resources = {};
    this.agentMap = {};
    this.events = {};
    this.workflowSteps = []; // store for evolve lookup
    this.verbose = verbose; // verbose logging flag
  }

  on(eventName, cb) {
    if (!this.events[eventName]) this.events[eventName] = [];
    this.events[eventName].push(cb);
  }

  emit(eventName, payload) {
    if (this.events[eventName]) {
      this.events[eventName].forEach(cb => cb(payload));
    }
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

  getNested(obj, path) {
    if (!path) return undefined;
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined) ? o[k] : undefined, obj);
  }

  findLastSummaryStep() {
    for (let i = this.workflowSteps.length - 1; i >= 0; i--) {
      const step = this.workflowSteps[i];
      if (step.type === 'action' && step.actionRaw?.startsWith('Ask ') && step.saveAs) {
        return step;
      }
    }
    return null;
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
    funcNames.forEach(fn => {
      safeFunc[fn] = this.mathFunctions[fn];
    });

    try {
      const f = new Function(...funcNames, `return ${expr};`);
      return f(...funcNames.map(fn => safeFunc[fn]));
    } catch (e) {
      console.warn(`[O-Lang] Failed to evaluate math expression "${expr}": ${e.message}`);
      return 0;
    }
  }

  // --------------------------
  // Execute workflow step
  // --------------------------
  async executeStep(step, agentResolver) {
    const stepType = step.type;

    // Helper: execute all resolvers for this step action
    const runAllResolvers = async (action) => {
      const outputs = [];
      if (agentResolver && Array.isArray(agentResolver._chain)) {
        for (let idx = 0; idx < agentResolver._chain.length; idx++) {
          const resolver = agentResolver._chain[idx];
          try {
            const out = await resolver(action, this.context);
            outputs.push(out);
            this.context[`__resolver_${idx}`] = out;
          } catch (e) {
            console.error(`❌ Resolver ${idx} error for action "${action}":`, e.message);
            outputs.push(null);
          }
        }
      } else {
        const out = await agentResolver(action, this.context);
        outputs.push(out);
        this.context['__resolver_0'] = out;
      }
      return outputs[outputs.length - 1]; // last result as primary
    };

    switch (stepType) {
      case 'calculate': {
        const expr = step.expression || step.actionRaw;
        const result = this.evaluateMath(expr);
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
          const argsRaw = mathCall[2];
          const args = argsRaw.split(',').map(s => s.trim()).map(s => {
            if (/^".*"$/.test(s) || /^'.*'$/.test(s)) return s.slice(1, -1);
            if (!isNaN(s)) return parseFloat(s);
            const lookup = s.replace(/^\{|\}$/g, '').trim();
            return this.getNested(this.context, lookup);
          });
          if (this.mathFunctions[fn]) {
            const value = this.mathFunctions[fn](...args);
            if (step.saveAs) this.context[step.saveAs] = value;
            break;
          }
        }

        const res = await runAllResolvers(action);
        if (step.saveAs) this.context[step.saveAs] = res;
        break;
      }

      case 'use': {
        const res = await runAllResolvers(`Use ${step.tool}`);
        if (step.saveAs) this.context[step.saveAs] = res;
        break;
      }

      case 'ask': {
        const res = await runAllResolvers(`Ask ${step.target}`);
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

      case 'evolve': {
        const maxGen = step.constraints?.max_generations || 1;
        if (maxGen < 1) {
          this.context['improved_summary'] = this.context['summary'] || '';
          return;
        }

        const summaryStep = this.findLastSummaryStep();
        if (!summaryStep) {
          console.warn('[O-Lang] Evolve: No prior "Ask ... Save as" step found to evolve');
          this.context['improved_summary'] = this.context['summary'] || '';
          return;
        }

        const varName = summaryStep.saveAs;
        let currentOutput = this.context[varName] || '';

        for (let attempt = 0; attempt < maxGen; attempt++) {
          let revisedAction = summaryStep.actionRaw.replace(/\{([^\}]+)\}/g, (_, path) => {
            const val = this.getNested(this.context, path.trim());
            return val !== undefined ? String(val) : `{${path}}`;
          });

          if (step.feedback) {
            revisedAction = revisedAction.replace(/(")$/, `\n\n[IMPROVEMENT FEEDBACK: ${step.feedback}]$1`);
          }

          currentOutput = await runAllResolvers(revisedAction);
          this.context[varName] = currentOutput;

          this.emit('debrief', {
            agent: step.agent || 'Evolver',
            message: `Evolve attempt ${attempt + 1}/${maxGen}: ${currentOutput.substring(0, 80)}...`
          });
        }

        this.context['improved_summary'] = currentOutput;
        break;
      }

      case 'prompt': {
        const input = await this.getUserInput(step.question);
        if (step.saveAs) this.context[step.saveAs] = input;
        break;
      }

      case 'persist': {
        const val = this.context[step.variable];
        if (val !== undefined) {
          fs.appendFileSync(step.target, JSON.stringify(val) + '\n', 'utf8');
        }
        break;
      }

      case 'emit': {
        const payload = step.payload ? this.getNested(this.context, step.payload) : undefined;
        this.emit(step.event, payload || step.payload);
        break;
      }
    }

    // Verbose logging of context after each step
    if (this.verbose) {
      console.log(`\n[Step: ${step.type} | saveAs: ${step.saveAs || 'N/A'}]`);
      console.log(JSON.stringify(this.context, null, 2));
    }
  }

  async getUserInput(question) {
    return new Promise(resolve => {
      process.stdout.write(`${question}: `);
      process.stdin.resume();
      process.stdin.once('data', data => {
        process.stdin.pause();
        resolve(data.toString().trim());
      });
    });
  }

  async executeWorkflow(workflow, inputs, agentResolver) {
    this.context = { ...inputs };
    this.workflowSteps = workflow.steps;

    for (const step of workflow.steps) {
      await this.executeStep(step, agentResolver);
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
