export type ScreenViewTarget = 'holistic' | 'team-1' | 'team-2' | 'team-3' | 'team-4';

export interface PlayerSlot {
  index: number;
  name: string;
  color: string;
  teamId: number | null;
  connected: boolean;
}

export type GameViewConfig =
  | {
      mode: 'holistic';
      inputBufferMode: 'zero-buffer' | 'adaptive-1tick';
    }
  | {
      mode: 'team-exclusive';
      requiredTeams: number;
      allowHolisticSpectator: boolean;
      inputBufferMode: 'zero-buffer' | 'adaptive-1tick';
    };

export interface GameManifest {
  id: string;
  title: string;
  minPlayers: number;
  maxPlayers: number;
  supportsTeams: boolean;
  maxTeams: number;
  supportsBots: boolean;
  rendererType: 'phaser-2d' | 'three-3d';
  viewConfig: GameViewConfig;
  themeTokens: Record<string, string>;
}

export interface GameDefinition {
  manifest: GameManifest;
}
