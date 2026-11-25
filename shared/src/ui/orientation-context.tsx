import { createContext, useContext, type Accessor, type ParentComponent } from 'solid-js';
import type { ControllerOrientation, StageRotationDeg } from '../controller/orientation.ts';

export interface ControllerOrientationContextValue {
  orientation: Accessor<ControllerOrientation>;
  rotationDeg: Accessor<StageRotationDeg>;
}

const DEFAULT_ORIENTATION: ControllerOrientationContextValue = {
  orientation: () => 'portrait',
  rotationDeg: () => 0,
};

const ControllerOrientationContext = createContext<ControllerOrientationContextValue>(
  DEFAULT_ORIENTATION,
);

export const OrientationProvider: ParentComponent<{
  orientation: ControllerOrientation;
  rotationDeg: StageRotationDeg;
}> = (props) => (
  <ControllerOrientationContext
    value={{
      orientation: () => props.orientation,
      rotationDeg: () => props.rotationDeg,
    }}
  >
    {props.children}
  </ControllerOrientationContext>
);

export function useControllerOrientation(): ControllerOrientationContextValue {
  return useContext(ControllerOrientationContext);
}
