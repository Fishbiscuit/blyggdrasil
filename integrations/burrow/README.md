# Blyggdrasil for Burrow

Adds **Copy edition proof link** to a reading entry’s actions in [Burrow](https://github.com/aneeshsathe/blygger-desktop). The sheet shows the edition number and a copyable URL. Opening it in Blyggdrasil checks that exact public edition.

Requires Node.js 20 or newer on Burrow’s PATH and a Burrow release with [BXP reading actions](https://github.com/aneeshsathe/blygger-desktop/blob/main/docs/EXTENSIONS.md#reading-slots). Copy this folder as `blyggdrasil-proof` into Burrow’s extensions directory (`~/.config/blygger/extensions/` by default). Add this line to the Burrow configuration and approve the reading permission when prompted.

```text
extension = blyggdrasil-proof
```

Open a subscribed Blygger post, use its `⋯` menu, select **Copy edition proof link**, and copy the URL shown. Creating the link works offline and uses only the origin, item ID, and version in the selected entry.
