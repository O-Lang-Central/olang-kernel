//depreciated

// // examples/groq-slack-resolver.js
// // Resolver for O-Lang: connects to Groq (LLM) and Slack (notifications)
// // Uses environment variables: GROQ_API_KEY, SLACK_TOKEN
// // Optional: auto-loads .env for local development

// // Optional: load .env (only in examples — kernel remains pure)
// try {
//   require('dotenv').config();
// } catch (e) {
//   // dotenv not installed — proceed with process.env as-is
// }

// const Groq = require('groq-sdk');
// const { WebClient } = require('@slack/web-api');

// // Read from environment (populated by .env or shell)
// const GROQ_API_KEY = process.env.GROQ_API_KEY;
// const SLACK_TOKEN = process.env.SLACK_TOKEN;

// const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;
// const slack = SLACK_TOKEN ? new WebClient(SLACK_TOKEN) : null;

// module.exports = async (action, context) => {
//   // === Step: Search for X using PolicySearch (mock Drive) ===
//   if (action.startsWith('Search for ')) {
//     const match = action.match(/Search for (.+?) using/);
//     const query = match ? match[1].trim() : 'policy';

//     return {
//       title: `HR Policy: ${query}`,
//       text: `Employees are entitled to 20 days of paid annual leave. All leave requests must be submitted via the HR portal at least 14 days in advance.`,
//       url: `mock://company-docs/${encodeURIComponent(query)}`
//     };
//   }

//   // === Step: Ask Summarizer to "..." (real Groq) ===
//   if (action.startsWith('Ask ')) {
//     if (!groq) {
//       console.warn('⚠️  GROQ_API_KEY not set — using mock summary');
//       return '✅ [Mock] Staff get 20 days paid annual leave. Submit via HR portal.';
//     }

//     const match = action.match(/Ask \S+ to "(.+)"$/);
//     const prompt = match ? match[1] : 'Summarize this document.';

//     try {
//       const response = await groq.chat.completions.create({
//         messages: [{ role: 'user', content: prompt }],
//         // ✅ ACTIVE MODEL as of Oct 2025 (replaces deprecated 'llama3-8b-8192')
//         model: 'llama-3.1-8b-instant',
//         temperature: 0.3,
//         max_tokens: 250,
//         top_p: 0.9
//       });
//       return response.choices[0].message.content.trim();
//     } catch (err) {
//       if (err.message?.includes('model_decommissioned')) {
//         console.error('❌ Groq model deprecated. Use "llama-3.1-8b-instant".');
//         return '⚠️ Groq model outdated. Contact admin.';
//       }
//       if (err.status === 401) {
//         console.error('❌ Invalid Groq API key.');
//         return '⚠️ Invalid Groq API key.';
//       }
//       console.error('❌ Groq API error:', err.message);
//       return '⚠️ Groq failed. Check logs.';
//     }
//   }

//   // === Step: Notify X using Notifier (real Slack DM) ===
//   if (action.startsWith('Notify ')) {
//     console.log('📨 Attempting to send Slack notification...');
//     const match = action.match(/Notify (\S+)/);
//     const userId = match ? match[1] : 'U0000000000';
//     const message = typeof context.summary === 'string'
//       ? context.summary
//       : '🔔 Alert from O-Lang workflow';

//     if (!slack) {
//       console.warn(`⚠️  SLACK_TOKEN not set — skipping notification to ${userId}`);
//       return `[Skipped Slack message to ${userId}]`;
//     }

//    try {
//   const dm = await slack.conversations.open({ users: userId });
//   await slack.chat.postMessage({ channel: dm.channel.id, text: message });
//   console.log(`✅ Slack DM successfully sent to ${userId}`);
//   return `Success`;
// } catch (err) {
//   console.error(`❌ Slack failed for ${userId}:`, err.data?.error || err.message);
//   return `Failed`;
// }
//   }
//   // === Debrief: human-readable log ===
//   if (action.startsWith('Debrief ')) {
//     console.log(`[O-Lang Debrief] ${action}`);
//     return 'Debrief logged';
//   }

//   // === Evolve: feedback signal ===
//   if (action.startsWith('Evolve ')) {
//     console.log(`[O-Lang Evolve] ${action}`);
//     return 'Feedback recorded';
//   }

//   // === Unhandled actions ===
//   console.warn(`[O-Lang] Unhandled action: "${action}"`);
//   return `[Unhandled: "${action}"]`;
// };

