## MODIFIED Requirements

### Requirement: The runner audits stored payloads after the last selected step
After the last selected step has passed its postconditions, the runner SHALL spawn `src/audit-payloads.js` as a child process, as it does for steps. The audit SHALL be scoped the same way postconditions are: the runner passes one `--entity` for each audit-registry entity whose table is written by a selected step (per the tables-written list in the postconditions requirement). Today `persons` → `person`, `refs` → `reference`, `authorities` → `authority`, `schemas` → `schema`, `collections` → `collection` and `specimens` → `specimen`; the `pbot-persons` and `pbot-refs` steps write the same tables as `persons` and `refs`.

- When no selected step writes an audited table, the runner SHALL NOT spawn the audit, and it SHALL record in the run log that no audited tables were written.
- A non-zero audit exit SHALL be a run failure: the runner reports it and exits non-zero.
- The scope follows from the selection. The runner SHALL NOT provide a flag that skips or widens the audit.
- The audit SHALL NOT run when a step or check has already failed.

#### Scenario: Full run audits every audited entity
- **WHEN** `specimens` passes its postconditions in a full run
- **THEN** the runner spawns the audit with one `--entity` for each of `collection`, `specimen`, `person`, `reference`, `authority` and `schema`, and reports the run successful only if the audit exits 0

#### Scenario: Audit failure fails the run
- **WHEN** every step succeeds but the audit reports a violation
- **THEN** the runner exits non-zero and names the audit as the failed check

#### Scenario: Narrowed run audits only what it wrote
- **WHEN** the runner is invoked with `--only specimens`
- **THEN** the audit is spawned with `--entity specimen` only, and `collections` is not read

#### Scenario: Run that writes no audited table
- **WHEN** the runner is invoked with `--only authority-opinions`
- **THEN** the audit is not spawned, and the run log records that no audited tables were written

#### Scenario: No audit after a failure
- **WHEN** `collections` fails its postconditions
- **THEN** the runner halts without spawning the audit

#### Scenario: The refs steps audit reference
- **WHEN** the runner is invoked with `--only refs` or `--only pbot-refs`
- **THEN** the audit is spawned with `--entity reference` only

#### Scenario: The authorities step audits authority
- **WHEN** the runner is invoked with `--only authorities`
- **THEN** the audit is spawned with `--entity authority` only

#### Scenario: The pbot-schemas step audits schema
- **WHEN** the runner is invoked with `--only pbot-schemas`
- **THEN** the audit is spawned with `--entity schema` only; `characters` and `states` are not audited, because no audit-registry entry names them
