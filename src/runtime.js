// src/runtime.js
const fs = require('fs');

class RuntimeAPI {
  constructor() {
    this.context = {};
    this.resources = {};
    this.agentMap = {};
    this.events = {};
    this.workflowSteps = []; // store for evolve lookup
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
    if (eq) return this.getNested(ctx, eq[1]) === eq[2];
    const gt = cond.match(/^\{(.+)\}\s+greater than\s+(\d+\.?\d*)$/);
    if (gt) return parseFloat(this.getNested(ctx, gt[1])) > parseFloat(gt[2]);
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

  async executeStep(step, agentResolver) {
    switch (step.type) {
      case 'action': {
        const action = step.actionRaw.replace(/\{([^\}]+)\}/g, (_, path) => {
          const value = this.getNested(this.context, path.trim());
          return value !== undefined ? String(value) : `{${path}}`;
        });
        const res = await agentResolver(action, this.context);
        if (step.saveAs) this.context[step.saveAs] = res;
        break;
      }

      case 'use': {
        // "Use <Tool>" step
        const res = await agentResolver(`Use ${step.tool}`, this.context);
        if (step.saveAs) this.context[step.saveAs] = res;
        break;
      }

      case 'ask': {
        // "Ask <Target>" step
        const res = await agentResolver(`Ask ${step.target}`, this.context);
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

          currentOutput = await agentResolver(revisedAction, this.context);
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

async function execute(workflow, inputs, agentResolver) {
  const rt = new RuntimeAPI();
  return rt.executeWorkflow(workflow, inputs, agentResolver);
}

module.exports = { execute, RuntimeAPI };
