import dns from 'node:dns';
import { env } from '../config/env';

let installed = false;

/**
 * Fallback DNS resolver.
 *
 * Some ISP/router resolvers refuse specific hostnames (e.g. `*.elastic.cloud`),
 * which surfaces as `getaddrinfo ENOTFOUND`/`EAI_AGAIN` even though the name is
 * valid. When `DNS_SERVERS` is set, we retry *failed* lookups against those
 * servers. Healthy lookups are untouched, so this is safe to leave enabled.
 *
 * Applied process-wide (affects `http`/`https`/`tls`/`net` + fetch/undici).
 */
export function installDnsFallback(): void {
  if (installed || env.dnsServers.length === 0) return;
  installed = true;

  const resolver = new dns.Resolver({ timeout: 3000, tries: 2 });
  resolver.setServers(env.dnsServers);

  const originalLookup = dns.lookup.bind(dns);

  const resolveWithFallback = (
    hostname: string,
  ): Promise<{ address: string; family: number }[]> =>
    new Promise((resolve, reject) => {
      let pending = 2;
      const records: { address: string; family: number }[] = [];
      const finish = () => {
        pending -= 1;
        if (pending > 0) return;
        if (records.length > 0) resolve(records);
        else reject(new Error('ENOTFOUND'));
      };
      resolver.resolve4(hostname, (err, addrs) => {
        if (!err && addrs) addrs.forEach((a) => records.push({ address: a, family: 4 }));
        finish();
      });
      resolver.resolve6(hostname, (err, addrs) => {
        if (!err && addrs) addrs.forEach((a) => records.push({ address: a, family: 6 }));
        finish();
      });
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dns as any).lookup = function patchedLookup(
    hostname: string,
    options: unknown,
    callback?: unknown,
  ): void {
    const cb = (typeof options === 'function' ? options : callback) as
      | ((...args: unknown[]) => void)
      | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts: any = typeof options === 'function' ? {} : options ?? {};
    if (typeof cb !== 'function') return;

    originalLookup(hostname, opts, (err, address, family) => {
      if (!err) {
        cb(null, address, family);
        return;
      }
      resolveWithFallback(hostname)
        .then((records) => {
          const wanted = opts.family ?? 0;
          const chosen = records.find((r) => r.family === wanted) ?? records[0];
          if (opts.all) cb(null, records);
          else cb(null, chosen.address, chosen.family);
        })
        .catch(() => cb(err));
    });
  };

  console.log(`[dns] fallback resolver enabled for: ${env.dnsServers.join(', ')}`);
}