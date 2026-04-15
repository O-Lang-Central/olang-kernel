const fs = require('fs');

// ✅ Symbol normalization helper (backward compatible - SAFE to keep)
function normalizeSymbol(raw) {
  if (!raw) return raw;
  // Take only the first word (stop at first whitespace)
  // Keep letters, numbers, underscores, and $ (for JS compatibility)
  return raw.split(/\s+/)[0].replace(/[^\w$]/g, '');
}

// ❌ REMOVED: normalizeAction() function (was stripping "Action" prefix → broke resolver matching)

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
  let inIfBlock = false;
  let ifCondition = null;
  let ifBody = [];
  let inParallelBlock = false;
  let parallelSteps = [];
  let parallelTimeout = null;
  let inEscalationBlock = false;
  let escalationLevels = [];
  let currentLevel = null;

  // ✅ Helper to flush currentStep
  const flushCurrentStep = () => {
    if (currentStep) {
      workflow.steps.push(currentStep);
      currentStep = null;
    }
  };

  while (i < lines.length) {
    let line = lines[i++].trim();

    if (line === '' || line.startsWith('#')) {
      continue;
    }

    // Workflow declaration
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

    // Global Constraint: max_generations
    if (line.startsWith('Constraint: max_generations = ')) {
      const match = line.match(/^Constraint:\s+max_generations\s*=\s*(\d+)$/i);
      if (match) {
        workflow.maxGenerations = parseInt(match[1], 10);
      } else {
        workflow.__warnings.push(`Invalid Constraint syntax: ${line}`);
      }
      continue;
    }

    // Allow resolvers section
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
        i--;
        continue;
      }
      continue;
    }

    // ✅ Parse Escalation block
    if (line.match(/^Run in parallel with escalation:$/i)) {
      flushCurrentStep();
      inEscalationBlock = true;
      escalationLevels = [];
      currentLevel = null;
      continue;
    }

    if (inEscalationBlock) {
      if (line.match(/^End$/i)) {
        if (currentLevel) {
          escalationLevels.push(currentLevel);
        }
        workflow.steps.push({
          type: 'escalation',
          levels: escalationLevels,
          stepNumber: workflow.steps.length + 1
        });
        inEscalationBlock = false;
        continue;
      } else if (line.match(/^Level \d+:/i)) {
        // Parse level declaration
        const levelMatch = line.match(/^Level (\d+):\s+(.+)$/i);
        if (levelMatch) {
          if (currentLevel) {
            escalationLevels.push(currentLevel);
          }
          
          // Parse timeout from level description
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
        // Parse steps within level
        currentLevel.steps.push(line);
        continue;
      }
    }

    // ✅ Parse Timed Parallel block (EXACT FORMAT - NO DUPLICATION)
    const timedParMatch = line.match(/^Run in parallel for (\d+)\s*([smhd])$/i);
    if (timedParMatch) {
      flushCurrentStep();
      
      const value = parseInt(timedParMatch[1]);
      const unit = timedParMatch[2].toLowerCase();
      const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
      const timeoutMs = value * (multipliers[unit] || 1000);
      
      inParallelBlock = true;
      parallelSteps = [];
      parallelTimeout = timeoutMs;
      continue;
    }

    // ✅ Parse Normal Parallel block (backward compatible)
    if (line.match(/^Run in parallel$/i)) {
      flushCurrentStep();
      inParallelBlock = true;
      parallelSteps = [];
      parallelTimeout = null;
      continue;
    }

    if (inParallelBlock) {
      if (line.match(/^End$/i)) {
        flushCurrentStep(); // ✅ Flush last parallel step
        const parsedParallel = parseBlock(parallelSteps);
        workflow.steps.push({
          type: 'parallel',
          steps: parsedParallel,
          timeout: parallelTimeout,
          stepNumber: workflow.steps.length + 1
        });
        inParallelBlock = false;
        parallelTimeout = null;
        continue;
      } else {
        parallelSteps.push(line);
        continue;
      }
    }

    // ✅ FLUSH before If/When block
    if (line.match(/^(?:If|When)\s+(.+)$/i)) {
      flushCurrentStep();
      const ifMatch = line.match(/^(?:If|When)\s+(.+)$/i);
      ifCondition = ifMatch[1].trim();
      inIfBlock = true;
      ifBody = [];
      continue;
    }

    if (inIfBlock) {
      if (line.match(/^End(?:If)?$/i)) {
        flushCurrentStep(); // ✅ Flush last if step
        const parsedIfBody = parseBlock(ifBody);
        workflow.steps.push({
          type: 'if',
          condition: ifCondition,
          body: parsedIfBody,
          stepNumber: workflow.steps.length + 1
        });
        inIfBlock = false;
        ifCondition = null;
        ifBody = [];
        continue;
      } else {
        ifBody.push(line);
        continue;
      }
    }

    // Step declaration - ✅ PRESERVE ACTION EXACTLY (NO NORMALIZATION)
    const stepMatch = line.match(/^Step\s+(\d+)\s*:\s*(.+)$/i);
    if (stepMatch) {
      flushCurrentStep(); // ✅ Flush previous step
      const stepNumber = parseInt(stepMatch[1], 10);
      const stepContent = stepMatch[2].trim();  // ← PRESERVED EXACTLY (no normalizeAction)
      
      currentStep = {
        type: 'action',
        stepNumber: stepNumber,
        actionRaw: stepContent,  // ← CRITICAL: No normalization here
        saveAs: null,
        constraints: {}
      };
      continue;
    }

    // Save as - ✅ Apply normalization (safe for symbol names)
    const saveMatch = line.match(/^Save as\s+(.+)$/i);
    if (saveMatch && currentStep) {
      currentStep.saveAs = normalizeSymbol(saveMatch[1].trim());
      continue;
    }

    // Constraint (per-step)
    const constraintMatch = line.match(/^Constraint:\s*(.+)$/i);
    if (constraintMatch && currentStep) {
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

        currentStep.constraints[key] = value;
      }
      continue;
    }

    // ✅ ADD: Set keyword (e.g., Set analysis_result = "")
    const setMatch = line.match(/^Set\s+(\w+)\s*=\s*(.+)$/i);
    if (setMatch) {
      flushCurrentStep();
      workflow.steps.push({
        type: 'calculate',
        stepNumber: workflow.steps.length + 1,
        actionRaw: setMatch[2].trim(),  // e.g., '""' or '"N/A"'
        saveAs: setMatch[1].trim(),     // e.g., 'analysis_result'
        constraints: {}
      });
      continue;
    }

    // Debrief
    const debriefMatch = line.match(/^Debrief\s+([^\s]+)\s+with\s+"([^"]*)"$/i);
    if (debriefMatch) {
      flushCurrentStep();
      workflow.steps.push({
        type: 'debrief',
        agent: debriefMatch[1].trim(),
        message: debriefMatch[2],
        stepNumber: workflow.steps.length + 1
      });
      continue;
    }

    // Evolve
    const evolveMatch = line.match(/^Evolve\s+([^\s]+)\s+using\s+feedback:\s*"([^"]*)"$/i);
    if (evolveMatch) {
      flushCurrentStep();
      workflow.steps.push({
        type: 'evolve',
        targetResolver: evolveMatch[1].trim(),
        feedback: evolveMatch[2],
        stepNumber: workflow.steps.length + 1
      });
      continue;
    }

    // Prompt
    const promptMatch = line.match(/^Prompt user to\s+"([^"]*)"$/i);
    if (promptMatch) {
      flushCurrentStep();
      workflow.steps.push({
        type: 'prompt',
        question: promptMatch[1],
        stepNumber: workflow.steps.length + 1,
        saveAs: null
      });
      continue;
    }

    // Persist
    const persistMatch = line.match(/^Persist\s+([^\s]+)\s+to\s+"([^"]*)"$/i);
    if (persistMatch) {
      flushCurrentStep();
      workflow.steps.push({
        type: 'persist',
        variable: persistMatch[1].trim(),
        target: persistMatch[2],
        stepNumber: workflow.steps.length + 1
      });
      continue;
    }

    // Emit
    const emitMatch = line.match(/^Emit\s+"([^"]+)"\s+with\s+(.+)$/i);
    if (emitMatch) {
      flushCurrentStep();
      workflow.steps.push({
        type: 'emit',
        event: emitMatch[1],
        payload: emitMatch[2].trim(),
        stepNumber: workflow.steps.length + 1
      });
      continue;
    }

    // Use (for Notify-like actions) - ✅ PRESERVE TOOL EXACTLY (NO NORMALIZATION)
    const useMatch = line.match(/^Use\s+(.+)$/i);
    if (useMatch) {
      flushCurrentStep();
      workflow.steps.push({
        type: 'use',
        tool: useMatch[1].trim(),  // ← PRESERVED EXACTLY (no normalizeAction)
        stepNumber: workflow.steps.length + 1,
        saveAs: null,
        constraints: {}
      });
      continue;
    }

    // Ask (for Notify/resolver calls) - ✅ PRESERVE TARGET EXACTLY (NO NORMALIZATION)
    const askMatch = line.match(/^Ask\s+(.+)$/i);
    if (askMatch) {
      flushCurrentStep();
      let actionContent = askMatch[1].trim();

      // ✅ Multiline heredoc support: Ask llm-groq """
      if (actionContent.endsWith('"""')) {
        // Consume lines until closing """
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
        constraints: {}
      });
      continue;
    }

    // ✅ ADD: Return keyword support (ensures wf.returnValues is populated)
// ✅ ADD: Return keyword support (with debug logging)
const returnMatch = line.match(/^Return\s+(.+)$/i);
if (returnMatch) {
  flushCurrentStep();
  const rawReturns = returnMatch[1];
  console.log(`[PARSER DEBUG] Return line: "${line}"`);
  console.log(`[PARSER DEBUG] Return match[1]: "${rawReturns}"`);
  console.log(`[PARSER DEBUG] Return match[1] char codes: ${Array.from(rawReturns).map(c => c.charCodeAt(0))}`);
  
  workflow.returnValues = rawReturns
    .split(',')
    .map(r => r.trim())
    .filter(r => r !== '');
    
  console.log(`[PARSER DEBUG] Parsed returnValues: ${JSON.stringify(workflow.returnValues)}`);
  continue;
}
    // Fallback: treat as action
    if (line.trim() !== '') {
      if (!currentStep) {
        currentStep = {
          type: 'action',
          stepNumber: workflow.steps.length + 1,
          actionRaw: line,  // ← PRESERVED EXACTLY (no normalizeAction)
          saveAs: null,
          constraints: {}
        };
      } else {
        currentStep.actionRaw += ' ' + line;  // ← PRESERVED EXACTLY (no normalizeAction)
      }
    }
  }

  flushCurrentStep(); // ✅ Final flush

    // ✅ FALLBACK: Scan raw lines for Return if regex missed it (Windows line endings, hidden chars, etc.)
  if (workflow.returnValues.length === 0) {
    for (let j = 0; j < lines.length; j++) {
      const clean = lines[j].replace(/\r/g, '').trim();
      const match = clean.match(/^Return\s+(.+)$/i);
      if (match) {
        console.log(`[PARSER] Recovered Return at line ${j+1}: "${clean}"`);
        workflow.returnValues = match[1]
          .split(',')
          .map(r => r.trim())
          .filter(r => r !== '');
        break;
      }
    }
  }

  // Post-process Save as in actionRaw - ✅ Apply normalization
  workflow.steps.forEach(step => {
    if (step.actionRaw && step.saveAs === null) {
      const saveInAction = step.actionRaw.match(/(.+?)\s+Save as\s+(.+)$/i);
      if (saveInAction) {
        step.actionRaw = saveInAction[1].trim();
        step.saveAs = normalizeSymbol(saveInAction[2].trim());
      }
    }
    // ✅ Also normalize any existing saveAs values
    if (step.saveAs) {
      step.saveAs = normalizeSymbol(step.saveAs);
    }
  });

  // Validation warnings
  if (!workflow.name) {
    workflow.__warnings.push('Workflow name not found');
  }
  if (workflow.steps.length === 0) {
    workflow.__warnings.push('No steps found in workflow');
  }
  if (workflow.returnValues.length === 0 && workflow.steps.length > 0) {
    workflow.__warnings.push('No Return statement found');
  }

  return workflow;
}

// Parses blocks (for parallel, if, escalation levels) - ✅ PRESERVE ALL FUNCTIONALITY
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

    // Step declaration in block - ✅ PRESERVE ACTION EXACTLY (NO NORMALIZATION)
    const stepMatch = line.match(/^Step\s+(\d+)\s*:\s*(.+)$/i);
    if (stepMatch) {
      flush();
      const stepNumber = parseInt(stepMatch[1], 10);
      const stepContent = stepMatch[2].trim();  // ← PRESERVED EXACTLY
      
      current = {
        type: 'action',
        stepNumber: stepNumber,
        actionRaw: stepContent,  // ← CRITICAL: No normalization
        saveAs: null,
        constraints: {}
      };
      continue;
    }

    // Save as - ✅ Apply normalization
    const saveMatch = line.match(/^Save as\s+(.+)$/i);
    if (saveMatch && current) {
      current.saveAs = normalizeSymbol(saveMatch[1].trim());
      continue;
    }

    // Handle all special steps inside blocks
    const debriefMatch = line.match(/^Debrief\s+([^\s]+)\s+with\s+"([^"]*)"$/i);
    if (debriefMatch) {
      flush();
      steps.push({ type: 'debrief', agent: debriefMatch[1].trim(), message: debriefMatch[2] });
      continue;
    }

    const evolveMatch = line.match(/^Evolve\s+([^\s]+)\s+using\s+feedback:\s*"([^"]*)"$/i);
    if (evolveMatch) {
      flush();
      steps.push({ type: 'evolve', targetResolver: evolveMatch[1].trim(), feedback: evolveMatch[2] });
      continue;
    }

    const promptMatch = line.match(/^Prompt user to\s+"([^"]*)"$/i);
    if (promptMatch) {
      flush();
      steps.push({ type: 'prompt', question: promptMatch[1], saveAs: null });
      continue;
    }

    const persistMatch = line.match(/^Persist\s+([^\s]+)\s+to\s+"([^"]*)"$/i);
    if (persistMatch) {
      flush();
      steps.push({ type: 'persist', variable: persistMatch[1].trim(), target: persistMatch[2] });
      continue;
    }

    const emitMatch = line.match(/^Emit\s+"([^"]+)"\s+with\s+(.+)$/i);
    if (emitMatch) {
      flush();
      steps.push({ type: 'emit', event: emitMatch[1], payload: emitMatch[2].trim() });
      continue;
    }

    // ✅ FIXED: Use in block — consistent with top-level Use handler (Bug 1 + Bug 2)
    const useMatch = line.match(/^Use\s+(.+)$/i);
    if (useMatch) {
      flush();
      steps.push({
        type: 'use',
        tool: useMatch[1].trim(),
        saveAs: null,
        constraints: {}
      });
      continue;
    }

    // Ask in block — CANONICALIZE AT PARSE TIME
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

    // Constraint inside block
    const constraintMatch = line.match(/^Constraint:\s*(.+)$/i);
    if (constraintMatch && current) {
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
        current.constraints[key] = value;
      }
      continue;
    }

    // ✅ ADD: Set keyword inside blocks (e.g., Set analysis_result = "")
    const setMatch = line.match(/^Set\s+(\w+)\s*=\s*(.+)$/i);
    if (setMatch) {
      flush(); // Flush any pending step
      steps.push({
        type: 'calculate',
        actionRaw: setMatch[2].trim(),  // e.g., '""' or '"N/A"'
        saveAs: setMatch[1].trim(),     // e.g., 'analysis_result'
        constraints: {}
      });
      continue;
    }

    // ✅ ADD: Return keyword inside blocks (rare but supported)
    const returnMatch = line.match(/^Return\s+(.+)$/i);
    if (returnMatch) {
      flush();
      // Note: Return inside blocks is unusual; this just parses it
      continue;
    }

    // Fallback
    if (current) {
      current.actionRaw += ' ' + line;  // ← PRESERVED EXACTLY (no normalizeAction)
    }
  }

  flush(); // ✅ Final flush in block

  // ✅ Post-process Save as for steps inside blocks - Apply normalization
  steps.forEach(step => {
    if (step.actionRaw && step.saveAs === null) {
      const saveInAction = step.actionRaw.match(/(.+?)\s+Save as\s+(.+)$/i);
      if (saveInAction) {
        step.actionRaw = saveInAction[1].trim();
        step.saveAs = normalizeSymbol(saveInAction[2].trim());
      }
    }
    // ✅ Also normalize any existing saveAs values
    if (step.saveAs) {
      step.saveAs = normalizeSymbol(step.saveAs);
    }
  });

  return steps;
}

function validate(workflow) {
  const errors = [];
  if (workflow.maxGenerations !== null && workflow.maxGenerations <= 0) {
    errors.push('max_generations must be positive');
  }
  return errors;
}

module.exports = { parse, parseFromFile, parseLines, validate };