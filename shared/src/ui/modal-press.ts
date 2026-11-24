export function releaseClosesModal(pressed: boolean, sawDown: boolean): boolean {
  return !pressed && sawDown;
}
