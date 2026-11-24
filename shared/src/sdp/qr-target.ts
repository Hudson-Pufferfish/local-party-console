export const CONTROLLER_REV = 8;

export function qrTarget(lanIp: string, port: number, code: string): string {
  return `https://${lanIp}:${port}/controller?rev=${CONTROLLER_REV}&room=${code}`;
}
