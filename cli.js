#!/usr/bin/env node
const { Command } = require('commander');
const { parse } = require('../src/parser'); // adjusted path if bin vs root
const { execute } = require('../src/runtime');
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
  if (!action || typeof action !== 'string') return `[Unhandled: ${String(action)}]`;

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
 * Built-in Math Resolver (so action style math strings are handled too)
 * Supports action strings like: add(1,2), subtract(5,2), multiply(2,3), divide(6,3), sum([1,2,3])
 * Note: runtime handles calculate steps; this resolver helps when parser emits actions with math strings.
 */
async function builtInMathResolver(action, context) {
  if (!action || typeof action !== 'string') return null;

  // Replace contextual placeholders {var}
  const a = action.replace(/\{([^\}]+)\}/g, (_, k) => {
    const v = context[k.trim()];
    return v !== undefined ? v : `{${k}}`;
  });

  // simple function matches
  let m;
  m = a.match(/^add\(([^,]+),\s*([^)]+)\)$/i);
  if (m) return parseFloat(m[1]) + parseFloat(m[2]);

  m = a.match(/^subtract\(([^,]+),\s*([^)]+)\)$/i);
  if (m) return parseFloat(m[1]) - parseFloat(m[2]);

  m = a.match(/^multiply\(([^,]+),\s*([^)]+)\)$/i);
  if (m) return parseFloat(m[1]) * parseFloat(m[2]);

  m = a.match(/^divide\(([^,]+),\s*([^)]+)\)$/i);
  if (m) return parseFloat(m[1]) / parseFloat(m[2]);

  m = a.match(/^sum\(\s*\[([^\]]+)\]\s*\)$/i);
  if (m) {
    const arr = m[1].split(',').map(s => parseFloat(s.trim()));
    return arr.reduce((s, v) => s + v, 0);
  }

  // not a math action
  return null;
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
 * loadResolverChain: include built-in math resolver first, then user resolvers, then default mock resolver
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
      // try to parse numbers, preserve strings otherwise
      const parsed = v === undefined ? '' : (v === 'true' ? true : (v === 'false' ? false : (isNaN(v) ? v : parseFloat(v))));
      acc[k] = parsed;
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
