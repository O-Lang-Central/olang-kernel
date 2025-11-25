function parse(code) {
  // Very minimal parser: split into lines and create AST
  const lines = code.split('\n').map(line => line.trim()).filter(Boolean);
  return lines.map((line, i) => ({ step: i + 1, action: line }));
}

module.exports = { parse };
