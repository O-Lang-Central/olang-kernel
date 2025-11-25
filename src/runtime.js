async function execute(ast, inputs = {}, agentResolver) {
  const results = [];
  for (const node of ast) {
    // Call mock agent
    const output = agentResolver().call(node.action, inputs);
    results.push({ step: node.step, action: node.action, output });
  }
  return results;
}

module.exports = { execute };
