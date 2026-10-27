import React, { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import {
  Mic,
  MicOff,
  Settings,
  Maximize2,
  Minimize2,
  RotateCcw,
  Volume2,
  VolumeX,
  Sparkles,
  Sliders,
  Clock,
  Play,
  Pause,
  Award,
  BookOpen,
  Users,
  MessageSquare
} from 'lucide-react';

interface SettingsConfig {
  micGain: number;
  yellowThreshold: number;
  redThreshold: number;
  enableBeep: boolean;
  redCooldownMs: number;
}

type TrafficState = 'green' | 'yellow' | 'red';
type ViewMode = 'classic' | 'mascot' | 'meter';

interface ActivityPreset {
  id: string;
  name: string;
  icon: string;
  yellow: number;
  red: number;
  description: string;
}

const PRESETS: ActivityPreset[] = [
  {
    id: 'exam',
    name: 'Examen / Silencio',
    icon: '🤫',
    yellow: 20,
    red: 35,
    description: 'Máxima concentración y silencio absoluto'
  },
  {
    id: 'individual',
    name: 'Trabajo Individual',
    icon: '📖',
    yellow: 30,
    red: 50,
    description: 'Lectura o tareas personales en calma'
  },
  {
    id: 'cooperative',
    name: 'Trabajo en Grupos',
    icon: '👥',
    yellow: 40,
    red: 65,
    description: 'Murmullo bajo para cooperar en equipo'
  },
  {
    id: 'assembly',
    name: 'Asamblea / Debate',
    icon: '🗣️',
    yellow: 55,
    red: 80,
    description: 'Participación abierta y turnos de palabra'
  }
];

export default function App() {
  // Configuración con persistencia
  const [config, setConfig] = useState<SettingsConfig>(() => {
    const saved = localStorage.getItem('semaforo_ruido_cfg');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          micGain: parsed.micGain ?? 1.5,
          yellowThreshold: parsed.yellowThreshold ?? 35,
          redThreshold: parsed.redThreshold ?? 60,
          enableBeep: parsed.enableBeep ?? true,
          redCooldownMs: parsed.redCooldownMs ?? 3000
        };
      } catch {
        // Fallback
      }
    }
    return {
      micGain: 1.5,
      yellowThreshold: 35,
      redThreshold: 60,
      enableBeep: true,
      redCooldownMs: 3000
    };
  });

  // Estado del motor de audio y UI
  const [isListening, setIsListening] = useState(false);
  const [volume, setVolume] = useState(0);
  const [trafficState, setTrafficState] = useState<TrafficState>('green');
  const [warningCount, setWarningCount] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('classic');
  const [audioError, setAudioError] = useState<string | null>(null);

  // Temporizador de sesión de clase
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [timeInGreen, setTimeInGreen] = useState(0);
  const [timeInYellow, setTimeInYellow] = useState(0);
  const [timeInRed, setTimeInRed] = useState(0);

  // Temporizador de actividad (Countdown)
  const [timerMinutes, setTimerMinutes] = useState(15);
  const [timerRemaining, setTimerRemaining] = useState<number | null>(null);
  const [isTimerRunning, setIsTimerRunning] = useState(false);

  // Referencias mutables para el ciclo de audio Web API
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const smoothedVolumeRef = useRef(0);
  const lastRedTriggerTimeRef = useRef(0);
  const configRef = useRef(config);
  configRef.current = config;

  // WakeLock
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Guardar configuración en localStorage
  const saveConfig = (newConfig: SettingsConfig) => {
    setConfig(newConfig);
    localStorage.setItem('semaforo_ruido_cfg', JSON.stringify(newConfig));
  };

  // Generador de tono sutil con Web Audio API
  const playWarningBeep = useCallback((ctx?: AudioContext) => {
    const context = ctx || audioCtxRef.current;
    if (!context || !configRef.current.enableBeep) return;
    try {
      if (context.state === 'suspended') {
        context.resume();
      }
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, context.currentTime); // Tono A4
      osc.frequency.exponentialRampToValueAtTime(320, context.currentTime + 0.3);

      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(context.destination);

      osc.start();
      osc.stop(context.currentTime + 0.36);
    } catch (err) {
      console.warn('Error al reproducir bip sutil:', err);
    }
  }, []);

  // Solicitar bloqueo de suspensión de pantalla
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator && !wakeLockRef.current) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      } catch (err) {
        console.debug('No se pudo activar el Wake Lock:', err);
      }
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  };

  // Iniciar escucha del micrófono
  const startListening = async () => {
    setAudioError(null);
    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtxClass();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      audioCtxRef.current = ctx;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false, // Permitir captar murmullo real de clase
          autoGainControl: false
        }
      });
      streamRef.current = stream;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      analyserRef.current = analyser;

      setIsListening(true);
      requestWakeLock();

      // Bucle de análisis acústico
      const buffer = new Uint8Array(analyser.frequencyBinCount);

      const processAudio = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(buffer);

        // Cálculo RMS
        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i++) {
          const norm = (buffer[i] - 128) / 128;
          sumSquares += norm * norm;
        }
        const rms = Math.sqrt(sumSquares / buffer.length);

        // Escalar con ganancia de usuario
        const instant = Math.min(100, Math.round(rms * 100 * configRef.current.micGain * 3.2));

        // Suavizado exponencial para evitar parpadeos bruscos
        smoothedVolumeRef.current = smoothedVolumeRef.current * 0.7 + instant * 0.3;
        const currentVol = Math.round(smoothedVolumeRef.current);
        setVolume(currentVol);

        // Lógica de estado del semáforo
        const { redThreshold, yellowThreshold, redCooldownMs } = configRef.current;

        if (currentVol >= redThreshold) {
          setTrafficState('red');
          const now = Date.now();
          if (now - lastRedTriggerTimeRef.current > redCooldownMs) {
            setWarningCount(prev => prev + 1);
            playWarningBeep();
            lastRedTriggerTimeRef.current = now;
          }
        } else if (currentVol >= yellowThreshold) {
          setTrafficState('yellow');
        } else {
          setTrafficState('green');
        }

        animationFrameRef.current = requestAnimationFrame(processAudio);
      };

      animationFrameRef.current = requestAnimationFrame(processAudio);
    } catch (err: unknown) {
      console.error('Error al acceder al micrófono:', err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes('Permission') || errorMsg.includes('NotAllowedError')) {
        setAudioError('Permiso de micrófono denegado. Permite el acceso para medir el ruido del aula.');
      } else {
        setAudioError('No se encontró micrófono o no está disponible en este dispositivo.');
      }
      setIsListening(false);
    }
  };

  // Detener escucha
  const stopListening = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setIsListening(false);
    setVolume(0);
    setTrafficState('green');
    releaseWakeLock();
  };

  // Limpieza al desmontar
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, []);

  // Contador de tiempo de sesión y métricas por estado
  useEffect(() => {
    if (!isListening) return;
    const interval = setInterval(() => {
      setSessionSeconds(prev => prev + 1);
      if (trafficState === 'green') setTimeInGreen(prev => prev + 1);
      else if (trafficState === 'yellow') setTimeInYellow(prev => prev + 1);
      else if (trafficState === 'red') setTimeInRed(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isListening, trafficState]);

  // Manejo del temporizador regresivo de clase
  useEffect(() => {
    if (!isTimerRunning || timerRemaining === null) return;
    if (timerRemaining <= 0) {
      setIsTimerRunning(false);
      // Chime final y confetti de felicitación
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      return;
    }
    const interval = setInterval(() => {
      setTimerRemaining(prev => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [isTimerRunning, timerRemaining]);

  // Pantalla completa
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Aplicar preset rápido
  const applyPreset = (preset: ActivityPreset) => {
    saveConfig({
      ...config,
      yellowThreshold: preset.yellow,
      redThreshold: preset.red
    });
  };

  // Recompensa y felicitación para la clase
  const celebrateClassroom = () => {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#22c55e', '#3b82f6', '#eab308', '#a855f7']
    });
  };

  // Cálculos de porcentajes de convivencia
  const totalTracked = timeInGreen + timeInYellow + timeInRed;
  const pctGreen = totalTracked > 0 ? Math.round((timeInGreen / totalTracked) * 100) : 100;
  const pctYellow = totalTracked > 0 ? Math.round((timeInYellow / totalTracked) * 100) : 0;
  const pctRed = totalTracked > 0 ? Math.round((timeInRed / totalTracked) * 100) : 0;

  // Formato de segundos a MM:SS
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="bg-slate-900 text-slate-100 min-h-screen flex flex-col justify-between select-none">
      {/* Header Superior */}
      <header className="w-full bg-slate-800/80 backdrop-blur border-b border-slate-700/60 px-4 py-3 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-950 flex items-center justify-center border border-slate-700 shadow-inner">
              <span className="text-xl">🚦</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold font-display tracking-wide text-white">
                  Semáforo de Aula
                </h1>
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Digital
                </span>
              </div>
              <p className="text-xs text-slate-400">Control Acústico y Convivencia Escolar</p>
            </div>
          </div>

          {/* Acciones de Cabecera */}
          <div className="flex items-center gap-2">
            {/* Selector de modo visual */}
            <div className="hidden sm:flex bg-slate-950/60 p-1 rounded-xl border border-slate-700 text-xs">
              <button
                onClick={() => setViewMode('classic')}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  viewMode === 'classic' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                Clásico
              </button>
              <button
                onClick={() => setViewMode('mascot')}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  viewMode === 'mascot' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                Mascota 🦉
              </button>
              <button
                onClick={() => setViewMode('meter')}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  viewMode === 'meter' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                Medidor
              </button>
            </div>

            <button
              onClick={() => setShowSettings(true)}
              className="p-2.5 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-200 transition focus:outline-none"
              title="Ajustes y Sensibilidad"
            >
              <Settings className="w-5 h-5" />
            </button>

            <button
              onClick={toggleFullscreen}
              className="p-2.5 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-200 transition focus:outline-none"
              title={isFullscreen ? 'Salir de Pantalla Completa' : 'Modo Pantalla Completa'}
            >
              {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Banner de error si el micrófono falla */}
      {audioError && (
        <div className="max-w-5xl mx-auto px-4 pt-3 w-full">
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs sm:text-sm p-3 rounded-xl flex items-center justify-between">
            <span>{audioError}</span>
            <button
              onClick={() => setAudioError(null)}
              className="ml-2 font-bold hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Barra de modos rápidos en móviles */}
      <div className="sm:hidden max-w-sm mx-auto w-full px-4 pt-3 flex justify-center gap-2">
        <button
          onClick={() => setViewMode('classic')}
          className={`flex-1 py-1.5 text-xs rounded-xl font-medium border ${
            viewMode === 'classic'
              ? 'bg-blue-600/30 border-blue-500 text-blue-200'
              : 'bg-slate-800/60 border-slate-700 text-slate-400'
          }`}
        >
          Semáforo
        </button>
        <button
          onClick={() => setViewMode('mascot')}
          className={`flex-1 py-1.5 text-xs rounded-xl font-medium border ${
            viewMode === 'mascot'
              ? 'bg-blue-600/30 border-blue-500 text-blue-200'
              : 'bg-slate-800/60 border-slate-700 text-slate-400'
          }`}
        >
          Mascota 🦉
        </button>
        <button
          onClick={() => setViewMode('meter')}
          className={`flex-1 py-1.5 text-xs rounded-xl font-medium border ${
            viewMode === 'meter'
              ? 'bg-blue-600/30 border-blue-500 text-blue-200'
              : 'bg-slate-800/60 border-slate-700 text-slate-400'
          }`}
        >
          Medidor
        </button>
      </div>

      {/* Área Principal de Visualización */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 flex flex-col justify-center items-center gap-6">

        {/* Tarjeta Central */}
        <div className="w-full max-w-sm sm:max-w-md bg-slate-950/70 p-6 sm:p-8 rounded-3xl border-4 border-slate-800 shadow-2xl flex flex-col items-center gap-6 relative">
          
          {/* MODO 1: CLÁSICO (Semáforo 3 Luces) */}
          {viewMode === 'classic' && (
            <div className="flex flex-col items-center gap-5 p-4 bg-slate-900 rounded-2xl border-2 border-slate-800 w-full max-w-[210px] shadow-inner">
              {/* Luz Roja */}
              <div
                className={`traffic-light w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-red-600 border-4 border-red-950/80 flex items-center justify-center ${
                  trafficState === 'red' ? 'active-red' : ''
                }`}
              >
                <span className="text-3xl sm:text-4xl">🤫</span>
              </div>

              {/* Luz Amarilla */}
              <div
                className={`traffic-light w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-yellow-400 border-4 border-yellow-950/80 flex items-center justify-center ${
                  trafficState === 'yellow' ? 'active-yellow' : ''
                }`}
              >
                <span className="text-3xl sm:text-4xl">👂</span>
              </div>

              {/* Luz Verde */}
              <div
                className={`traffic-light w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-emerald-500 border-4 border-emerald-950/80 flex items-center justify-center ${
                  trafficState === 'green' ? 'active-green' : ''
                }`}
              >
                <span className="text-3xl sm:text-4xl">😊</span>
              </div>
            </div>
          )}

          {/* MODO 2: MASCOTA DE AULA (Búho Guardián del Silencio) */}
          {viewMode === 'mascot' && (
            <div className="flex flex-col items-center justify-center p-6 bg-slate-900 rounded-3xl border-2 border-slate-800 w-full max-w-[260px] shadow-inner relative overflow-hidden">
              <div
                className={`text-7xl sm:text-8xl transition-transform duration-300 ${
                  trafficState === 'red'
                    ? 'scale-110 animate-bounce'
                    : trafficState === 'yellow'
                    ? 'scale-105'
                    : 'scale-100'
                }`}
              >
                {trafficState === 'green' ? '🦉' : trafficState === 'yellow' ? '🧐' : '🙈'}
              </div>
              <div className="mt-3 text-center">
                <span
                  className={`inline-block px-3 py-1 rounded-full text-xs font-bold tracking-wide ${
                    trafficState === 'green'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : trafficState === 'yellow'
                      ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'
                      : 'bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse'
                  }`}
                >
                  {trafficState === 'green'
                    ? 'Búho Feliz y Tranquilo'
                    : trafficState === 'yellow'
                    ? 'Búho Escuchando Murmullos'
                    : '¡Búho se Tapa los Oídos!'}
                </span>
              </div>
            </div>
          )}

          {/* MODO 3: MEDIDOR GIGANTE (VU-Meter para Proyector) */}
          {viewMode === 'meter' && (
            <div className="w-full bg-slate-900 rounded-2xl border-2 border-slate-800 p-6 flex flex-col items-center justify-center gap-4">
              <div className="relative w-40 h-40 flex items-center justify-center">
                {/* Círculo de fondo */}
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    stroke="#1e293b"
                    strokeWidth="10"
                    fill="transparent"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    stroke={
                      trafficState === 'red'
                        ? '#ef4444'
                        : trafficState === 'yellow'
                        ? '#eab308'
                        : '#22c55e'
                    }
                    strokeWidth="10"
                    strokeDasharray={251.2}
                    strokeDashoffset={251.2 - (251.2 * volume) / 100}
                    strokeLinecap="round"
                    fill="transparent"
                    className="transition-all duration-100"
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-4xl font-extrabold font-display">{volume}%</span>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    Decibelio Rel.
                  </span>
                </div>
              </div>
              <div className="text-xs text-slate-400 flex justify-between w-full px-4">
                <span>0% Min</span>
                <span className="text-yellow-400">🟡 {config.yellowThreshold}%</span>
                <span className="text-red-400">🔴 {config.redThreshold}%</span>
                <span>100% Max</span>
              </div>
            </div>
          )}

          {/* Indicador textual de estado */}
          <div className="text-center w-full">
            <div
              className={`text-xl sm:text-2xl font-bold font-display tracking-wide ${
                trafficState === 'red'
                  ? 'text-red-500'
                  : trafficState === 'yellow'
                  ? 'text-yellow-400'
                  : 'text-emerald-400'
              }`}
            >
              {trafficState === 'red'
                ? '¡Demasiado Ruido!'
                : trafficState === 'yellow'
                ? 'Cuidado con el Murmullo'
                : 'Ambiente Perfecto'}
            </div>
            <div className="text-xs sm:text-sm text-slate-400 mt-1">
              {trafficState === 'red'
                ? 'Haced silencio para poder continuar'
                : trafficState === 'yellow'
                ? 'Bajad el tono de voz al hablar en equipo'
                : 'Nivel de ruido óptimo para trabajar'}
            </div>
          </div>

          {/* Barra de Volumen Actual (Vúmetro) */}
          <div className="w-full mt-2">
            <div className="flex justify-between text-xs font-semibold text-slate-400 mb-1">
              <span>VOLUMEN EN VIVO</span>
              <span>{volume}%</span>
            </div>
            <div className="w-full h-4 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700/80 flex">
              <div
                className={`h-full rounded-full transition-all duration-75 ${
                  trafficState === 'red'
                    ? 'bg-red-500'
                    : trafficState === 'yellow'
                    ? 'bg-yellow-400'
                    : 'bg-emerald-500'
                }`}
                style={{ width: `${volume}%` }}
              />
            </div>
          </div>
        </div>

        {/* Panel de Métricas Rápidas: Infracciones e Inicio */}
        <div className="w-full max-w-sm sm:max-w-md grid grid-cols-2 gap-4">
          {/* Tarjeta Infracciones Rojas */}
          <div className="bg-slate-800/60 border border-slate-700/70 p-4 rounded-2xl flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400 uppercase font-bold tracking-wider">Avisos Rojos</div>
              <div className="text-3xl font-extrabold text-red-400 mt-1">{warningCount}</div>
            </div>
            <button
              onClick={() => setWarningCount(0)}
              className="p-2 text-slate-400 hover:text-white bg-slate-700/50 hover:bg-slate-700 rounded-xl text-xs transition"
              title="Reiniciar avisos"
            >
              Reiniciar
            </button>
          </div>

          {/* Botón de Encendido / Escucha */}
          <button
            onClick={() => (isListening ? stopListening() : startListening())}
            className={`font-bold p-4 rounded-2xl shadow-lg active:scale-95 transition flex items-center justify-center gap-2 ${
              isListening
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/30'
            }`}
          >
            {isListening ? (
              <>
                <MicOff className="w-6 h-6 animate-pulse" />
                <span>Detener</span>
              </>
            ) : (
              <>
                <Mic className="w-6 h-6" />
                <span>Iniciar Mic</span>
              </>
            )}
          </button>
        </div>

        {/* Presets de Actividades de Clase */}
        <div className="w-full max-w-sm sm:max-w-md bg-slate-950/40 p-4 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase font-bold text-slate-400 tracking-wider">
              Modos de Actividad
            </span>
            <span className="text-[11px] text-slate-500">Calibración rápida</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map(p => {
              const isActive =
                config.yellowThreshold === p.yellow && config.redThreshold === p.red;
              return (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p)}
                  className={`p-2.5 rounded-xl text-left border transition flex flex-col gap-1 ${
                    isActive
                      ? 'bg-blue-600/20 border-blue-500 text-white'
                      : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold text-xs">
                    <span>{p.icon}</span>
                    <span className="truncate">{p.name}</span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    🟡 {p.yellow}% • 🔴 {p.red}%
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Estadísticas de Convivencia y Silencio del Aula */}
        <div className="w-full max-w-sm sm:max-w-md bg-slate-950/40 p-4 rounded-2xl border border-slate-800 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-emerald-400" />
              <span className="text-xs uppercase font-bold text-slate-300 tracking-wider">
                Rendimiento de Convivencia
              </span>
            </div>
            <span className="text-xs text-slate-400 font-mono">
              {formatTime(sessionSeconds)}
            </span>
          </div>

          {/* Barra de Convivencia */}
          <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden flex">
            <div style={{ width: `${pctGreen}%` }} className="bg-emerald-500 transition-all duration-300" title="Verde" />
            <div style={{ width: `${pctYellow}%` }} className="bg-yellow-400 transition-all duration-300" title="Amarillo" />
            <div style={{ width: `${pctRed}%` }} className="bg-red-500 transition-all duration-300" title="Rojo" />
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="text-emerald-400 font-semibold">🟢 {pctGreen}% Tranquilo</span>
            <span className="text-yellow-400 font-semibold">🟡 {pctYellow}% Murmullo</span>
            <span className="text-red-400 font-semibold">🔴 {pctRed}% Ruido</span>
          </div>

          {pctGreen >= 80 && sessionSeconds >= 30 && (
            <button
              onClick={celebrateClassroom}
              className="mt-1 w-full py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-yellow-300" />
              <span>¡Felicitar a la Clase! (Confeti)</span>
            </button>
          )}
        </div>

      </main>

      {/* Modal / Drawer de Ajustes y Calibración */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl overflow-y-auto max-h-[85vh]">
            
            <div className="flex items-center justify-between mb-5 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚙️</span>
                <h2 className="text-lg font-bold text-white">Calibrar Sensibilidad</h2>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 hover:bg-slate-700 transition"
              >
                ✕
              </button>
            </div>

            <div className="space-y-6">
              
              {/* Multiplicador / Sensibilidad Mic */}
              <div>
                <div className="flex justify-between items-center text-sm font-semibold mb-2">
                  <label htmlFor="sliderGain">Ganancia del Micrófono</label>
                  <span className="text-blue-400 font-bold">{config.micGain}x</span>
                </div>
                <input
                  type="range"
                  id="sliderGain"
                  min="0.5"
                  max="4.0"
                  step="0.1"
                  value={config.micGain}
                  onChange={e =>
                    saveConfig({ ...config, micGain: parseFloat(e.target.value) })
                  }
                  className="w-full h-2 bg-slate-800 rounded-lg cursor-pointer"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Aumenta este valor si el micrófono de tu móvil captura poco sonido.
                </p>
              </div>

              {/* Umbral Amarillo */}
              <div>
                <div className="flex justify-between items-center text-sm font-semibold mb-2 text-yellow-400">
                  <label htmlFor="sliderYellow">Límite Amarillo (Murmullo)</label>
                  <span className="font-bold">{config.yellowThreshold}%</span>
                </div>
                <input
                  type="range"
                  id="sliderYellow"
                  min="10"
                  max="60"
                  step="2"
                  value={config.yellowThreshold}
                  onChange={e => {
                    const val = parseInt(e.target.value);
                    const newRed = val >= config.redThreshold ? val + 5 : config.redThreshold;
                    saveConfig({ ...config, yellowThreshold: val, redThreshold: newRed });
                  }}
                  className="w-full h-2 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Umbral Rojo */}
              <div>
                <div className="flex justify-between items-center text-sm font-semibold mb-2 text-red-400">
                  <label htmlFor="sliderRed">Límite Rojo (Exceso de ruido)</label>
                  <span className="font-bold">{config.redThreshold}%</span>
                </div>
                <input
                  type="range"
                  id="sliderRed"
                  min="40"
                  max="95"
                  step="2"
                  value={config.redThreshold}
                  onChange={e => {
                    const val = parseInt(e.target.value);
                    const newYellow = val <= config.yellowThreshold ? Math.max(5, val - 5) : config.yellowThreshold;
                    saveConfig({ ...config, redThreshold: val, yellowThreshold: newYellow });
                  }}
                  className="w-full h-2 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Sonido de Alarma sutil */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <div>
                  <div className="text-sm font-medium text-slate-200">Aviso Sonoro Sutil</div>
                  <div className="text-xs text-slate-400">Emite un bip suave cuando se activa el semáforo rojo</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.enableBeep}
                    onChange={e => saveConfig({ ...config, enableBeep: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* Botón para probar el sonido */}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => playWarningBeep()}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 flex items-center gap-1.5 transition"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Probar Sonido de Alerta</span>
                </button>
              </div>

            </div>

            <button
              onClick={() => setShowSettings(false)}
              className="mt-8 w-full py-3 bg-blue-600 hover:bg-blue-500 font-bold rounded-xl text-white shadow-lg transition"
            >
              Cerrar y Guardar
            </button>
          </div>
        </div>
      )}

      {/* Pie de página informativo */}
      <footer className="w-full text-center py-3 text-xs text-slate-500 border-t border-slate-800/60 bg-slate-950/40">
        Semáforo Escolar • PWA para Proyectores y Dispositivos Móviles
      </footer>
    </div>
  );
}
