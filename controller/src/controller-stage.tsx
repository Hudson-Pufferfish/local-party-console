import { createEffect, createMemo, createSignal, type Element, type ParentComponent } from 'solid-js';
import {
  resolveStageOrientation,
  type ControllerOrientation,
  type OrientationPreference,
  type ResolvedStageOrientation,
} from '../../shared/src/controller/orientation.ts';
import { OrientationProvider } from '../../shared/src/ui/orientation-context.tsx';
import type { ThemeVars } from './register-games.ts';

function readNativePortrait(): boolean {
  if (typeof window === 'undefined') return true;
  if (typeof window.matchMedia === 'function') {
    const query = window.matchMedia('(orientation: portrait)');
    if (typeof query.matches === 'boolean') return query.matches;
  }
  return window.innerHeight >= window.innerWidth;
}

export const ControllerStage: ParentComponent<{
  pref: OrientationPreference;
  supportedOrientations?: readonly ControllerOrientation[];
  joined?: boolean;
  style?: ThemeVars;
  nativePortraitOverride?: boolean;
  onResolved?: (resolved: ResolvedStageOrientation) => void;
  children?: Element;
}> = (props) => {
  const [nativePortrait, setNativePortrait] = createSignal(
    props.nativePortraitOverride ?? readNativePortrait(),
  );
  const [shellWidth, setShellWidth] = createSignal(0);
  const [shellHeight, setShellHeight] = createSignal(0);
  let shellEl: HTMLElement | undefined;

  function syncViewport(): void {
    if (props.nativePortraitOverride === undefined) {
      setNativePortrait(readNativePortrait());
    }
    if (shellEl !== undefined) {
      const width = shellEl.clientWidth;
      const height = shellEl.clientHeight;
      if (width > 0 && height > 0) {
        setShellWidth(width);
        setShellHeight(height);
        return;
      }
    }
    if (typeof window !== 'undefined') {
      const vp = window.visualViewport;
      const width = Math.round(vp?.width ?? window.innerWidth);
      const height = Math.round(vp?.height ?? window.innerHeight);
      if (width > 0 && height > 0) {
        setShellWidth(width);
        setShellHeight(height);
      }
    }
  }

  createEffect(
    () => props.nativePortraitOverride,
    (override) => {
      if (override !== undefined) {
        setNativePortrait(override);
        return;
      }
      if (typeof window === 'undefined') return;
      const media =
        typeof window.matchMedia === 'function'
          ? window.matchMedia('(orientation: portrait)')
          : null;
      const onChange = (): void => {
        syncViewport();
      };
      syncViewport();
      const observer =
        typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onChange) : null;
      if (shellEl !== undefined) observer?.observe(shellEl);
      media?.addEventListener('change', onChange);
      window.addEventListener('resize', onChange);
      window.visualViewport?.addEventListener('resize', onChange);
      return () => {
        observer?.disconnect();
        media?.removeEventListener('change', onChange);
        window.removeEventListener('resize', onChange);
        window.visualViewport?.removeEventListener('resize', onChange);
      };
    },
  );

  const resolved = createMemo(() =>
    resolveStageOrientation({
      pref: props.pref,
      nativePortrait: nativePortrait(),
      supportedOrientations: props.supportedOrientations,
    }),
  );

  createEffect(
    () => resolved(),
    (next) => {
      props.onResolved?.(next);
    },
  );

  const shellStyle = (): ThemeVars => {
    const base = props.style ?? {};
    const width = shellWidth();
    const height = shellHeight();
    if (width <= 0 || height <= 0) return base;
    return {
      ...base,
      '--stage-w': `${height}px`,
      '--stage-h': `${width}px`,
    };
  };

  return (
    <main
      class="shell"
      data-joined={props.joined ? 'true' : 'false'}
      style={shellStyle()}
      ref={(el) => {
        shellEl = el;
        syncViewport();
      }}
    >
      <div
        class="stage"
        data-orientation={resolved().orientation}
        data-rotation={String(resolved().rotationDeg)}
        data-supported={resolved().supported ? 'true' : 'false'}
      >
        <OrientationProvider
          orientation={resolved().orientation}
          rotationDeg={resolved().rotationDeg}
        >
          {props.children}
        </OrientationProvider>
      </div>
    </main>
  );
};
