export const CONTROLLER_REV = '0.0.7';

export function qrTarget(lanIp: string, port: number, code: string): string {
  return `https://${lanIp}:${port}/controller?rev=${CONTROLLER_REV}&room=${code}`;
}
