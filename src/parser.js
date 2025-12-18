// src/parser.js

function parse(code, fileName = null) {
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

    resolverPolicy: {
      declared: [],
      autoInjected: [],
      used: [],
      warnings: []
    },

    __warnings: [],
    __requiresMath: false
  };

  let i = 0;

  while (i < lines.length) {
    let line = lines[i];

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
// Return statement (updated: auto-detect math)
// ---------------------------
const returnMatch = line.match(/^Return\s+(.+)$/i);
if (returnMatch) {
  const returns = returnMatch[1].split(',').map(v => v.trim());
  workflow.returnValues = returns;

  // --- Check if any return vars come from math steps ---
  for (const retVar of returns) {
    const producedByMath = workflow.steps.some(
      s => s.saveAs === retVar && s.type === 'calculate'
    );
    if (producedByMath) workflow.__requiresMath = true;
  }

  i++;
  continue;
}


    // ---------------------------
// Steps (updated: auto-detect math + saveAs)
// ---------------------------
const stepMatch = line.match(/^Step\s+(\d+)\s*:\s*(.+)$/i);
if (stepMatch) {
  const stepNum = parseInt(stepMatch[1], 10);
  const raw = stepMatch[2].trim();

  // --- Detect math inside Step ---
  let mathDetected = null;
  let expr = '';
  let saveVar = null;

  const mathOps = [
    { re: /^Add\s+\{(.+?)\}\s+and\s+\{(.+?)\}\s+Save as\s+(.+)$/i, fn: 'add' },
    { re: /^Subtract\s+\{(.+?)\}\s+from\s+\{(.+?)\}\s+Save as\s+(.+)$/i, fn: 'subtract' },
    { re: /^Multiply\s+\{(.+?)\}\s+and\s+\{(.+?)\}\s+Save as\s+(.+)$/i, fn: 'multiply' },
    { re: /^Divide\s+\{(.+?)\}\s+by\s+\{(.+?)\}\s+Save as\s+(.+)$/i, fn: 'divide' }
  ];

  for (const op of mathOps) {
    const m = raw.match(op.re);
    if (m) {
      mathDetected = op.fn;
      saveVar = m[3].trim();
      if (op.fn === 'subtract') expr = `subtract({${m[2]}}, {${m[1]}})`;
      else expr = `${op.fn}({${m[1]}}, {${m[2]}})`;
      break;
    }
  }

  if (mathDetected) workflow.__requiresMath = true;

  workflow.steps.push({
    type: mathDetected ? 'calculate' : 'action',
    stepNumber: stepNum,
    actionRaw: mathDetected ? null : raw,
    expression: mathDetected ? expr : undefined,
    saveAs: saveVar,
    constraints: {}
  });

  i++;
  continue;
}

    const saveMatch = line.match(/^Save as\s+(.+)$/i);
    if (saveMatch && workflow.steps.length > 0) {
      const lastStep = workflow.steps[workflow.steps.length - 1];
      lastStep.saveAs = saveMatch[1].trim();

      if (lastStep.saveAs.match(/[A-Z][A-Za-z0-9_]*/)) {
        workflow.__requiresMath = true;
      }

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
