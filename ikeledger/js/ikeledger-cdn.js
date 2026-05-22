export async function importFromCdn(urls, packageName) {
  const failures = [];

  for (const url of urls) {
    try {
      return await import(url);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${url} -> ${reason}`);
    }
  }

  throw new Error(
    `Unable to load ${packageName} from configured CDNs. ${failures.join(" | ")}`
  );
}
