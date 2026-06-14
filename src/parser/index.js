const fs = require('fs');

// ✅ Symbol normalization helper (backward compatible - SAFE to keep)
function normalizeSymbol(raw) {
  if (!raw) return raw;
  // Take only the first word (stop at first whitespace)
  // Keep letters, numbers, underscores, and $ (for JS compatibility)
  return raw.split(/\s+/)[0].replace(/[^\w$]/g, '');
}

function parse(content, filename = '<unknown>') {
  if (typeof content === 'string') {
    // ✅ Strip UTF-8 BOM if present (0xFEFF = Unicode BOM)
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }
    
    const lines = content.split('\n').map(line => line.replace(/\r$/, ''));
    return parseLines(lines, filename);
  } else if (typeof content === 'object' && content !== null) {
    return content;
  } else {
    throw new Error('parse() expects string content or pre-parsed object');
  }
}

function parseFromFile(filepath) {
  // Enforce .ol extension
  if (!filepath.endsWith(".ol")) {
    throw new Error(`Expected .ol workflow, got: ${filepath}`);
  }
  const content = fs.readFileSync(filepath, 'utf8');
  return parse(content, filepath);
}

function parseLines(lines, filename) {
  return parseWorkflowLines(lines, filename);
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE WORKFLOW PARSER
// ─────────────────────────────────────────────────────────────────────────────

function parseWorkflowLines(lines, filename) {
  const workflow = {
    type: 'workflow',
    name: null,
    parameters: [],
    steps: [],
    returnValues: [],
    allowedResolvers: [],
    maxGenerations: null,
    __warnings: [],
    filename: filename
  };

  let i = 0;
  let currentStep = null;
  let inAllowResolvers = false;
  
  // If/Else State Machine Variables (FIXED: Separate accumulators)
  let inIfBlock = false;
  let ifCondition = null;
  let mainIfBody = [];       // Accumulates main if branch lines
  let currentBranchBody = []; // Accumulates else-if or else branches
  let elseIfChain = [];
  let currentElseIf = null;
  let inElseBlock = false;

  // Parallel State
  let inParallelBlock = false;
  let parallelSteps = [];
  let parallelTimeout = null;

  // Escalation State
  let inEscalationBlock = false;
  let escalationLevels = [];
  let currentLevel = null;

  // ✅ ENHANCED: Track labels for blocks
  let currentIfLabel = null;
  let currentParallelLabel = null;
  let currentEscalationLabel = null;

  const flushCurrentStep = () => {
    if (currentStep) {
      workflow.steps.push(currentStep);
      currentStep = null;
    }
  };

  while (i < lines.length) {
    let line = lines[i++].trim();
    if (line === '' || line.startsWith('#')) continue;

    // ✅ ENHANCED: Extract "Step N:" label if present
    let stepLabel = null;
    let strippedLine = line;
    const labelMatch = line.match(/^Step\s+(\d+)\s*:\s*(.+)$/i);
    if (labelMatch) {
      stepLabel = `Step ${labelMatch[1]}`;
      strippedLine = labelMatch[2].trim();
    }

    // --- 1. Workflow Declaration ---
    if (line.startsWith('Workflow ')) {
      const match = line.match(/^Workflow\s+"([^"]+)"(?:\s+with\s+(.+))?$/i);
      if (match) {
        workflow.name = match[1];
        if (match[2]) {
          workflow.parameters = match[2].split(',').map(p => p.trim()).filter(p => p !== '');
        }
      } else {
        workflow.__warnings.push(`Invalid Workflow syntax: ${line}`);
      }
      continue;
    }

    // --- 2. Global Constraints ---
    if (line.startsWith('Constraint: max_generations = ')) {
      const match = line.match(/^Constraint:\s+max_generations\s*=\s*(\d+)$/i);
      if (match) {
        workflow.maxGenerations = parseInt(match[1], 10);
      }
      continue;
    }

    // --- 3. Allow Resolvers Section ---
    if (line === 'Allow resolvers:') {
      inAllowResolvers = true;
      continue;
    }

    if (inAllowResolvers) {
      if (line.startsWith('- ')) {
        const resolverName = line.substring(2).trim();
        if (resolverName) {
          workflow.allowedResolvers.push(resolverName);
        }
      } else if (line === '' || line.startsWith('#')) {
        continue;
      } else {
        inAllowResolvers = false;
        i--; // Re-process this line as normal step
        continue;
      }
      continue;
    }

    // --- 4. Block: Escalation ---
    // ✅ ENHANCED: Use strippedLine to match "Step N: Run in parallel with escalation:"
    if (strippedLine.match(/^Run in parallel with escalation:$/i)) {
      flushCurrentStep();
      inEscalationBlock = true;
      escalationLevels = [];
      currentLevel = null;
      currentEscalationLabel = stepLabel; // ✅ Save label
      continue;
    }

    if (inEscalationBlock) {
      if (line.match(/^End$/i)) {
        if (currentLevel) escalationLevels.push(currentLevel);
        workflow.steps.push({
          type: 'escalation',
          levels: escalationLevels,
          stepNumber: workflow.steps.length + 1,
          label: currentEscalationLabel // ✅ ENHANCED: Add label
        });
        currentEscalationLabel = null; // ✅ Reset
        inEscalationBlock = false;
        continue;
      } else if (line.match(/^Level \d+:/i)) {
        const levelMatch = line.match(/^Level (\d+):\s+(.+)$/i);
        if (levelMatch) {
          if (currentLevel) escalationLevels.push(currentLevel);
          
          let timeoutMs = null;
          const desc = levelMatch[2].trim().toLowerCase();
          if (desc.includes('immediately')) {
            timeoutMs = 0;
          } else {
            const timeMatch = desc.match(/within\s+(\d+)\s*([smhd])/i);
            if (timeMatch) {
              const value = parseInt(timeMatch[1]);
              const unit = timeMatch[2].toLowerCase();
              const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
              timeoutMs = value * (multipliers[unit] || 1000);
            }
          }
          
          currentLevel = {
            levelNumber: parseInt(levelMatch[1]),
            timeout: timeoutMs,
            steps: [] 
          };
          continue;
        }
      } else if (currentLevel) {
        currentLevel.steps.push(line);
        continue;
      }
    }

    // --- 5. Block: Parallel ---
    // ✅ ENHANCED: Use strippedLine to match "Step N: Run in parallel for Xs"
    const timedParMatch = strippedLine.match(/^Run in parallel for (\d+)\s*([smhd])$/i);
    if (timedParMatch) {
      flushCurrentStep();
      const value = parseInt(timedParMatch[1]);
      const unit = timedParMatch[2].toLowerCase();
      const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
      parallelTimeout = value * (multipliers[unit] || 1000);
      
      inParallelBlock = true;
      parallelSteps = [];
      currentParallelLabel = stepLabel; // ✅ Save label
      continue;
    }

    // ✅ ENHANCED: Use strippedLine to match "Step N: Run in parallel"
    if (strippedLine.match(/^Run in parallel$/i)) {
      flushCurrentStep();
      inParallelBlock = true;
      parallelSteps = [];
      parallelTimeout = null;
      currentParallelLabel = stepLabel; // ✅ Save label
      continue;
    }

    if (inParallelBlock) {
      if (line.match(/^End$/i)) {
        flushCurrentStep();
        const parsedParallel = parseBlock(parallelSteps);
        workflow.steps.push({
          type: 'parallel',
          steps: parsedParallel,
          timeout: parallelTimeout,
          stepNumber: workflow.steps.length + 1,
          label: currentParallelLabel // ✅ ENHANCED: Add label
        });
        currentParallelLabel = null; // ✅ Reset
        inParallelBlock = false;
        parallelTimeout = null;
        continue;
      } else {
        parallelSteps.push(line);
        continue;
      }
    }

    // --- 6. Block: If / Else If / Else (FIXED STATE MACHINE) ---
    
    // ✅ ENHANCED: Use strippedLine to match "Step N: If ..."
    if (strippedLine.match(/^(?:If|When)\s+(.+)$/i)) {
      flushCurrentStep();
      const ifMatch = strippedLine.match(/^(?:If|When)\s+(.+)$/i);
      ifCondition = ifMatch[1].trim();
      inIfBlock = true;
      currentIfLabel = stepLabel; // ✅ Save label
      
      // Reset accumulators
      mainIfBody = [];
      currentBranchBody = [];
      elseIfChain = [];
      currentElseIf = null;
      inElseBlock = false;
      continue;
    }

    if (inIfBlock) {
      // Handle Else If
      if (line.match(/^Else If\s+(.+)$/i) || line.match(/^Elseif\s+(.+)$/i)) {
        const eiMatch = line.match(/^(?:Else If|Elseif)\s+(.+)$/i);
        
        // Save previous branch (either main if or previous else-if)
        if (currentElseIf) {
          currentElseIf.body = parseBlock(currentBranchBody);
          elseIfChain.push(currentElseIf);
        }
        
        // Reset for new else-if branch
        currentBranchBody = [];
        currentElseIf = { condition: eiMatch[1].trim(), body: [] };
        continue;
      }

      // Handle Else
      if (line.match(/^Else$/i)) {
        // Save previous else-if if it exists
        if (currentElseIf) {
          currentElseIf.body = parseBlock(currentBranchBody);
          elseIfChain.push(currentElseIf);
          currentElseIf = null;
        }
        
        inElseBlock = true;
        currentBranchBody = [];
        continue;
      }

      // Handle End
      if (line.match(/^End(?:If)?$/i)) {
        flushCurrentStep();

        // Close any open else-if
        if (currentElseIf) {
          currentElseIf.body = parseBlock(currentBranchBody);
          elseIfChain.push(currentElseIf);
          currentElseIf = null;
        }

        workflow.steps.push({
          type: 'if',
          condition: ifCondition,
          body: parseBlock(mainIfBody),           // Main body correctly isolated
          elseIf: elseIfChain,                    // Else-if chain
          elseBranch: inElseBlock ? parseBlock(currentBranchBody) : [], // Else body
          stepNumber: workflow.steps.length + 1,
          label: currentIfLabel // ✅ ENHANCED: Add label
        });
        currentIfLabel = null; // ✅ Reset

        // Reset State
        inIfBlock = false;
        ifCondition = null;
        mainIfBody = [];
        currentBranchBody = [];
        elseIfChain = [];
        inElseBlock = false;
        continue;
      }

      // Accumulate lines into correct bucket
      if (inElseBlock || currentElseIf) {
        currentBranchBody.push(line);
      } else {
        mainIfBody.push(line); // Main if body accumulates here
      }
      continue;
    }

    // --- 7. Standard Steps & Keywords ---

    // Calculate (NEW v1.4.0 — math expression evaluation)
    // ✅ ENHANCED: Use strippedLine
    const calcMatch = strippedLine.match(/^Calculate\s+(.+)$/i);
    if (calcMatch) {
      flushCurrentStep();
      workflow.steps.push({
        type: 'calculate',
        expression: calcMatch[1].trim(),
        stepNumber: workflow.steps.length + 1,
        saveAs: null,
        constraints: {},
        label: stepLabel // ✅ ENHANCED: Add label
      });
      continue;
    }

    // Connect: Connect "name" to url "..." OR Connect "name" to resolver "..."
    // ✅ ENHANCED: Use strippedLine
    const connectMatch = strippedLine.match(/^Connect\s+"([^"]+)"\s+to\s+(url|resolver)\s+"([^"]+)"$/i);
    if (connectMatch) {
      flushCurrentStep();
      workflow.steps.push({
        type: 'connect',
        resource: connectMatch[1],
        endpoint: connectMatch[3],
        targetType: connectMatch[2].toLowerCase(),
        stepNumber: workflow.steps.length + 1,
        label: stepLabel // ✅ ENHANCED: Add label
      });
      continue;
    }

    // Use: Use "logicalName" as "resource"
    // ✅ ENHANCED: Use strippedLine
    const useMatch = strippedLine.match(/^Use\s+"([^"]+)"\s+as\s+"([^"]+)"$/i);
    if (useMatch) {
      flushCurrentStep();
      workflow.steps.push({
        type: 'agent_use',
        logicalName: useMatch[1],
        resource: useMatch[2],
        stepNumber: workflow.steps.length + 1,
        label: stepLabel // ✅ ENHANCED: Add label
      });
      continue;
    }

    // Step Declaration
    const stepMatch = line.match(/^Step\s+(\d+)\s*:\s*(.+)$/i);
    if (stepMatch) {
      flushCurrentStep();
      currentStep = {
        type: 'action',
        stepNumber: parseInt(stepMatch[1], 10),
        actionRaw: stepMatch[2].trim(),
        saveAs: null,
        constraints: {},
        label: `Step ${stepMatch[1]}` // ✅ ENHANCED: Add label
      };
      continue;
    }

    // Save As
    const saveMatch = line.match(/^Save as\s+(.+)$/i);
    if (saveMatch && currentStep) {
      currentStep.saveAs = normalizeSymbol(saveMatch[1].trim());
      continue;
    }

    // Debrief
    // ✅ ENHANCED: Use strippedLine
    const debriefMatch = strippedLine.match(/^Debrief\s+([^\s]+)\s+with\s+"([^"]*)"$/i);
    if (debriefMatch) {
      flushCurrentStep();
      workflow.steps.push({
        type: 'debrief',
        agent: debriefMatch[1].trim(),
        message: debriefMatch[2],
        stepNumber: workflow.steps.length + 1,
        label: stepLabel // ✅ ENHANCED: Add label
      });
      continue;
    }

    // Prompt
    // ✅ ENHANCED: Use strippedLine
    const promptMatch = strippedLine.match(/^Prompt user to\s+"([^"]*)"$/i);
    if (promptMatch) {
      flushCurrentStep();
      workflow.steps.push({
        type: 'prompt',
        question: promptMatch[1],
        stepNumber: workflow.steps.length + 1,
        saveAs: null,
        label: stepLabel // ✅ ENHANCED: Add label
      });
      continue;
    }

    // Persist
    // ✅ ENHANCED: Use strippedLine
    const persistMatch = strippedLine.match(/^Persist\s+([^\s]+)\s+to\s+"([^"]*)"$/i);
    if (persistMatch) {
      flushCurrentStep();
      workflow.steps.push({
        type: 'persist',
        variable: persistMatch[1].trim(),
        target: persistMatch[2],
        stepNumber: workflow.steps.length + 1,
        label: stepLabel // ✅ ENHANCED: Add label
      });
      continue;
    }

    // Emit
    // ✅ ENHANCED: Use strippedLine
    const emitMatch = strippedLine.match(/^Emit\s+"([^"]+)"\s+with\s+(.+)$/i);
    if (emitMatch) {
      flushCurrentStep();
      workflow.steps.push({
        type: 'emit',
        event: emitMatch[1],
        payload: emitMatch[2].trim(),
        stepNumber: workflow.steps.length + 1,
        label: stepLabel // ✅ ENHANCED: Add label
      });
      continue;
    }

    // Ask (Multiline support)
    // ✅ ENHANCED: Use strippedLine
    const askMatch = strippedLine.match(/^Ask\s+(.+)$/i);
    if (askMatch) {
      flushCurrentStep();
      let actionContent = askMatch[1].trim();
      if (actionContent.endsWith('"""')) {
        let multiline = actionContent.slice(0, -3).trim() + ' ';
        while (i < lines.length) {
          const nextLine = lines[i++].trim();
          if (nextLine === '"""') break;
          multiline += nextLine + ' ';
        }
        actionContent = multiline.trim();
      }
      workflow.steps.push({
        type: 'action',
        actionRaw: `Action ${actionContent}`,
        stepNumber: workflow.steps.length + 1,
        saveAs: null,
        constraints: {},
        label: stepLabel // ✅ ENHANCED: Add label
      });
      continue;
    }

    // Return
    const returnMatch = line.match(/^Return\s+(.+)$/i);
    if (returnMatch) {
      flushCurrentStep();
      workflow.returnValues = returnMatch[1]
        .split(',')
        .map(r => r.trim())
        .filter(r => r !== '');
      continue;
    }

    // Fallback: Treat as action
    // ✅ ENHANCED: Use strippedLine for actionRaw
    if (strippedLine.trim() !== '') {
      if (!currentStep) {
        currentStep = {
          type: 'action',
          stepNumber: workflow.steps.length + 1,
          actionRaw: strippedLine,
          saveAs: null,
          constraints: {},
          label: stepLabel // ✅ ENHANCED: Add label
        };
      } else {
        currentStep.actionRaw += ' ' + strippedLine;
      }
    }
  }

  flushCurrentStep();

  // Post-process Save as in actionRaw AND expression (calculate steps)
  workflow.steps.forEach(step => {
    if (step.actionRaw && step.saveAs === null) {
      const saveInAction = step.actionRaw.match(/(.+?)\s+Save as\s+(.+)$/i);
      if (saveInAction) {
        step.actionRaw = saveInAction[1].trim();
        step.saveAs = normalizeSymbol(saveInAction[2].trim());
      }
    }
    // ✅ NEW: Handle Calculate steps with inline Save as
    if (step.type === 'calculate' && step.expression && step.saveAs === null) {
      const saveInExpr = step.expression.match(/(.+?)\s+Save as\s+(.+)$/i);
      if (saveInExpr) {
        step.expression = saveInExpr[1].trim();
        step.saveAs = normalizeSymbol(saveInExpr[2].trim());
      }
    }
    if (step.saveAs) {
      step.saveAs = normalizeSymbol(step.saveAs);
    }
  });

  return workflow;
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK PARSER (Exported for RuntimeAPI Escalation)
// ─────────────────────────────────────────────────────────────────────────────

function parseBlock(lines) {
  const steps = [];
  let current = null;

  const flush = () => {
    if (current) {
      steps.push(current);
      current = null;
    }
  };

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    // Calculate in Block (NEW v1.4.0)
    const calcMatch = line.match(/^Calculate\s+(.+)$/i);
    if (calcMatch) {
      flush();
      steps.push({
        type: 'calculate',
        expression: calcMatch[1].trim(),
        saveAs: null,
        constraints: {}
      });
      continue;
    }

    // Connect in Block
    const connectMatch = line.match(/^Connect\s+"([^"]+)"\s+to\s+(url|resolver)\s+"([^"]+)"$/i);
    if (connectMatch) {
      flush();
      steps.push({
        type: 'connect',
        resource: connectMatch[1],
        endpoint: connectMatch[3],
        targetType: connectMatch[2].toLowerCase()
      });
      continue;
    }

    // Use in Block
    const useMatch = line.match(/^Use\s+"([^"]+)"\s+as\s+"([^"]+)"$/i);
    if (useMatch) {
      flush();
      steps.push({
        type: 'agent_use',
        logicalName: useMatch[1],
        resource: useMatch[2]
      });
      continue;
    }

    // Step in Block
    const stepMatch = line.match(/^Step\s+(\d+)\s*:\s*(.+)$/i);
    if (stepMatch) {
      flush();
      current = {
        type: 'action',
        stepNumber: parseInt(stepMatch[1], 10),
        actionRaw: stepMatch[2].trim(),
        saveAs: null,
        constraints: {},
        label: `Step ${stepMatch[1]}` // ✅ ENHANCED: Add label
      };
      continue;
    }

    // Save As in Block
    const saveMatch = line.match(/^Save as\s+(.+)$/i);
    if (saveMatch && current) {
      current.saveAs = normalizeSymbol(saveMatch[1].trim());
      continue;
    }

    // Debrief in Block
    const debriefMatch = line.match(/^Debrief\s+([^\s]+)\s+with\s+"([^"]*)"$/i);
    if (debriefMatch) {
      flush();
      steps.push({ type: 'debrief', agent: debriefMatch[1].trim(), message: debriefMatch[2] });
      continue;
    }

    // Persist in Block
    const persistMatch = line.match(/^Persist\s+([^\s]+)\s+to\s+"([^"]*)"$/i);
    if (persistMatch) {
      flush();
      steps.push({ type: 'persist', variable: persistMatch[1].trim(), target: persistMatch[2] });
      continue;
    }

    // Emit in Block
    const emitMatch = line.match(/^Emit\s+"([^"]+)"\s+with\s+(.+)$/i);
    if (emitMatch) {
      flush();
      steps.push({ type: 'emit', event: emitMatch[1], payload: emitMatch[2].trim() });
      continue;
    }

    // Ask in Block
    const askMatch = line.match(/^Ask\s+(.+)$/i);
    if (askMatch) {
      flush();
      steps.push({
        type: 'action',
        actionRaw: `Action ${askMatch[1].trim()}`,
        saveAs: null,
        constraints: {}
      });
      continue;
    }

    // Fallback for block actions
    if (current) {
      current.actionRaw += ' ' + line;
    }
  }

  flush();

  // Post-process Save as in block steps
  steps.forEach(step => {
    if (step.actionRaw && step.saveAs === null) {
      const saveInAction = step.actionRaw.match(/(.+?)\s+Save as\s+(.+)$/i);
      if (saveInAction) {
        step.actionRaw = saveInAction[1].trim();
        step.saveAs = normalizeSymbol(saveInAction[2].trim());
      }
    }
    // ✅ NEW: Handle Calculate steps with inline Save as in blocks
    if (step.type === 'calculate' && step.expression && step.saveAs === null) {
      const saveInExpr = step.expression.match(/(.+?)\s+Save as\s+(.+)$/i);
      if (saveInExpr) {
        step.expression = saveInExpr[1].trim();
        step.saveAs = normalizeSymbol(saveInExpr[2].trim());
      }
    }
    if (step.saveAs) {
      step.saveAs = normalizeSymbol(step.saveAs);
    }
  });

  return steps;
}

// ✅ EXPORTS: Added parseBlock so RuntimeAPI can use it for Escalation
module.exports = { parse, parseFromFile, parseLines, parseBlock };