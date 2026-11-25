import { For, type VoidComponent } from 'solid-js';
import {
  normalizeOrientationPreference,
  type OrientationPreference,
} from '../../shared/src/controller/orientation.ts';

export const ORIENTATION_STORAGE_KEY = 'party-controller-orientation';

const OPTIONS: readonly {
  value: OrientationPreference;
  label: string;
  ariaLabel: string;
}[] = [
  { value: 'portrait', label: 'PORTRAIT', ariaLabel: 'Portrait orientation' },
  { value: 'landscape-left', label: 'LAND ↻', ariaLabel: 'Landscape clockwise' },
  { value: 'landscape-right', label: 'LAND ↺', ariaLabel: 'Landscape counter-clockwise' },
];

export function readStoredOrientationPref(
  storage?: Pick<Storage, 'getItem'>,
): OrientationPreference {
  try {
    const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (target === undefined) return 'portrait';
    return normalizeOrientationPreference(target.getItem(ORIENTATION_STORAGE_KEY));
  } catch {
    return 'portrait';
  }
}

export function writeStoredOrientationPref(
  pref: OrientationPreference,
  storage?: Pick<Storage, 'setItem'>,
): void {
  try {
    const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    target?.setItem(ORIENTATION_STORAGE_KEY, pref);
  } catch {
    // Ignore storage quota or private browsing errors.
  }
}

export const OrientationToggle: VoidComponent<{
  value: OrientationPreference;
  disabled?: boolean;
  onChange: (next: OrientationPreference) => void;
}> = (props) => {
  return (
    <div
      class="orient-toggle"
      role="group"
      aria-label="Controller orientation"
      data-locked={props.disabled ? 'true' : 'false'}
    >
      <For each={OPTIONS}>
        {(option) => (
          <button
            type="button"
            class="orient-btn"
            data-pref={option.value}
            data-active={props.value === option.value ? 'true' : 'false'}
            aria-pressed={props.value === option.value ? 'true' : 'false'}
            aria-label={option.ariaLabel}
            disabled={props.disabled === true}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              if (props.disabled) return;
              props.onChange(option.value);
            }}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
};
