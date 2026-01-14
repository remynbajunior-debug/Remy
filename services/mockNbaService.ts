import { Game, Player } from '../types';

// Endpoints públicos da ESPN
const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';

// --- Types ---
interface EspnCompetitor {
  id: string;
  team: {
    id: string;
    abbreviation: string;
    displayName: string;
    color?: string;
    logo?: string;
  };
  score: string;
  homeAway: string;
}

interface EspnEvent {
  id: string;
  date: string; 
  status: {
    type: {
      state: string; // "pre", "in", "post"
      detail: string; // "Final", "Q4 - 5:00"
    };
    period: number;
    displayClock: string;
  };
  competitions:Array<{
    competitors: EspnCompetitor[];
  }>;
}

// --- HELPER FUNCTIONS ---

const getTeamColor = (abbr: string): string => {
  const colors: Record<string, string> = {
    LAL: 'text-yellow-400', BOS: 'text-green-500', GSW: 'text-blue-400', MIA: 'text-red-500',
    CHI: 'text-red-600', BKN: 'text-white', NYK: 'text-orange-500', PHI: 'text-blue-600',
    DEN: 'text-yellow-300', DAL: 'text-blue-500', MIL: 'text-green-600', PHX: 'text-orange-400',
    ATL: 'text-red-500', MIN: 'text-blue-300', NOP: 'text-indigo-400', UTA: 'text-yellow-200'
  };
  return colors[abbr] || 'text-slate-200';
};

const getYyyyMmDd = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

const calculateElapsedMinutes = (quarter: number, clock: string, status: string): number => {
  if (status === 'FINISHED') return 48;
  if (status === 'SCHEDULED' || status === 'pre') return 0;
  
  // clock format usually "11:30" or "45.2" (seconds)
  let minutesLeftInQuarter = 0;
  if (clock) {
    const parts = clock.split(':');
    if (parts.length === 2) {
      minutesLeftInQuarter = parseInt(parts[0]) + parseInt(parts[1]) / 60;
    } else if (parts.length === 1 && clock.trim() !== '') {
      minutesLeftInQuarter = parseFloat(parts[0]) / 60;
    }
  }

  // NBA quarters are 12 mins
  // Q1 start: q=1, left=12 -> elapsed=0
  // Q1 end: q=1, left=0 -> elapsed=12
  // Q2 start: q=2, left=12 -> elapsed=12
  const pastQuarters = (quarter - 1) * 12;
  const currentQuarterElapsed = 12 - minutesLeftInQuarter;
  
  // Clamp between 0 and 48 (exclude OT logic for simplicity or cap at actual time)
  return Math.max(0.1, pastQuarters + currentQuarterElapsed); // Min 0.1 to avoid division by zero
};

// --- API FETCHING ---

export const fetchLiveNbaData = async (apiKey?: string): Promise<{ games: Game[], players: Player[], error?: string }> => {
  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // 1. Fetch Scoreboard for Yesterday AND Today
    const [resToday, resYesterday] = await Promise.all([
      fetch(`${SCOREBOARD_URL}?dates=${getYyyyMmDd(today)}&limit=100`),
      fetch(`${SCOREBOARD_URL}?dates=${getYyyyMmDd(yesterday)}&limit=100`)
    ]);

    const dataToday = resToday.ok ? await resToday.json() : { events: [] };
    const dataYesterday = resYesterday.ok ? await resYesterday.json() : { events: [] };

    const allEvents: EspnEvent[] = [...(dataToday.events || []), ...(dataYesterday.events || [])];
    const uniqueEventsMap = new Map<string, EspnEvent>();
    allEvents.forEach(evt => uniqueEventsMap.set(evt.id, evt));
    const uniqueEvents = Array.from(uniqueEventsMap.values());

    const games: Game[] = uniqueEvents.map(evt => {
      const comp = evt.competitions[0];
      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      
      const statusState = evt.status.type.state; 
      let appStatus: 'SCHEDULED' | 'LIVE' | 'FINISHED' = 'SCHEDULED';
      if (statusState === 'in') appStatus = 'LIVE';
      if (statusState === 'post') appStatus = 'FINISHED';

      // Calculate elapsed time for pace stats
      const elapsed = calculateElapsedMinutes(evt.status.period, evt.status.displayClock, appStatus);

      return {
        id: evt.id,
        quarter: evt.status.period,
        timeLeft: evt.status.displayClock,
        elapsedMinutes: elapsed,
        status: appStatus,
        homeTeam: {
          id: home?.team.id || '0',
          name: home?.team.displayName || 'Home',
          abbreviation: home?.team.abbreviation || 'HOM',
          score: parseInt(home?.score || '0'),
          color: getTeamColor(home?.team.abbreviation || ''),
          logo: home?.team.logo || ''
        },
        awayTeam: {
          id: away?.team.id || '0',
          name: away?.team.displayName || 'Away',
          abbreviation: away?.team.abbreviation || 'AWY',
          score: parseInt(away?.score || '0'),
          color: getTeamColor(away?.team.abbreviation || ''),
          logo: away?.team.logo || ''
        }
      };
    });

    const activeGameIds = games
      .filter(g => g.status !== 'SCHEDULED')
      .map(g => g.id);

    let allPlayers: Player[] = [];

    const playerPromises = activeGameIds.map(async (gameId) => {
      try {
        const summaryRes = await fetch(`${SUMMARY_URL}?event=${gameId}`);
        if (!summaryRes.ok) return [];
        const summaryData = await summaryRes.json();
        const boxscore = summaryData.boxscore;
        
        if (!boxscore || !boxscore.players) return [];

        const gamePlayers: Player[] = [];

        boxscore.players.forEach((teamSection: any) => {
          const teamAbbr = teamSection.team.abbreviation; 
          
          teamSection.statistics.forEach((p: any) => {
             const statsMap: any = {};
             const labels = p.names || p.labels || []; 
             const values = p.stats || [];

             labels.forEach((label: string, idx: number) => {
               statsMap[label] = values[idx];
             });

             if (statsMap['MIN'] && statsMap['MIN'] !== "--" && statsMap['MIN'] !== "DNP") {
               const pts = parseInt(statsMap['PTS'] || '0');
               const reb = parseInt(statsMap['REB'] || '0');
               const ast = parseInt(statsMap['AST'] || '0');
               const threePtRaw = statsMap['3PT'] || '0-0';
               const threePtMade = parseInt(threePtRaw.split('-')[0] || '0');

               gamePlayers.push({
                 id: p.athlete.id,
                 name: p.athlete.displayName,
                 teamId: `t_${teamAbbr}`,
                 gameId: gameId, // Important: Link to game
                 position: p.athlete.position?.abbreviation || 'P',
                 avatar: p.athlete.headshot?.href || `https://ui-avatars.com/api/?name=${p.athlete.displayName.replace(' ', '+')}&background=random`,
                 stats: { pts, reb, ast },
                 averages: { 
                   pts: threePtMade, 
                   reb: 0, 
                   ast: 0 
                 }
               });
             }
          });
        });
        return gamePlayers;
      } catch (err) {
        return [];
      }
    });

    const results = await Promise.all(playerPromises);
    results.forEach(pList => allPlayers = [...allPlayers, ...pList]);

    return { games, players: allPlayers };

  } catch (error: any) {
    return { games: [], players: [], error: "Erro ao conectar com API da NBA/ESPN." };
  }
};

export const simulateLiveUpdates = (games: Game[], players: Player[]) => ({ games, players });
export const createInitialGames = () => [];
export const createInitialPlayers = () => [];