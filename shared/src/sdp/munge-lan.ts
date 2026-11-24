export interface MungeResult {
  sdp: string;
  ok: boolean;
}

export function mungeLanSdp(sdp: string, lanIp: string): MungeResult {
  const newline = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(/\r?\n/);
  const next: string[] = [];
  let keptHost = 0;

  for (const line of lines) {
    if (!line.startsWith('a=candidate:')) {
      next.push(line);
      continue;
    }
    const parts = line.split(' ');
    const address = parts[4];
    const typIndex = parts.indexOf('typ');
    const type = typIndex >= 0 ? parts[typIndex + 1] : undefined;
    if (address === undefined || type !== 'host') continue;
    if (address === lanIp) {
      keptHost += 1;
      next.push(line);
      continue;
    }
    if (address.toLowerCase().endsWith('.local')) {
      parts[4] = lanIp;
      keptHost += 1;
      next.push(parts.join(' '));
    }
  }

  if (keptHost === 0) return { sdp, ok: false };
  return { sdp: next.join(newline), ok: true };
}
