import React from "react";
import styled from "styled-components";
import { Select, SelectProps } from "antd";
import { useSearchParams } from "react-router-dom";
import { 
  AVAILABLE_LANGUAGES, 
  DEFAULT_SOURCE_LANGUAGE, 
  DEFAULT_TARGET_LANGUAGE 
} from "utils/constants";
import { SwitchIcon } from "../assets/SwitchIcon";
import { palette } from "theme/palette";

interface LanguageOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const LanguagesBar = () => {
  const [searchParams, setURLSearchParams] = useSearchParams();
  const [sourceLang, setSourceLang] = React.useState(
    validateLang(searchParams.get("sl"), DEFAULT_SOURCE_LANGUAGE)
  );
  const [targetLang, setTargetLang] = React.useState(
    validateLang(searchParams.get("tl"), DEFAULT_TARGET_LANGUAGE)
  );

  const languageOptions = React.useMemo(() => 
    AVAILABLE_LANGUAGES.map(lang => ({
      value: lang.code,
      label: lang.name,
      disabled: false
    })), []);

  const setLangParam = (key: string, value: string) => {
    setURLSearchParams(params => {
      params.set(key, value);
      return params;
    });
  };

  const switchLangsHandler = () => {
    const newSource = targetLang;
    const newTarget = sourceLang;
    
    setSourceLang(newSource);
    setTargetLang(newTarget);
    setLangParam("sl", newSource);
    setLangParam("tl", newTarget);
  };

  const handleChangeSourceLang = (value: string) => {
    if(value === targetLang) switchLangsHandler();
    else updateLang(value, setSourceLang, "sl");
  };

  const handleChangeTargetLang = (value: string) => {
    if(value === sourceLang) switchLangsHandler();
    else updateLang(value, setTargetLang, "tl");
  };

  const updateLang = React.useCallback((
    value: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    paramKey: "sl" | "tl"
  ) => {
    if(AVAILABLE_LANGUAGES.some(lang => lang.code === value)) {
      setter(value);
      setLangParam(paramKey, value);
    }
  }, []);

  React.useEffect(() => {
    if(!searchParams.get("sl")) setLangParam("sl", DEFAULT_SOURCE_LANGUAGE);
    if(!searchParams.get("tl")) setLangParam("tl", DEFAULT_TARGET_LANGUAGE);
  }, []);

  return (
    <Container>
      <StyledSelect<string>
        value={sourceLang}
        onChange={handleChangeSourceLang}
        options={languageOptions as unknown as { value: string; label: string }[]}
        aria-label="Seleccionar idioma origen"
        popupMatchSelectWidth={false}
      />
      
      <SwitchButton 
        onClick={switchLangsHandler}
        aria-label="Intercambiar idiomas"
      >
        <SwitchIcon />
      </SwitchButton>
      
      <StyledSelect<string>
        value={targetLang}
        onChange={handleChangeTargetLang}
        options={languageOptions as unknown as { value: string; label: string }[]}
        aria-label="Seleccionar idioma destino"
        popupMatchSelectWidth={false}
      />
    </Container>
  );
};

// Helpers
const validateLang = (lang: string | null, fallback: string): string => {
  return lang && AVAILABLE_LANGUAGES.some(l => l.code === lang) 
    ? lang 
    : fallback;
};

// Styled components
const Container = styled.div`
  background-color: ${props => props.theme.primary.main};
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 12px;
  border-bottom: 1px solid ${props => props.theme.primary[700]};
  
  @media (max-width: 480px) {
    padding: 0 8px;
    gap: 6px;
  }
`;

const StyledSelect = styled(Select<string>)<SelectProps<string>>`
  min-width: 140px;
  flex: 1;
  
  .ant-select-selector {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    color: ${props => props.theme.primary.contrastText} !important;
    font-size: 16px !important;
    padding: 16px 0 !important;
    height: auto !important;
    
    .ant-select-selection-item {
      color: inherit !important;
      font-weight: 500;
      text-transform: uppercase;
    }
  }

  .ant-select-arrow {
    color: ${props => props.theme.primary.contrastText} !important;
  }
  
  @media (max-width: 480px) {
    min-width: 120px;
    font-size: 14px !important;
  }
`;

const SwitchButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 4px;
  transition: all 0.2s ease;
  
  &:hover {
    background: ${props => props.theme.primary[500]};
    transform: rotate(180deg) scale(1.1);
  }
  
  &:active {
    transform: rotate(180deg) scale(0.95);
  }
  
  svg {
    display: block;
    width: 24px;
    height: 24px;
    fill: ${props => props.theme.primary.contrastText};
  }
  
  @media (max-width: 480px) {
    padding: 4px;
    svg {
      width: 20px;
      height: 20px;
    }
  }
`;

export default React.memo(LanguagesBar);