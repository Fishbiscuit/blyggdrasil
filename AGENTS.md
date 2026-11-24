# Driving Blyggdrasil with a coding agent

This file is optional. Delete it and nothing breaks. Every outcome is decided by [SPEC.md](SPEC.md) and the command line, never by the agent.

## Rules

1. **Only run `bin/blyggdrasil.mjs`** for keys, trees, checks and archives. Don't write signatures, claims blocks or archive files by hand, and don't "fix" a verdict.
2. **Private keys stay private.** Key files live in `~/.blyggdrasil/` with mode 600. Never print their contents, paste them into chat, commit them, upload them or send them anywhere. The `.gitignore` blocks `*.key.json` and `keys/`.
3. **The person posts.** Proof lines, tree posts and republished archives go out under their name. Show the exact text and where it will appear, and post only with their explicit approval for that post.
4. **Private stays private.** Files under `archive/private/` are never published, quoted or summarised into public posts.
5. **Report verdicts as they are.** `claimed` and `unreachable` are not `verified`. Say which branches failed and why.

## Setting up a tree for someone

1. Ask for their blyg address and the accounts they want to connect.
2. `node bin/blyggdrasil.mjs keygen`, then `keygen --label recovery`. Tell them to back up both files, and to keep the recovery key offline.
3. `node bin/blyggdrasil.mjs proof --trunk <blyg> --key ~/.blyggdrasil/main.json`. Give them the line to post on each account. For X, ask for the proof post's address.
4. `node bin/blyggdrasil.mjs tree … --out tree.md`. They publish it as a post. Then point the blyg at it: a profile link labelled `Blyggdrasil`, or the `blyggdrasil` key in `blyg.json`.
5. `node bin/blyggdrasil.mjs verify <blyg>`, and show them the result.
