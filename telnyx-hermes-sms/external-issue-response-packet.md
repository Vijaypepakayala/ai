# External issue response packet

This packet supports internal review for `TEL-589` and the linked external
issues in `team-telnyx/telnyx-hermes-sms`.

## Root cause summary

Issue `#5` was caused by an ambiguous contributor setup path:

- the repo README already mentioned `HERMES_AGENT_ROOT`, but the failure report
  shows a contributor pointed it at `/root/.hermes` without a local
  `hermes-agent` checkout under that path
- runtime and plugin-loading tests import Hermes `gateway.*` modules directly,
  so those tests cannot run from this repo alone
- the previous docs did not separate "install the plugin in Hermes" from "set up
  a contributor test environment", which also matches the confusion visible in
  issue `#3`

## Repo changes in this patch

- added a goal-based fork in `README.md` so installers and contributors take
  different setup paths
- made the Hermes checkout contract explicit, including the exact
  `~/.hermes/hermes-agent` example from the observed failure mode
- added a quick shell sanity check for `HERMES_AGENT_ROOT`
- documented that static tests run without Hermes but runtime/plugin-loading
  tests require a local checkout
- added static test coverage so the new prerequisite text stays documented

## Recommended GitHub response for issue #5

Suggested maintainer reply:

> Thanks for the report. The failing step was that `HERMES_AGENT_ROOT` needs to
> point at a real local `hermes-agent` source checkout, not only the Hermes data
> directory. If your Hermes checkout lives under `~/.hermes/hermes-agent`, use
> `export HERMES_AGENT_ROOT="$HOME/.hermes/hermes-agent"` before running the
> runtime/plugin-loading tests. We tightened the README to spell out that
> prerequisite and added a quick validation command for the checkout path.

## Note for issue #3

No extra code follow-up is required from this patch. Recommended close-the-loop
response:

> The repo now documents the one-command installer path first:
> `uvx --from "git+https://github.com/team-telnyx/telnyx-hermes-sms.git" telnyx-hermes-sms`.
> If you only want the Hermes plugin, use that install flow and the enablement
> steps in `README.md`; you do not need to manually copy plugin files or set up
> the contributor test harness first.

If adoption questions continue after that, the next likely follow-up would be a
released/tagged install target so the stable command can move from default-branch
Git install to a versioned release command.
