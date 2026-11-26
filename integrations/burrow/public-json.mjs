import { lookup } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

const nonPublic = new BlockList();
for (const [address, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 3],
]) nonPublic.addSubnet(address, bits, "ipv4");
for (const [address, bits] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
]) nonPublic.addSubnet(address, bits, "ipv6");

const globalUnicast = new BlockList();
globalUnicast.addSubnet("2000::", 3, "ipv6");

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !nonPublic.check(address, "ipv4");
  if (family === 6) return globalUnicast.check(address, "ipv6") && !nonPublic.check(address, "ipv6");
  return false;
}

function publicLookup(hostname, options, callback) {
  lookup(hostname, { all: true, family: options.family || 0 }, (error, addresses) => {
    if (error) return callback(error);
    const usable = addresses.filter(({ address }) => isPublicAddress(address));
    if (usable.length === 0) return callback(new Error("This host has no public address."));
    if (options.all) return callback(null, usable);
    callback(null, usable[0].address, usable[0].family);
  });
}

// A Burrow process has the reader's desktop network privileges. Keep requests
// restricted to the selected public HTTPS authority and its pinned addresses.
export function publicJson(origin) {
  const authority = new URL(origin).origin;
  const signal = AbortSignal.timeout(4000);
  return async (input) => {
    const unavailable = { ok: false, status: 0, url: input };
    let url;
    try {
      url = new URL(input);
    } catch {
      return unavailable;
    }
    if (url.origin !== authority || url.protocol !== "https:" || url.username || url.password) return unavailable;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) ? !isPublicAddress(host) : !host.includes(".") || /\.(?:localhost|local|internal)\.?$/i.test(host)) {
      return unavailable;
    }

    return new Promise((resolve) => {
      try {
        const req = request(url, {
          agent: false,
          lookup: publicLookup,
          signal,
          headers: { accept: "application/json" },
        }, async (response) => {
          const status = response.statusCode ?? 0;
          const result = { ok: false, status, url: url.href };
          if (status !== 200) {
            response.destroy();
            resolve(result);
            return;
          }

          let length = 0;
          const chunks = [];
          try {
            for await (const chunk of response) {
              length += chunk.length;
              if (length > 2 * 1024 * 1024) {
                response.destroy();
                resolve(result);
                return;
              }
              chunks.push(chunk);
            }
            resolve({ ...result, ok: true, json: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
          } catch {
            resolve(result);
          }
        });
        req.on("error", () => resolve(unavailable));
        req.end();
      } catch {
        resolve(unavailable);
      }
    });
  };
}
