// Simple CLI argument parser: --key value or --flag
module.exports = (function parseArgs() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const key = a[i].slice(2);
      if (a[i + 1] && !a[i + 1].startsWith('--')) {
        out[key] = a[++i];
      } else {
        out[key] = true; // flag with no value
      }
    }
  }
  return out;
})();
