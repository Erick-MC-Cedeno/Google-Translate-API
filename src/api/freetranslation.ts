import axios from "axios";

// ============================
// CONFIGURACIÓN DE TRADUCCIÓN
// ============================
const API_URL = "https://translate.googleapis.com/translate_a/single";
const TIMEOUT = 8000; // Tiempo máximo de espera en ms
const MAX_CACHE_SIZE = 2000; // Aumentado para mejor rendimiento
const RETRIES = 5; // Aumentado para mayor tolerancia a fallos
const RETRY_DELAY = 500; // Aumentado para dar más tiempo entre reintentos
const MAX_CONCURRENT_REQUESTS = 3; // Reducido para evitar bloqueos
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas en milisegundos
const MAX_TEXT_LENGTH = 5000; // Longitud máxima para cada solicitud

// ===================
// Tipos y utilidades
// ===================
interface TranslationResult {
  data: any[];
}

interface CacheEntry {
  value: string;
  timestamp: number;
}

/**
 * Normaliza el texto eliminando espacios extras y recortando.
 */
const normalizeText = (text: string): string =>
  text.trim().replace(/\s+/g, " ");

/**
 * Crea una clave única para almacenar en caché en función de los idiomas y el texto.
 */
const generateCacheKey = (sourceLang: string, targetLang: string, text: string): string =>
  `${sourceLang}-${targetLang}-${text}`;

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
// Implementación de caché con TTL
// ===================
class TranslationCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number, ttl: number) {
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  get(key: string): string | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    // Verificar si la entrada ha expirado
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }
    
    return entry.value;
  }

  set(key: string, value: string): void {
    // Limpiar entradas expiradas primero
    this.cleanExpired();
    
    // Si aún estamos en el límite, eliminar la entrada más antigua
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.findOldestEntry();
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }
  
  private cleanExpired(): void {
    const now = Date.now();
    // Convert Map entries to array for compatibility
    Array.from(this.cache.entries()).forEach(([key, entry]) => {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    });
  }
  
  private findOldestEntry(): string | undefined {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    
    // Convert Map entries to array and iterate
    Array.from(this.cache.entries()).forEach(([key, entry]) => {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    });
    
    return oldestKey;
  }
}

const cache = new TranslationCache(MAX_CACHE_SIZE, CACHE_TTL);

// ===================
// Semáforo para limitar la concurrencia de solicitudes HTTP
// ===================
class Semaphore {
  private tasks: Array<() => void> = [];
  private count: number;

  constructor(count: number) {
    this.count = count;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }
    await new Promise<void>((resolve) => this.tasks.push(resolve));
  }

  release(): void {
    this.count++;
    if (this.tasks.length > 0) {
      this.count--;
      const next = this.tasks.shift();
      next && next();
    }
  }
}

const semaphore = new Semaphore(MAX_CONCURRENT_REQUESTS);

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
  await semaphore.acquire();
  try {
    // Se configura la cabecera "User-Agent" solo si NO estamos en el navegador.
    const headers: Record<string, string> = {};
    if (typeof window === "undefined") {
      headers["User-Agent"] = agentRotator.getNextAgent();
      // Añadir cabeceras adicionales para simular un navegador real
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
      const jitter = Math.random() * 300; // Añadir aleatoriedad para evitar sincronización
      
      await new Promise((resolve) =>
        setTimeout(resolve, backoffTime + jitter)
      );
      return callTranslationAPI(params, attempt + 1);
    }
    throw error;
  } finally {
    semaphore.release();
  }
};

/**
 * Procesa la respuesta de la API de traducción y extrae el texto traducido
 */
const processTranslationResponse = (response: TranslationResult, cacheKey: string): string => {
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
      translatedParts.push(sentence[0]);
    }
  }

  if (translatedParts.length === 0) {
    throw new Error("No se encontró traducción");
  }

  const translatedText = translatedParts.join(' ');
  cache.set(cacheKey, translatedText);
  return translatedText;
};

// ===================
// Función de traducción principal con soporte para textos largos
// ===================
export const translate = async (
  targetLang: string,
  sourceLang: string,
  text: string
): Promise<string> => {
  const cleanedText = normalizeText(text);
  if (!cleanedText)
    throw new Error("El texto a traducir no puede estar vacío.");

  const cacheKey = generateCacheKey(sourceLang, targetLang, cleanedText);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    // Si el texto es demasiado largo, dividirlo y traducir por partes
    if (cleanedText.length > MAX_TEXT_LENGTH) {
      const chunks = splitText(cleanedText, MAX_TEXT_LENGTH);
      const translatedChunks = await Promise.all(
        chunks.map(async (chunk) => {
          // Verificar si este fragmento ya está en caché
          const chunkCacheKey = generateCacheKey(sourceLang, targetLang, chunk);
          const cachedChunk = cache.get(chunkCacheKey);
          if (cachedChunk) return cachedChunk;
          
          // Traducir el fragmento
          const response = await callTranslationAPI({
            q: chunk,
            source: sourceLang,
            target: targetLang,
          });
          
          return processTranslationResponse(response, chunkCacheKey);
        })
      );
      
      const completeTranslation = translatedChunks.join(' ');
      cache.set(cacheKey, completeTranslation);
      return completeTranslation;
    }
    
    // Para textos cortos, traducir directamente
    const response = await callTranslationAPI({
      q: cleanedText,
      source: sourceLang,
      target: targetLang,
    });
    
    return processTranslationResponse(response, cacheKey);
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