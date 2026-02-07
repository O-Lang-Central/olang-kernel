// src/runtime/semantic.js
const { parse } = require('../parser');

class SemanticEngine {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
  }

  analyze(workflowSource) {
    let workflowPlan;

    if (typeof workflowSource === 'string') {
      if (this.verbose) console.log('[semantic] Parsing workflow string...');
      workflowPlan = parse(workflowSource); // always parse string to workflow object
    } else if (typeof workflowSource === 'object' && workflowSource !== null) {
      workflowPlan = workflowSource;
      // Ensure steps array exists
      if (!Array.isArray(workflowPlan.steps)) workflowPlan.steps = [];
    } else {
      throw new Error('[semantic] Invalid workflow input');
    }

    // Ensure safe defaults
    if (!workflowPlan.steps) workflowPlan.steps = [];
    if (!workflowPlan.allowedResolvers) workflowPlan.allowedResolvers = [];
    if (!workflowPlan.returnValues) workflowPlan.returnValues = [];

    if (this.verbose) {
      console.log(`[semantic] Workflow "${workflowPlan.name || '<unknown>'}" analyzed: ${workflowPlan.steps.length} steps`);
    }

    return workflowPlan;
  }
}

module.exports = SemanticEngine;
