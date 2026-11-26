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

## Share or check an exact edition

```sh
node bin/blyggdrasil.mjs proof-link POST_URL --version 1
node bin/blyggdrasil.mjs verify-quote POST_URL --version 1 --quote "at five" --json
```

The verifier also accepts `origin`, `id`, and `version` query parameters. This lets another client hand off what its reader actually saw. The [Burrow extension](integrations/burrow/README.md) can copy that link and show the three proof checks in its reader. Use the [quote checker](quote/?example=pinned) to compare a cited excerpt with the signed current edition. The [interoperability packet](interop/README.md) contains the same signed editions and altered copies for another implementation to verify.

## Audit an archive

```sh
node bin/audit-blyg.mjs https://fishbiscuit.me/blyg/ --limit 10
node bin/render-tree.mjs https://fishbiscuit.me/blyg/ --out tree/fishbiscuit/index.html --check
```

The audit emits one JSON line per checked public item. The [browser audit](audit/) shows the same checks, with a filter for issues. The [v1 report schema](schemas/post-proof.v1.json) describes the machine-readable single-post proof.

## Try the examples

[Compare the pinned original and edited edition](https://fishbiscuit.me/blyggdrasil/demo/edit-and-pin/). The demo publisher signed both versions of one post. The page fetches its actual pinned item and current item, then displays the text checked by the verifier. Each side links to its item JSON and full post proof.

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

## Prepare a publisher release

- **Pins.** `bin/pin-prepare.mjs` captures the verified edition. `bin/pin-install.mjs` installs it into the local static publisher and records its changelog flag. `bin/pin-audit.mjs` compares builds to ensure existing promises still serve the same pin bytes.
- **Continuity.** `bin/export-public-bundle.mjs` packages a public blyg with its advertised pins. `bin/verify-public-bundle.mjs` verifies them offline. `bin/plan-blyg-move.mjs` prepares a dry-run move plan. `bin/recovery-readiness.mjs` checks whether the publisher serves the tree pin that names the recovery key.
- **Archives.** `bin/republish-archive.mjs` shows the original dates and the proposed identifiers and source links for public entries. `bin/emit-archive.mjs` writes signed items to an explicit local output directory. Run either with `--help` for its required files and options.
- **Release checks.** `bin/release-overlay.mjs` builds a scoped public directory over an existing baseline and checks existing pins. `bin/release-smoke.mjs` checks the public tree and both editions of the edit-and-pin example over HTTP.

Run `npm test` for the portable suite, `npm run test:interop` after installing the optional Python reader dependency, and `npm run test:live` to exercise the public demo URLs.
