import { Show, type VoidComponent } from 'solid-js';
import type { GameManifest } from '../../../../shared/src/types/game.ts';
import { MatchExitControl } from '../../match-exit.tsx';
import type { RoundPanelOutput } from '../../round-panel-model.ts';
import type { ScoreRow, ScoreRules } from '../../register-games.ts';
import { MatchRejoinQr, RoundRanking, ScoreboardPanel, ScoreRulesPanel } from '../../score-rules.tsx';

export interface HolisticMatchShellProps {
  gameId: string;
  primary: boolean;
  match: boolean;
  matchOver: boolean;
  manifest: GameManifest | undefined;
  banner: string;
  scoreHeader: string;
  scoreRows: readonly ScoreRow[];
  scoreRules: ScoreRules | null;
  roundPanel: RoundPanelOutput | null;
  onQr: (canvas: HTMLCanvasElement) => void;
  onMatchCanvas: (canvas: HTMLCanvasElement) => void;
  onPlayAgain: () => void;
  onExit: () => void;
}

export const HolisticMatchShell: VoidComponent<HolisticMatchShellProps> = (props) => {
  return (
    <section class="match" data-game={props.gameId}>
      <MatchRejoinQr onQr={(canvas) => props.onQr(canvas)} />
      <Show when={props.manifest?.title}>
        <span class="match-game-title">{props.manifest?.title}</span>
      </Show>
      <MatchExitControl
        primary={props.primary}
        match={props.match}
        manifest={props.manifest}
        onConfirm={() => props.onExit()}
      />
      <p class="match-banner">{props.banner}</p>
      <Show when={props.roundPanel === null}>
        <Show when={props.scoreRules}>
          {(rules) => <ScoreRulesPanel rules={rules()} />}
        </Show>
      </Show>
      <Show when={props.roundPanel}>
        {(panel) => (
          <div class="match-side match-side-left">
            <Show when={props.scoreRules}>
              {(rules) => <ScoreRulesPanel rules={rules()} />}
            </Show>
            <RoundRanking mode={panel().mode} rows={panel().rankRows} />
          </div>
        )}
      </Show>
      <canvas
        ref={(canvas) => props.onMatchCanvas(canvas)}
        width={800}
        height={800}
      />
      <Show when={!props.roundPanel}>
        <ScoreboardPanel header={props.scoreHeader} rows={props.scoreRows} />
      </Show>
      <Show when={props.roundPanel}>
        {(panel) => <ScoreboardPanel header={props.scoreHeader} rows={panel().totalRows} />}
      </Show>
      <Show when={props.primary && props.matchOver}>
        <div class="podium">
          <button type="button" class="key" onClick={() => props.onPlayAgain()}>
            PLAY AGAIN
          </button>
          <button type="button" class="key" onClick={() => props.onExit()}>
            RETURN TO LOBBY
          </button>
        </div>
      </Show>
    </section>
  );
};
