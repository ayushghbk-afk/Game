import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, Radio, Megaphone } from 'lucide-react';

interface AudioVoiceControllerProps {
  socket: WebSocket | null;
  onVoiceStateChange: (isSpeaking: boolean) => void;
  team: 'Red' | 'Blue' | 'FFA';
  playerName: string;
}

export const TACTICAL_MACROS = [
  { text: "Enemy Spotted!", key: "F2", synth: "Enemy spotted, be on high alert." },
  { text: "Need Back Up!", key: "F3", synth: "Requesting immediate backup at my coordinate." },
  { text: "Defend this Area!", key: "F4", synth: "Fall back and defend this area." },
  { text: "Regroup on Me!", key: "F5", synth: "Regroup on my position, squad up." },
  { text: "Affirmative!", key: "F6", synth: "Affirmative. Roger that." },
  { text: "Negative!", key: "F7", synth: "Negative. No can do." }
];

export const AudioVoiceController: React.FC<AudioVoiceControllerProps> = ({
  socket,
  onVoiceStateChange,
  team,
  playerName
}) => {
  const [micEnabled, setMicEnabled] = useState(false);
  const [voiceThreshold, setVoiceThreshold] = useState(-55); // dB threshold
  const [currentVolume, setCurrentVolume] = useState(-100); // current dB
  const [pushToTalk, setPushToTalk] = useState(false); // default Voice Activity Detection
  const [isCurrentlyTransmitting, setIsCurrentlyTransmitting] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Keyboard shortcut listener for tactical radio macros
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in chat input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      const macro = TACTICAL_MACROS.find(m => m.key === e.key);
      if (macro) {
        e.preventDefault();
        sendTacticalMacro(macro.text, macro.synth);
      }

      // Push to Talk toggle (Hold V)
      if (e.code === 'KeyV') {
        if (pushToTalk && !isCurrentlyTransmitting && micEnabled) {
          startTransmitting();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyV') {
        if (pushToTalk && isCurrentlyTransmitting) {
          stopTransmitting();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [pushToTalk, isCurrentlyTransmitting, micEnabled]);

  const startTransmitting = () => {
    setIsCurrentlyTransmitting(true);
    onVoiceStateChange(true);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'voice_indicator',
        isSpeaking: true
      }));
    }
  };

  const stopTransmitting = () => {
    setIsCurrentlyTransmitting(false);
    onVoiceStateChange(false);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'voice_indicator',
        isSpeaking: false
      }));
    }
  };

  // Toggle Microhpone Access
  const toggleMic = async () => {
    if (micEnabled) {
      cleanupAudio();
      setMicEnabled(false);
      stopTransmitting();
      setCurrentVolume(-100);
    } else {
      try {
        setMicError(null);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        streamRef.current = stream;

        // Initialize Web Audio API to analyze active speaking volumes
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioCtx();
        audioContextRef.current = audioContext;

        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        analyserRef.current = analyser;

        setMicEnabled(true);

        // Volume monitoring loop
        const pcmData = new Float32Array(analyser.fftSize);
        let speakingDebounce = 0;

        const monitorVolume = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getFloatTimeDomainData(pcmData);
          
          // Calculate root-mean-square (RMS) for DB level
          let sumSquares = 0.0;
          for (const amplitude of pcmData) {
            sumSquares += amplitude * amplitude;
          }
          const rms = Math.sqrt(sumSquares / pcmData.length);
          const db = rms > 0 ? 20 * Math.log10(rms) : -100;
          
          setCurrentVolume(Math.round(db));

          // Handle Voice Activity Detection (if not on Push To Talk)
          if (!pushToTalk) {
            if (db > voiceThreshold) {
              speakingDebounce = 15; // Hold transmission open for 15 frames after speaking
              if (!isCurrentlyTransmitting) {
                startTransmitting();
              }
            } else {
              if (speakingDebounce > 0) {
                speakingDebounce--;
              } else if (isCurrentlyTransmitting) {
                stopTransmitting();
              }
            }
          }

          animationFrameRef.current = requestAnimationFrame(monitorVolume);
        };

        monitorVolume();
      } catch (err: any) {
        console.warn('Microphone permission or capture failed:', err);
        setMicError(err.message || 'Permission denied. Could not open microphone.');
      }
    }
  };

  const cleanupAudio = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  };

  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, []);

  // Broadcast Tactical Radio Macro voice and synthesis
  const sendTacticalMacro = (text: string, synthPhrase: string) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      // Send websocket macro event
      socket.send(JSON.stringify({
        type: 'voice_data',
        isSpeaking: true,
        textMacro: text
      }));

      // Immediately toggle back off
      setTimeout(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'voice_indicator',
            isSpeaking: false
          }));
        }
      }, 1000);

      // Speak locally so player receives sound confirmation
      playVoiceSynthesis(playerName, text, team);
    }
  };

  return (
    <div id="voice-tactical-controller" className="bg-slate-900/90 border border-slate-700 p-4 rounded-xl shadow-xl w-80 text-white backdrop-blur-md">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Radio className={`w-5 h-5 ${isCurrentlyTransmitting ? 'text-green-400 animate-pulse' : 'text-slate-400'}`} />
          <span className="font-semibold text-sm tracking-wide uppercase">Tactical Voice Comms</span>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
          team === 'Red' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 
          team === 'Blue' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 
          'bg-purple-500/20 text-purple-400 border border-purple-500/30'
        }`}>
          {team} Channel
        </span>
      </div>

      {micError && (
        <p className="text-[11px] text-red-400 bg-red-950/40 p-2 rounded mb-3 border border-red-900/40">
          ⚠️ {micError}
        </p>
      )}

      {/* Main Controls */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <button
          onClick={toggleMic}
          className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all duration-200 cursor-pointer border ${
            micEnabled 
              ? 'bg-red-600/20 border-red-500 text-red-300 hover:bg-red-600/30' 
              : 'bg-emerald-600/20 border-emerald-500 text-emerald-300 hover:bg-emerald-600/30'
          }`}
        >
          {micEnabled ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          {micEnabled ? 'Disable Mic' : 'Enable Mic'}
        </button>

        <button
          onClick={() => {
            setPushToTalk(!pushToTalk);
            stopTransmitting();
          }}
          className={`flex items-center justify-center gap-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all duration-200 border ${
            pushToTalk 
              ? 'bg-slate-700 border-slate-600 text-white' 
              : 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
          }`}
        >
          <Volume2 className="w-4 h-4" />
          {pushToTalk ? 'Push-To-Talk (V)' : 'Voice Activity'}
        </button>
      </div>

      {/* Volume Bar & Activity Indicator */}
      {micEnabled && (
        <div className="mb-4 bg-slate-950 p-3 rounded-lg border border-slate-800">
          <div className="flex justify-between text-[11px] text-slate-400 mb-1">
            <span>Voice Activity Level</span>
            <span>{currentVolume} dB</span>
          </div>
          <div className="h-2 bg-slate-850 rounded-full overflow-hidden flex items-center relative">
            <div 
              className={`h-full transition-all duration-75 ${
                currentVolume > voiceThreshold ? 'bg-emerald-400' : 'bg-indigo-400'
              }`}
              style={{ width: `${Math.max(0, Math.min(100, (currentVolume + 100) * 1.25))}%` }}
            />
            {/* Threshold marker */}
            <div 
              className="absolute h-full w-0.5 bg-red-500 top-0"
              style={{ left: `${(voiceThreshold + 100) * 1.25}%` }}
              title="Gate Threshold"
            />
          </div>

          {!pushToTalk ? (
            <div className="mt-2">
              <label className="flex justify-between text-[10px] text-slate-400 mb-1">
                <span>Mic gate threshold (dB)</span>
                <span>{voiceThreshold} dB</span>
              </label>
              <input
                type="range"
                min="-80"
                max="-20"
                value={voiceThreshold}
                onChange={(e) => setVoiceThreshold(Number(e.target.value))}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
              />
            </div>
          ) : (
            <div className="mt-2 text-center text-[10px] text-indigo-300 font-medium">
              HOLD <span className="px-1.5 py-0.5 bg-indigo-950 border border-indigo-800 rounded">V</span> KEY TO TRANSMIT AUDIO
            </div>
          )}
        </div>
      )}

      {/* Tactical Quick Macros */}
      <div>
        <div className="flex items-center gap-1.5 mb-2 border-t border-slate-800 pt-3">
          <Megaphone className="w-3.5 h-3.5 text-orange-400" />
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tactical Quick Radio (F2-F7)</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {TACTICAL_MACROS.map((macro, idx) => (
            <button
              key={idx}
              onClick={() => sendTacticalMacro(macro.text, macro.synth)}
              className="flex justify-between items-center py-1.5 px-2 bg-slate-800/60 hover:bg-slate-700/80 border border-slate-700/50 rounded text-left text-[11px] font-medium transition-all duration-100 cursor-pointer"
            >
              <span className="truncate">{macro.text}</span>
              <span className="text-[9px] px-1 py-0.2 bg-slate-950 text-slate-400 border border-slate-800 rounded font-mono font-semibold">
                {macro.key}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// Play client-side Web Speech Synthesis for tactical announcements (making multiplayer feel ultra-immersive)
export const playVoiceSynthesis = (senderName: string, phrase: string, team: 'Red' | 'Blue' | 'FFA') => {
  if (!('speechSynthesis' in window)) return;

  // Stop any currently speaking phrases to avoid speech queue build-up
  window.speechSynthesis.cancel();

  // Clean the sender name (keep short)
  const shortName = senderName.split('_')[0].slice(0, 10);
  const synthText = `${shortName}: ${phrase}`;

  const utterance = new SpeechSynthesisUtterance(synthText);
  utterance.volume = 0.8;
  utterance.rate = 1.05; // slightly faster robot-operator style
  
  // Choose voice (preferably a clean robotic english voice)
  const voices = window.speechSynthesis.getVoices();
  const preferredVoice = voices.find(v => 
    v.lang.startsWith('en') && 
    (v.name.toLowerCase().includes('google') || v.name.toLowerCase().includes('robot') || v.name.toLowerCase().includes('natural'))
  );
  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }

  // Pitch adjustment based on team
  if (team === 'Red') {
    utterance.pitch = 0.85; // slightly lower deeper soldier tone
  } else if (team === 'Blue') {
    utterance.pitch = 1.15; // slightly higher tactical tone
  } else {
    utterance.pitch = 1.0;
  }

  window.speechSynthesis.speak(utterance);
};
