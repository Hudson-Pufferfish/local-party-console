interface GuardTarget {
  closest?: (selector: string) => unknown;
  parentElement?: GuardTarget | null;
}

export interface GuardEvent {
  target: unknown;
  detail?: number;
  preventDefault(): void;
}

interface GuardSelection {
  isCollapsed: boolean;
  removeAllRanges(): void;
}

export interface PointerGuardDocument {
  readonly body: unknown;
  readonly activeElement: unknown;
  readonly defaultView: { getSelection?: () => GuardSelection | null } | null;
  addEventListener(type: string, listener: (event: GuardEvent) => void): void;
  removeEventListener(type: string, listener: (event: GuardEvent) => void): void;
}

function asElement(target: unknown): GuardTarget | null {
  if (typeof target !== 'object' || target === null) return null;
  const node = target as GuardTarget;
  if (typeof node.closest === 'function') return node;
  if (node.parentElement !== undefined && node.parentElement !== null) {
    return typeof node.parentElement.closest === 'function' ? node.parentElement : null;
  }
  return null;
}

function isEditable(el: GuardTarget | null): boolean {
  return el !== null && el.closest?.('input, textarea') != null;
}

function blurActive(doc: PointerGuardDocument): void {
  const active = doc.activeElement;
  if (active === null || active === undefined || active === doc.body) return;
  if (typeof (active as { blur?: unknown }).blur === 'function') {
    (active as { blur: () => void }).blur();
  }
}

function clearSelection(doc: PointerGuardDocument): void {
  const selection = doc.defaultView?.getSelection?.();
  if (selection !== null && selection !== undefined && !selection.isCollapsed) {
    selection.removeAllRanges();
  }
}

export function installPointerGuard(doc: PointerGuardDocument): () => void {
  const onMouseDown = (event: GuardEvent): void => {
    const el = asElement(event.target);
    if (isEditable(el)) return;
    const isButton = el !== null && el.closest?.('button') != null;
    const isMultiClick = typeof event.detail === 'number' && event.detail > 1;
    if (!isButton && !isMultiClick) return;
    event.preventDefault();
    blurActive(doc);
    clearSelection(doc);
  };

  const onSelectStart = (event: GuardEvent): void => {
    if (isEditable(asElement(event.target))) return;
    event.preventDefault();
  };

  doc.addEventListener('mousedown', onMouseDown);
  doc.addEventListener('selectstart', onSelectStart);

  return () => {
    doc.removeEventListener('mousedown', onMouseDown);
    doc.removeEventListener('selectstart', onSelectStart);
  };
}
