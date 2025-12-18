// src/parser.js

function parse(code, fileName = null) {
  // --- Enforce .ol extension if filename provided ---
  if (fileName && !fileName.endsWith(".ol")) {
    throw new Error(`Expected .ol workflow, got: ${fileName}`);
  }

  const lines = code
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('//'));

  const workflow = {
    name: 'Unnamed Workflow',
    parameters: [],
    steps: [],
    returnValues: [],
    allowedResolvers: [] // NEW: store allowed resolvers
  };

  let i = 0;
  while (i < lines.length) {
    let line = lines[i];

    // ---------------------------
    // NEW: Detect Allow resolvers
    // ---------------------------
    const allowMatch = line.match(/^Allow resolvers\s*:\s*$/i);
    if (allowMatch) {
      i++;
      while (i < lines.length && lines[i].startsWith('  ')) {
        workflow.allowedResolvers.push(lines[i].trim());
        i++;
      }
      continue;
    }

    // ============================
    // Math operations
    // ============================
    let mathAdd = line.match(/^Add\s+\{(.+?)\}\s+and\s+\{(.+?)\}\s+Save as\s+(.+)$/i);
    if (mathAdd) {
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
      workflow.parameters = wfMatch[2] ? wfMatch[2].split(',').map(p => p.trim()) : [];
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

      const constraintLine = constraintMatch[1].trim();
      const eq = constraintLine.match(/^([^=]+)=\s*(.+)$/);
      if (eq) {
        let key = eq[1].trim();
        let value = eq[2].trim();

        if (value.startsWith('[') && value.endsWith(']')) {
          value = value.slice(1, -1).split(',').map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
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
    // If blocks
    // ---------------------------
    const ifMatch = line.match(/^If\s+(.+)\s+then$/i);
    if (ifMatch) {
      const condition = ifMatch[1].trim();
      const body = [];
      i++;
      while (i < lines.length && !/^\s*End If\s*$/i.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      workflow.steps.push({ type: 'if', condition, body: parseBlock(body) });
      continue;
    }

    // ---------------------------
    // Parallel blocks
    // ---------------------------
    const parMatch = line.match(/^Run in parallel$/i);
    if (parMatch) {
      const steps = [];
      i++;
      while (i < lines.length && !/^\s*End\s*$/i.test(lines[i])) {
        steps.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      workflow.steps.push({ type: 'parallel', steps: parseBlock(steps) });
      continue;
    }

    // ---------------------------
    // Connect
    // ---------------------------
    const connMatch = line.match(/^Connect\s+"([^"]+)"\s+using\s+"([^"]+)"$/i);
    if (connMatch) {
      workflow.steps.push({
        type: 'connect',
        resource: connMatch[1],
        endpoint: connMatch[2]
      });
      i++;
      continue;
    }

    // ---------------------------
    // Agent uses
    // ---------------------------
    const agentUseMatch = line.match(/^Agent\s+"([^"]+)"\s+uses\s+"([^"]+)"$/i);
    if (agentUseMatch) {
      workflow.steps.push({
        type: 'agent_use',
        logicalName: agentUseMatch[1],
        resource: agentUseMatch[2]
      });
      i++;
      continue;
    }

    // ---------------------------
    // Debrief
    // ---------------------------
    const debriefMatch = line.match(/^Debrief\s+(\w+)\s+with\s+"(.+)"$/i);
    if (debriefMatch) {
      workflow.steps.push({
        type: 'debrief',
        agent: debriefMatch[1],
        message: debriefMatch[2]
      });
      i++;
      continue;
    }

    // ---------------------------
    // Evolve
    // ---------------------------
    const evolveMatch = line.match(/^Evolve\s+(\w+)\s+using\s+feedback:\s+"(.+)"$/i);
    if (evolveMatch) {
      workflow.steps.push({
        type: 'evolve',
        agent: evolveMatch[1],
        feedback: evolveMatch[2]
      });
      i++;
      continue;
    }

    // ---------------------------
    // Prompt user
    // ---------------------------
    const promptMatch = line.match(/^Prompt user to\s+"(.+)"$/i);
    if (promptMatch) {
      workflow.steps.push({
        type: 'prompt',
        question: promptMatch[1],
        saveAs: null
      });
      i++;
      continue;
    }

    // ---------------------------
    // Persist
    // ---------------------------
    const persistMatch = line.match(/^Persist\s+(.+)\s+to\s+"(.+)"$/i);
    if (persistMatch) {
      workflow.steps.push({
        type: 'persist',
        variable: persistMatch[1].trim(),
        target: persistMatch[2]
      });
      i++;
      continue;
    }

    // ---------------------------
    // Emit
    // ---------------------------
    const emitMatch = line.match(/^Emit\s+"(.+)"\s+with\s+(.+)$/i);
    if (emitMatch) {
      workflow.steps.push({
        type: 'emit',
        event: emitMatch[1],
        payload: emitMatch[2].trim()
      });
      i++;
      continue;
    }

    // ---------------------------
    // Return
    // ---------------------------
    const returnMatch = line.match(/^Return\s+(.+)$/i);
    if (returnMatch) {
      workflow.returnValues = returnMatch[1].split(',').map(v => v.trim());
      i++;
      continue;
    }

    // ---------------------------
    // Use tool
    // ---------------------------
    const useMatch = line.match(/^Use\s+(.+)$/i);
    if (useMatch) {
      workflow.steps.push({
        type: 'use',
        tool: useMatch[1].trim(),
        saveAs: null,
        constraints: {}
      });
      i++;
      continue;
    }

    // ---------------------------
    // Ask target
    // ---------------------------
    const askMatch = line.match(/^Ask\s+(.+)$/i);
    if (askMatch) {
      workflow.steps.push({
        type: 'ask',
        target: askMatch[1].trim(),
        saveAs: null,
        constraints: {}
      });
      i++;
      continue;
    }

    i++;
  }

  return workflow;
}

// ---------------------------
// Parse nested blocks (If / Parallel)
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
    if (saveMatch && current) {
      current.saveAs = saveMatch[1].trim();
    }

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
