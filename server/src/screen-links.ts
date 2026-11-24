const VIEWS = ['holistic', 'team-1', 'team-2'] as const;

export function screenLinkLines(
  lanIp: string,
  port: number,
  roomId: string,
  hostToken: string,
): string[] {
  const lines = [
    linkLine('holistic', lanIp, port, roomId, hostToken, 'holistic'),
    linkLine('local', '127.0.0.1', port, roomId, hostToken, 'holistic'),
  ];
  for (const view of VIEWS) {
    if (view === 'holistic') continue;
    lines.push(linkLine(view, lanIp, port, roomId, hostToken, view));
  }
  return lines;
}

function linkLine(
  label: string,
  host: string,
  port: number,
  roomId: string,
  hostToken: string,
  view: string,
): string {
  const query = `room=${encodeURIComponent(roomId)}&view=${encodeURIComponent(view)}&hostToken=${encodeURIComponent(hostToken)}`;
  return `${label.padEnd(8, ' ')}  https://${host}:${port}/screen/?${query}`;
}
