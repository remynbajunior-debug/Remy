import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Trophy, Activity, Flame, RefreshCw, Loader2, AlertCircle, TrendingUp } from 'lucide-react';
import { fetchLiveNbaData } from './services/mockNbaService';
import { Game, Player, HotStat } from './types';
import { VoiceAssistant } from './components/VoiceAssistant';

function App() {
  const [games, setGames] = useState<Game[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [hotStats, setHotStats] = useState<HotStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const hasFetchedRef = useRef(false);
  const API_KEY = process.env.API_KEY || ''; 

  const loadRealData = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setErrorMsg(null);

    const { games: newGames, players: newPlayers, error } = await fetchLiveNbaData(API_KEY);
    
    if (error) {
      setErrorMsg(error);
    } else {
      const sortedGames = newGames.sort((a, b) => {
        const order = { 'LIVE': 0, 'FINISHED': 1, 'SCHEDULED': 2 };
        return order[a.status] - order[b.status];
      });
      
      setGames(sortedGames);
      setPlayers(newPlayers);
      calculateHotStats(newPlayers, newGames);
      setLastUpdated(new Date());
    }

    setLoading(false);
  }, [loading, API_KEY]);

  useEffect(() => {
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true;
      loadRealData();
    }
  }, [loadRealData]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadRealData();
    }, 60000);
    return () => clearInterval(interval);
  }, [loadRealData]);


  const calculateHotStats = (currentPlayers: Player[], currentGames: Game[]) => {
    const hot: HotStat[] = [];
    const gamesMap = new Map(currentGames.map(g => [g.id, g]));
    
    currentPlayers.forEach(p => {
      const game = gamesMap.get(p.gameId);
      if (!game) return;

      const teamAbbr = p.teamId.startsWith('t_') ? p.teamId.substring(2) : 'NBA';
      const threePtMade = p.averages.pts; // Transported 3PM

      // PACE CALCULATION
      // We project stats to 48 minutes to find "hotness" relative to game time.
      // Filter out garbage time: only consider if game has at least 5 mins elapsed or it's finished.
      const elapsed = Math.max(game.elapsedMinutes, 1);
      const isEarlyGame = elapsed < 5;
      const isFinished = game.status === 'FINISHED';

      // Projection Factor
      // If Live: Project to 48m. If Finished: Factor is 1 (actual stats).
      const projectionFactor = isFinished ? 1 : (48 / elapsed);

      const projPts = p.stats.pts * projectionFactor;
      const projReb = p.stats.reb * projectionFactor;
      const projAst = p.stats.ast * projectionFactor;

      // --- LOGIC: THRESHOLDS FOR "HOT" ---
      
      // 1. Points
      // Hot if: Current > 25 OR (Live & Projected > 30 & Current > 6)
      // Note: "Current > 6" prevents someone with 2 pts in 1 min from being "Hot"
      if (p.stats.pts >= 25) {
         hot.push(createHotStat(p, teamAbbr, 'PTS', p.stats.pts, p.stats.pts, false));
      } else if (!isFinished && !isEarlyGame && projPts >= 30 && p.stats.pts >= 6) {
         hot.push(createHotStat(p, teamAbbr, 'PTS', p.stats.pts, Math.round(projPts), true));
      }

      // 2. Assists
      // Hot if: Current > 8 OR (Live & Projected > 10 & Current > 3)
      if (p.stats.ast >= 9) {
         hot.push(createHotStat(p, teamAbbr, 'AST', p.stats.ast, p.stats.ast, false));
      } else if (!isFinished && !isEarlyGame && projAst >= 12 && p.stats.ast >= 3) {
         hot.push(createHotStat(p, teamAbbr, 'AST', p.stats.ast, Math.round(projAst), true));
      }

      // 3. Rebounds
      // Hot if: Current > 10 OR (Live & Projected > 13 & Current > 4)
      if (p.stats.reb >= 11) {
         hot.push(createHotStat(p, teamAbbr, 'REB', p.stats.reb, p.stats.reb, false));
      } else if (!isFinished && !isEarlyGame && projReb >= 14 && p.stats.reb >= 4) {
         hot.push(createHotStat(p, teamAbbr, 'REB', p.stats.reb, Math.round(projReb), true));
      }

      // 4. 3-Pointers (Always absolute, no projection needed usually)
      if (threePtMade >= 4) {
        hot.push({
          playerId: p.id,
          playerName: p.name,
          teamAbbr: teamAbbr,
          statType: 'PTS', // Color hack
          current: p.stats.pts,
          projected: threePtMade, // Hack: store 3PM count here
          diff: 0,
          percentage: 100,
          isProjection: false // Special handling in UI
        });
      }
    });
    
    // Sort by "Impressiveness" (Raw stats for finished, Projection for live)
    setHotStats(hot.sort((a, b) => b.projected - a.projected).slice(0, 15));
  };

  const createHotStat = (p: Player, team: string, type: 'PTS' | 'REB' | 'AST', curr: number, proj: number, isProj: boolean): HotStat => {
    return {
      playerId: p.id,
      playerName: p.name,
      teamAbbr: team,
      statType: type,
      current: curr,
      projected: proj,
      diff: proj - curr,
      percentage: Math.min((curr / (isProj ? proj/2 : 15)) * 100, 100), // Visual bar calculation
      isProjection: isProj
    };
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-20">
      <header className="bg-slate-900/95 backdrop-blur-sm sticky top-0 z-40 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <div className="bg-indigo-600 p-2 rounded-lg">
                <Activity className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-xl font-bold tracking-tight">NBA <span className="text-indigo-400">Live Pulse</span></h1>
            </div>

            <div className="flex items-center gap-4 text-sm text-slate-400">
              {loading && <Loader2 className="w-4 h-4 animate-spin text-indigo-400"/>}
              {!loading && lastUpdated && <span className="hidden md:inline text-xs text-slate-500">Atualizado: {lastUpdated.toLocaleTimeString()}</span>}

              <button 
                onClick={() => loadRealData()}
                disabled={loading}
                className="p-2 bg-slate-800 hover:bg-slate-700 rounded-full transition-colors disabled:opacity-50"
                title="Atualizar Dados Agora"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
          {errorMsg && (
            <div className="mt-4 bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 flex items-center gap-3 text-yellow-200 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        
        {/* Games Scroll */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
              Jogos Recentes & Ao Vivo
            </h2>
          </div>
          
          {games.length === 0 ? (
             <div className="p-8 text-center text-slate-500 bg-slate-800/50 rounded-xl border border-dashed border-slate-700">
               {loading ? "Buscando jogos..." : "Nenhum jogo encontrado nas últimas 24h."}
             </div>
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x">
              {games.map(game => (
                <div key={game.id} className={`snap-center shrink-0 w-72 border rounded-xl p-4 shadow-lg transition-colors ${game.status === 'LIVE' ? 'bg-slate-800 border-red-900/50' : 'bg-slate-800 border-slate-700'}`}>
                  <div className="flex justify-between items-center text-xs text-slate-400 mb-3">
                    <span className={`font-mono px-2 py-0.5 rounded flex items-center gap-1 ${game.status === 'LIVE' ? 'bg-slate-900 text-red-400 border border-red-900' : 'bg-slate-900 text-slate-500'}`}>
                      {game.status === 'LIVE' && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>}
                      {game.status === 'LIVE' ? `Q${game.quarter} ${game.timeLeft}` : game.status === 'FINISHED' ? 'FINAL' : 'AGENDADO'}
                    </span>
                    <span>NBA</span>
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <img src={game.homeTeam.logo} alt="" className="w-6 h-6 object-contain opacity-80" onError={(e) => e.currentTarget.style.display = 'none'} />
                        <span className={`font-bold text-lg w-12 truncate ${game.homeTeam.score > game.awayTeam.score ? 'text-white' : 'text-slate-400'}`}>
                          {game.homeTeam.abbreviation}
                        </span>
                      </div>
                      <span className={`text-2xl font-bold font-mono ${game.homeTeam.score > game.awayTeam.score ? 'text-white' : 'text-slate-500'}`}>
                        {game.homeTeam.score}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                       <div className="flex items-center gap-3">
                        <img src={game.awayTeam.logo} alt="" className="w-6 h-6 object-contain opacity-80" onError={(e) => e.currentTarget.style.display = 'none'} />
                        <span className={`font-bold text-lg w-12 truncate ${game.awayTeam.score > game.homeTeam.score ? 'text-white' : 'text-slate-400'}`}>
                          {game.awayTeam.abbreviation}
                        </span>
                      </div>
                      <span className={`text-2xl font-bold font-mono ${game.awayTeam.score > game.homeTeam.score ? 'text-white' : 'text-slate-500'}`}>
                        {game.awayTeam.score}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Hot Players Grid */}
        <section>
          <div className="flex items-center gap-2 mb-6">
            <Flame className="w-6 h-6 text-orange-500" />
            <h2 className="text-2xl font-bold text-white">Destaques Individuais</h2>
          </div>
          
          {loading && hotStats.length === 0 ? (
            <div className="flex items-center justify-center py-20">
               <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            </div>
          ) : hotStats.length === 0 ? (
            <div className="text-center py-20 bg-slate-800/50 rounded-2xl border border-dashed border-slate-700">
              <p className="text-slate-500">Nenhum destaque detectado ainda. (Critério: Ritmo de 30+ PTS, 12+ AST, ou 14+ REB)</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {hotStats.map((stat, idx) => (
                <div key={`${stat.playerId}-${stat.statType}-${idx}`} className="bg-slate-800 rounded-xl border border-slate-700 p-5 shadow-lg relative overflow-hidden group hover:border-indigo-500/50 transition-colors">
                  <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Trophy className="w-24 h-24 text-indigo-500 transform rotate-12" />
                  </div>
                  
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <img 
                        src={`https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${stat.playerId}.png&w=350&h=254`} 
                        alt={stat.playerName}
                        className="w-12 h-12 rounded-full bg-slate-700 object-cover object-top border border-slate-600"
                        onError={(e) => { e.currentTarget.src = `https://ui-avatars.com/api/?name=${stat.playerName}&background=random` }}
                      />
                      <div>
                        <h3 className="text-lg font-bold text-white leading-tight">{stat.playerName}</h3>
                        <span className="text-xs font-bold text-slate-400 bg-slate-900 px-2 py-1 rounded mt-1 inline-block">
                          {stat.teamAbbr}
                        </span>
                      </div>
                    </div>
                    <div className={`
                      flex flex-col items-center justify-center w-12 h-12 rounded-full font-bold
                      ${stat.statType === 'PTS' ? 'bg-orange-500/10 text-orange-400' : ''}
                      ${stat.statType === 'REB' ? 'bg-blue-500/10 text-blue-400' : ''}
                      ${stat.statType === 'AST' ? 'bg-green-500/10 text-green-400' : ''}
                    `}>
                      <span className="text-xs opacity-75">{stat.statType === 'PTS' && !stat.isProjection && stat.current === stat.projected && stat.current < 20 ? '3PM' : stat.statType}</span>
                    </div>
                  </div>

                  <div className="flex items-end gap-2 mb-2">
                    <span className="text-4xl font-bold text-white tracking-tighter">{stat.current}</span>
                    {/* Special Case: 3PM or Finished Game */}
                    {stat.statType === 'PTS' && !stat.isProjection && stat.current === stat.projected && stat.current < 20 && 
                       <span className="text-xs text-orange-300 mb-2">Bolas de 3</span>
                    }
                  </div>
                  
                  {/* Projection Badge */}
                  {stat.isProjection && (
                    <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded text-xs font-medium mb-3">
                      <TrendingUp className="w-3 h-3" />
                      Projeção: {stat.projected} {stat.statType}
                    </div>
                  )}

                  <div className="w-full bg-slate-700/50 rounded-full h-2 mb-2 overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${
                        stat.percentage > 50 ? 'bg-gradient-to-r from-indigo-500 to-purple-500' : 'bg-indigo-500'
                      }`}
                      style={{ width: `${stat.percentage}%` }} 
                    />
                  </div>
                  
                  <div className="flex items-center text-xs font-medium text-green-400">
                    <Activity className="w-3 h-3 mr-1" />
                    {stat.isProjection ? 'Ritmo acelerado' : 'Performance de elite'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <VoiceAssistant 
        apiKey={API_KEY} 
        contextPlayers={players} 
        contextGames={games} 
      />
    </div>
  );
}

export default App;