# Blyggdrasil for Burrow

Adds two actions to public Blygger posts in [Burrow](https://github.com/aneeshsathe/blygger-desktop).

- **Copy edition proof link** copies a URL for the exact edition, using the origin, item ID, and version already held by the reader.
- **Verify this edition** checks the text hash, signature, and the signer’s authority in the publisher’s tree. It also checks whether the Markdown held by Burrow matches the verified source. The sheet retains the exact-edition link when a network check is unavailable.

## Install

Requires Node.js 20 or newer and a Burrow release with [BXP reading actions](https://github.com/aneeshsathe/blygger-desktop/blob/main/docs/EXTENSIONS.md#reading-slots). From the Blyggdrasil checkout, package the extension into a new directory. Put that directory in Burrow’s extensions directory (`~/.config/blygger/extensions/` by default).

```sh
node integrations/burrow/bundle.mjs /path/to/new/blyggdrasil-proof
```

The package uses the absolute path to the Node executable on this machine. Add the extension to your Burrow configuration and approve `reading.read` and `net` when prompted.

```text
extension = blyggdrasil-proof
```

Open a subscribed Blygger post, then choose either action from its `⋯` menu.

Link copying works offline. Verification makes bounded public HTTPS requests to the selected publisher’s authority, without cookies or authentication, and keeps the reading copy’s text on your machine. A publisher that serves its proof on a different host or requires a redirect may need to be checked in the web verifier.

## Reproduce the checks

```sh
node --test test/burrow-link.mjs test/burrow-edition.mjs test/burrow-bundle.mjs
node --test test/burrow-live.mjs
```

The second command uses the published pinned and current editions of the [edit-and-pin example](https://fishbiscuit.me/blyggdrasil/demo/edit-and-pin/).
