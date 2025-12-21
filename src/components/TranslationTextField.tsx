import React from "react";
import styled, { createGlobalStyle } from "styled-components";
import CloseIcon from "../assets/CloseIcon";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";
import { useSpeechSynthesis } from "react-speech-kit";
import { useSearchParams } from "react-router-dom";
import MicIcon from "assets/MicIcon";
import PauseIcon from "assets/PauseIcon";
import SpeakerIcon from "assets/SpeakerIcon";
import { DEFAULT_SOURCE_LANGUAGE } from "utils/constants";

const GlobalStyle = createGlobalStyle`
  @keyframes pulse {
    0% { transform: scale(0.95); opacity: 0.7; }
    70% { transform: scale(1.1); opacity: 0.3; }
    100% { transform: scale(0.95); opacity: 0.7; }
  }
`;

const Container = styled.div<{ $hasText: boolean }>`
  position: relative;
  height: auto;

  textarea {
    width: 100%;
    height: 87%;
    background-color: inherit;
    border: none;
    outline: none;
    box-shadow: none;
    color: #ffffff;
    padding: 16px 40px 24px 16px;
    font-size: 18px;
    resize: none;
    transition: all 0.1s ease;

    &:focus {
      outline: 2px solid ${(props) => props.theme.primary.main};
    }

    &::-webkit-scrollbar {
      width: 12px;
    }

    &::-webkit-scrollbar-thumb {
      border: 2px solid ${(props) => props.theme.primary.main};
      border-radius: 20px;
      background-color: ${(props) => props.theme.primary[700]};
    }
  }

  .text-clear {
    display: ${(props) => (props.$hasText ? "block" : "none")};
    position: absolute;
    top: 16px;
    right: 16px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: opacity 0.2s ease;

    &:hover {
      opacity: 0.8;
    }
  }
`;

const Actions = styled.div`
  position: absolute;
  bottom: 10px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 16px;

  button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 5px;
    transition: all 0.2s ease;
    position: relative;
    
    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    &:hover:not(:disabled) {
      transform: scale(1.05);
    }
  }

  .error-message {
    color: #ff4444;
    font-size: 12px;
    margin-left: 10px;
    animation: fadeIn 0.2s ease;

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  }

  .pulse-indicator {
    position: absolute;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.14);
    animation: pulse 1s infinite;
  }
`;

const TranslationTextField = () => {
  const [searchParams, setURLSearchParams] = useSearchParams();
  const [text, setText] = React.useState(searchParams.get("text") || "");
  const [voice, setVoice] = React.useState<SpeechSynthesisVoice | null>(null);
  const { speak, cancel, speaking, supported } = useSpeechSynthesis();
  const sl = searchParams.get("sl") || DEFAULT_SOURCE_LANGUAGE;
  const [voices, setVoices] = React.useState<SpeechSynthesisVoice[]>([]);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = React.useState<string | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const mediaStreamRef = React.useRef<MediaStream | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const vadIntervalRef = React.useRef<number | null>(null);
  const silenceTimerRef = React.useRef<number | null>(null);
    const activeFramesRef = React.useRef<number>(0);
    const silentFramesRef = React.useRef<number>(0);
  const rmsSmoothRef = React.useRef<number>(0);
  const noiseFloorRef = React.useRef<number>(1);
  const [voiceCache, setVoiceCache] = React.useState<Record<string, SpeechSynthesisVoice>>({});
  const {
    transcript,
    listening,
    resetTranscript,
    browserSupportsSpeechRecognition,
    isMicrophoneAvailable,
  } = useSpeechRecognition({
    clearTranscriptOnListen: false,
    commands: [
      {
        command: 'clear',
        callback: () => clearTextHandler(),
      }
    ]
  });
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const voicesInitialized = React.useRef(false);
  const manualEditRef = React.useRef<boolean>(false);
  const manualEditTimeoutRef = React.useRef<number | null>(null);

  // VAD (Voice Activity Detection) settings
  // Mejor sensibilidad: suavizado RMS, estimación de ruido y umbral adaptativo
  const baseVolumeThreshold = 0.03; // valor mínimo absoluto para evitar demasiada sensibilidad
  const vadCheckInterval = 75; // ms entre comprobaciones de VAD (más responsivo)
  const activeHoldCount = 3; // frames consecutivos por encima del umbral para confirmar voz
  const silenceHoldCount = 6; // frames consecutivos por debajo del umbral para confirmar silencio
  const silenceTimeout = 1000; // ms de silencio adicional (no usado para el conteo principal)
  const rmsSmoothingAlpha = 0.15; // coeficiente EMA para suavizado del RMS
  const adaptiveMultiplier = 3.5; // multiplicador sobre el ruido de fondo para formar el umbral adaptativo

  // Optimized voice loading with caching
  React.useEffect(() => {
    const loadVoices = () => {
      // Only fetch voices if we haven't already
      if (voicesInitialized.current) return;
      
      const availableVoices = window.speechSynthesis.getVoices();
      if (availableVoices.length > 0) {
        setVoices(availableVoices);
        
        // Create voice cache for faster lookups
        const cache: Record<string, SpeechSynthesisVoice> = {};
        availableVoices.forEach(voice => {
          const langPrefix = voice.lang.split('-')[0];
          if (!cache[langPrefix] || voice.default) {
            cache[langPrefix] = voice;
          }
        });
        
        setVoiceCache(cache);
        voicesInitialized.current = true;
        
        // Set initial voice
        const defaultVoice = availableVoices.find(v => v.default) || availableVoices[0];
        setVoice(defaultVoice);
      }
    };
    
    // Try to load voices immediately
    loadVoices();
    
    // Set up event listener as fallback
    if (!voicesInitialized.current) {
      window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
      return () => {
        window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
      };
    }
  }, []);

  // Solicitar permiso y listar dispositivos al inicio
  React.useEffect(() => {
    const initDevices = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        const list = await navigator.mediaDevices.enumerateDevices();
        const inputs = list.filter(d => d.kind === 'audioinput');
        setDevices(inputs);
        if (inputs.length > 0 && !selectedDeviceId) setSelectedDeviceId(inputs[0].deviceId);
      } catch (err) {
        console.warn('No se pudo acceder a dispositivos de audio', err);
      }
    };

    initDevices();
  }, []);

  const setTextParam = React.useCallback((value: string) => {
    const trimmedValue = value.trim() === "" ? "" : value;
    setText(trimmedValue);
    setURLSearchParams((params) => {
      if (trimmedValue === "") {
        params.delete("text");
      } else {
        params.set("text", trimmedValue);
      }
      return params;
    });
  }, [setURLSearchParams]);

  const clearTextHandler = async () => {
    setTextParam("");
    resetTranscript();
    if (listening) {
      await SpeechRecognition.stopListening();
      SpeechRecognition.abortListening(); // Forzar el cese inmediato de la escucha
    }
    cancel();
    await cleanupAudioProcessing();
  };

  const handleChangeText = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Marcar edición manual para evitar que la VAD/transcripción la sobrescriba inmediatamente
    if (manualEditTimeoutRef.current) {
      window.clearTimeout(manualEditTimeoutRef.current);
      manualEditTimeoutRef.current = null;
    }
    manualEditRef.current = true;
    manualEditTimeoutRef.current = window.setTimeout(() => {
      manualEditRef.current = false;
      manualEditTimeoutRef.current = null;
    }, 700);

    setTextParam(e.target.value);

    // Si el usuario borró todo el texto, también limpiar la transcripción
    if (e.target.value.trim() === "") {
      resetTranscript();
    }
  };

  // Optimized speech recognition handling
  const handleSpeech = async () => {
    try {
      setIsProcessing(true);
      if (listening) {
        await SpeechRecognition.stopListening();
        await cleanupAudioProcessing();
      } else {
        if (!isMicrophoneAvailable) {
          alert("Por favor permite acceso al micrófono");
          return;
        }
        // Inicializar procesamiento de audio con constraints y VAD
        await setupAudioProcessing(selectedDeviceId);

        await SpeechRecognition.startListening({
          continuous: true,
          interimResults: true,
          language: sl
        });
      }
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Inicializa WebAudio con constraints para mejorar la captura
  const setupAudioProcessing = async (deviceId: string | null) => {
    try {
      // Si ya existe un stream, limpiarlo
      await cleanupAudioProcessing();

      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const compressor = audioCtx.createDynamicsCompressor();
      const gain = audioCtx.createGain();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;

      // Conectar: source -> compressor -> gain -> analyser (no conectar a destino)
      source.connect(compressor);
      compressor.connect(gain);
      gain.connect(analyser);

      analyserRef.current = analyser;

      // Iniciar VAD simple
      startVAD();
    } catch (err) {
      console.error('No se pudo inicializar audio:', err);
    }
  };

  const cleanupAudioProcessing = async () => {
    try {
      if (vadIntervalRef.current) {
        window.clearInterval(vadIntervalRef.current);
        vadIntervalRef.current = null;
      }

      // Reset VAD counters
      activeFramesRef.current = 0;
      silentFramesRef.current = 0;

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
      }

      if (audioContextRef.current) {
        try { await audioContextRef.current.close(); } catch(e){}
        audioContextRef.current = null;
      }

      analyserRef.current = null;
    } catch (err) {
      console.warn('Error during cleanupAudioProcessing', err);
    }
  };

  const startVAD = () => {
    if (!analyserRef.current) return;
    const analyser = analyserRef.current;

    // Buffer para lectura de float (más precisión si está disponible)
    const floatData = new Float32Array(analyser.fftSize);

    // Comprobar nivel RMS en intervalos regulares y usar conteo de frames con suavizado y umbral adaptativo
    vadIntervalRef.current = window.setInterval(() => {
      // Preferir getFloatTimeDomainData si existe para mayor precisión
      if ((analyser as any).getFloatTimeDomainData) {
        (analyser as any).getFloatTimeDomainData(floatData);
      } else {
        const byteData = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(byteData);
        for (let i = 0; i < byteData.length; i++) {
          floatData[i] = (byteData[i] - 128) / 128;
        }
      }

      let sum = 0;
      for (let i = 0; i < floatData.length; i++) {
        const v = floatData[i];
        sum += v * v;
      }
      const rms = Math.sqrt(sum / floatData.length);

      // Suavizado exponencial del RMS para evitar picos
      const prevSmooth = rmsSmoothRef.current || 0;
      const smooth = rmsSmoothingAlpha * rms + (1 - rmsSmoothingAlpha) * prevSmooth;
      rmsSmoothRef.current = smooth;

      // Mantener estimación del ruido de fondo (mínimo adaptativo con ligero decaimiento hacia arriba)
      noiseFloorRef.current = Math.min(noiseFloorRef.current, smooth);
      // Decaimiento lento hacia arriba para permitir adaptación al ruido que sube
      noiseFloorRef.current = Math.max(noiseFloorRef.current, noiseFloorRef.current * 1.0005);

      const adaptiveThreshold = Math.max(baseVolumeThreshold, noiseFloorRef.current * adaptiveMultiplier + 0.005);

      // Mantener conteo de frames activos/silenciosos para evitar disparos por transitorios
      if (smooth > adaptiveThreshold) {
        activeFramesRef.current += 1;
        silentFramesRef.current = 0;

        if (activeFramesRef.current >= activeHoldCount) {
          if (!listening) {
            SpeechRecognition.startListening({ continuous: true, interimResults: true, language: sl }).catch(()=>{});
          }
        }
      } else {
        silentFramesRef.current += 1;
        activeFramesRef.current = 0;

        if (silentFramesRef.current >= silenceHoldCount) {
          if (listening) {
            SpeechRecognition.stopListening().catch(()=>{});
          }
        }
      }
    }, vadCheckInterval);
  };

  const handleSpeak = () => {
    if (speaking) {
      cancel();
    } else {
      speak({ 
        text,
        voice,
        rate: 1.1,
        pitch: 1,
        volume: 1
      });
    }
  };

  // Sistema mejorado para capturar audio y pasarlo al texto para traducción
  const previousTranscriptRef = React.useRef("");
  
  React.useEffect(() => {
    if (!listening) return;
    // Si el usuario editó manualmente recientemente, no sobrescribimos
    if (manualEditRef.current) return;

    if (transcript && transcript !== previousTranscriptRef.current) {
      // Actualizar el texto solo cuando hay cambios reales en la transcripción
      previousTranscriptRef.current = transcript;
      
      // Usar high priority para asegurar que la actualización sea inmediata
      window.setTimeout(() => {
        setTextParam(transcript);
      }, 0);
    }
  }, [transcript, setTextParam, listening]);

  // Único efecto para manejar la transcripción, optimizado para mayor velocidad y sensibilidad
  React.useEffect(() => {
    if (!listening) return;
    // Evitar sobrescribir si el usuario editó manualmente hace poco
    if (manualEditRef.current) return;

    // Procesar incluso transcripciones muy cortas para mayor sensibilidad
    if (transcript) {
      // Usar requestAnimationFrame para optimizar rendimiento
      requestAnimationFrame(() => {
        setTextParam(transcript);
      });
    }
    
  }, [transcript, setTextParam, listening]);

  // Optimized voice selection using cache
  React.useEffect(() => {
    if (Object.keys(voiceCache).length === 0) return;
    
    // Try to find voice by language code
    const langPrefix = sl.split('-')[0];
    const cachedVoice = voiceCache[langPrefix];
    
    if (cachedVoice) {
      setVoice(cachedVoice);
    } else {
      // Fallback to traditional search if not in cache
      const matchingVoice = voices.find((v) => v.lang.startsWith(langPrefix));
      setVoice(matchingVoice || voices[0] || null);
    }
  }, [sl, voices, voiceCache]);

  React.useEffect(() => {
    if (textareaRef.current && !listening) {
      textareaRef.current.focus();
    }
  }, [listening]);

  return (
    <Container $hasText={!!text}>
      <GlobalStyle />
      <div style={{ height: "100%" }}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChangeText}
          placeholder="Start typing.."
          aria-label="Texto para traducción"
          autoFocus
          spellCheck={false}
        ></textarea>
        {text && (
          <button className="text-clear" onClick={clearTextHandler} aria-label="Limpiar texto">
            <CloseIcon />
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <label style={{ color: '#bbb', fontSize: 12 }}>Entrada:</label>
        <select
          value={selectedDeviceId || ''}
          onChange={(e) => setSelectedDeviceId(e.target.value || null)}
          aria-label="Seleccionar dispositivo de entrada"
        >
          {devices.length === 0 && <option value="">Predeterminado</option>}
          {devices.map(d => (
            <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
          ))}
        </select>
        <button onClick={async () => {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop());
            const list = await navigator.mediaDevices.enumerateDevices();
            const inputs = list.filter(d => d.kind === 'audioinput');
            setDevices(inputs);
          } catch (err) { console.warn(err); }
        }} style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer' }} aria-label="Refrescar dispositivos">↻</button>
      </div>
      <Actions>
        {browserSupportsSpeechRecognition ? (
          <button 
            onClick={handleSpeech}
            disabled={!isMicrophoneAvailable || isProcessing}
            aria-label={listening ? "Detener reconocimiento" : "Iniciar reconocimiento"}
          >
            {listening ? <PauseIcon /> : <MicIcon />}
          </button>
        ) : (
          <p>Reconocimiento de voz no soportado</p>
        )}
        
        {supported && text && voice && (
          <button 
            onClick={handleSpeak}
            disabled={isProcessing}
            aria-label={speaking ? "Detener narración" : "Reproducir texto"}
          >
            {speaking ? <PauseIcon /> : <SpeakerIcon />}
          </button>
        )}
        
        {!isMicrophoneAvailable && browserSupportsSpeechRecognition && (
          <div className="error-message">
            Micrófono no detectado
          </div>
        )}
      </Actions>
    </Container>
  );
};

export default TranslationTextField;