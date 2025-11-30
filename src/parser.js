// src/parser.js
function parse(code) {
  const lines = code
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('//'));

  const workflow = {
    name: 'Unnamed Workflow',
    parameters: [],
    steps: [],
    returnValues: []
  };

  let i = 0;
  while (i < lines.length) {
    let line = lines[i];

    // Workflow
    const wfMatch = line.match(/^Workflow\s+"([^"]+)"(?:\s+with\s+(.+))?/i);
    if (wfMatch) {
      workflow.name = wfMatch[1];
      workflow.parameters = wfMatch[2] ? wfMatch[2].split(',').map(p => p.trim()) : [];
      i++;
      continue;
    }

    // Step
    const stepMatch = line.match(/^Step\s+(\d+)\s*:\s*(.+)$/i);
    if (stepMatch) {
      workflow.steps.push({
        type: 'action',
        stepNumber: parseInt(stepMatch[1], 10),
        actionRaw: stepMatch[2].trim(),
        saveAs: null,
        constraints: {} // Initialize constraints
      });
      i++;
      continue;
    }

    // Save as
    const saveMatch = line.match(/^Save as\s+(.+)$/i);
    if (saveMatch && workflow.steps.length > 0) {
      workflow.steps[workflow.steps.length - 1].saveAs = saveMatch[1].trim();
      i++;
      continue;
    }

    // Constraint (NEW: parse key = value lines and attach to last step)
    const constraintMatch = line.match(/^Constraint:\s*(.+)$/i);
    if (constraintMatch && workflow.steps.length > 0) {
      const lastStep = workflow.steps[workflow.steps.length - 1];
      if (!lastStep.constraints) lastStep.constraints = {};

      const constraintLine = constraintMatch[1].trim();
      const eq = constraintLine.match(/^([^=]+)=\s*(.+)$/);
      if (eq) {
        let key = eq[1].trim();
        let value = eq[2].trim();

        // Parse list: [a, b, c]
        if (value.startsWith('[') && value.endsWith(']')) {
          value = value.slice(1, -1).split(',').map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
        }
        // Parse number
        else if (!isNaN(value)) {
          value = Number(value);
        }
        // Keep string (remove quotes if present)
        else if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }

        lastStep.constraints[key] = value;
      }
      i++;
      continue;
    }

    // If
    const ifMatch = line.match(/^If\s+(.+)\s+then$/i);
    if (ifMatch) {
      const condition = ifMatch[1].trim();
      const body = [];
      i++;
      while (i < lines.length && !/^\s*End If\s*$/i.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip 'End If'
      workflow.steps.push({ type: 'if', condition, body: parseBlock(body) });
      continue;
    }

    // Parallel
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

    // Connect
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

    // Agent ... uses ...
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

    // Debrief
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

    // Evolve
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

    // Prompt
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

    // Persist
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

    // Emit
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

    // Return
    const returnMatch = line.match(/^Return\s+(.+)$/i);
    if (returnMatch) {
      workflow.returnValues = returnMatch[1].split(',').map(v => v.trim());
      i++;
      continue;
    }

    i++;
  }

  return workflow;
}

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
  }
  return steps;
}

module.exports = { parse };







// // src/parser.js
// function parse(code) {
//   const lines = code
//     .split(/\r?\n/)
//     .map(l => l.trim())
//     .filter(l => l && !l.startsWith('#') && !l.startsWith('//'));

//   const workflow = {
//     name: 'Unnamed Workflow',
//     parameters: [],
//     steps: [],
//     returnValues: []
//   };

//   let i = 0;
//   while (i < lines.length) {
//     let line = lines[i];

//     // Workflow
//     const wfMatch = line.match(/^Workflow\s+"([^"]+)"(?:\s+with\s+(.+))?/i);
//     if (wfMatch) {
//       workflow.name = wfMatch[1];
//       workflow.parameters = wfMatch[2] ? wfMatch[2].split(',').map(p => p.trim()) : [];
//       i++;
//       continue;
//     }

//     // Step
//     const stepMatch = line.match(/^Step\s+(\d+)\s*:\s*(.+)$/i);
//     if (stepMatch) {
//       workflow.steps.push({
//         type: 'action',
//         stepNumber: parseInt(stepMatch[1], 10),
//         actionRaw: stepMatch[2].trim(),
//         saveAs: null
//       });
//       i++;
//       continue;
//     }

//     // Save as
//     const saveMatch = line.match(/^Save as\s+(.+)$/i);
//     if (saveMatch && workflow.steps.length > 0) {
//       workflow.steps[workflow.steps.length - 1].saveAs = saveMatch[1].trim();
//       i++;
//       continue;
//     }

//     // If
//     const ifMatch = line.match(/^If\s+(.+)\s+then$/i);
//     if (ifMatch) {
//       const condition = ifMatch[1].trim();
//       const body = [];
//       i++;
//       while (i < lines.length && !/^\s*End If\s*$/i.test(lines[i])) {
//         body.push(lines[i]);
//         i++;
//       }
//       if (i < lines.length) i++; // skip 'End If'
//       workflow.steps.push({ type: 'if', condition, body: parseBlock(body) });
//       continue;
//     }

//     // Parallel
//     const parMatch = line.match(/^Run in parallel$/i);
//     if (parMatch) {
//       const steps = [];
//       i++;
//       while (i < lines.length && !/^\s*End\s*$/i.test(lines[i])) {
//         steps.push(lines[i]);
//         i++;
//       }
//       if (i < lines.length) i++;
//       workflow.steps.push({ type: 'parallel', steps: parseBlock(steps) });
//       continue;
//     }

//     // Connect
//     const connMatch = line.match(/^Connect\s+"([^"]+)"\s+using\s+"([^"]+)"$/i);
//     if (connMatch) {
//       workflow.steps.push({
//         type: 'connect',
//         resource: connMatch[1],
//         endpoint: connMatch[2]
//       });
//       i++;
//       continue;
//     }

//     // Agent ... uses ...
//     const agentUseMatch = line.match(/^Agent\s+"([^"]+)"\s+uses\s+"([^"]+)"$/i);
//     if (agentUseMatch) {
//       workflow.steps.push({
//         type: 'agent_use',
//         logicalName: agentUseMatch[1],
//         resource: agentUseMatch[2]
//       });
//       i++;
//       continue;
//     }

//     // Debrief
//     const debriefMatch = line.match(/^Debrief\s+(\w+)\s+with\s+"(.+)"$/i);
//     if (debriefMatch) {
//       workflow.steps.push({
//         type: 'debrief',
//         agent: debriefMatch[1],
//         message: debriefMatch[2]
//       });
//       i++;
//       continue;
//     }

//     // Evolve
//     const evolveMatch = line.match(/^Evolve\s+(\w+)\s+using\s+feedback:\s+"(.+)"$/i);
//     if (evolveMatch) {
//       workflow.steps.push({
//         type: 'evolve',
//         agent: evolveMatch[1],
//         feedback: evolveMatch[2]
//       });
//       i++;
//       continue;
//     }

//     // Prompt
//     const promptMatch = line.match(/^Prompt user to\s+"(.+)"$/i);
//     if (promptMatch) {
//       workflow.steps.push({
//         type: 'prompt',
//         question: promptMatch[1],
//         saveAs: null
//       });
//       i++;
//       continue;
//     }

//     // Persist
//     const persistMatch = line.match(/^Persist\s+(.+)\s+to\s+"(.+)"$/i);
//     if (persistMatch) {
//       workflow.steps.push({
//         type: 'persist',
//         variable: persistMatch[1].trim(),
//         target: persistMatch[2]
//       });
//       i++;
//       continue;
//     }

//     // Emit
//     const emitMatch = line.match(/^Emit\s+"(.+)"\s+with\s+(.+)$/i);
//     if (emitMatch) {
//       workflow.steps.push({
//         type: 'emit',
//         event: emitMatch[1],
//         payload: emitMatch[2].trim()
//       });
//       i++;
//       continue;
//     }

//     // Return
//     const returnMatch = line.match(/^Return\s+(.+)$/i);
//     if (returnMatch) {
//       workflow.returnValues = returnMatch[1].split(',').map(v => v.trim());
//       i++;
//       continue;
//     }

//     i++;
//   }

//   return workflow;
// }

// function parseBlock(lines) {
//   const steps = [];
//   let current = null;
//   for (const line of lines) {
//     const stepMatch = line.match(/^Step\s+(\d+)\s*:\s*(.+)$/i);
//     if (stepMatch) {
//       current = {
//         type: 'action',
//         stepNumber: parseInt(stepMatch[1], 10),
//         actionRaw: stepMatch[2].trim(),
//         saveAs: null
//       };
//       steps.push(current);
//       continue;
//     }
//     const saveMatch = line.match(/^Save as\s+(.+)$/i);
//     if (saveMatch && current) {
//       current.saveAs = saveMatch[1].trim();
//     }
//     const debriefMatch = line.match(/^Debrief\s+(\w+)\s+with\s+"(.+)"$/i);
//     if (debriefMatch) {
//       steps.push({ type: 'debrief', agent: debriefMatch[1], message: debriefMatch[2] });
//     }
//     const evolveMatch = line.match(/^Evolve\s+(\w+)\s+using\s+feedback:\s+"(.+)"$/i);
//     if (evolveMatch) {
//       steps.push({ type: 'evolve', agent: evolveMatch[1], feedback: evolveMatch[2] });
//     }
//     const promptMatch = line.match(/^Prompt user to\s+"(.+)"$/i);
//     if (promptMatch) {
//       steps.push({ type: 'prompt', question: promptMatch[1], saveAs: null });
//     }
//   }
//   return steps;
// }

// module.exports = { parse };