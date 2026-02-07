const { parse } = require('./src/parser/index.js');

// Sample workflow with simple step
const workflowText = `
Workflow "Secure Bank Assistant" with user_question, customer_id

Allow resolvers:
- llm-groq
- bank-account-lookup

Step 1: bank-account-lookup {customer_id}
Save as account_info

Step 2: llm-groq "Answer this customer question: '{user_question}'. The customer's current balance is {account_info.balance}. NEVER mention account numbers, routing numbers, or transfer capabilities. Keep the response under 2 sentences."
Save as response

Return response
`;

// Parse it
const workflow = parse(workflowText);

// Inspect output
console.log(JSON.stringify(workflow, null, 2));
