declare module 'qrcode' {
  interface QrOptions {
    margin?: number;
    width?: number;
    color?: { dark?: string; light?: string };
  }

  export function toCanvas(
    canvas: HTMLCanvasElement,
    text: string,
    options?: QrOptions,
  ): Promise<void>;
}
