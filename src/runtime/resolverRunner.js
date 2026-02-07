// src/runtime/resolverRunner.js
const path = require('path');

class ResolverRunner {
  constructor({ verbose = false, resolvers = [] }) {
    this.verbose = verbose;
    this.resolvers = resolvers;
  }

  /**
   * Parse action string into structured parameters.
   * Handles BOTH quoted and unquoted values:
   *   "bank-account-lookup customer_id=12345 db_path=bank.db"
   *   "bank-account-lookup customer_id=\"12345\" db_path=\"bank.db\""
   * 
   * @param {string} actionStr - Raw action string from workflow step
   * @returns {Object|null} Parsed action with resolverName, params[], namedParams{}, and raw string
   */
  _parseAction(actionStr) {
    if (typeof actionStr !== 'string' || !actionStr.trim()) return null;

    // Normalize: Remove leading "Action"/"Ask" keywords for parsing
    let normalized = actionStr.trim();
    const actionMatch = normalized.match(/^(Action|Ask)\s+(.+)/i);
    if (actionMatch) {
      normalized = actionMatch[2].trim();
    }

    // Extract resolver name (first word)
    const firstSpace = normalized.indexOf(' ');
    const resolverName = firstSpace > 0 
      ? normalized.substring(0, firstSpace).toLowerCase()
      : normalized.toLowerCase();

    // Extract key=value pairs (handles quoted/unquoted values)
    const namedParams = {};
    const paramRegex = /(\w+)=(?:"([^"]*)"|(\S+))/g;
    let match;
    while ((match = paramRegex.exec(normalized)) !== null) {
      const [, key, quotedVal, unquotedVal] = match;
      namedParams[key] = quotedVal || unquotedVal;
    }

    // For "Ask llm-groq \"prompt\"" style - extract the quoted prompt as first param
    const askMatch = normalized.match(/^(\S+)\s+"([^"]+)"$/);
    if (askMatch && !Object.keys(namedParams).length) {
      namedParams.prompt = askMatch[2];
    }

    // Build positional params array (order matters for legacy resolvers)
    const params = Object.values(namedParams);

    return {
      resolverName,
      params,
      namedParams,
      raw: actionStr,
      normalized
    };
  }

  /**
   * Used ONLY for logging / routing insight
   */
  normalizeAction(action) {
    const trimmed = action.trim();
    if (/^Action\s+/i.test(trimmed)) {
      return trimmed.replace(/^Action\s+/i, '');
    }
    if (/^Ask\s+/i.test(trimmed)) {
      return trimmed.replace(/^Ask\s+/i, '');
    }
    return trimmed;
  }

  /**
   * Resolve placeholders {var} in text using context values
   */
  resolvePlaceholders(text, context) {
    return text.replace(/{([^}]+)}/g, (_, expr) => {
      const value = expr
        .trim()
        .split('.')
        .reduce((acc, key) => acc?.[key], context);
      
      if (value === undefined) {
        throw new Error(
          `[O-Lang SAFETY] Unresolved placeholder at runtime: {${expr}}`
        );
      }
      
      // 🔒 SAFETY: Block object/array interpolation into strings
      if (value !== null && typeof value === 'object') {
        const type = Array.isArray(value) ? 'array' : 'object';
        throw new Error(
          `[O-Lang SAFETY] Cannot interpolate ${type} "{${expr}}" into action string.\n` +
          `  → Use dot notation: "{${expr}.field}" (e.g., {account_info.balance})`
        );
      }
      
      return String(value);
    });
  }

  /**
   * Execute workflow plan with context mediation
   */
  async execute({ plan, context }) {
    if (this.verbose) {
      console.log('[ResolverRunner] execute called with steps:', plan.steps.length);
    }

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      
      if (!step.actionRaw) {
        throw new Error('[O-Lang SAFETY] Step missing actionRaw');
      }

      // ✅ Resolve placeholders JUST IN TIME (after semantic validation)
      const resolvedAction = this.resolvePlaceholders(step.actionRaw, context);
      const normalized = this.normalizeAction(resolvedAction);

      if (this.verbose) {
        console.log(`\n[Step ${i + 1}] Raw action: "${step.actionRaw}"`);
        console.log(`[Step ${i + 1}] Resolved:   "${resolvedAction}"`);
      }

      // ✅ PARSE ACTION BEFORE RESOLVER INVOCATION (critical fix)
      const parsed = this._parseAction(resolvedAction);
      
      if (this.verbose && parsed) {
        console.log(`[Step ${i + 1}] Parsed resolver: "${parsed.resolverName}"`);
        console.log(`[Step ${i + 1}] Parsed params:`, parsed.namedParams);
      }

      let handled = false;
      let resolverAttempts = [];

      for (const resolver of this.resolvers) {
        const resolverName = resolver?.resolverName?.toLowerCase() || 'unknown';
        let result;
        let invocationMethod = 'unknown';

        try {
          // ✅ STRATEGY 1: If resolver name matches parsed action → try POSITIONAL PARAMS (backward compatible)
          if (parsed && resolverName === parsed.resolverName) {
            try {
              // Call with native params: resolver(customer_id, db_path, context)
              result = await resolver(...parsed.params, context);
              invocationMethod = 'positional_params';
              
              if (this.verbose) {
                console.log(`[ResolverRunner] ✓ Invoked "${resolverName}" via positional params`);
              }
            } catch (e) {
              // If positional params fail, fall through to raw string invocation below
              if (this.verbose) {
                console.log(`[ResolverRunner] ✗ Positional params failed for "${resolverName}", trying raw string...`);
              }
            }
          }

          // ✅ STRATEGY 2: If not handled yet → try RAW STRING INVOCATION (for generic/new-style resolvers)
          if (result === undefined) {
            result = await resolver(resolvedAction, context);
            invocationMethod = 'raw_string';
            
            if (this.verbose && result !== undefined) {
              console.log(`[ResolverRunner] ✓ Invoked "${resolverName}" via raw string`);
            }
          }

          // ✅ ACCEPT valid result (non-undefined)
          if (result !== undefined) {
            handled = true;
            
            // Handle resolver error contract
            if (result?.error) {
              // Parse structured error if JSON string
              let errorMsg = result.error;
              try {
                const errObj = JSON.parse(result.error);
                errorMsg = `[${errObj.code}] ${errObj.message || errObj.error}`;
              } catch (e) {
                // Not JSON - use as-is
              }
              
              throw new Error(`[Resolver Error] ${resolverName}: ${errorMsg}`);
            }

            // ✅ CRITICAL FIX: UNWRAP output BEFORE saving to context
            const valueToSave = result?.output !== undefined ? result.output : result;
            
            // Save to context if requested
            if (valueToSave !== undefined && step.saveAs) {
              context[step.saveAs] = valueToSave;
              
              if (this.verbose) {
                console.log(`[Step ${i + 1}] Output saved to context.${step.saveAs}:`, valueToSave);
              }
            }

            resolverAttempts.push({
              name: resolverName,
              status: 'success',
              method: invocationMethod
            });
            break;
          } else {
            resolverAttempts.push({
              name: resolverName,
              status: 'skipped',
              reason: 'returned undefined'
            });
          }

        } catch (e) {
          resolverAttempts.push({
            name: resolverName,
            status: 'failed',
            error: e.message || String(e)
          });
          
          if (this.verbose) {
            console.warn(`[ResolverRunner] Resolver "${resolverName}" failed:`, e.message || e);
          }
          // Continue to next resolver in chain
        }
      }

      // ✅ SAFETY: No resolver handled this action → halt workflow
      if (!handled) {
        let errorMessage = `[O-Lang SAFETY] No resolver handled action: "${resolvedAction}"\n\n`;
        errorMessage += `Attempted resolvers:\n`;

        resolverAttempts.forEach((attempt, idx) => {
          const namePad = attempt.name.padEnd(30);
          if (attempt.status === 'skipped') {
            errorMessage += `  ${idx + 1}. ${namePad} → SKIPPED (returned undefined)\n`;
          } else if (attempt.status === 'failed') {
            errorMessage += `  ${idx + 1}. ${namePad} → FAILED\n`;
            errorMessage += `     Error: ${attempt.error.substring(0, 80)}\n`;
          } else {
            errorMessage += `  ${idx + 1}. ${namePad} → ${attempt.status.toUpperCase()} (${attempt.method})\n`;
          }
        });

        errorMessage += `\n💡 How to fix:\n`;
        errorMessage += `  • Verify resolver is loaded with correct name ("${parsed?.resolverName || 'unknown'}")\n`;
        errorMessage += `  • Ensure resolver package is installed and registered with kernel\n`;
        errorMessage += `  • Check resolver signature matches kernel expectations:\n`;
        errorMessage += `      → Legacy: resolver(param1, param2, context)\n`;
        errorMessage += `      → Modern: resolver(actionString, context)\n`;
        errorMessage += `\n🛑 Workflow halted to prevent unsafe data propagation.`;

        throw new Error(errorMessage);
      }
    }

    if (this.verbose) {
      console.log('\n[ResolverRunner] All steps executed successfully');
    }
  }
}

module.exports = ResolverRunner;