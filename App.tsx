import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Activity, RefreshCw, Loader2, AlertCircle, Siren, Zap, TrendingUp, Flame, Target } from 'lucide-react';
import { fetchLiveNbaData } from './services/mockNbaService';
import { Game, Player, HotStat } from './types';
import { VoiceAssistant } from './components/VoiceAssistant';

function App() {
  const [games, setGames] = useState<Game[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [anomalies, setAnomalies] = useState<HotStat[]>([]);
  const [loading, setLoading] = useState(false);
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
      detectAnomalies(newPlayers, newGames);
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
    }, 45000); 
    return () => clearInterval(interval);
  }, [loadRealData]);

  // --- ANOMALY DETECTION ENGINE 2.0 ---
  const detectAnomalies = (currentPlayers: Player[], currentGames: Game[]) => {
    const detected: HotStat[] = [];
    const gamesMap = new Map(currentGames.map(g => [g.id, g]));

    currentPlayers.forEach(p => {
      const m = p.stats.minutes;
      // Skip if hasn't played meaningful minutes
      if (m < 2) return; 

      // Get Game Context for Projection
      const game = gamesMap.get(p.gameId);
      // Calculate how much of the game has passed (0.0 to 1.0)
      // Use a minimum of 5 minutes elapsed to avoid crazy multipliers at start of game
      const gameElapsed = Math.max(game ? game.elapsedMinutes : 1, 5); 
      const gameProgress = Math.min(gameElapsed / 48.0, 1.0);

      const pts = p.stats.pts;
      const ast = p.stats.ast;
      const reb = p.stats.reb;
      const stl = p.stats.stl;
      const blk = p.stats.blk;
      const threePM = p.averages.pts; 

      // --- PROJECTION HELPER ---
      const getProj = (val: number) => Math.round(val / gameProgress);

      // Metric: Points Per Minute (PPM)
      const ppm = pts / m;

      // --- DETECTION RULES ---

      // 1. THE "GUI SANTOS" RULE (Micro-ondas / Bench Spark)
      if (m < 15 && m >= 2) {
        if (ppm > 1.0 && pts >= 5) { 
           detected.push(createAnomaly(p, 'PTS', pts, m, getProj(pts), 'Micro-ondas! Entrou pontuando muito.', 'HIGH'));
        }
        else if (threePM >= 2 && m < 8) {
           detected.push(createAnomaly(p, '3PM', threePM, m, getProj(threePM), 'Gatilho rápido! 2+ bolas de 3.', 'HIGH'));
        }
      }

      // 2. THE "STAR" RULE (Volume & Consistency)
      else {
        if (pts >= 30) {
          detected.push(createAnomaly(p, 'PTS', pts, m, getProj(pts), 'Volume de elite. Jogo de 30+ pontos.', 'EXTREME'));
        } else if (ppm > 0.8 && pts >= 12) {
          detected.push(createAnomaly(p, 'PTS', pts, m, getProj(pts), `Ritmo forte (${ppm.toFixed(1)} pts/min).`, 'HIGH'));
        }
        
        if (ast >= 10) {
          detected.push(createAnomaly(p, 'AST', ast, m, getProj(ast), 'Double-double em assistências.', 'HIGH'));
        } else if (ast / m > 0.35 && ast >= 5) {
           detected.push(createAnomaly(p, 'AST', ast, m, getProj(ast), 'Visão de jogo elite.', 'MEDIUM'));
        }

        if (reb >= 12) {
          detected.push(createAnomaly(p, 'REB', reb, m, getProj(reb), 'Dominando a tábua.', 'HIGH'));
        } else if (reb / m > 0.4 && reb >= 6) {
           detected.push(createAnomaly(p, 'REB', reb, m, getProj(reb), 'Alta taxa de rebotes.', 'MEDIUM'));
        }
        
        if (stl >= 4) {
          detected.push(createAnomaly(p, 'STL', stl, m, getProj(stl), 'Mãos rápidas! 4+ roubos.', 'EXTREME'));
        }
      }

      // 3. SPECIALIST ALERTS (Any time)
      if (threePM >= 5) {
         detected.push(createAnomaly(p, '3PM', threePM, m, getProj(threePM), `Chuva de 3! ${threePM} convertidas.`, 'HIGH'));
      }
      if (blk >= 4) {
         detected.push(createAnomaly(p, 'BLK', blk, m, getProj(blk), 'Parede humana! 4+ tocos.', 'EXTREME'));
      }
    });

    // Remove duplicates (keep highest severity)
    const uniqueMap = new Map<string, HotStat>();
    detected.forEach(d => {
      const key = d.playerId + d.statType;
      if (!uniqueMap.has(key) || getSeverityVal(d.severity) > getSeverityVal(uniqueMap.get(key)!.severity)) {
        uniqueMap.set(key, d);
      }
    });
    const unique = Array.from(uniqueMap.values());

    setAnomalies(unique.sort((a, b) => {
      const sDiff = getSeverityVal(b.severity) - getSeverityVal(a.severity);
      if (sDiff !== 0) return sDiff;
      return b.value - a.value;
    }));
  };

  const getSeverityVal = (s: string) => {
    if (s === 'EXTREME') return 4;
    if (s === 'HIGH') return 3;
    if (s === 'MEDIUM') return 2;
    return 1;
  };

  const createAnomaly = (p: Player, type: any, val: number, minutes: number, proj: number, desc: string, severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'): HotStat => {
    const pace = (val / Math.max(minutes, 1)) * 36;
    return {
      playerId: p.id,
      playerName: p.name,
      teamAbbr: p.teamId.replace('t_', ''),
      statType: type,
      value: val,
      pace: pace,
      projectedTotal: proj,
      anomalyScore: getSeverityVal(severity) * 2.5,
      severity,
      description: desc,
      minuteOfGame: Math.round(minutes)
    };
  };

  const getSeverityColor = (sev: string) => {
    switch (sev) {
      case 'EXTREME': return 'bg-red-600 text-white shadow-red-500/50 border-red-400 ring-2 ring-red-400/20';
      case 'HIGH': return 'bg-orange-500 text-white shadow-orange-500/50 border-orange-400';
      case 'MEDIUM': return 'bg-yellow-500 text-black shadow-yellow-500/50 border-yellow-400';
      default: return 'bg-blue-500 text-white border-blue-400';
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-20">
      <header className="bg-slate-900/90 backdrop-blur-xl sticky top-0 z-40 border-b border-slate-800 shadow-2xl">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-red-600 to-red-800 p-2.5 rounded-xl shadow-lg shadow-red-900/50 animate-pulse-slow border border-red-500/30">
                <Siren className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tighter text-white uppercase italic">
                  Operaçao<span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-orange-500">Remynba</span>
                </h1>
                <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400">Scanner de Elite • Multi-Source</p>
              </div>
            </div>

            <div className="flex items-center gap-4 text-sm text-slate-400">
              {loading && <div className="flex items-center gap-2 text-red-400 text-xs font-bold animate-pulse"><Loader2 className="w-3 h-3 animate-spin"/> SCANNING...</div>}
              <button 
                onClick={() => loadRealData()}
                disabled={loading}
                className="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-full transition-all hover:scale-110 active:scale-95 border border-slate-700 shadow-lg"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
          {errorMsg && (
            <div className="mt-4 bg-red-950/50 border border-red-800/50 rounded-lg p-3 flex items-center gap-3 text-red-200 text-sm animate-in slide-in-from-top-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-10">
        
        {/* Games Strip */}
        <section>
          {games.length > 0 ? (
            <div className="flex gap-4 overflow-x-auto pb-6 scrollbar-hide snap-x px-2">
              {games.map(game => (
                <div key={game.id} className={`snap-center shrink-0 w-72 rounded-2xl p-4 border transition-all relative overflow-hidden group ${game.status === 'LIVE' ? 'bg-gradient-to-br from-slate-900 to-slate-800 border-red-500/50 shadow-red-900/20 shadow-xl' : 'bg-slate-900 border-slate-800 opacity-60 hover:opacity-100'}`}>
                  {game.status === 'LIVE' && <div className="absolute top-0 right-0 p-1.5"><div className="w-2 h-2 rounded-full bg-red-500 animate-ping"/></div>}
                  
                  <div className="flex justify-between items-center text-[11px] text-slate-400 mb-4 font-mono uppercase tracking-wider">
                    <span className={game.status === 'LIVE' ? 'text-red-400 font-bold' : ''}>
                      {game.status === 'LIVE' ? `AO VIVO • Q${game.quarter} ${game.timeLeft}` : game.status}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center relative z-10">
                    <div className="flex flex-col items-center w-1/3 gap-2">
                       <img src={game.homeTeam.logo} alt={game.homeTeam.abbreviation} className="w-10 h-10 object-contain drop-shadow-lg" />
                       <span className="font-bold text-xl">{game.homeTeam.score}</span>
                    </div>
                    <span className="text-slate-600 text-xs font-black">VS</span>
                    <div className="flex flex-col items-center w-1/3 gap-2">
                       <img src={game.awayTeam.logo} alt={game.awayTeam.abbreviation} className="w-10 h-10 object-contain drop-shadow-lg" />
                       <span className="font-bold text-xl">{game.awayTeam.score}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-slate-500 py-4 text-sm font-mono">
              Aguardando jogos...
            </div>
          )}
        </section>

        {/* Anomaly Grid */}
        <section>
          <div className="flex items-center gap-3 mb-8 pl-2 border-l-4 border-yellow-500">
            <Flame className="w-7 h-7 text-yellow-500 fill-orange-500 animate-pulse" />
            <h2 className="text-3xl font-black text-white uppercase italic tracking-tighter">Radar de Anomalias</h2>
          </div>
          
          {anomalies.length === 0 ? (
            <div className="text-center py-32 bg-slate-900/30 rounded-3xl border-2 border-dashed border-slate-800/50 flex flex-col items-center justify-center group">
              <div className="p-6 bg-slate-900 rounded-full mb-6 group-hover:scale-110 transition-transform duration-500">
                 <Activity className="w-16 h-16 text-slate-700 group-hover:text-red-500 transition-colors" />
              </div>
              <p className="text-slate-400 text-xl font-light">Nenhuma anomalia crítica detectada.</p>
              <p className="text-slate-600 text-sm mt-2 max-w-md mx-auto">O algoritmo está monitorando cada posse de bola em busca de desempenhos fora da curva.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {anomalies.map((stat, idx) => (
                <div key={`${stat.playerId}-${stat.statType}-${idx}`} className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden relative group hover:border-slate-600 hover:-translate-y-1 transition-all duration-300 shadow-2xl">
                  
                  {/* Severity Banner */}
                  <div className={`absolute top-0 right-0 px-4 py-1.5 rounded-bl-2xl text-[10px] font-black tracking-widest uppercase shadow-lg z-10 ${getSeverityColor(stat.severity)}`}>
                    {stat.severity === 'EXTREME' ? 'CRÍTICO' : stat.severity === 'HIGH' ? 'ALTO' : 'MÉDIO'}
                  </div>

                  <div className="p-6 relative">
                    <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-b from-slate-800/50 to-transparent pointer-events-none" />

                    <div className="flex items-start gap-4 mb-5 relative z-10">
                      <div className="relative shrink-0">
                        <div className="w-16 h-16 rounded-2xl bg-slate-800 overflow-hidden border-2 border-slate-700 shadow-inner">
                           <img 
                            src={`https://cdn.nba.com/headshots/nba/latest/1040x760/${stat.playerId}.png`} 
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${stat.playerName}&background=random`
                            }}
                            alt={stat.playerName}
                            className="w-full h-full object-cover scale-110 mt-2"
                          />
                        </div>
                        <div className="absolute -bottom-2 -right-2 bg-black text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-700 text-slate-300">
                          {stat.teamAbbr}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold text-white leading-tight truncate">{stat.playerName}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-400 border border-slate-700">
                             {stat.minuteOfGame} MIN
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Stats Display */}
                    <div className="flex flex-col mb-4">
                      <div className="flex items-baseline gap-1">
                         <span className={`text-5xl font-black tracking-tighter ${stat.severity === 'EXTREME' ? 'text-red-500' : 'text-white'}`}>
                           {stat.value}
                         </span>
                         <span className="text-sm font-bold text-slate-500 uppercase">{stat.statType}</span>
                      </div>
                      <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Ao Vivo</span>
                    </div>

                    <div className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/50 mb-3 backdrop-blur-sm min-h-[50px]">
                      <p className="text-xs text-indigo-200 font-medium leading-relaxed">
                        {stat.description}
                      </p>
                    </div>
                    
                    {/* FULL GAME PROJECTION */}
                    <div className="pt-3 border-t border-slate-800/50">
                      <div className="flex justify-between items-center group-hover:scale-105 transition-transform origin-left">
                        <div className="flex items-center gap-2 text-yellow-500/80">
                           <Target className="w-4 h-4" />
                           <span className="text-[10px] uppercase font-black tracking-widest">Projeção Final</span>
                        </div>
                        <span className="text-2xl font-black font-mono text-yellow-400">{stat.projectedTotal}</span>
                      </div>
                    </div>

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