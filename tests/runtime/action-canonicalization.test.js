const { RuntimeAPI } = require('../../src/runtime/RuntimeAPI');

describe('Action Canonicalization', () => {
  test('kernel normalizes "Ask resolver args" → "Action resolver args" before resolver dispatch', async () => {
    const runtime = new RuntimeAPI();

    const testResolver = async function (action) {
      if (!action.startsWith('Action bank-account-lookup')) {
        throw new Error(`NON-CANONICAL ACTION RECEIVED: ${action}`);
      }
      return { output: { balance: 1500 } };
    };

    testResolver.resolverName = 'bank-account-lookup';

    runtime.allowedResolvers = new Set(['bank-account-lookup']);

    const step = {
      type: 'action',
      actionRaw: 'Ask bank-account-lookup "{customer_id}" "{bank_db_path}"',
      saveAs: 'account_info'
    };

    runtime.context = {
      customer_id: '12345',
      bank_db_path: './bank.db'
    };

    await runtime.executeStep(step, [testResolver]);

    expect(runtime.context.account_info).toEqual({ balance: 1500 });
  });

  test('kernel rejects non-canonical actions with clear error', async () => {
    const runtime = new RuntimeAPI();

    const noop = async () => undefined;
    noop.resolverName = 'test-resolver';

    runtime.allowedResolvers = new Set(['test-resolver']);

    const step = {
      type: 'action',
      actionRaw: 'bank-account-lookup llm-groq'
    };

    await expect(
      runtime.executeStep(step, [noop])
    ).rejects.toThrow(/Non-canonical action/);
  });
});
