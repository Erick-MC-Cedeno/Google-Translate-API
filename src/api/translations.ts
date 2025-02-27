import axios from "axios";

// ============================
// GOOGLE TRANSLATE API REQUEST
// ============================
const API_URL = "https://translation.googleapis.com/language/translate/v2";

// SETUP .ENV FILE AND API KEY IN ROOT PATH 
const API_KEY = process.env.REACT_APP_GOOGLE_TRANSLATE_API_KEY;
const TIMEOUT = 5000;
const MAX_CACHE_SIZE = 1000;
const RETRIES = 3;
const RETRY_DELAY = 300;

// Tamaño máximo permitido para cada fragmento (en caracteres)
const MAX_CHUNK_LENGTH = 500;

// Número máximo de solicitudes concurrentes a la API
const MAX_CONCURRENT_REQUESTS = 5;



// ===================
// Tipos y utilidades
// ===================
interface TranslationResult {
  data: {
    translations: { translatedText: string }[];
  };
}

// Función para normalizar el texto (quita espacios de más)
const normalizeText = (text: string): string =>
  text.trim().replace(/\s+/g, " ");

// Genera una llave única para la caché en base a idioma origen, destino y texto
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
      // Eliminar la entrada más antigua
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
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
// Función para dividir textos largos en chunks sin cortar palabras
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
    // Buscar un espacio hacia atrás para no cortar una palabra
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
// Función para llamar a la API de traducción con reintentos y limitación de concurrencia
// ===================
const callTranslationAPI = async (
  params: any,
  attempt: number = 0
): Promise<TranslationResult> => {
  //const startTime = Date.now(); // Inicio del tiempo
  await semaphore.acquire();
  try {
    const response = await axios({
      method: 'post',
      url: API_URL,
      params: { key: API_KEY },
      data: { q: params.q, source: params.source, target: params.target },
      timeout: TIMEOUT,
    });
    //const endTime = Date.now(); // Fin del tiempo
    //console.log(`Tiempo de respuesta: ${endTime - startTime} ms`);

    return response.data;
  } catch (error) {
    if (attempt >= RETRIES) throw error;

    const isRetryable =
      axios.isAxiosError(error) &&
      (error.code === "ECONNABORTED" ||
        (error.response?.status || 500) >= 500);

    if (isRetryable) {
      // Espera incremental antes de reintentar
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
// Función de traducción individual (con división de textos largos)
// ===================
export const translate = async (
  tl: string,
  sl: string,
  text: string
): Promise<string> => {
  const cleanedText = normalizeText(text);
  if (!cleanedText)
    throw new Error("El texto a traducir no puede estar vacío.");

  // Si el texto es muy largo, lo dividimos en fragmentos
  if (cleanedText.length > MAX_CHUNK_LENGTH) {
    const chunks = splitTextIntoChunks(cleanedText, MAX_CHUNK_LENGTH);
    // Se traducen los fragmentos en paralelo usando la función de traducción múltiple
    const translatedChunks = await translateMultiple(chunks, tl, sl);
    // Se unen los fragmentos traducidos (se puede ajustar el separador según convenga)
    return translatedChunks.join(" ");
  }

  // Revisar la caché
  const cacheKey = generateCacheKey(sl, tl, cleanedText);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Llamada a la API para textos que no requieren división
  try {
    const data = await callTranslationAPI({
      q: cleanedText,
      source: sl,
      target: tl,
    });
    const translatedText = data?.data?.translations?.[0]?.translatedText;
    if (!translatedText) throw new Error("Respuesta de API inválida");

    cache.set(cacheKey, translatedText);
    return translatedText;
  } catch (error) {
    throw new Error(`Error en traducción: ${(error as Error).message}`);
  }
};




// ===================
// Función para traducción múltiple con procesamiento por lotes
// Se diferencia entre textos cortos (se agrupan en una sola llamada)
// y textos largos (se procesan individualmente).
// ===================
export const translateMultiple = async (
  texts: string[],
  tl: string,
  sl: string
): Promise<string[]> => {
  if (!texts.length) return [];

  // Inicializa un arreglo para los resultados finales
  const finalTranslations: (string | null)[] = new Array(texts.length).fill(null);

  // Arreglos para procesar en lote (textos cortos)
  const batchTexts: string[] = [];
  const batchIndices: number[] = [];

  // Arreglo para solicitudes de textos largos
  const longTextPromises: Promise<void>[] = [];

  texts.forEach((text, index) => {
    const cleanedText = normalizeText(text);
    if (!cleanedText) {
      finalTranslations[index] = "";
      return;
    }

    // Si el texto es muy largo, se procesa individualmente (la función translate se encarga de dividirlo si es necesario)
    if (cleanedText.length > MAX_CHUNK_LENGTH) {
      longTextPromises.push(
        translate(tl, sl, cleanedText).then((result) => {
          finalTranslations[index] = result;
        })
      );
    } else {
      // Para textos cortos se revisa la caché
      const cacheKey = generateCacheKey(sl, tl, cleanedText);
      const cached = cache.get(cacheKey);
      if (cached) {
        finalTranslations[index] = cached;
      } else {
        batchTexts.push(cleanedText);
        batchIndices.push(index);
      }
    }
  });

  // Si existen textos cortos pendientes, se agrupan en una sola llamada
  if (batchTexts.length > 0) {
    try {
      const data = await callTranslationAPI({
        q: batchTexts,
        source: sl,
        target: tl,
      });
      const results = data?.data?.translations?.map((t) => t.translatedText) || [];
      if (results.length !== batchTexts.length) {
        throw new Error("Respuesta de API incompleta");
      }
      results.forEach((translatedText, idx) => {
        const originalIndex = batchIndices[idx];
        const cacheKey = generateCacheKey(sl, tl, batchTexts[idx]);
        cache.set(cacheKey, translatedText);
        finalTranslations[originalIndex] = translatedText;
      });
    } catch (error) {
      throw new Error(
        `Error en traducción múltiple: ${(error as Error).message}`
      );
    }
  }

  // Espera a que se completen las traducciones de textos largos
  await Promise.all(longTextPromises);

  // Se garantiza que se devuelva un arreglo de cadenas
  return finalTranslations as string[];
};