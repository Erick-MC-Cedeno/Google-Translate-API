import React from "react";
import { useSearchParams } from "react-router-dom";
import { useSpeechSynthesis } from "react-speech-kit";
import styled from "styled-components";
import { translate } from "api/freetranslation";
import CopyIcon from "assets/CopyIcon";
import { DEFAULT_SOURCE_LANGUAGE, DEFAULT_TARGET_LANGUAGE } from "utils/constants";
import { debounce } from "lodash";

const TranslatedText = () => {
  const [searchParams] = useSearchParams();
  // Se elimina la desestructuración de cancel, speaking y supported, ya que no se usan.
  useSpeechSynthesis();
  const text = searchParams.get("text") || "";
  const tl = searchParams.get("tl") || DEFAULT_TARGET_LANGUAGE;
  const sl = searchParams.get("sl") || DEFAULT_SOURCE_LANGUAGE;
  const isRTL = ["ar", "fa", "ur"].includes(tl);
  const [translatedText, setTranslatedText] = React.useState<string[]>([]);
  const abortControllerRef = React.useRef<AbortController>();
  const currentTextRef = React.useRef(text);

  const translateHandler = async (value: string, targetLang: string, sourceLang: string) => {
    if (!value || value !== currentTextRef.current) {
      setTranslatedText([]);
      return;
    }
    
    try {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
  
      // Modificar la llamada a translate para incluir el signal
      const translated = await translate(targetLang, sourceLang, value, {
        signal: abortControllerRef.current.signal
      });
      
      if (translated) {
        // Preservar mayúsculas y formato de la API, sólo recortar líneas vacías
        const normalizedText = translated
          .split("\n")
          .map(line => line.trim())
          .filter(line => line.length > 0);
        setTranslatedText(normalizedText.length ? normalizedText : [translated.trim()]);
      }
    } catch (error) {
      if (!(error instanceof DOMException)) { // Ignore abort errors
        console.error("Error de traducción:", error);
        setTranslatedText(["<< Error en la traducción >>"]);
      }
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

  // Se crea la función debounced solo una vez
  const debouncedTranslateHandler = React.useMemo(
    () =>
      debounce((text: string, targetLang: string, sourceLang: string) => {
        translateHandler(text, targetLang, sourceLang);
      }, 300),
    []
  );

  // Actualizar la traducción cuando cambie el texto o los idiomas.
  // Usamos un único useEffect para evitar llamadas duplicadas y
  // asegurarnos de cancelar traducciones pendientes al borrar el texto.
  React.useEffect(() => {
    currentTextRef.current = text;

    if (!text) {
      debouncedTranslateHandler.cancel();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setTranslatedText([]);
      return;
    }

    debouncedTranslateHandler(text, tl, sl);

    return () => {
      debouncedTranslateHandler.cancel();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [text, tl, sl, debouncedTranslateHandler]);

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
          <button onClick={copyHandler} aria-label="Copiar texto">
            <div style={{ color: "#2196F3" }}>
              <CopyIcon />
            </div>
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

  button {
    position: absolute;
    bottom: 10px;
    right: 10px;
  }
`;

export default TranslatedText;