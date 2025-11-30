//Depreciated!

// // examples/groq-telegram-resolver.js
// // O-Lang resolver: Groq (LLM) + Telegram (notifications)
// // Uses GROQ_API_KEY + TELEGRAM_BOT_TOKEN from .env or process.env

// try {
//   require('dotenv').config();
// } catch (e) {
//   // dotenv not installed → use process.env directly
// }

// const Groq = require('groq-sdk');
// const GROQ_API_KEY = process.env.GROQ_API_KEY;
// const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

// const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// // 🔧 CRITICAL FIX: No spaces after 'bot'
// const TELEGRAM_BASE_URL = TELEGRAM_BOT_TOKEN
//   ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
//   : null;

// // --- Groq Summarization ---
// async function summarizeWithGroq(prompt) {
//   if (!groq) {
//     console.warn('⚠️ GROQ_API_KEY not set — using mock summary');
//     return "✅ [Mock] Staff get 20 days paid annual leave. Submit via HR portal.";
//   }

//   try {
//     const response = await groq.chat.completions.create({
//       messages: [{ role: 'user', content: prompt }],
//       model: 'llama-3.1-8b-instant',
//       temperature: 0.3,
//       max_tokens: 250,
//       top_p: 0.9
//     });
//     return response.choices[0].message.content.trim();
//   } catch (err) {
//     console.error('❌ Groq error:', err.message);
//     return '⚠️ Groq failed. Check logs.';
//   }
// }

// // --- Telegram Notification ---
// async function sendTelegramMessage(chatId, text) {
//   if (!TELEGRAM_BASE_URL) {
//     console.warn('⚠️ TELEGRAM_BOT_TOKEN not set — skipping notification');
//     return '[Skipped Telegram notification]';
//   }

//   try {
//     const res = await fetch(`${TELEGRAM_BASE_URL}/sendMessage`, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         chat_id: chatId,
//         text: text,
//         parse_mode: 'Markdown',
//         disable_web_page_preview: true
//       })
//     });

//     const data = await res.json();
//     if (data.ok) {
//       console.log(`✅ Telegram message sent to ${chatId}`);
//       return 'Telegram notification sent';
//     } else {
//       throw new Error(data.description || 'Unknown Telegram error');
//     }
//   } catch (err) {
//     console.error(`❌ Telegram error: ${err.message}`);
//     return `⚠️ Telegram failed: ${err.message}`;
//   }
// }

// // --- Resolver Entry Point ---
// module.exports = async (action, context) => {
//   // 🔍 Debug: log every action received
//   console.log('🔍 Resolver received action:', JSON.stringify(action));

//   // Step 1: Search for X using Y (robust matching)
//   if (/^Search\s+for\s+.+\s+using\s+\S+/.test(action)) {
//     const match = action.match(/^Search\s+for\s+(.+)\s+using\s+\S+/i);
//     const query = match ? match[1].trim() : 'policy';
//     console.log('📁 Searching policy for:', query);
//     return {
//       title: `HR Policy: ${query}`,
//       text: `Employees are entitled to 20 days of paid annual leave. All leave requests must be submitted via the HR portal at least 14 days in advance.`,
//       url: `mock://docs/${encodeURIComponent(query)}`
//     };
//   }

//   // Step 2: Ask Summarizer to "..." — ✅ ROBUST MULTI-LINE PARSER
//   if (action.startsWith('Ask ')) {
//     // Extract everything after the first ` to "` and before the final `"`
//     const toIndex = action.indexOf(' to "');
//     if (toIndex !== -1) {
//       const start = toIndex + 6; // length of ' to "'
//       const end = action.lastIndexOf('"');
//       if (end > start) {
//         let prompt = action.slice(start, end);
//         // Handle escaped newlines from CLI/runtime
//         prompt = prompt.replace(/\\n/g, '\n');
//         console.log('📝 Summarization prompt:', prompt);
//         return await summarizeWithGroq(prompt);
//       }
//     }
//     // Fallback if parsing fails
//     console.warn('⚠️ Could not parse Ask prompt, using fallback');
//     return await summarizeWithGroq('Summarize this document.');
//   }

//   // Step 3: Notify X using Notifier
//   if (action.startsWith('Notify ')) {
//     const match = action.match(/Notify\s+(\S+)/);
//     const chatId = match ? match[1] : process.env.TELEGRAM_CHAT_ID;
//     const message = context.summary || context.improved_summary || 'Alert from O-Lang';

//     if (!chatId) {
//       console.warn('⚠️ No chat ID provided and TELEGRAM_CHAT_ID not set');
//       return '[No Telegram recipient]';
//     }

//     console.log('📲 Sending Telegram message to:', chatId);
//     return await sendTelegramMessage(chatId, message);
//   }

//   // Debrief / Evolve: observability
//   if (action.startsWith('Debrief ') || action.startsWith('Evolve ')) {
//     console.log(`[O-Lang] ${action}`);
//     return 'Acknowledged';
//   }

//   // Unhandled
//   console.warn(`[O-Lang] ❌ Unhandled action: "${action}"`);
//   return `[Unhandled: "${action}"]`;
// };


