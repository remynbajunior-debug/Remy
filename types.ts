export interface Player {
  id: string;
  name: string;
  teamId: string;
  gameId: string; // Link back to game for context
  position: string;
  avatar: string;
  stats: {
    pts: number;
    reb: number;
    ast: number;
  };
  averages: {
    pts: number;
    reb: number;
    ast: number;
  };
}

export interface Team {
  id: string;
  name: string;
  abbreviation: string;
  color: string;
  logo: string;
  score: number;
}

export interface Game {
  id: string;
  homeTeam: Team;
  awayTeam: Team;
  quarter: number;
  timeLeft: string;
  elapsedMinutes: number; // New field for pace calculation
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED';
}

export interface AppState {
  games: Game[];
  players: Player[];
}

export interface HotStat {
  playerId: string;
  playerName: string;
  teamAbbr: string;
  statType: 'PTS' | 'REB' | 'AST';
  current: number;
  projected: number; // Changed 'average' to 'projected' for better context
  diff: number; // Can be used for "On Pace" value
  percentage: number;
  isProjection: boolean; // Flag to show "On Pace" UI
}