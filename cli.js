#!/usr/bin/env node
const { Command } = require('commander');
const { parse } = require('./src/parser');
const { execute } = require('./src/runtime');
const fs = require('fs');
const path = require('path');

/**
 * Enforce .ol extension ONLY
 */
function ensureOlExtension(filename) {
  if (!filename.endsWith('.ol')) {
    throw new Error(
      `Invalid file: "${filename}".\n` +
      `O-Lang workflows must use the ".ol" extension.`
    );
  }
}

/**
 * Default mock resolver (for demo use)
 */
async function defaultMockResolver(action, context) {
  if (action.startsWith('Search for ')) {
    return {
      title: "HR Policy 2025",
      text: "Employees are entitled to 20 days of paid leave per year. All requests must be submitted via the HR portal.",
      url: "mock://hr-policy"
    };
  }

  if (action.startsWith('Ask ')) {
    return "✅ [Mock] Summarized for demonstration.";
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

/**
 * Built-in Math Resolver
 * Supports minimal math operations for workflows
 */
async function builtInMathResolver(action, context) {
  // Replace variables in context
  action = action.replace(/\{([^\}]+)\}/g, (_, key) => {
    const val = context[key.trim()];
    return val !== undefined ? val : `{${key}}`;
  });

  let match;

  match = action.match(/^add\(([^,]+),\s*([^)]+)\)$/);
  if (match) return parseFloat(match[1]) + parseFloat(match[2]);

  match = action.match(/^subtract\(([^,]+),\s*([^)]+)\)$/);
  if (match) return parseFloat(match[1]) - parseFloat(match[2]);

  match = action.match(/^multiply\(([^,]+),\s*([^)]+)\)$/);
  if (match) return parseFloat(match[1]) * parseFloat(match[2]);

  match = action.match(/^divide\(([^,]+),\s*([^)]+)\)$/);
  if (match) return parseFloat(match[1]) / parseFloat(match[2]);

  return null; // not handled
}

/**
 * Resolver chaining mechanism
 */
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
      throw new Error(
        `Failed to load resolver '${specifier}':\n  npm: ${e1.message}\n  file: ${e2.message}`
      );
    }
  }
}

/**
 * Updated resolver chain
 * Built-in math resolver is added first, then user resolvers, then default mock
 */
function loadResolverChain(specifiers) {
  const userResolvers = specifiers?.map(loadSingleResolver) || [];
  const resolvers = [builtInMathResolver, ...userResolvers, defaultMockResolver];

  if (!specifiers || specifiers.length === 0) {
    console.log('ℹ️ No resolver provided. Using built-in math + default mock resolver.');
  } else {
    console.log(`📦 Loaded user resolvers: ${specifiers.join(', ')}`);
  }

  return createResolverChain(resolvers);
}

/**
 * CLI Setup
 */
const program = new Command();

program
  .name('olang')
  .description('O-Lang CLI: run .ol workflows with rule-enforced agent governance')
  .command('run <file>')
  .option(
    '-r, --resolver <specifier>',
    'Resolver (npm package or local path). Can be used multiple times.\nExample:\n  -r @o-lang/llm-groq\n  -r @o-lang/notify-telegram',
    (val, acc) => { acc.push(val); return acc; },
    []
  )
  .option(
    '-i, --input <k=v>',
    'Input parameters',
    (val, acc = {}) => {
      const [k, v] = val.split('=');
      acc[k] = isNaN(v) ? v : parseFloat(v);
      return acc;
    },
    {}
  )
  .action(async (file, options) => {
    try {
      ensureOlExtension(file);

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
