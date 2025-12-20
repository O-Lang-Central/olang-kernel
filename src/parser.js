const fs = require('fs');

function parse(content, filename = '<unknown>') {
  if (typeof content === 'string') {
    const lines = content.split('\n').map(line => line.replace(/\r$/, ''));
    return parseLines(lines, filename);
  } else if (typeof content === 'object' && content !== null) {
    // Already parsed
    return content;
  } else {
    throw new Error('parse() expects string content or pre-parsed object');
  }
}

function parseFromFile(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  return parse(content, filepath);
}

function parseLines(lines, filename) {
  // Remove evolution file parsing - evolution is now in-workflow
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
    maxGenerations: null, // ✅ Updated field name for Constraint: max_generations = X
    __warnings: [],
    filename: filename
  };
  
  let i = 0;
  let currentStep = null;
  let inAllowResolvers = false;
  let inIfBlock = false;
  let ifCondition = null;
  let ifBody = [];
  
  while (i < lines.length) {
    let line = lines[i++].trim();
    
    // Skip empty lines and comments
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    
    // Parse Workflow declaration
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
    
    // Parse Constraint: max_generations = X (✅ Updated syntax)
    if (line.startsWith('Constraint: max_generations = ')) {
      const match = line.match(/^Constraint:\s+max_generations\s*=\s*(\d+)$/i);
      if (match) {
        workflow.maxGenerations = parseInt(match[1], 10);
      } else {
        workflow.__warnings.push(`Invalid Constraint syntax: ${line}`);
      }
      continue;
    }
    
    // Parse Allow resolvers section
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
        // Continue
      } else {
        // End of Allow resolvers section
        inAllowResolvers = false;
        i--; // Re-process this line
        continue;
      }
      continue;
    }
    
    // Parse Step declarations
    const stepMatch = line.match(/^Step\s+(\d+)\s*:\s*(.+)$/i);
    if (stepMatch) {
      // Save previous step if it exists
      if (currentStep) {
        workflow.steps.push(currentStep);
        currentStep = null;
      }
      
      const stepNumber = parseInt(stepMatch[1], 10);
      const stepContent = stepMatch[2];
      
      currentStep = {
        type: 'action',
        stepNumber: stepNumber,
        actionRaw: stepContent,
        saveAs: null,
        constraints: {}
      };
      continue;
    }
    
    // Parse Evolve steps (✅ NEW IN-WORKFLOW EVOLUTION)
    const evolveMatch = line.match(/^Evolve\s+([^\s]+)\s+using\s+feedback:\s*"([^"]*)"$/i);
    if (evolveMatch) {
      if (currentStep) {
        workflow.steps.push(currentStep);
        currentStep = null;
      }
      
      currentStep = {
        type: 'evolve',
        stepNumber: workflow.steps.length + 1,
        targetResolver: evolveMatch[1].trim(),
        feedback: evolveMatch[2],
        saveAs: null,
        constraints: {}
      };
      continue;
    }
    
    // Parse Save as
    const saveMatch = line.match(/^Save as\s+(.+)$/i);
    if (saveMatch && currentStep) {
      currentStep.saveAs = saveMatch[1].trim();
      continue;
    }
    
    // Parse If/When conditions
    const ifMatch = line.match(/^(?:If|When)\s+(.+)$/i);
    if (ifMatch) {
      ifCondition = ifMatch[1].trim();
      inIfBlock = true;
      ifBody = [];
      continue;
    }
    
    const endIfMatch = line.match(/^End(?:If)?$/i);
    if (endIfMatch && inIfBlock) {
      if (currentStep) {
        workflow.steps.push(currentStep);
        currentStep = null;
      }
      
      workflow.steps.push({
        type: 'if',
        condition: ifCondition,
        body: ifBody,
        stepNumber: workflow.steps.length + 1
      });
      
      inIfBlock = false;
      ifCondition = null;
      ifBody = [];
      continue;
    }
    
    // Handle lines inside If block
    if (inIfBlock) {
      ifBody.push(line);
      continue;
    }
    
    // Parse Return statement
    const returnMatch = line.match(/^Return\s+(.+)$/i);
    if (returnMatch) {
      if (currentStep) {
        workflow.steps.push(currentStep);
        currentStep = null;
      }
      workflow.returnValues = returnMatch[1].split(',').map(r => r.trim()).filter(r => r !== '');
      continue;
    }
    
    // If we reach here and have unprocessed content, it's likely a workflow line without "Step X:"
    // Try to handle it as a step
    if (line.trim() !== '') {
      if (!currentStep) {
        currentStep = {
          type: 'action',
          stepNumber: workflow.steps.length + 1,
          actionRaw: line,
          saveAs: null,
          constraints: {}
        };
      } else {
        // Append to current step action (multi-line)
        currentStep.actionRaw += ' ' + line;
      }
    }
  }
  
  // Don't forget the last step
  if (currentStep) {
    workflow.steps.push(currentStep);
  }
  
  // Post-process steps to extract Save as from actionRaw
  workflow.steps.forEach(step => {
    if (step.actionRaw && step.saveAs === null) {
      const saveInAction = step.actionRaw.match(/(.+?)\s+Save as\s+(.+)$/i);
      if (saveInAction) {
        step.actionRaw = saveInAction[1].trim();
        step.saveAs = saveInAction[2].trim();
      }
    }
  });
  
  // Check for common issues
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

function validate(workflow) {
  const errors = [];
  
  if (workflow.maxGenerations !== null && workflow.maxGenerations <= 0) {
    errors.push('max_generations must be positive');
  }
  
  return errors;
}

module.exports = { parse, parseFromFile, parseLines, validate };