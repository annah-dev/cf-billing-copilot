Before I merge PR #3, one more round, then the usual gate review:

1. Seed realism. Every customer's July and August invoices are identical to the cent because
   daily usage is constant (3,000 requests every day except the spike). Give usage a
   deterministic day-to-day shape (for example weekday and weekend) on every meter and customer.
   Keep each customer's August and September monthly quantities exactly as they are, so those
   invoices, $412.87 and the 38% change do not move; make July's quantities differ from
   August's. The anomaly detector must still flag only the September 18 spike, so keep normal
   daily variation well under 3x the baseline. Update the seed tests and src/engine/README.md.
2. Gate prompt text. The gate runs Claude Code (claude pid=54062 in round 1), and Claude Code
   normally saves each session, including its prompt, under ~/.claude/projects. Look there
   read-only for the gate sessions of this PR's review rounds, match them by time and content,
   and put the exact prompt text into the 02g files. If you cannot find them, keep the current
   note and say where you looked. Copy nothing else from those logs.
