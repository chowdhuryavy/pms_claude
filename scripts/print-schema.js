/**
 * Prints docs/SCHEMA.md from the sheet schema in apps-script/src/00_config.js,
 * so the documentation cannot drift from the code.
 */
const { createEnv } = require('../tests/helpers/gas-env');

const { ctx } = createEnv();
const lines = ['# Sheet schema', '', 'Generated from `apps-script/src/00_config.js`. Do not edit by hand.', ''];
Object.keys(ctx.SCHEMA).forEach((name) => {
  const s = ctx.SCHEMA[name];
  lines.push(`## ${name}`, '');
  lines.push(`- Spreadsheet domain: \`${s.domain}\``);
  lines.push(`- Key column: \`${s.key}\``);
  lines.push(`- Append only: ${s.append_only ? 'yes' : 'no'}`);
  lines.push('', '| Column |', '| --- |');
  s.headers.forEach((h) => lines.push(`| \`${h}\` |`));
  lines.push('');
});
process.stdout.write(lines.join('\n'));
