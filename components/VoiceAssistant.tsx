import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, MicOff, Volume2, X, Activity } from 'lucide-react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createBlob, decode, decodeAudioData } from '../services/audioUtils';
import { Player, Game } from '../types';

interface VoiceAssistantProps {
  apiKey: string;
  contextPlayers: Player[];
  contextGames: Game[];
}

export const VoiceAssistant: React.FC<VoiceAssistantProps> = ({ apiKey, contextPlayers, contextGames }) => {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [volume, setVolume] = useState(0); // For visualizer
  const [error, setError] = useState<string | null>(null);

  // Refs for audio handling
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Ref for the session promise to avoid closure staleness
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const aiRef = useRef<GoogleGenAI | null>(null);

  // Initialize GenAI
  useEffect(() => {
    if (apiKey) {
      aiRef.current = new GoogleGenAI({ apiKey });
    }
  }, [apiKey]);

  const buildSystemInstruction = () => {
    const gameSummaries = contextGames.map(g => 
      `${g.homeTeam.abbreviation} ${g.homeTeam.score} vs ${g.awayTeam.abbreviation} ${g.awayTeam.score} (Q${g.quarter} ${g.timeLeft})`
    ).join('; ');

    const topPlayers = contextPlayers
      .filter(p => p.stats.pts > p.averages.pts || p.stats.ast > p.averages.ast)
      .map(p => `${p.name} (${p.stats.pts} PTS, ${p.stats.reb} REB, ${p.stats.ast} AST)`)
      .slice(0, 5)
      .join('; ');

    return `
      Você é um analista esportivo experiente da NBA, comentando ao vivo em português do Brasil.
      Seja energético, use gírias de basquete (dunk, triple-double, clutch, splash brothers).
      Dê respostas curtas e diretas, como se estivesse no rádio ou TV.
      
      CONTEXTO ATUAL DOS JOGOS AO VIVO:
      ${gameSummaries}
      
      JOGADORES EM DESTAQUE (ACIMA DA MÉDIA):
      ${topPlayers || "Nenhum destaque absurdo no momento."}
      
      Se o usuário perguntar algo que não está nos dados, use seu conhecimento geral sobre a NBA, mas priorize os dados ao vivo fornecidos.
    `;
  };

  const startSession = async () => {
    if (!aiRef.current) return;
    setError(null);
    setIsConnecting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Input Context (Microphone) - 16kHz
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      inputAudioContextRef.current = inputCtx;
      
      const source = inputCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      
      // Script Processor for raw PCM access
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      // Output Context (Speaker) - 24kHz
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = outputCtx;
      const outputNode = outputCtx.createGain();
      outputNode.connect(outputCtx.destination);

      // Connect to Gemini Live
      const systemInstruction = buildSystemInstruction();
      
      const sessionPromise = aiRef.current.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: systemInstruction,
        },
        callbacks: {
          onopen: () => {
            console.log('Gemini Live Connection Opened');
            setIsConnecting(false);
            setIsActive(true);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Audio Output Handling
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              try {
                if (!audioContextRef.current) return;
                
                // Simple visualizer simulation based on packet arrival
                setVolume(Math.random() * 0.8 + 0.2);
                setTimeout(() => setVolume(0), 200);

                const audioBuffer = await decodeAudioData(
                  decode(base64Audio),
                  audioContextRef.current,
                  24000,
                  1
                );
                
                const source = audioContextRef.current.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputNode);
                
                // Scheduling
                const now = audioContextRef.current.currentTime;
                // Ensure we schedule in the future, handling gaps if playback fell behind
                const startTime = Math.max(nextStartTimeRef.current, now);
                source.start(startTime);
                
                nextStartTimeRef.current = startTime + audioBuffer.duration;
                
                sourcesRef.current.add(source);
                source.onended = () => sourcesRef.current.delete(source);
              } catch (e) {
                console.error("Error decoding audio", e);
              }
            }
          },
          onclose: () => {
            console.log('Connection Closed');
            stopSession();
          },
          onerror: (e) => {
            console.error('Connection Error', e);
            setError("Erro na conexão com Gemini.");
            stopSession();
          }
        }
      });

      sessionPromiseRef.current = sessionPromise;

      // Setup audio processing loop to send data
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // Calculate volume for visualizer
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
        const rms = Math.sqrt(sum / inputData.length);
        // Only update UI occasionally or it lags, here we just use it for local state if needed
        // but for now we rely on the `isConnecting` state mostly.
        
        const pcmBlob = createBlob(inputData);
        
        sessionPromise.then(session => {
            session.sendRealtimeInput({ media: pcmBlob });
        });
      };

      source.connect(processor);
      processor.connect(inputCtx.destination); // Required for script processor to run

    } catch (err) {
      console.error('Failed to initialize audio', err);
      setError("Permissão de microfone negada ou erro de inicialização.");
      setIsConnecting(false);
    }
  };

  const stopSession = useCallback(() => {
    setIsActive(false);
    setIsConnecting(false);
    setVolume(0);

    // Stop tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Disconnect Audio Nodes
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    
    // Close Audio Contexts
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Stop all playing sources
    sourcesRef.current.forEach(s => {
      try { s.stop(); } catch(e) {}
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    
    // Attempt to close session if library supports it (it relies on onclose mostly)
    // There isn't a direct .close() on the session object in the snippet, 
    // but stopping input usually triggers server timeout or we just abandon it.
  }, []);

  useEffect(() => {
    return () => {
      stopSession();
    };
  }, [stopSession]);


  if (!apiKey) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {error && (
        <div className="bg-red-500/90 text-white px-4 py-2 rounded-lg mb-2 text-sm shadow-lg max-w-[250px]">
          {error}
        </div>
      )}
      
      {isActive || isConnecting ? (
        <div className="bg-slate-800 border border-slate-700 shadow-2xl rounded-2xl p-4 w-80 animate-in slide-in-from-bottom-10 fade-in duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <span className={`w-2 h-2 rounded-full ${isConnecting ? 'bg-yellow-400 animate-pulse' : 'bg-green-500 animate-pulse'}`} />
              <span className="text-slate-200 font-semibold text-sm">
                {isConnecting ? 'Conectando...' : 'Analista NBA (Ao Vivo)'}
              </span>
            </div>
            <button onClick={stopSession} className="text-slate-400 hover:text-white transition-colors">
              <X size={18} />
            </button>
          </div>
          
          <div className="flex items-center justify-center h-24 bg-slate-900/50 rounded-xl mb-4 relative overflow-hidden">
             {/* Simple Audio Visualizer */}
             <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <div 
                    key={i}
                    className="w-3 bg-indigo-500 rounded-full visualizer-bar"
                    style={{ 
                      height: isActive && !isConnecting ? `${Math.max(10, volume * 80 * (Math.random() + 0.5))}px` : '4px',
                      opacity: isActive ? 1 : 0.3
                    }}
                  />
                ))}
             </div>
             {!isActive && !isConnecting && <span className="text-xs text-slate-500 absolute">Ocioso</span>}
          </div>

          <div className="text-xs text-slate-400 text-center">
            Fale naturalmente. "Quem está pegando fogo no jogo?"
          </div>
        </div>
      ) : (
        <button
          onClick={startSession}
          className="group flex items-center gap-3 px-6 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-xl transition-all hover:scale-105 active:scale-95"
        >
          <div className="relative">
            <Mic className="w-6 h-6" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-400"></span>
            </span>
          </div>
          <span className="font-semibold pr-2">Falar com Assistente</span>
        </button>
      )}
    </div>
  );
};
