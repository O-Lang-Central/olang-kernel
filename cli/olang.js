#!/usr/bin/env node

const { Command } = require('commander');
const { parse } = require('../src/parser');
const { execute } = require('../src/runtime');
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

// === Load kernel package.json for version ===
const pkg = require('../package.json');

/**
 * Enforce .ol extension ONLY (CLI only)
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
 * Default mock resolver (for demo / fallback)
 */
async function defaultMockResolver(action) {
  if (!action || typeof action !== 'string') return undefined;

  if (action.startsWith('Search for ')) {
    return {
      title: 'HR Policy 2025',
      text: 'Employees are entitled to 20 days of paid leave per year.',
      url: 'mock://hr-policy'
    };
  }

  if (action.startsWith('Ask ')) {
    return '✅ [Mock] Summarized for demonstration.';
  }

  if (action.startsWith('Notify ')) {
    const recipient = action.match(/Notify (\S+)/)?.[1] || 'user@example.com';
    return `📬 Notification sent to ${recipient}`;
  }

  if (action.startsWith('Debrief ') || action.startsWith('Evolve ')) {
    console.log(`[O-Lang] ${action}`);
    return 'Acknowledged';
  }

  return undefined;
}
defaultMockResolver.resolverName = 'defaultMockResolver';

/**
 * Built-in Math Resolver
 */
async function builtInMathResolver(action, context) {
  if (!action || typeof action !== 'string') return undefined;

  const a = action.replace(/\{([^\}]+)\}/g, (_, k) =>
    context[k.trim()] ?? `{${k}}`
  );

  let m;
  if ((m = a.match(/^add\(([^,]+),\s*([^)]+)\)$/i))) return +m[1] + +m[2];
  if ((m = a.match(/^subtract\(([^,]+),\s*([^)]+)\)$/i))) return +m[1] - +m[2];
  if ((m = a.match(/^multiply\(([^,]+),\s*([^)]+)\)$/i))) return +m[1] * +m[2];
  if ((m = a.match(/^divide\(([^,]+),\s*([^)]+)\)$/i))) return +m[1] / +m[2];
  if ((m = a.match(/^sum\(\s*\[([^\]]+)\]\s*\)$/i))) {
    return m[1].split(',').map(Number).reduce((a, b) => a + b, 0);
  }

  return undefined;
}
builtInMathResolver.resolverName = 'builtInMathResolver';

/**
 * Create resolver chain
 */
function createResolverChain(resolvers, verbose = false) {
  const wrapped = async (action, context) => {
    for (const resolver of resolvers) {
      try {
        const result = await resolver(action, context);
        if (result !== undefined) {
          if (verbose) {
            console.log(`✅ ${resolver.resolverName} handled "${action}"`);
          }
          return result;
        }
      } catch (err) {
        console.error(`❌ Resolver ${resolver.resolverName} failed:`, err.message);
      }
    }
    if (verbose) console.log(`⏭️ No resolver handled "${action}"`);
    return undefined;
  };

  wrapped._chain = resolvers;
  return wrapped;
}

/**
 * Load a single resolver (CRITICAL FIX)
 *
 * Resolution order:
 * 1. User project node_modules (npm install / npm link)
 * 2. Relative/local path
 * 3. Error with actionable message
 */
function loadSingleResolver(specifier) {
  if (!specifier) throw new Error('Empty resolver specifier');

  // Anchor resolution to the CALLING PROJECT, not the kernel
  const projectRequire = createRequire(
    path.join(process.cwd(), 'package.json')
  );

  let resolver;
  let resolvedFrom = 'unknown';

  try {
    resolver = projectRequire(specifier);
    resolvedFrom = 'project';
  } catch {
    try {
      resolver = require(path.resolve(process.cwd(), specifier));
      resolvedFrom = 'local';
    } catch {
      throw new Error(
        `Resolver "${specifier}" not found.\n` +
        `Install it in your project with:\n` +
        `  npm install ${specifier}\n` +
        `or link it with:\n` +
        `  npm link ${specifier}`
      );
    }
  }

  if (typeof resolver !== 'function') {
    throw new Error(`Resolver "${specifier}" must export a function`);
  }

  const name =
    resolver.resolverName ||
    specifier.replace(/^@[^/]+\//, '');

  resolver.resolverName = name;

  console.log(`📦 Loaded resolver: ${name} (${resolvedFrom})`);
  return resolver;
}

/**
 * Policy-aware resolver loader
 */
function loadResolverChain(specifiers, verbose, allowed) {
  const resolvers = [];

  if (allowed.has('builtInMathResolver')) {
    resolvers.push(builtInMathResolver);
  }

  for (const r of specifiers.map(loadSingleResolver)) {
    if (allowed.has(r.resolverName)) {
      resolvers.push(r);
    } else if (verbose) {
      console.warn(`⚠️ Skipped disallowed resolver: ${r.resolverName}`);
    }
  }

  if (allowed.has('defaultMockResolver')) {
    resolvers.push(defaultMockResolver);
  }

  return createResolverChain(resolvers, verbose);
}

/**
 * CLI SETUP
 */
const program = new Command();

program.version(pkg.version, '-V, --version', 'Show O-lang kernel version');

program
  .name('olang')
  .command('run <file>')
  .option('-r, --resolver <specifier>', 'Resolver', (v, a) => (a.push(v), a), [])
  .option('-i, --input <k=v>', 'Input', (v, a = {}) => {
    const [k, val] = v.split('=');
    a[k] = isNaN(val) ? val : Number(val);
    return a;
  }, {})
  .option('-v, --verbose')
  .action(async (file, options) => {
    ensureOlExtension(file);

    const workflowSource = fs.readFileSync(file, 'utf8');
    const workflow = parse(workflowSource, file);

    const allowed = new Set(workflow.allowedResolvers);
    const resolver = loadResolverChain(
      options.resolver,
      options.verbose,
      allowed
    );

    const result = await execute(
      workflow,
      options.input,
      resolver,
      options.verbose
    );

    console.log(JSON.stringify(result, null, 2));
  });

/**
 * SERVER MODE
 */
program
  .command('server')
  .description('Start O-lang kernel in HTTP server mode')
  .option('-p, --port <port>', 'Server port', process.env.OLANG_SERVER_PORT || '3000')
  .option('-h, --host <host>', 'Server host', '0.0.0.0')
  .action(async (options) => {
    const fastify = require('fastify')({ logger: false });

    fastify.get('/health', () => ({
      status: 'healthy',
      kernel: 'o-lang',
      uptime: process.uptime()
    }));

    fastify.post('/execute-workflow', async (req, reply) => {
      try {
        const { workflowSource, inputs = {}, resolvers = [], verbose = false } = req.body;

        const workflow = parse(workflowSource, 'remote.ol');
        const allowed = new Set(workflow.allowedResolvers);
        const resolver = loadResolverChain(resolvers, verbose, allowed);

        const result = await execute(workflow, inputs, resolver, verbose);
        reply.send(result);
      } catch (err) {
        reply.status(500).send({ error: err.message });
      }
    });

    await fastify.listen({
      port: Number(options.port),
      host: options.host
    });

    console.log(`✅ O-Lang Kernel running on http://${options.host}:${options.port}`);
  });

program.parse(process.argv);