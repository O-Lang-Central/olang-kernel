#!/usr/bin/env node
const { Command } = require('commander');
const { parse } = require('./src/parser');
const { execute } = require('./src/runtime');
const fs = require('fs');
const path = require('path');

async function defaultMockResolver(action, context) {
  if (action.startsWith('Search for ')) {
    return {
      title: "HR Policy 2025",
      text: "Employees are entitled to 20 days of paid leave per year. All requests must be submitted via the HR portal.",
      url: "mock://hr-policy"
    };
  }
  if (action.startsWith('Ask ')) {
    return "✅ [Mock] Summarized for staff.";
  }
  if (action.startsWith('Notify ')) {
    const recipient = action.match(/Notify (\S+)/)?.[1] || 'user@example.com';
    return `📬 Notification sent to ${recipient}`;
  }
  if (action.startsWith('Debrief ') || action.startsWith('Evolve ')) {
    console.log(`[O-Lang] ${action}`);
    return 'Acknowledged';
  }
  return `[Unhandled: ${action}]`;
}

function createResolverChain(resolvers) {
  return async (action, context) => {
    for (const resolver of resolvers) {
      try {
        const result = await resolver(action, context);
        if (result !== null && result !== undefined) {
          return result;
        }
      } catch (err) {
        console.error(`❌ Resolver error for action "${action}":`, err.message);
        throw err;
      }
    }
    return `[Unhandled: ${action}]`;
  };
}

function loadSingleResolver(specifier) {
  if (!specifier) return defaultMockResolver;

  try {
    const resolver = require(specifier);
    if (typeof resolver !== 'function') {
      throw new Error(`Resolver must export a function`);
    }
    console.log(`📦 Loaded resolver: ${specifier}`);
    return resolver;
  } catch (e1) {
    try {
      const absolutePath = path.resolve(process.cwd(), specifier);
      const resolver = require(absolutePath);
      console.log(`📁 Loaded resolver: ${absolutePath}`);
      return resolver;
    } catch (e2) {
      throw new Error(`Failed to load resolver '${specifier}':\n  npm: ${e1.message}\n  file: ${e2.message}`);
    }
  }
}

function loadResolverChain(specifiers) {
  if (!specifiers || specifiers.length === 0) {
    console.log('ℹ️ No resolver provided. Using default mock resolver.');
    return defaultMockResolver;
  }

  const resolvers = specifiers.map(loadSingleResolver);
  return createResolverChain(resolvers);
}

const program = new Command();

program
  .name('olang')
  .description('O-Lang CLI: run .olang workflows')
  .command('run <file>')
  .option('-r, --resolver <specifier>', 'Resolver (npm package or local path). Can be used multiple times.\nExample:\n  -r @o-lang/llm-groq\n  -r @o-lang/notify-telegram', (val, acc) => {
    acc.push(val);
    return acc;
  }, [])
  .option('-i, --input <k=v>', 'Input parameters', (val, acc = {}) => {
    const [k, v] = val.split('=');
    acc[k] = v;
    return acc;
  }, {})
  .action(async (file, options) => {
    try {
      const content = fs.readFileSync(file, 'utf8');
      const workflow = parse(content);
      const resolver = loadResolverChain(options.resolver);
      const result = await execute(workflow, options.input, resolver);
      console.log('\n=== Workflow Result ===');
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error('❌ Error:', err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);









// #!/usr/bin/env node
// const { Command } = require('commander');
// const { parse } = require('./src/parser');
// const { execute } = require('./src/runtime');
// const fs = require('fs');
// const path = require('path');

// // Default mock resolver (for demos)
// async function defaultMockResolver(action, context) {
//   if (action.startsWith('Search for ')) {
//     return {
//       title: "HR Policy 2025",
//       text: "Employees are entitled to 20 days of paid leave per year. All requests must be submitted via the HR portal.",
//       url: "mock://hr-policy"
//     };
//   }
//   if (action.startsWith('Ask ')) {
//     return "✅ [Mock] Summarized for staff.";
//   }
//   if (action.startsWith('Notify ')) {
//     const recipient = action.match(/Notify (\S+)/)?.[1] || 'user@example.com';
//     return `📬 Notification sent to ${recipient}`;
//   }
//   if (action.startsWith('Debrief ') || action.startsWith('Evolve ')) {
//     console.log(`[O-Lang] ${action}`);
//     return 'Acknowledged';
//   }
//   return `[Unhandled: ${action}]`;
// }

// function loadResolver(resolverPath) {
//   if (!resolverPath) {
//     console.log('ℹ️ No resolver provided. Using default mock resolver.');
//     return defaultMockResolver;
//   }

//   try {
//     // Resolve relative to current working directory
//     const absolutePath = path.resolve(process.cwd(), resolverPath);
//     return require(absolutePath);
//   } catch (err) {
//     console.error(`❌ Failed to load resolver from: ${resolverPath}`);
//     console.error(`Error: ${err.message}`);
//     process.exit(1);
//   }
// }

// const program = new Command();

// program
//   .name('olang')
//   .description('O-Lang CLI: run .olang workflows')
//   .command('run <file>')
//   .option('-r, --resolver <path>', 'Path to agent resolver (e.g., ./examples/groq-slack-resolver.js)')
//   .option('-i, --input <k=v>', 'Input parameters', (val, acc = {}) => {
//     const [k, v] = val.split('=');
//     acc[k] = v;
//     return acc;
//   }, {})
//   .action(async (file, options) => {
//     try {
//       const content = fs.readFileSync(file, 'utf8');
//       const workflow = parse(content);
//       const resolver = loadResolver(options.resolver);
//       const result = await execute(workflow, options.input, resolver);
//       console.log('\n=== Workflow Result ===');
//       console.log(JSON.stringify(result, null, 2));
//     } catch (err) {
//       console.error('❌ Error:', err.message);
//       process.exit(1);
//     }
//   });

// program.parse(process.argv);