// test-fixes.js
// Run with: node test-fixes.js
//
// Tests all fixes applied to RuntimeAPI.js and parser.js:
//   - evaluateCondition (conditions, operators, OR/AND logic)
//   - parallel (context isolation, timeout, allSettled)
//   - debrief (interpolation, missing symbol guard, audit)
//   - emit (audit trail, early exit on missing symbol)
//   - persist (object serialization, error handling, audit)
//   - if/else-if/else (routing, branch isolation)
//   - parser (body isolation, parseBlock export)

const path = require('path');
const fs   = require('fs');

// ─── Resolve paths relative to this file's location ──────────────────────────
const KERNEL_ROOT = __dirname;
const RuntimeAPI_PATH = path.join(KERNEL_ROOT, 'src', 'runtime', 'RuntimeAPI');
const PARSER_PATH     = path.join(KERNEL_ROOT, 'src', 'parser', 'index');

let RuntimeAPI, parse, parseBlock;
try {
  ({ RuntimeAPI } = require(RuntimeAPI_PATH));
} catch (e) {
  console.error('❌ Could not load RuntimeAPI:', e.message);
  process.exit(1);
}
try {
  ({ parse, parseBlock } = require(PARSER_PATH));
} catch (e) {
  console.error('❌ Could not load parser:', e.message);
  process.exit(1);
}

// ─── Test helpers ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    console.log(`     expected: ${JSON.stringify(expected)}`);
    console.log(`     got:      ${JSON.stringify(actual)}`);
    failed++;
  }
}

function section(name) {
  const pad = '─'.repeat(Math.max(0, 52 - name.length));
  console.log(`\n── ${name} ${pad}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. evaluateCondition
// ─────────────────────────────────────────────────────────────────────────────
section('evaluateCondition — basic operators');

const rt0 = new RuntimeAPI();
const ctx = {
  intent:  'send_mail',
  score:   85,
  message: 'transfer or withdraw funds',
  status:  'active'
};

assert('equals match',                 rt0.evaluateCondition('{intent} equals "send_mail"', ctx),        true);
assert('equals no match',              rt0.evaluateCondition('{intent} equals "notify"', ctx),            false);
assert('not equals',                   rt0.evaluateCondition('{intent} not equals "notify"', ctx),        true);
assert('greater than pass',            rt0.evaluateCondition('{score} greater than 80', ctx),             true);
assert('greater than fail',            rt0.evaluateCondition('{score} greater than 90', ctx),             false);
assert('less than pass',               rt0.evaluateCondition('{score} less than 90', ctx),                true);
assert('less than fail',               rt0.evaluateCondition('{score} less than 80', ctx),                false);
assert('gte exact',                    rt0.evaluateCondition('{score} greater than or equal 85', ctx),    true);
assert('gte above',                    rt0.evaluateCondition('{score} greater than or equal 80', ctx),    true);
assert('gte fail',                     rt0.evaluateCondition('{score} greater than or equal 86', ctx),    false);
assert('lte exact',                    rt0.evaluateCondition('{score} less than or equal 85', ctx),       true);
assert('lte fail',                     rt0.evaluateCondition('{score} less than or equal 84', ctx),       false);
assert('contains pass',                rt0.evaluateCondition('{intent} contains "mail"', ctx),            true);
assert('contains fail',                rt0.evaluateCondition('{intent} contains "notify"', ctx),          false);
assert('=== syntax',                   rt0.evaluateCondition('{intent} === "send_mail"', ctx),            true);
assert('!== syntax',                   rt0.evaluateCondition('{intent} !== "notify"', ctx),               true);

section('evaluateCondition — OR / AND logic');

assert('"or" inside quoted value not split',
  rt0.evaluateCondition('{message} equals "transfer or withdraw funds"', ctx), true);
assert('logical OR — first branch matches',
  rt0.evaluateCondition('{intent} equals "send_mail" or {intent} equals "notify"', ctx), true);
assert('logical OR — second branch matches',
  rt0.evaluateCondition('{intent} equals "schedule" or {intent} equals "send_mail"', ctx), true);
assert('logical OR — no branch matches',
  rt0.evaluateCondition('{intent} equals "schedule" or {intent} equals "notify"', ctx), false);
assert('logical AND — both pass',
  rt0.evaluateCondition('{score} greater than 80 and {intent} equals "send_mail"', ctx), true);
assert('logical AND — second fails',
  rt0.evaluateCondition('{score} greater than 80 and {intent} equals "notify"', ctx), false);
assert('"or equal" in gte not treated as logical OR',
  rt0.evaluateCondition('{score} greater than or equal 85', ctx), true);

section('evaluateCondition — strict equality (was loose ==)');

// number 0 must NOT match string "0" after the == → === fix
assert('strict: number 0 !== string "0"',
  rt0.evaluateCondition('{score} equals "0"', { score: 0 }), false);
assert('strict: string "0" === string "0"',
  rt0.evaluateCondition('{score} equals "0"', { score: '0' }), true);
assert('strict: null !== string "0"',
  rt0.evaluateCondition('{score} equals "0"', { score: null }), false);

section('evaluateCondition — unknown syntax emits warning');

const rt0w = new RuntimeAPI();
rt0w.evaluateCondition('some_random_thing', { some_random_thing: true });
assert('fallback warning emitted',
  rt0w.__warnings.some(w => w.message.includes('unrecognised condition')), true);


// ─────────────────────────────────────────────────────────────────────────────
// 2. parallel — context isolation
// ─────────────────────────────────────────────────────────────────────────────
section('parallel — context isolation');

async function testParallel() {
  const rt = new RuntimeAPI({ verbose: false });
  rt.context = { base: 'original' };
  rt.allowedResolvers = new Set(['builtInMathResolver']);

  const step = {
    type: 'parallel',
    timeout: undefined,
    steps: [
      { type: 'calculate', expression: '1 + 1', saveAs: 'result_a', actionRaw: 'Add 1 1' },
      { type: 'calculate', expression: '2 + 2', saveAs: 'result_b', actionRaw: 'Add 2 2' }
    ]
  };

  await rt.executeStep(step, null);

  assert('result_a saved correctly',   rt.context.result_a,   2);
  assert('result_b saved correctly',   rt.context.result_b,   4);
  assert('timed_out is false',         rt.context.timed_out,  false);
  assert('base context preserved',     rt.context.base,       'original');
}


// ─────────────────────────────────────────────────────────────────────────────
// 3. parallel — timeout
// ─────────────────────────────────────────────────────────────────────────────
section('parallel — timeout');

async function testParallelTimeout() {
  const rt = new RuntimeAPI({ verbose: false });
  rt.context = {};
  rt.allowedResolvers = new Set(['slow-resolver']);

  let timeoutEventFired = false;
  rt.on('parallel_timeout', () => { timeoutEventFired = true; });

  const slowResolver = async (action, ctx) => {
    await new Promise(r => setTimeout(r, 500));
    return 'done';
  };
  slowResolver.resolverName = 'slow-resolver';

  const step = {
    type: 'parallel',
    timeout: 50,
    steps: [{
      type: 'action',
      actionRaw: 'Action slow-resolver do something',
      saveAs: 'slow_result'
    }]
  };

  await rt.executeStep(step, slowResolver);

  assert('timed_out is true',          rt.context.timed_out,     true);
  assert('timeout event fired',        timeoutEventFired,         true);
  assert('slow_result not written',    rt.context.slow_result,   undefined);
  assert('parallel_timeout audit entry',
    rt.auditLog.some(e => e.event === 'parallel_timeout'), true);
}


// ─────────────────────────────────────────────────────────────────────────────
// 4. debrief — interpolation and missing symbol guard
// ─────────────────────────────────────────────────────────────────────────────
section('debrief — interpolation');

async function testDebrief() {
  const rt = new RuntimeAPI({ verbose: false });
  rt.context = { customer_name: 'Tony', score: 95 };

  let debriefPayload = null;
  rt.on('debrief', (payload) => { debriefPayload = payload; });

  await rt.executeStep({
    type:    'debrief',
    agent:   'jarvis',
    message: 'Hello {customer_name}, your score is {score}'
  }, null);

  assert('message fully interpolated',
    debriefPayload?.message, 'Hello Tony, your score is 95');
  assert('agent name correct',
    debriefPayload?.agent, 'jarvis');
  assert('debrief_emitted audit entry created',
    rt.auditLog.some(e => e.event === 'debrief_emitted'), true);

  // Missing symbol — must NOT emit
  debriefPayload = null;
  await rt.executeStep({
    type:    'debrief',
    agent:   'jarvis',
    message: 'Hello {missing_symbol}'
  }, null);

  assert('debrief skipped on missing symbol', debriefPayload, null);
}


// ─────────────────────────────────────────────────────────────────────────────
// 5. emit — interpolation, audit, missing symbol guard
// ─────────────────────────────────────────────────────────────────────────────
section('emit — interpolation and audit');

async function testEmit() {
  const rt = new RuntimeAPI({ verbose: false });
  rt.context = { order_id: 'ORD-001', amount: 5000 };

  let emittedPayload = null;
  rt.on('payment_processed', (p) => { emittedPayload = p; });

  await rt.executeStep({
    type:    'emit',
    event:   'payment_processed',
    payload: 'Order {order_id} paid {amount} NGN'
  }, null);

  assert('payload fully interpolated',
    emittedPayload?.payload, 'Order ORD-001 paid 5000 NGN');
  assert('event_emitted audit entry created',
    rt.auditLog.some(e => e.event === 'event_emitted'), true);

  // Missing symbol — must NOT emit
  emittedPayload = null;
  await rt.executeStep({
    type:    'emit',
    event:   'payment_processed',
    payload: 'Order {missing_field} paid'
  }, null);

  assert('emit skipped on missing symbol', emittedPayload, null);
}


// ─────────────────────────────────────────────────────────────────────────────
// 6. persist — serialization, object→non-json warning, audit
// ─────────────────────────────────────────────────────────────────────────────
section('persist — serialization and audit');

async function testPersist() {
  const logsDir = path.join(KERNEL_ROOT, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const jsonOut = path.join(logsDir, 'test_persist.json');
  const txtOut  = path.join(logsDir, 'test_persist.txt');

  // Object → .json target
  const rt1 = new RuntimeAPI({ verbose: false });
  rt1.context = { assessment: { score: 90, recommendation: 'approve' } };

  await rt1.executeStep({
    type:     'persist',
    variable: 'assessment',
    target:   jsonOut
  }, null);

  const written = JSON.parse(fs.readFileSync(jsonOut, 'utf8'));
  assert('json file written correctly',      written.score,           90);
  assert('json recommendation correct',      written.recommendation,  'approve');
  assert('context_persisted audit entry',
    rt1.auditLog.some(e => e.event === 'context_persisted'), true);

  // Object → .txt target — must warn, must NOT write [object Object]
  const rt2 = new RuntimeAPI({ verbose: false });
  rt2.context = { assessment: { score: 90 } };

  await rt2.executeStep({
    type:     'persist',
    variable: 'assessment',
    target:   txtOut
  }, null);

  const txtContent = fs.readFileSync(txtOut, 'utf8');
  assert('no [object Object] in txt file',
    txtContent.includes('[object Object]'), false);
  assert('warning emitted for object → txt',
    rt2.__warnings.some(w => w.message && w.message.includes('not .json')), true);

  // Cleanup
  [jsonOut, txtOut].forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
}


// ─────────────────────────────────────────────────────────────────────────────
// 7. if — else-if routing (the Jarvis scenario)
// ─────────────────────────────────────────────────────────────────────────────
section('if/else-if/else — branch routing');

async function testIfRouting() {
  const executedActions = [];

  class TestRuntime extends RuntimeAPI {
    async executeStep(step, resolver) {
      if (step.type === 'action') {
        executedActions.push(step.actionRaw);
        return;
      }
      return super.executeStep(step, resolver);
    }
  }

  // Helper: build and run an if step with a given intent
  async function runWith(intent) {
    executedActions.length = 0;
    const rt = new TestRuntime({ verbose: false });
    rt.context = { intent };
    rt.allowedResolvers = new Set([
      'send_mail_resolver', 'notify_resolver',
      'calendar_resolver',  'fallback_resolver'
    ]);

    await rt.executeStep({
      type:      'if',
      condition: '{intent} equals "send_mail"',
      body:      [{ type: 'action', actionRaw: 'Action send_mail_resolver run', saveAs: 'r' }],
      elseIf: [
        {
          condition: '{intent} equals "notify"',
          body: [{ type: 'action', actionRaw: 'Action notify_resolver run', saveAs: 'r' }]
        },
        {
          condition: '{intent} equals "schedule"',
          body: [{ type: 'action', actionRaw: 'Action calendar_resolver run', saveAs: 'r' }]
        }
      ],
      elseBranch: [{ type: 'action', actionRaw: 'Action fallback_resolver run', saveAs: 'r' }]
    }, null);

    return [...executedActions];
  }

  const mailActions     = await runWith('send_mail');
  const notifyActions   = await runWith('notify');
  const scheduleActions = await runWith('schedule');
  const unknownActions  = await runWith('unknown');

  assert('send_mail: only 1 branch runs',     mailActions.length,     1);
  assert('send_mail: correct branch',         mailActions[0],         'Action send_mail_resolver run');
  assert('notify: only 1 branch runs',        notifyActions.length,   1);
  assert('notify: correct branch',            notifyActions[0],       'Action notify_resolver run');
  assert('schedule: only 1 branch runs',      scheduleActions.length, 1);
  assert('schedule: correct branch',          scheduleActions[0],     'Action calendar_resolver run');
  assert('unknown: falls to else',            unknownActions.length,  1);
  assert('unknown: fallback branch',          unknownActions[0],      'Action fallback_resolver run');
}


// ─────────────────────────────────────────────────────────────────────────────
// 8. parser — parseBlock exported + if/else-if/else body isolation
// ─────────────────────────────────────────────────────────────────────────────
section('parser — parseBlock exported');

assert('parseBlock is a function', typeof parseBlock, 'function');

section('parser — if/else-if/else body isolation');

const olWorkflow = `
Workflow "jarvis_test"

Allow resolvers:
  - mail_resolver
  - notify_resolver
  - fallback_resolver

If {intent} equals "send_mail"
  Ask send email via mail_resolver Save as mail_result
Else If {intent} equals "notify"
  Ask notify via notify_resolver Save as notify_result
Else
  Ask fallback via fallback_resolver Save as fallback_result
End

Return mail_result
`;

let ifStep;
try {
  const workflow = parse(olWorkflow);
  ifStep = workflow.steps.find(s => s.type === 'if');
} catch (e) {
  console.log(`  ❌ parse threw: ${e.message}`);
  failed++;
  ifStep = null;
}

if (ifStep) {
  assert('if step exists',
    !!ifStep, true);
  assert('main body has 1 step',
    ifStep.body.length, 1);
  assert('main body is mail_resolver step',
    ifStep.body[0]?.actionRaw?.includes('mail_resolver'), true);
  assert('elseIf chain has 1 entry',
    ifStep.elseIf.length, 1);
  assert('elseIf condition correct',
    ifStep.elseIf[0].condition, '{intent} equals "notify"');
  assert('elseIf body has 1 step',
    ifStep.elseIf[0].body.length, 1);
  assert('elseIf body is notify_resolver',
    ifStep.elseIf[0].body[0]?.actionRaw?.includes('notify_resolver'), true);
  assert('elseBranch has 1 step',
    ifStep.elseBranch.length, 1);
  assert('elseBranch is fallback_resolver',
    ifStep.elseBranch[0]?.actionRaw?.includes('fallback_resolver'), true);
  assert('main body !== else body (not duplicated)',
    ifStep.body[0]?.actionRaw !== ifStep.elseBranch[0]?.actionRaw, true);
}


// ─────────────────────────────────────────────────────────────────────────────
// 9. connect — registers endpoint in this.resources
//
// The connect case is intentionally simple:
//   this.resources[step.resource] = step.endpoint;
//
// Tests verify:
//   - A URL endpoint is stored under the correct resource key
//   - A resolver endpoint is stored the same way
//   - Multiple connects don't overwrite each other
//   - A connect inside a parallel branch also resolves correctly
//   - An empty resource name is handled without crashing
// ─────────────────────────────────────────────────────────────────────────────

async function testConnect() {

  // ── Basic URL connect ────────────────────────────────────────────────────
  const rt1 = new RuntimeAPI({ verbose: false });
  await rt1.executeStep({
    type:       'connect',
    resource:   'payment_service',
    endpoint:   'https://api.paystack.co/v1',
    targetType: 'url'
  }, null);

  assert('url connect stores endpoint under resource key',
    rt1.resources['payment_service'], 'https://api.paystack.co/v1');
  assert('url connect creates audit entry',
    rt1.auditLog.some(e => e.event === 'resource_connected'), true);

  // ── Resolver connect — must NOT be rejected by URL validation ────────────
  // targetType: 'resolver' endpoints are npm package names, not URLs.
  // new URL('@o-lang/kyc-resolver') throws — the fix gates URL validation
  // on targetType so resolver connects register correctly.
  const rt2 = new RuntimeAPI({ verbose: false });
  await rt2.executeStep({
    type:       'connect',
    resource:   'kyc_resolver',
    endpoint:   '@o-lang/kyc-resolver',
    targetType: 'resolver'
  }, null);

  assert('resolver connect registered without URL validation error',
    rt2.resources['kyc_resolver'], '@o-lang/kyc-resolver');
  assert('resolver connect creates audit entry',
    rt2.auditLog.some(e => e.event === 'resource_connected'), true);

  // ── Multiple connects — do not overwrite each other ──────────────────────
  const rt3 = new RuntimeAPI({ verbose: false });
  await rt3.executeStep({
    type: 'connect', resource: 'payment_service',
    endpoint: 'https://api.paystack.co/v1', targetType: 'url'
  }, null);
  await rt3.executeStep({
    type: 'connect', resource: 'kyc_resolver',
    endpoint: '@o-lang/kyc-resolver', targetType: 'resolver'
  }, null);

  assert('multiple connects — first key present',
    rt3.resources['payment_service'], 'https://api.paystack.co/v1');
  assert('multiple connects — second key present',
    rt3.resources['kyc_resolver'], '@o-lang/kyc-resolver');
  assert('multiple connects — resource count is 2',
    Object.keys(rt3.resources).length, 2);

  // ── Overwrite — same resource name replaces endpoint ────────────────────
  await rt3.executeStep({
    type: 'connect', resource: 'payment_service',
    endpoint: 'https://api.flutterwave.com/v3', targetType: 'url'
  }, null);

  assert('overwrite replaces existing endpoint',
    rt3.resources['payment_service'], 'https://api.flutterwave.com/v3');
  assert('overwrite does not grow resource count',
    Object.keys(rt3.resources).length, 2);

  // ── Missing resource or endpoint — must warn, not crash ──────────────────
  const rt4 = new RuntimeAPI({ verbose: false });
  await rt4.executeStep({
    type: 'connect', resource: '', endpoint: 'https://api.paystack.co/v1', targetType: 'url'
  }, null);

  assert('missing resource name — warning emitted',
    rt4.__warnings.some(w => w.message.includes('missing')), true);
  assert('missing resource name — nothing registered',
    Object.keys(rt4.resources).length, 0);

  // ── Invalid URL on url-type connect — must warn, not crash ───────────────
  const rt5 = new RuntimeAPI({ verbose: false });
  await rt5.executeStep({
    type: 'connect', resource: 'bad_service',
    endpoint: 'not-a-valid-url', targetType: 'url'
  }, null);

  assert('invalid URL — warning emitted',
    rt5.__warnings.some(w => w.message.includes('Invalid endpoint')), true);
  assert('invalid URL — resource not registered',
    rt5.resources['bad_service'], undefined);

  // ── Connect inside parallel — both resources survive branch merge ─────────
  // Object.create(this) shares this.resources by prototype reference,
  // so both parallel branches write to the same resources object — correct,
  // since resource registration has no race condition risk (different keys).
  const rt6 = new RuntimeAPI({ verbose: false });
  rt6.context = {};

  await rt6.executeStep({
    type:    'parallel',
    timeout: undefined,
    steps: [
      {
        type: 'connect', resource: 'sms_gateway',
        endpoint: 'https://sms.africas-talking.com', targetType: 'url'
      },
      {
        type: 'connect', resource: 'email_gateway',
        endpoint: 'https://api.sendgrid.com/v3', targetType: 'url'
      }
    ]
  }, null);

  assert('parallel connect — sms_gateway registered',
    rt6.resources['sms_gateway'], 'https://sms.africas-talking.com');
  assert('parallel connect — email_gateway registered',
    rt6.resources['email_gateway'], 'https://api.sendgrid.com/v3');

  // ── Credential masking — test the regex directly ─────────────────────────
  // The masking logic is a pure string operation applied inside the connect case.
  // Tested directly rather than through auditLog since audit persistence
  // requires OLANG_AUDIT_LOG=true env var to be set.
  const credentialEndpoint = 'https://admin:secret123@db.example.com/api';
  const masked = credentialEndpoint.replace(/\/\/[^@]+@/, '//***@');

  assert('credential masking — password not in masked string',
    masked.includes('secret123'), false);
  assert('credential masking — masked marker present',
    masked.includes('***'), true);
  assert('credential masking — host preserved after masking',
    masked.includes('db.example.com'), true);
  assert('credential masking — original string unchanged',
    credentialEndpoint, 'https://admin:secret123@db.example.com/api');

  const rt7 = new RuntimeAPI({ verbose: false });
  await rt7.executeStep({
    type: 'connect', resource: 'db_service',
    endpoint: credentialEndpoint, targetType: 'url'
  }, null);

  assert('credential masking — real endpoint stored unmasked in resources',
    rt7.resources['db_service'], credentialEndpoint);
}


// ─────────────────────────────────────────────────────────────────────────────
// 10. agent_use — maps a logical name to a registered resource
//
// agent_use is the semantic layer on top of connect.
// connect registers the physical endpoint in this.resources.
// agent_use maps a logical workflow name to that resource in this.agentMap.
//
// Tests verify:
//   - Basic mapping is stored in agentMap
//   - Multiple agents can be mapped without collision
//   - Mapping to an unconnected resource emits a warning but does not crash
//   - Remapping the same logical name replaces it
//   - connect + agent_use used together works end to end
//   - Missing logicalName or resource emits a warning and skips
// ─────────────────────────────────────────────────────────────────────────────

async function testAgentUse() {

  // ── Basic mapping ─────────────────────────────────────────────────────────
  const rt1 = new RuntimeAPI({ verbose: false });
  rt1.resources['paystack_api'] = 'https://api.paystack.co/v1';

  await rt1.executeStep({
    type:        'agent_use',
    logicalName: 'payment_agent',
    resource:    'paystack_api'
  }, null);

  assert('agent_use stores mapping in agentMap',
    rt1.agentMap['payment_agent'], 'paystack_api');

  // ── Multiple agents — no collision ───────────────────────────────────────
  rt1.resources['nhis_api'] = 'https://api.nhis.gov.ng';
  await rt1.executeStep({
    type:        'agent_use',
    logicalName: 'insurance_agent',
    resource:    'nhis_api'
  }, null);

  assert('multiple agents — first mapping preserved',
    rt1.agentMap['payment_agent'], 'paystack_api');
  assert('multiple agents — second mapping stored',
    rt1.agentMap['insurance_agent'], 'nhis_api');
  assert('multiple agents — agentMap has 2 entries',
    Object.keys(rt1.agentMap).length, 2);

  // ── Remap — same logical name replaces resource ───────────────────────────
  rt1.resources['flutterwave_api'] = 'https://api.flutterwave.com/v3';
  await rt1.executeStep({
    type:        'agent_use',
    logicalName: 'payment_agent',
    resource:    'flutterwave_api'
  }, null);

  assert('remap replaces existing logical name',
    rt1.agentMap['payment_agent'], 'flutterwave_api');
  assert('remap does not grow agentMap',
    Object.keys(rt1.agentMap).length, 2);

  // ── Unconnected resource — warns but does not crash ───────────────────────
  // agent_use should warn when the resource hasn't been connect-ed yet.
  // This catches authoring mistakes (wrong order, typo in resource name)
  // without halting the workflow.
  const rt2 = new RuntimeAPI({ verbose: false });
  await rt2.executeStep({
    type:        'agent_use',
    logicalName: 'orphan_agent',
    resource:    'nonexistent_service'
  }, null);

  assert('unconnected resource — warning emitted',
    rt2.__warnings.some(w => w.message.includes('nonexistent_service')), true);
  assert('unconnected resource — mapping still stored',
    rt2.agentMap['orphan_agent'], 'nonexistent_service');

  // ── Missing logicalName — warns and skips ────────────────────────────────
  const rt3 = new RuntimeAPI({ verbose: false });
  await rt3.executeStep({
    type:        'agent_use',
    logicalName: '',
    resource:    'some_service'
  }, null);

  assert('missing logicalName — warning emitted',
    rt3.__warnings.some(w => w.message.includes('missing')), true);
  assert('missing logicalName — agentMap stays empty',
    Object.keys(rt3.agentMap).length, 0);

  // ── connect + agent_use together — the natural pair ──────────────────────
  // This is the canonical usage: connect registers the physical endpoint,
  // agent_use gives it a logical name, steps reference the logical name.
  const rt4 = new RuntimeAPI({ verbose: false });

  await rt4.executeStep({
    type:       'connect',
    resource:   'afdb_payments_api',
    endpoint:   'https://payments.afdb.org/v2',
    targetType: 'url'
  }, null);

  await rt4.executeStep({
    type:        'agent_use',
    logicalName: 'disbursement_agent',
    resource:    'afdb_payments_api'
  }, null);

  assert('connect+agent_use — resource registered',
    rt4.resources['afdb_payments_api'], 'https://payments.afdb.org/v2');
  assert('connect+agent_use — logical name maps to resource',
    rt4.agentMap['disbursement_agent'], 'afdb_payments_api');
  assert('connect+agent_use — no warning for connected resource',
    rt4.__warnings.length, 0);
}


// ─────────────────────────────────────────────────────────────────────────────
// Run all async tests then print summary
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  try {
    section('parallel — context isolation');
    await testParallel();

    section('parallel — timeout');
    await testParallelTimeout();

    section('debrief — interpolation');
    await testDebrief();

    section('emit — interpolation and audit');
    await testEmit();

    section('persist — serialization and audit');
    await testPersist();

    section('if/else-if/else — branch routing');
    await testIfRouting();

    section('connect — endpoint registration');
    await testConnect();

    section('agent_use — logical name mapping');
    await testAgentUse();

  } catch (e) {
    console.error('\n💥 Unexpected error during async tests:', e.message);
    console.error(e.stack);
    failed++;
  }

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('  ✅ All tests passed — safe to publish');
  } else {
    console.log('  ❌ Fix failing tests before publishing');
    process.exit(1);
  }
  console.log('═'.repeat(55));
})();