import type { VoidComponent } from 'solid-js';

export const PreflightStrip: VoidComponent<{
  power: 'ok' | 'low-power';
  powerReady: boolean;
  cores: number;
  rttMs: number | null;
  jitterMs: number | null;
  portrait: boolean;
}> = (props) => {
  const powerWarn = (): boolean => props.powerReady && props.power === 'low-power';
  return (
    <div class="strip">
      <p class="pill" data-warn={powerWarn() ? 'true' : 'false'}>
        <span>POWER</span>
        <span>{powerLabel(props.powerReady, props.power)} {props.cores < 0 ? '--' : props.cores}</span>
      </p>
      <p class="pill">
        <span>WI-FI</span>
        <span>{wifiLabel(props.rttMs, props.jitterMs)}</span>
      </p>
      <p class="pill" data-warn={props.portrait ? 'true' : 'false'}>
        <span>ORIENTATION</span>
        <span>{props.portrait ? 'TURN' : 'OK'}</span>
      </p>
    </div>
  );
};

function powerLabel(ready: boolean, power: 'ok' | 'low-power'): string {
  if (!ready) return '--';
  return power === 'low-power' ? 'LOW' : 'OK';
}

function wifiLabel(rttMs: number | null, jitterMs: number | null): string {
  if (rttMs === null) return 'WAIT';
  if (jitterMs === null) return `${Math.round(rttMs)} MS`;
  return `${Math.round(rttMs)} MS J${Math.round(jitterMs)}`;
}
