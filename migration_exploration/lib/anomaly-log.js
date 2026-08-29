// Per-status-folder anomaly ledger, shared across every pair handler in that folder.
// Each handler logs skip/warning events as it processes rows, then flush() rewrites
// <folder>/anomalies.csv, replacing only this script's own prior rows (matched by the
// `script` column) so re-running one handler never clobbers its siblings' findings.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const HEADER = 'opinion_no,script,target_table,severity,issue,description';

function csvField(value) {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function createAnomalyLog(handlerFileUrl) {
  const scriptPath = fileURLToPath(handlerFileUrl);
  const scriptName = basename(scriptPath);
  const csvPath = join(dirname(scriptPath), 'anomalies.csv');
  const rows = [];

  return {
    // severity: 'skip' (row excluded from target_table entirely) or 'warning' (row
    // written, but has a noteworthy property worth flagging).
    log(opinionNo, targetTable, severity, issue, description) {
      if (severity !== 'skip' && severity !== 'warning') {
        throw new Error(`anomaly-log: severity must be 'skip' or 'warning', got '${severity}'`);
      }
      rows.push([opinionNo, scriptName, targetTable, severity, issue, description]);
    },
    // Rewrites the folder's anomalies.csv: keeps every other script's rows untouched,
    // drops this script's previous rows, appends this run's fresh rows.
    flush() {
      const existingLines = existsSync(csvPath)
        ? readFileSync(csvPath, 'utf8').trim().split('\n').slice(1)
        : [];
      const kept = existingLines.filter((line) => line.split(',')[1] !== scriptName);
      const fresh = rows.map((r) => r.map(csvField).join(','));
      writeFileSync(csvPath, [HEADER, ...kept, ...fresh].join('\n') + '\n');
      return rows.length;
    },
  };
}
