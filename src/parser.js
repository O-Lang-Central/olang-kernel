// src/parser.js

function parse(code, fileName = null) {
  // --- Enforce .ol extension if filename provided ---
  if (fileName && !fileName.endsWith(".ol")) {
    throw new Error(`Expected .ol workflow, got: ${fileName}`);
  }

  const rawLines = code.split(/\r?\n/);

  const lines = rawLines
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('//'));

  const workflow = {
    name: 'Unnamed Workflow',
    parameters: [],
    steps: [],
    returnValues: [],
    allowedResolvers: [],

    // --- NEW: formal resolver policy ---
    resolverPolicy: {
      declared: [],
      autoInjected: [],
      used: [],
      warnings: []
    },

    // --- NEW: parser warnings (non-fatal) ---
    __warnings: [],

    // --- NEW: feature detection flags ---
    __requiresMath: false
  };

  let i = 0;

  while (i < lines.length) {
    let line = lines[i];

    // ---------------------------
    // Resolver policy declaration
    // ---------------------------
    const allowMatch = line.match(/^Allow resolvers\s*:\s*$/i);
    if (allowMatch) {
      i++;
      while (i < lines.length && !/^[A-Za-z]/.test(lines[i])) {
        const val = lines[i].trim();
        if (val) {
          workflow.allowedResolvers.push(val);
          workflow.resolverPolicy.declared.push(val);
        }
        i++;
      }
      continue;
    }

    // ============================
    // Math operations (detected)
    // ============================
    let mathAdd = line.match(/^Add\s+\{(.+?)\}\s+and\s+\{(.+?)\}\s+Save as\s+(.+)$/i);
    if (mathAdd) {
      workflow.__requiresMath = true;
      workflow.steps.push({
        type: 'calculate',
        expression: `add({${mathAdd[1]}}, {${mathAdd[2]}})`,
        saveAs: mathAdd[3].trim()
      });
      i++;
      continue;
    }

    let mathSub = line.match(/^Subtract\s+\{(.+?)\}\s+from\s+\{(.+?)\}\s+Save as\s+(.+)$/i);
    if (mathSub) {
      workflow.__requiresMath = true;
      workflow.steps.push({
        type: 'calculate',
        expression: `subtract({${mathSub[2]}}, {${mathSub[1]}})`,
        saveAs: mathSub[3].trim()
      });
      i++;
      continue;
    }

    let mathMul = line.match(/^Multiply\s+\{(.+?)\}\s+and\s+\{(.+?)\}\s+Save as\s+(.+)$/i);
    if (mathMul) {
      workflow.__requiresMath = true;
      workflow.steps.push({
        type: 'calculate',
        expression: `multiply({${mathMul[1]}}, {${mathMul[2]}})`,
        saveAs: mathMul[3].trim()
      });
      i++;
      continue;
    }

    let mathDiv = line.match(/^Divide\s+\{(.+?)\}\s+by\s+\{(.+?)\}\s+Save as\s+(.+)$/i);
    if (mathDiv) {
      workflow.__requiresMath = true;
      workflow.steps.push({
        type: 'calculate',
        expression: `divide({${mathDiv[1]}}, {${mathDiv[2]}})`,
        saveAs: mathDiv[3].trim()
      });
      i++;
      continue;
    }

    // ---------------------------
    // Workflow definition
    // ---------------------------
    const wfMatch = line.match(/^Workflow\s+"([^"]+)"(?:\s+with\s+(.+))?/i);
    if (wfMatch) {
      workflow.name = wfMatch[1];
      workflow.parameters = wfMatch[2]
        ? wfMatch[2].split(',').map(p => p.trim())
        : [];
      i++;
      continue;
    }

    // ---------------------------
    // Steps
    // ---------------------------
    const stepMatch = line.match(/^Step\s+(\d+)\s*:\s*(.+)$/i);
    if (stepMatch) {
      workflow.steps.push({
        type: 'action',
        stepNumber: parseInt(stepMatch[1], 10),
        actionRaw: stepMatch[2].trim(),
        saveAs: null,
        constraints: {}
      });
      i++;
      continue;
    }

    const saveMatch = line.match(/^Save as\s+(.+)$/i);
    if (saveMatch && workflow.steps.length > 0) {
      workflow.steps[workflow.steps.length - 1].saveAs = saveMatch[1].trim();
      i++;
      continue;
    }

    const constraintMatch = line.match(/^Constraint:\s*(.+)$/i);
    if (constraintMatch && workflow.steps.length > 0) {
      const lastStep = workflow.steps[workflow.steps.length - 1];
      if (!lastStep.constraints) lastStep.constraints = {};

      const eq = constraintMatch[1].match(/^([^=]+)=\s*(.+)$/);
      if (eq) {
        let key = eq[1].trim();
        let value = eq[2].trim();

        if (value.startsWith('[') && value.endsWith(']')) {
          value = value.slice(1, -1).split(',').map(v =>
            v.trim().replace(/^"/, '').replace(/"$/, '')
          );
        } else if (!isNaN(value)) {
          value = Number(value);
        } else if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }

        lastStep.constraints[key] = value;
      }
      i++;
      continue;
    }

    // ---------------------------
    // (ALL remaining blocks unchanged)
    // If, Parallel, Connect, Agent, Debrief, Evolve,
    // Prompt, Persist, Emit, Return, Use, Ask
    // ---------------------------

    i++;
  }

  // ============================
  // LINT & POLICY FINALIZATION
  // ============================

  if (workflow.__requiresMath) {
    workflow.resolverPolicy.used.push('builtInMathResolver');

    if (!workflow.resolverPolicy.declared.includes('builtInMathResolver')) {
      workflow.resolverPolicy.autoInjected.push('builtInMathResolver');
      workflow.allowedResolvers.unshift('builtInMathResolver');

      workflow.__warnings.push(
        'Math operations detected. builtInMathResolver auto-injected.'
      );
    }
  }

  if (workflow.resolverPolicy.declared.length === 0) {
    workflow.__warnings.push(
      'No "Allow resolvers" section declared. Workflow will run in restricted mode.'
    );
  }

  workflow.resolverPolicy.warnings = workflow.__warnings.slice();

  return workflow;
}

// ---------------------------
// Parse nested blocks (unchanged)
// ---------------------------
function parseBlock(lines) {
  const steps = [];
  let current = null;

  for (const line of lines) {
    const stepMatch = line.match(/^Step\s+(\d+)\s*:\s*(.+)$/i);
    if (stepMatch) {
      current = {
        type: 'action',
        stepNumber: parseInt(stepMatch[1], 10),
        actionRaw: stepMatch[2].trim(),
        saveAs: null,
        constraints: {}
      };
      steps.push(current);
      continue;
    }

    const saveMatch = line.match(/^Save as\s+(.+)$/i);
    if (saveMatch && current) current.saveAs = saveMatch[1].trim();

    const debriefMatch = line.match(/^Debrief\s+(\w+)\s+with\s+"(.+)"$/i);
    if (debriefMatch) {
      steps.push({ type: 'debrief', agent: debriefMatch[1], message: debriefMatch[2] });
    }

    const evolveMatch = line.match(/^Evolve\s+(\w+)\s+using\s+feedback:\s+"(.+)"$/i);
    if (evolveMatch) {
      steps.push({ type: 'evolve', agent: evolveMatch[1], feedback: evolveMatch[2] });
    }

    const promptMatch = line.match(/^Prompt user to\s+"(.+)"$/i);
    if (promptMatch) {
      steps.push({ type: 'prompt', question: promptMatch[1], saveAs: null });
    }

    const useMatch = line.match(/^Use\s+(.+)$/i);
    if (useMatch) {
      steps.push({ type: 'use', tool: useMatch[1].trim(), saveAs: null, constraints: {} });
    }

    const askMatch = line.match(/^Ask\s+(.+)$/i);
    if (askMatch) {
      steps.push({ type: 'ask', target: askMatch[1].trim(), saveAs: null, constraints: {} });
    }
  }

  return steps;
}

module.exports = { parse };
