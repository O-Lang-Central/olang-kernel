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
 * Built-in Math Resolver
 */
async function builtInMathResolver(action, context) {
  if (!action || typeof action !== 'string') return null;

  const a = action.replace(/\{([^\}]+)\}/g, (_, k) => {
    const v = context[k.trim()];
    return v !== undefined ? v : `{${k}}`;
  });

  let m;
  m = a.match(/^add\(([^,]+),\s*([^)]+)\)$/i); if (m) return parseFloat(m[1]) + parseFloat(m[2]);
  m = a.match(/^subtract\(([^,]+),\s*([^)]+)\)$/i); if (m) return parseFloat(m[1]) - parseFloat(m[2]);
  m = a.match(/^multiply\(([^,]+),\s*([^)]+)\)$/i); if (m) return parseFloat(m[1]) * parseFloat(m[2]);
  m = a.match(/^divide\(([^,]+),\s*([^)]+)\)$/i); if (m) return parseFloat(m[1]) / parseFloat(m[2]);
  m = a.match(/^sum\(\s*\[([^\]]+)\]\s*\)$/i); if (m) return m[1].split(',').map(s => parseFloat(s.trim())).reduce((s, v) => s + v, 0);

  return null;
}

/**
 * Resolver chaining with verbose + context logging
 */
function createResolverChain(resolvers, verbose = false) {
  const chain = resolvers.slice();
  const wrapped = async (action, context) => {
    let lastResult;
    for (let i = 0; i < chain.length; i++) {
      try {
        const res = await chain[i](action, context);
        context[`__resolver_${i}`] = res;
        lastResult = res;
      } catch (e) {
        console.error(`❌ Resolver ${i} failed for action "${action}":`, e.message);
      }
    }
    if (verbose) console.log(`[Resolver Chain] action="${action}" lastResult=`, lastResult);
    return lastResult;
  };
  wrapped._chain = chain;
  return wrapped;
}

function loadSingleResolver(specifier) {
  if (!specifier) return defaultMockResolver;

  try {
    const resolver = require(specifier);
    if (typeof resolver !== 'function') throw new Error(`Resolver must export a function`);
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
function loadResolverChain(specifiers, verbose = false) {
  const userResolvers = specifiers?.map(loadSingleResolver) || [];
  const resolvers = [builtInMathResolver, ...userResolvers, defaultMockResolver];

  if (!specifiers || specifiers.length === 0) {
    console.log('ℹ️ No resolver provided. Using built-in math + default mock resolver.');
  } else {
    console.log(`📦 Loaded user resolvers: ${specifiers.join(', ')}`);
  }

  return createResolverChain(resolvers, verbose);
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
    'Resolver (npm package or local path). Can be used multiple times.',
    (val, acc) => { acc.push(val); return acc; },
    []
  )
  .option(
    '-i, --input <k=v>',
    'Input parameters',
    (val, acc = {}) => {
      const [k, v] = val.split('=');
      const parsed = v === undefined ? '' : (v === 'true' ? true : (v === 'false' ? false : (isNaN(v) ? v : parseFloat(v))));
      acc[k] = parsed;
      return acc;
    },
    {}
  )
  .option('-v, --verbose', 'Verbose mode: logs resolver outputs and context after each step')
  .action(async (file, options) => {
    try {
      ensureOlExtension(file);

      const content = fs.readFileSync(file, 'utf8');
      const workflow = parse(content);

      const resolver = loadResolverChain(options.resolver, options.verbose);
      const result = await execute(workflow, options.input, resolver, options.verbose);

      console.log('\n=== Workflow Result ===');
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error('❌ Error:', err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
