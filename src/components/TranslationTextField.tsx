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

interface ContainerProps {
  hasText: boolean;
}

const Container = styled.div<ContainerProps>`
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
    display: ${(props) => (props.hasText ? "block" : "none")};
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
    border: 2px solid #ff4444;
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

  const {
    transcript,
    listening,
    resetTranscript,
    browserSupportsSpeechRecognition,
    isMicrophoneAvailable,
  } = useSpeechRecognition();

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const updateVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      setVoices(availableVoices);
      if (availableVoices.length > 0) {
        const defaultVoice = availableVoices.find(v => v.default) || availableVoices[0];
        setVoice(defaultVoice);
      }
    };
    
    window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
    updateVoices();
    
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
    };
  }, []);

  const setTextParam = React.useCallback((value: string) => {
    setText(value);
    setURLSearchParams((params) => {
      params.set("text", value);
      return params;
    });
  }, [setURLSearchParams]);

  const clearTextHandler = () => {
    setTextParam("");
    resetTranscript();
    cancel();
  };

  const handleChangeText = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextParam(e.target.value);
  };

  const handleSpeech = async () => {
    try {
      setIsProcessing(true);
      if (listening) {
        await SpeechRecognition.stopListening();
      } else {
        if (!isMicrophoneAvailable) {
          alert("Por favor permite acceso al micrófono");
          return;
        }
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

  React.useEffect(() => {
    if (transcript && listening) {
      setTextParam(transcript);
    }
  }, [transcript, setTextParam, listening]);

  React.useEffect(() => {
    const matchingVoice = voices.find((v) => v.lang.startsWith(sl));
    setVoice(matchingVoice || voices[0] || null);
  }, [sl, voices]);

  React.useEffect(() => {
    if (textareaRef.current && !listening) {
      textareaRef.current.focus();
    }
  }, [listening]);

  return (
    <Container hasText={!!text}>
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
      <Actions>
        {browserSupportsSpeechRecognition ? (
          <button 
            onClick={handleSpeech}
            disabled={!isMicrophoneAvailable || isProcessing}
            aria-label={listening ? "Detener reconocimiento" : "Iniciar reconocimiento"}
          >
            {listening && <div className="pulse-indicator" />}
            {listening ? (
              <div style={{ position: 'relative', color: '#ff4444' }}>
                <PauseIcon />
              </div>
            ) : (
              <div style={{ color: isMicrophoneAvailable ? '#4CAF50' : '#ff4444' }}>
                <MicIcon />
              </div>
            )}
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
            {speaking ? (
              <div style={{ color: '#ff4444' }}><PauseIcon /></div>
            ) : (
              <div style={{ color: '#4CAF50' }}><SpeakerIcon /></div>
            )}
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