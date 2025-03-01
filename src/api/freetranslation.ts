import axios from "axios";

// ============================
// CONFIGURACIÓN DE TRADUCCIÓN
// ============================
const API_URL = "https://translate.googleapis.com/translate_a/single";
const TIMEOUT = 5000;
const MAX_CACHE_SIZE = 1000;
const RETRIES = 3;
const RETRY_DELAY = 300;
const MAX_CHUNK_LENGTH = 500;
const MAX_CONCURRENT_REQUESTS = 5;

// ===================
// Tipos y utilidades
// ===================
interface TranslationResult {
  data: any[];
}

const normalizeText = (text: string): string =>
  text.trim().replace(/\s+/g, " ");

const generateCacheKey = (sl: string, tl: string, text: string): string =>
  `${sl}-${tl}-${text}`;

// ===================
// Implementación de caché
// ===================
class TranslationCache {
  private cache = new Map<string, string>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): string | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: string): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }
}

const cache = new TranslationCache(MAX_CACHE_SIZE);

// ===================
// Semáforo para limitar concurrencia
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
// Función para dividir textos largos
// ===================
const splitTextIntoChunks = (text: string, maxChunkLength: number): string[] => {
  const chunks: string[] = [];
  let currentIndex = 0;

  while (currentIndex < text.length) {
    let nextIndex = currentIndex + maxChunkLength;
    if (nextIndex >= text.length) {
      chunks.push(text.substring(currentIndex));
      break;
    }
    let spaceIndex = text.lastIndexOf(" ", nextIndex);
    if (spaceIndex <= currentIndex) {
      spaceIndex = nextIndex;
    }
    chunks.push(text.substring(currentIndex, spaceIndex));
    currentIndex = spaceIndex;
  }
  return chunks;
};

// ===================
// Llamada a la API web de Google Translate
// ===================
const callTranslationAPI = async (
  params: any,
  attempt: number = 0
): Promise<TranslationResult> => {
  await semaphore.acquire();
  try {
    const response = await axios({
      method: 'get',
      url: API_URL,
      params: {
        client: 'gtx',
        sl: params.source,
        tl: params.target,
        dt: 't',
        q: params.q,
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
      },
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
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAY * (attempt + 1))
      );
      return callTranslationAPI(params, attempt + 1);
    }
    throw error;
  } finally {
    semaphore.release();
  }
};

// ===================
// Función de traducción principal
// ===================
export const translate = async (
  tl: string,
  sl: string,
  text: string
): Promise<string> => {
  const cleanedText = normalizeText(text);
  if (!cleanedText) throw new Error("El texto a traducir no puede estar vacío.");

  if (cleanedText.length > MAX_CHUNK_LENGTH) {
    const chunks = splitTextIntoChunks(cleanedText, MAX_CHUNK_LENGTH);
    const translatedChunks = await translateMultiple(chunks, tl, sl);
    return translatedChunks.join(" ");
  }

  const cacheKey = generateCacheKey(sl, tl, cleanedText);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await callTranslationAPI({
      q: cleanedText,
      source: sl,
      target: tl,
    });
    
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
  } catch (error) {
    throw new Error(`Error en traducción: ${(error as Error).message}`);
  }
};

// ===================
// Traducción múltiple
// ===================
export const translateMultiple = async (
  texts: string[],
  tl: string,
  sl: string
): Promise<string[]> => {
  return Promise.all(texts.map(text => translate(tl, sl, text)));
};