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
    return " ✅  [Mock] Summarized for demonstration.";
  }
  if (action.startsWith('Notify ')) {
    const recipient = action.match(/Notify (\S+)/)?.[1] || 'user@example.com';
    return ` 📬  Notification sent to ${recipient}`;
  }
  if (action.startsWith('Debrief ') || action.startsWith('Evolve ')) {
    console.log(`[O-Lang] ${action}`);
    return 'Acknowledged';
  }
  return `[Unhandled: ${action}]`;
}
defaultMockResolver.resolverName = 'defaultMockResolver';

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
builtInMathResolver.resolverName = 'builtInMathResolver';

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
        console.error(` ❌  Resolver ${i} failed for action "${action}":`, e.message);
      }
    }
    if (verbose) console.log(`[Resolver Chain] action="${action}" lastResult=`, lastResult);
    return lastResult;
  };
  wrapped._chain = chain;
  return wrapped;
}

/**
 * Load a single resolver — NO fallback to defaultMockResolver
 */
function loadSingleResolver(specifier) {
  if (!specifier) {
    throw new Error('Empty resolver specifier provided');
  }

  let resolver, pkgName;

  // Extract clean package name (e.g., @o-lang/extractor → extractor)
  if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
    // Local file: use filename without extension
    pkgName = path.basename(specifier, path.extname(specifier));
  } else {
    // npm package: strip scope (e.g., @o-lang/extractor → extractor)
    pkgName = specifier.replace(/^@[^/]+\//, '');
  }

  try {
    resolver = require(specifier);
  } catch (e1) {
    try {
      const absolutePath = path.resolve(process.cwd(), specifier);
      resolver = require(absolutePath);
      console.log(` 📁  Loaded resolver: ${absolutePath}`);
    } catch (e2) {
      throw new Error(
        `Failed to load resolver '${specifier}':\n  npm: ${e1.message}\n  file: ${e2.message}`
      );
    }
  }

  if (typeof resolver !== 'function') {
    throw new Error(`Resolver must export a function`);
  }

  // ✅ Auto-assign resolverName from package/filename if missing
  if (!resolver.resolverName || typeof resolver.resolverName !== 'string') {
    resolver.resolverName = pkgName;
    console.log(` 🏷️  Auto-assigned resolverName: "${pkgName}" (from ${specifier})`);
  } else {
    console.log(` 📦  Loaded resolver: ${specifier} (name: ${resolver.resolverName})`);
  }

  return resolver;
}

/**
 * ✅ POLICY-AWARE resolver loader: only includes resolvers in allowedResolvers
 */
function loadResolverChain(specifiers, verbose = false, allowedResolvers = new Set()) {
  const userResolvers = specifiers?.map(loadSingleResolver) || [];
  const resolvers = [];

  // Only add builtInMathResolver if allowed
  if (allowedResolvers.has('builtInMathResolver')) {
    resolvers.push(builtInMathResolver);
  }

  // Add user resolvers only if their name is allowed
  for (const r of userResolvers) {
    const name = r.resolverName || r.name || 'unknown';
    if (allowedResolvers.has(name)) {
      resolvers.push(r);
    } else if (verbose) {
      console.warn(` ⚠️  Skipping disallowed user resolver: ${name}`);
    }
  }

  // Only add defaultMockResolver if explicitly allowed
  if (allowedResolvers.has('defaultMockResolver')) {
    resolvers.push(defaultMockResolver);
  }

  if (resolvers.length === 0) {
    if (verbose) {
      console.warn(' ⚠️  No allowed resolvers loaded. Actions may fail.');
    }
  } else {
    if (verbose) {
      console.log(` ℹ️  Loaded allowed resolvers: ${resolvers.map(r => r.resolverName || 'anonymous').join(', ')}`);
    }
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
      const workflow = parse(content, file);
      if (!workflow || typeof workflow !== 'object') {
        console.error(' ❌  Error: Parsed workflow is invalid or empty');
        process.exit(1);
      }
      if (options.verbose) {
        console.log(' 📄  Parsed Workflow:', JSON.stringify(workflow, null, 2));
      }

      const allowedSet = new Set(workflow.allowedResolvers.map(r => r.trim()));
      const resolver = loadResolverChain(options.resolver, options.verbose, allowedSet);

      // 🔔 Warn if allowed resolvers declared but none loaded
      if (workflow.allowedResolvers.length > 0 && resolver._chain.length === 0) {
        console.warn(
          `\n⚠️  Warning: Workflow allows [${workflow.allowedResolvers.join(', ')}],\n` +
          `   but no matching resolvers were loaded. Use -r <path> to provide them.\n`
        );
      }

      const result = await execute(workflow, options.input, resolver, options.verbose);
      console.log('\n=== Workflow Result ===');
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(' ❌  Error:', err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);