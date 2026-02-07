function getNested(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((o, k) =>
    o && o[k] !== undefined ? o[k] : undefined, obj);
}

const mathFunctions = {
  add: (a, b) => a + b,
  subtract: (a, b) => a - b,
  multiply: (a, b) => a * b,
  divide: (a, b) => a / b,
  equals: (a, b) => a === b,
  greater: (a, b) => a > b,
  less: (a, b) => a < b,
  sum: arr => arr.reduce((a, v) => a + v, 0),
  avg: arr => arr.reduce((a, v) => a + v, 0) / arr.length,
  min: arr => Math.min(...arr),
  max: arr => Math.max(...arr),
  increment: a => a + 1,
  decrement: a => a - 1,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  abs: Math.abs
};

function evaluateMath(expr, context, addWarning) {
  expr = expr.replace(/\{([^\}]+)\}/g, (_, p) => {
    const v = getNested(context, p.trim());
    return v !== undefined ? v : 0;
  });

  try {
    const fn = new Function(
      ...Object.keys(mathFunctions),
      `return ${expr};`
    );
    return fn(...Object.values(mathFunctions));
  } catch (e) {
    addWarning?.(`Failed to evaluate math "${expr}": ${e.message}`);
    return 0;
  }
}

function evaluateCondition(cond, ctx) {
  cond = cond.trim();
  const eq = cond.match(/^\{(.+)\}\s+equals\s+"(.*)"$/);
  if (eq) return getNested(ctx, eq[1]) == eq[2];
  const gt = cond.match(/^\{(.+)\}\s+greater than\s+(\d+\.?\d*)$/);
  if (gt) return +getNested(ctx, gt[1]) > +gt[2];
  const lt = cond.match(/^\{(.+)\}\s+less than\s+(\d+\.?\d*)$/);
  if (lt) return +getNested(ctx, lt[1]) < +lt[2];
  return Boolean(getNested(ctx, cond.replace(/[{}]/g, '')));
}

module.exports = {
  getNested,
  mathFunctions,
  evaluateMath,
  evaluateCondition
};
