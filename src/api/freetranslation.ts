import axios from "axios";

// ============================
// CONFIGURACIÓN DE TRADUCCIÓN
// ============================
const API_URL = "https://translate.googleapis.com/translate_a/single";
const TIMEOUT = 8000; // Tiempo máximo de espera en ms
const RETRIES = 5; // Aumentado para mayor tolerancia a fallos
const RETRY_DELAY = 500; // Tiempo inicial de espera entre reintentos en ms
const MAX_TEXT_LENGTH = 5000; // Longitud máxima para cada solicitud

// ===================
// Tipos y utilidades
// ===================
interface TranslationResult {
  data: any[];
}

/**
 * Normaliza el texto eliminando espacios extras y recortando.
 */
const normalizeText = (text: string): string =>
  text.trim().replace(/\s+/g, " ");

/**
 * Divide un texto largo en fragmentos más pequeños para evitar límites de la API.
 * Intenta dividir por oraciones para mantener el contexto.
 */
const splitText = (text: string, maxLength: number): string[] => {
  if (text.length <= maxLength) return [text];
  
  const chunks: string[] = [];
  const sentenceDelimiters = /([.!?])\s+/g;
  let currentChunk = "";
  
  // Reemplazar delimitadores con un marcador especial
  const markedText = text.replace(sentenceDelimiters, "$1\n");
  const sentences = markedText.split("\n");
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length <= maxLength) {
      currentChunk += sentence + " ";
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      
      // Si una oración es más larga que maxLength, dividirla por palabras
      if (sentence.length > maxLength) {
        const words = sentence.split(" ");
        currentChunk = "";
        
        for (const word of words) {
          if (currentChunk.length + word.length + 1 <= maxLength) {
            currentChunk += word + " ";
          } else {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = word + " ";
          }
        }
      } else {
        currentChunk = sentence + " ";
      }
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
};

// ===================
// Rotación de Agentes (User-Agent) para evitar bloqueos
// ===================
class AgentRotator {
  private agents: string[];
  private currentIndex: number = 0;

  constructor(agents: string[]) {
    this.agents = agents;
  }

  getNextAgent(): string {
    const agent = this.agents[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.agents.length;
    return agent;
  }
}

// Lista ampliada de User-Agents para reducir la probabilidad de bloqueo
const agents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:90.0) Gecko/20100101 Firefox/90.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.164 Safari/537.36 Edg/91.0.864.71',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
];

const agentRotator = new AgentRotator(agents);

// ===================
// Llamada a la API de traducción con backoff exponencial
// ===================
const callTranslationAPI = async (
  params: { source: string; target: string; q: string },
  attempt: number = 0
): Promise<TranslationResult> => {
  try {
    // Se configura la cabecera "User-Agent" solo si NO estamos en el navegador.
    const headers: Record<string, string> = {};
    if (typeof window === "undefined") {
      headers["User-Agent"] = agentRotator.getNextAgent();
      // Cabeceras adicionales para simular un navegador real
      headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8";
      headers["Accept-Language"] = "en-US,en;q=0.5";
      headers["Connection"] = "keep-alive";
      headers["Upgrade-Insecure-Requests"] = "1";
    }
    
    const response = await axios.get(API_URL, {
      params: {
        client: 'gtx',
        sl: params.source,
        tl: params.target,
        dt: 't',
        q: params.q,
      },
      headers,
      timeout: TIMEOUT,
    });
    return response;
  } catch (error) {
    if (attempt >= RETRIES) throw error;
    
    const isRetryable =
      axios.isAxiosError(error) &&
      (error.code === "ECONNABORTED" ||
       (error.response?.status || 500) === 429 ||
       (error.response?.status || 500) >= 500);

    if (isRetryable) {
      // Backoff exponencial: cada reintento espera más tiempo
      const backoffTime = RETRY_DELAY * Math.pow(2, attempt);
      const jitter = Math.random() * 300; // Aleatoriedad para evitar sincronización
      
      await new Promise((resolve) =>
        setTimeout(resolve, backoffTime + jitter)
      );
      return callTranslationAPI(params, attempt + 1);
    }
    throw error;
  }
};

/**
 * Procesa la respuesta de la API de traducción y extrae el texto traducido
 */
const processTranslationResponse = (response: TranslationResult): string => {
  if (!response?.data || !Array.isArray(response.data) || response.data.length < 1) {
    throw new Error("Respuesta de API inválida");
  }
  const mainTranslationData = response.data[0];
  if (!Array.isArray(mainTranslationData)) {
    throw new Error("Formato de traducción inválido");
  }

  const translatedParts: string[] = [];
  for (const sentence of mainTranslationData) {
    if (Array.isArray(sentence) && sentence.length > 0 && typeof sentence[0] === 'string') {
      translatedParts.push(decodeHtmlEntities(sentence[0]));
    }
  }

  if (translatedParts.length === 0) {
    throw new Error("No se encontró traducción");
  }

  // Unir fragmentos y limpiar espacios antes de signos de puntuación
  const joined = translatedParts.join(' ');
  return joined.replace(/\s+([.,!?;:])/g, '$1').trim();
};

// Decodifica entidades HTML comunes que puede devolver la API
const decodeHtmlEntities = (str: string): string => {
  if (!str) return str;
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
};

// ===================
// Función de traducción principal con soporte para textos largos
// ===================
export const translate = async (
  targetLang: string,
  sourceLang: string,
  text: string,
  options?: { signal?: AbortSignal }
): Promise<string> => {
  const cleanedText = normalizeText(text);
  if (!cleanedText)
    throw new Error("El texto a traducir no puede estar vacío.");

  // Si se solicita detección automática, intentar detectar primero con la misma API gratuita
  let effectiveSource = sourceLang;
  if (sourceLang === 'auto' || sourceLang === 'auto-detect') {
    try {
      effectiveSource = await detectLanguage(cleanedText);
    } catch (e) {
      effectiveSource = 'auto';
    }
  }

  try {
    // Si el texto es demasiado largo, dividirlo y traducir por partes
    if (cleanedText.length > MAX_TEXT_LENGTH) {
      const chunks = splitText(cleanedText, MAX_TEXT_LENGTH);
        const translatedChunks = await Promise.all(
        chunks.map(async (chunk) => {
          const response = await callTranslationAPI({
            q: chunk,
            source: effectiveSource,
            target: targetLang,
          });

          return processTranslationResponse(response);
        })
      );
      
      return translatedChunks.join(' ');
    }
    
    // Para textos cortos, traducir directamente
    const response = await callTranslationAPI({
      q: cleanedText,
      source: effectiveSource,
      target: targetLang,
    });

    return processTranslationResponse(response);
  } catch (error) {
    throw new Error(`Error en traducción: ${(error as Error).message}`);
  }
};

// ===================
// Función de traducción para múltiples textos (manteniendo por compatibilidad)
// ===================
export const translateMultiple = async (
  texts: string[],
  targetLang: string,
  sourceLang: string
): Promise<string[]> => {
  return Promise.all(texts.map(text => translate(targetLang, sourceLang, text)));
};

// ===================
// Función para detectar el idioma de un texto
// ===================
export const detectLanguage = async (text: string): Promise<string> => {
  const cleanedText = normalizeText(text);
  if (!cleanedText) throw new Error("El texto no puede estar vacío");
  
  try {
    const response = await callTranslationAPI({
      q: cleanedText.substring(0, 1000), // Usar solo los primeros 1000 caracteres
      source: 'auto',
      target: 'en', // El idioma destino no importa para la detección
    });
    
    // La detección de idioma está en el tercer elemento del array de respuesta
    if (response?.data && Array.isArray(response.data) && response.data.length >= 3) {
      const detectedLang = response.data[2];
      if (typeof detectedLang === 'string') {
        return detectedLang;
      }
    }
    
    throw new Error("No se pudo detectar el idioma");
  } catch (error) {
    throw new Error(`Error en detección de idioma: ${(error as Error).message}`);
  }
};