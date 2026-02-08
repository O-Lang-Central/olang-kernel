// tests/runtime/action-canonicalization.test.js
const { RuntimeAPI } = require('../../src/runtime/RuntimeAPI');

describe('Action Canonicalization', () => {
  test('kernel normalizes "Ask resolver args" → "Action resolver args" before resolver dispatch', async () => {
    let receivedAction = null;
    
    // ✅ FAKE RESOLVER WITH REQUIRED METADATA (resolverName + capabilities)
    const fakeResolver = async (action) => {
      receivedAction = action;
      if (action.startsWith('Action bank-account-lookup')) {
        return { output: { balance: 1500 } };
      }
      return undefined; // Skip non-matching actions
    };
    fakeResolver.resolverName = 'bank-account-lookup';
    fakeResolver.capabilities = ['bank-account-lookup'];
    fakeResolver.name = 'bank-account-lookup'; // Fallback for older kernels

    const runtime = new RuntimeAPI({ verbose: false });
    runtime.allowedResolvers.add('bank-account-lookup');
    
    const step = {
      type: 'action',
      stepNumber: 1,
      actionRaw: 'Ask bank-account-lookup "{customer_id}" "{bank_db_path}"',
      saveAs: 'account_info'
    };
    
    // Set up context with interpolated values
    runtime.context = {
      customer_id: '12345',
      bank_db_path: 'Bank-lookup-demo/bank.db'
    };

    await runtime.executeStep(step, [fakeResolver]);

    // 🔒 CRITICAL ASSERTION: Resolver MUST receive canonical Action format
    expect(receivedAction).toBe(
      'Action bank-account-lookup "12345" "Bank-lookup-demo/bank.db"'
    );
    
    // Verify result was saved correctly
    expect(runtime.context.account_info).toEqual({ balance: 1500 });
  });

  test('kernel rejects non-canonical actions with clear error', async () => {
    // ✅ MINIMAL RESOLVER WITH METADATA (to pass policy check)
    const minimalResolver = async () => undefined;
    minimalResolver.resolverName = 'test-resolver';
    minimalResolver.capabilities = ['test-resolver'];
    minimalResolver.name = 'test-resolver';

    const runtime = new RuntimeAPI({ verbose: false });
    runtime.allowedResolvers.add('test-resolver');
    
    const step = {
      type: 'action',
      stepNumber: 1,
      actionRaw: 'invalid-action-format', // Non-Ask, non-canonical action
      saveAs: 'result'
    };
    
    runtime.context = {};
    
    // Should fail with canonicalization error BEFORE resolver dispatch
    // Note: We're testing that the kernel catches this early
    // (Your current kernel may not have this guard yet — see note below)
    await expect(runtime.executeStep(step, [minimalResolver]))
      .rejects
      .toThrow(/Non-canonical action/);
  });
});