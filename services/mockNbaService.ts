import { Game, Player } from '../types';

// --- SOURCES ---
// We use a CORS proxy to access NBA CDN data from the browser
const PROXY_URL = 'https://corsproxy.io/?';

// 1. NBA CDN (Primary - Faster, official data)
const NBA_CDN_SCOREBOARD = 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json';
const NBA_CDN_BOXSCORE_BASE = 'https://cdn.nba.com/static/json/liveData/boxscore/boxscore_'; // append gameId + .json

// 2. ESPN API (Fallback)
const ESPN_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const ESPN_SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';

// --- HELPERS ---

const parseMinutes = (minStr: string): number => {
  if (!minStr) return 0;
  // NBA CDN format: "PT12M34.00S" or "12:34"
  let clean = minStr.replace('PT', '').replace('S', '');
  
  if (clean.includes('M')) {
    const parts = clean.split('M');
    const m = parseInt(parts[0]);
    const s = parseFloat(parts[1] || '0');
    return m + (s / 60);
  }

  if (clean.includes(':')) {
    const parts = clean.split(':');
    return parseInt(parts[0]) + parseFloat(parts[1]) / 60;
  }
  
  return parseFloat(clean) || 0;
};

const getTeamColor = (abbr: string): string => {
  const colors: Record<string, string> = {
    LAL: 'text-yellow-400', BOS: 'text-green-500', GSW: 'text-blue-400', MIA: 'text-red-500',
    CHI: 'text-red-600', BKN: 'text-white', NYK: 'text-orange-500', PHI: 'text-blue-600',
    DEN: 'text-yellow-300', DAL: 'text-blue-500', MIL: 'text-green-600', PHX: 'text-orange-400',
    ATL: 'text-red-500', MIN: 'text-blue-300', NOP: 'text-indigo-400', UTA: 'text-yellow-200',
    OKC: 'text-blue-400', CLE: 'text-red-700', IND: 'text-yellow-500', HOU: 'text-red-600',
    SAS: 'text-slate-300', SAC: 'text-purple-500', TOR: 'text-red-600', ORL: 'text-blue-500',
    WAS: 'text-red-500', DET: 'text-red-600', CHA: 'text-teal-400', MEM: 'text-blue-300',
    POR: 'text-red-500', LAC: 'text-blue-500'
  };
  return colors[abbr] || 'text-slate-200';
};

// --- NBA CDN FETCHING ---

async function fetchFromNbaCdn(): Promise<{ games: Game[], players: Player[] } | null> {
  try {
    // Use CORS proxy
    const targetUrl = encodeURIComponent(NBA_CDN_SCOREBOARD);
    const res = await fetch(`${PROXY_URL}${targetUrl}`);
    
    if (!res.ok) throw new Error(`NBA CDN Scoreboard failed: ${res.status}`);
    const data = await res.json();
    
    const gamesData = data.scoreboard?.games || [];
    const games: Game[] = [];
    const players: Player[] = [];

    for (const g of gamesData) {
      // NBA Game Status: 1=Scheduled, 2=Live, 3=Final
      let status: 'SCHEDULED' | 'LIVE' | 'FINISHED' = 'SCHEDULED';
      if (g.gameStatus === 2) status = 'LIVE';
      if (g.gameStatus === 3) status = 'FINISHED';

      // Parse Period/Clock
      const quarter = g.period;
      const clock = g.gameClock || ""; // "PT05M30.00S"
      
      // Calculate elapsed (rough approximation for game list)
      let elapsed = 0;
      if (status === 'FINISHED') elapsed = 48;
      else if (status === 'LIVE') {
        const qElapsed = 12 - parseMinutes(clock);
        elapsed = ((quarter - 1) * 12) + Math.max(0, qElapsed);
      }

      games.push({
        id: g.gameId,
        quarter: quarter,
        timeLeft: clock.replace('PT', '').replace('M', ':').replace('S', '').split('.')[0], 
        elapsedMinutes: elapsed,
        status: status,
        homeTeam: {
          id: g.homeTeam.teamId,
          name: g.homeTeam.teamName,
          abbreviation: g.homeTeam.teamTricode,
          score: g.homeTeam.score,
          color: getTeamColor(g.homeTeam.teamTricode),
          logo: `https://cdn.nba.com/logos/nba/${g.homeTeam.teamId}/primary/L/logo.svg`
        },
        awayTeam: {
          id: g.awayTeam.teamId,
          name: g.awayTeam.teamName,
          abbreviation: g.awayTeam.teamTricode,
          score: g.awayTeam.score,
          color: getTeamColor(g.awayTeam.teamTricode),
          logo: `https://cdn.nba.com/logos/nba/${g.awayTeam.teamId}/primary/L/logo.svg`
        }
      });

      // If LIVE or FINISHED, fetch boxscore
      if (status !== 'SCHEDULED') {
        try {
          const boxUrl = encodeURIComponent(`${NBA_CDN_BOXSCORE_BASE}${g.gameId}.json`);
          const boxRes = await fetch(`${PROXY_URL}${boxUrl}`);
          
          if (boxRes.ok) {
            const boxData = await boxRes.json();
            const processTeam = (teamData: any) => {
              if (!teamData?.players) return;
              teamData.players.forEach((p: any) => {
                 if (p.status === 'ACTIVE' && p.statistics && p.statistics.minutes) {
                   const mins = parseMinutes(p.statistics.minutes);
                   // Include even low minute players
                   if (mins > 0.1) { 
                     players.push({
                       id: String(p.personId),
                       name: `${p.firstName} ${p.familyName}`,
                       teamId: `t_${teamData.teamTricode}`,
                       gameId: g.gameId,
                       position: p.position,
                       avatar: `https://cdn.nba.com/headshots/nba/latest/1040x760/${p.personId}.png`,
                       stats: {
                         pts: p.statistics.points,
                         reb: p.statistics.reboundsTotal,
                         ast: p.statistics.assists,
                         stl: p.statistics.steals || 0,
                         blk: p.statistics.blocks || 0,
                         fgm: p.statistics.fieldGoalsMade,
                         fga: p.statistics.fieldGoalsAttempted,
                         minutes: mins
                       },
                       averages: {
                         pts: p.statistics.threePointersMade, // Storing 3PM here for compatibility
                         reb: 0,
                         ast: 0
                       }
                     });
                   }
                 }
              });
            };
            processTeam(boxData.game.homeTeam);
            processTeam(boxData.game.awayTeam);
          }
        } catch (e) {
          console.warn(`Failed to fetch boxscore for ${g.gameId}`, e);
        }
      }
    }
    
    return { games, players };

  } catch (e) {
    console.warn("NBA CDN Fetch via Proxy failed, switching to ESPN...", e);
    return null; // Trigger fallback
  }
}

// --- ESPN FETCHING (FALLBACK) ---

async function fetchFromEspn(): Promise<{ games: Game[], players: Player[] }> {
  try {
    const res = await fetch(`${ESPN_SCOREBOARD_URL}?limit=100`);
    if (!res.ok) throw new Error("ESPN Scoreboard failed");
    const data = await res.json();
    const events = data.events || [];
    
    const games: Game[] = events.map((evt: any) => {
      const comp = evt.competitions[0];
      const home = comp.competitors.find((c: any) => c.homeAway === 'home');
      const away = comp.competitors.find((c: any) => c.homeAway === 'away');
      const state = evt.status.type.state;
      
      return {
        id: evt.id,
        quarter: evt.status.period,
        timeLeft: evt.status.displayClock,
        elapsedMinutes: evt.status.period * 12, // Rough estimate
        status: state === 'in' ? 'LIVE' : state === 'post' ? 'FINISHED' : 'SCHEDULED',
        homeTeam: {
          id: home.team.id,
          name: home.team.displayName,
          abbreviation: home.team.abbreviation,
          score: parseInt(home.score),
          color: getTeamColor(home.team.abbreviation),
          logo: home.team.logo
        },
        awayTeam: {
          id: away.team.id,
          name: away.team.displayName,
          abbreviation: away.team.abbreviation,
          score: parseInt(away.score),
          color: getTeamColor(away.team.abbreviation),
          logo: away.team.logo
        }
      };
    });

    const activeGames = games.filter(g => g.status !== 'SCHEDULED');
    let allPlayers: Player[] = [];

    await Promise.all(activeGames.map(async (g) => {
        try {
          const sRes = await fetch(`${ESPN_SUMMARY_URL}?event=${g.id}`);
          if (!sRes.ok) return;
          const sData = await sRes.json();
          const box = sData.boxscore;
          if(box && box.players) {
             box.players.forEach((team: any) => {
                team.statistics.forEach((p: any) => {
                   if(!p.stats) return;
                   const minsStr = p.stats[0]; 
                   const mins = parseMinutes(minsStr);
                   if (mins > 0) {
                      const statsArr = p.stats; 
                      allPlayers.push({
                        id: p.athlete.id,
                        name: p.athlete.displayName,
                        teamId: `t_${team.team.abbreviation}`,
                        gameId: g.id,
                        position: p.athlete.position?.abbreviation || 'F',
                        avatar: p.athlete.headshot?.href || '',
                        stats: {
                          pts: parseInt(statsArr[13] || '0'), // PTS is usually last in ESPN array
                          reb: parseInt(statsArr[6] || '0'),
                          ast: parseInt(statsArr[7] || '0'),
                          stl: parseInt(statsArr[8] || '0'),
                          blk: parseInt(statsArr[9] || '0'),
                          fgm: 0, 
                          fga: 0,
                          minutes: mins
                        },
                        averages: { pts: 0, reb: 0, ast: 0 }
                      });
                   }
                });
             });
          }
        } catch (e) {
          console.warn("ESPN Boxscore fetch error", e);
        }
    }));
    return { games, players: allPlayers };

  } catch(e) {
    console.error("ESPN Fallback Error", e);
    return { games: [], players: [] };
  }
}

// --- MAIN EXPORT ---

export const fetchLiveNbaData = async (apiKey?: string): Promise<{ games: Game[], players: Player[], error?: string }> => {
  // 1. Try NBA CDN with Proxy
  const cdnData = await fetchFromNbaCdn();
  if (cdnData && (cdnData.games.length > 0 || cdnData.players.length > 0)) {
    return cdnData;
  }

  // 2. Fallback to ESPN
  const espnData = await fetchFromEspn();
  if (espnData.games.length > 0) {
    return espnData;
  }

  return { games: [], players: [], error: "Não foi possível carregar dados de nenhuma fonte." };
};