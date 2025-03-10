import React from "react";
import { useSearchParams } from "react-router-dom";
import { useSpeechSynthesis } from "react-speech-kit";
import styled from "styled-components";
import { translate } from "api/freetranslation";
import SpeakerIcon from "assets/SpeakerIcon";
import CopyIcon from "assets/CopyIcon";
import PauseIcon from "assets/PauseIcon";
import { DEFAULT_SOURCE_LANGUAGE, DEFAULT_TARGET_LANGUAGE } from "utils/constants";
import { debounce } from "lodash";

const TranslatedText = () => {
  const [searchParams] = useSearchParams();
  const { speak, cancel, speaking, supported } = useSpeechSynthesis();
  const text = searchParams.get("text") || "";
  const tl = searchParams.get("tl") || DEFAULT_TARGET_LANGUAGE;
  const sl = searchParams.get("sl") || DEFAULT_SOURCE_LANGUAGE;
  const isRTL = ["ar", "fa", "ur"].includes(tl);
  const [translatedText, setTranslatedText] = React.useState<string[]>([]);
  const [voice, setVoice] = React.useState<SpeechSynthesisVoice | null>(null);
  const [voices, setVoices] = React.useState<SpeechSynthesisVoice[]>([]);
  // Remove unused state variable or use it in handleSpeak
  const [isProcessing] = React.useState(false);
  const [voiceCache, setVoiceCache] = React.useState<Record<string, SpeechSynthesisVoice>>({});
  const voicesInitialized = React.useRef(false);
  const translateHandler = async (value: string, tl: string, sl: string) => {
    if (!value) {
      setTranslatedText([]);
      return;
    }
    try {
      const translated = await translate(tl, sl, value);
      setTranslatedText(translated ? translated.split("\n") : []);
    } catch (error) {
      console.error("Error de traducción:", error);
      setTranslatedText(["<< Error en la traducción >>"]);
    }
  };
  const handleSpeak = () => {
    try {
      if (speaking) {
        cancel();
      } else {
        speak({ 
          text: translatedText.join("\n"), 
          voice,
          rate: 1.1,
          pitch: 1,
          volume: 1
        });
      }
    } catch (error) {
      console.error("Error en síntesis de voz:", error);
      alert("Error al reproducir el texto");
    }
  };
  const copyHandler = () => {
    try {
      const txt = translatedText.join("\n");
      navigator.clipboard.writeText(txt);
    } catch (error) {
      console.error("Error al copiar:", error);
      alert("No se pudo copiar el texto");
    }
  };
  // Fix useCallback with inline function and proper dependencies
  const debounceLoadData = React.useCallback(
    (value: string, targetLang: string, sourceLang: string) => {
      debounce((text: string, tl: string, sl: string) => {
        translateHandler(text, tl, sl);
      }, 300)(value, targetLang, sourceLang);
    },
    [/* translateHandler depends on setTranslatedText which is stable */]
  );
  // Optimized voice loading with caching
  React.useEffect(() => {
    const loadVoices = () => {
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
    
    loadVoices();
    
    if (!voicesInitialized.current) {
      window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
      return () => {
        window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
      };
    }
  }, []);
  // Optimized voice selection using cache
  React.useEffect(() => {
    if (Object.keys(voiceCache).length === 0) return;
    
    const langPrefix = tl.split('-')[0];
    const cachedVoice = voiceCache[langPrefix];
    
    if (cachedVoice) {
      setVoice(cachedVoice);
    } else {
      const matchingVoice = voices.find((v) => v.lang.startsWith(langPrefix));
      setVoice(matchingVoice || voices[0] || null);
    }
  }, [tl, voices, voiceCache]);
  React.useEffect(() => {
    const updateVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      setVoices(availableVoices);
    };
    
    window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
    updateVoices();
    
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
    };
  }, []);
  // Fix missing dependency in useEffect
  React.useEffect(() => {
    debounceLoadData(text, tl, sl);
  }, [text, tl, sl, debounceLoadData]);
  React.useEffect(() => {
    const matchingVoice = voices.find((v) => v.lang.startsWith(tl));
    setVoice(matchingVoice || voices[0] || null);
  }, [tl, voices]);
  return (
    <Container $rtl={isRTL}>
      <div>
        {translatedText.map((line, index) => (
          <React.Fragment key={index}>
            {line || <br />}
          </React.Fragment>
        ))}
      </div>
      {translatedText.length !== 0 && (
        <Actions>
          <div>
            {supported && voice && (
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
          </div>
          <button 
            onClick={copyHandler}
            aria-label="Copiar texto"
          >
            <div style={{ color: '#2196F3' }}><CopyIcon /></div>
          </button>
        </Actions>
      )}
    </Container>
  );
};

const Container = styled.div<{ $rtl: boolean }>`
  position: relative;
  background-color: ${(props) => props.theme.primary[600]};
  text-align: ${(props) => (props.$rtl ? "right" : "left")};
  font-size: 18px;
  word-break: break-word;
  min-height: 100px;

  div {
    padding: 16px;
    overflow: auto;
    max-height: 52vh;
    
    &::-webkit-scrollbar {
      width: 8px;
    }

    &::-webkit-scrollbar-thumb {
      background: ${(props) => props.theme.primary[400]};
      border-radius: 4px;
    }
  }
`;

const Actions = styled.div`
  button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 5px;
    transition: all 0.2s ease;
    
    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    &:hover:not(:disabled) {
      transform: scale(1.1);
    }
  }

  button:nth-child(1) {
    position: absolute;
    left: 10px;
    bottom: 10px;
  }
  
  button:nth-child(2) {
    position: absolute;
    bottom: 10px;
    right: 10px;
  }
`;

export default TranslatedText;