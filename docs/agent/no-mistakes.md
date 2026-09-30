# no-mistakes gate

Codex-authored lanes (engine, ui, evals) push through a local gate that runs Claude as the
reviewer before the branch reaches GitHub, opens the PR and watches CI. Set up the same way as in
another repo of mine that already runs the gate, whose docs hold the installation provenance.

## Version

- no-mistakes v1.41.2 (`867d64d`), pinned. The CLI prints a newer-version banner; ignore it. Do
  not run `no-mistakes update`: changing the version is the owner's decision.
- gh v2.98.0 at `~/.local/bin/gh` (needed for `gh pr checks --json`).
- Gate initialised for this repo on 2026-09-29 with `no-mistakes init`: remote `no-mistakes`, bare
  repo under `~/.no-mistakes/repos/`, daemon running as a systemd user service. Never restart the
  daemon with `--force`.

## Repository configuration (.no-mistakes.yaml)

- `agent: claude`: Claude reviews. No fallback list, so Codex can never review Codex; if Claude
  cannot run, the gate fails before its first step.
- `commands.test: npm test`: the offline suite from docs/agent/verification.md.
- `auto_fix.review: 0`: review findings park for the lane agent to fix on its own branch.
- `auto_fix.{rebase,test,document,lint,ci}: 1`: one automatic attempt each.
- `commands.lint` is omitted, so lint folds into the document step.

The gate reads `agent`, `commands.*` and document instructions from the default branch, so this
file reached main through the Stop 2 foundation PR by a plain push. Changes to those fields follow
the same path: an ordinary PR, never a gated push of the change itself.

## Using it

    git push no-mistakes <branch>            # gated delivery
    no-mistakes axi status                   # where the run is
    no-mistakes axi logs --step review --full
    no-mistakes axi sync                     # when the run offers branch_sync.next_action = sync
    no-mistakes rerun                        # validate the preserved head again
    no-mistakes axi abort                    # discard a stuck run

After a pipeline moves the branch, obey `branch_sync.next_action` instead of resetting, rebasing or
force-pushing.

A plain `git push origin <branch>` bypasses the gate. It is only for changing gate configuration
before it exists on main, or when Claude is unavailable; in the second case the PR still needs a
Claude review before the owner merges.
