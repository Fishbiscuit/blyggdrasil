# Read and verify a Blyggdrasil tree

- Start at [the Fishbiscuit tree snapshot](tree/fishbiscuit/index.html). It has accounts and dated posts in HTML, with links to the canonical item documents. Read it with JavaScript disabled or from an HTML client. The snapshot is refreshed by the renderer. Consult the linked live archive for newer items.
- Use the [Blygger manifest](https://fishbiscuit.me/blyg/blyg.json) to discover the signed tree and the [archive index](https://fishbiscuit.me/blyg/items/index.json) to find current post versions. Read the manifest’s URL templates, where supplied. Fetch individual item JSON for the actual Markdown, hash, signature and original-source links. The manifest identifies the publisher. Verify its tree to see which keys it authorizes.
- Treat account listings as claims until the back-reference is checked. The browser links to the evidence it checked. Fetch failures produce an unavailable verdict, so a reader can retry a single account.

## Verify a post

```sh
node bin/blyggdrasil.mjs verify-post https://fishbiscuit.me/blyg/t/7phxkgdpcecwvxa8xwbfwtq3pm/ --version 1 --json
```

`checks.content` compares the served Markdown with the recorded SHA-256 hash. `checks.signature` verifies Ed25519 against that recorded hash. `checks.signer` checks whether the signed tree authorizes the key. Use `--expect-key <did:key>` with a separately trusted public key for an independent identity check. The JSON also includes the resolved version, source link, and tree and manifest data URLs when available. A valid tree reports accepted key changes and former origins claimed in its signed text.

Exit codes are `0` for verified, `1` for failed, unsigned or unavailable, and `2` for usage errors. Use the JSON `status` to distinguish each result. A version-specific check uses the current item if the version still matches and otherwise requires the publisher’s pinned copy. To make a proof link survive later edits, publish a pin for that version.

The source linked by an archive item is attribution. Signing an imported copy authenticates the copy on the blyg under the blyg’s key.

## Try the examples

Check the [signed original](verify/?example=original) and the [edited copy](verify/?example=edited) in a served checkout, or run:

```sh
node --test test/proof-examples.mjs
```

Both use the same public [test evidence](demo/proof/examples.json). The edited text fails the hash comparison while the recorded signature and signing key still check. The [continuity rehearsal](demo/continuity/) uses throwaway keys and simulated origins for a move, rotation, recovery, and missing evidence cases.

To exercise the move and recovery through a real HTTP redirect and version endpoints, run `node --test test/continuity-http.mjs` in an environment that allows loopback listeners. The test starts and closes two temporary local servers.

## Refresh the public HTML

```sh
node bin/render-tree.mjs https://fishbiscuit.me/blyg/ --out tree/fishbiscuit/index.html
```

Use `--mirror <directory>` if you have a local copy of the published public Blygger documents. Keep the canonical HTTPS address as the first argument.
