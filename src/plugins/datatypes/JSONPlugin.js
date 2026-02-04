/**
 * JSON Plugin
 * 
 * Renderiza objetos JSON complejos.
 * Soporta almacenamiento en bucket para JSON grandes.
 */

const JSONPlugin = {
  name: "json",
  datatypes: ["json", "object", "array"],
  priority: -1, // Baja prioridad, es un fallback
  
  // Configuración de bucket para JSON grandes
  storage: {
    bucketId: process.env.NEXT_PUBLIC_BUCKET_JSON || "json",
    maxInlineChars: 1000, // Más de 1k caracteres se sube a bucket
    mimeType: "application/json",
  },

  render(data, options = {}) {
    if (data === null || data === undefined) {
      return null;
    }

    // Si es referencia a archivo en bucket
    if (data.fileId && data.bucketId) {
      return {
        type: "json-file",
        fileId: data.fileId,
        bucketId: data.bucketId,
        url: data.url,
      };
    }

    return {
      type: "json",
      data,
      formatted: JSON.stringify(data, null, 2),
    };
  },

  preview(data, options = {}) {
    if (data === null || data === undefined) {
      return null;
    }

    // Si es referencia a archivo
    if (data?.fileId && data?.bucketId) {
      return "📁 JSON (archivo)";
    }

    const str = JSON.stringify(data);
    const maxLength = options.maxLength || 50;
    return str.length > maxLength ? str.substring(0, maxLength) + "..." : str;
  },
};

export default JSONPlugin;
