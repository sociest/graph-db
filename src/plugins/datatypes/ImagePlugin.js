/**
 * Image Plugin
 * 
 * Renderiza URLs de imágenes.
 * Soporta subida a bucket para almacenamiento persistente.
 */

function getThumbnailUrl(url) {
  // Si es una URL de Commons, generar thumbnail
  if (url.includes("commons.wikimedia.org")) {
    return url.replace("/commons/", "/commons/thumb/") + "/120px-thumbnail.jpg";
  }
  return url;
}

const ImagePlugin = {
  name: "image",
  datatypes: ["image", "photo", "picture", "media"],
  priority: 0,
  
  // Configuración de bucket para este tipo de dato
  storage: {
    bucketId: process.env.NEXT_PUBLIC_BUCKET_IMAGES || "images",
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"],
    uploadFromUrl: true, // Permite descargar y re-subir imágenes desde URLs externas
  },

  render(data, options = {}) {
    if (data === null || data === undefined) {
      return null;
    }

    const { fullValue } = options;
    
    // Soportar tanto URL directa como objeto con fileId/bucketId
    let url;
    if (typeof data === "string") {
      url = data;
    } else if (data.fileId && data.bucketId) {
      // Archivo almacenado en bucket
      url = data.url || `/api/files/${data.bucketId}/${data.fileId}`;
    } else {
      url = data.url;
    }
    
    const alt = fullValue?.alt || fullValue?.label || "Image";
    const caption = fullValue?.caption;

    return {
      type: "image",
      url,
      alt,
      caption,
      thumbnail: getThumbnailUrl(url),
      fileId: data.fileId,
      bucketId: data.bucketId,
    };
  },

  preview(data, options = {}) {
    if (data === null || data === undefined) {
      return null;
    }
    
    let url;
    if (typeof data === "string") {
      url = data;
    } else if (data.fileId && data.bucketId) {
      url = data.url || `/api/files/${data.bucketId}/${data.fileId}`;
    } else {
      url = data.url;
    }
    
    return {
      type: "image-thumbnail",
      url: getThumbnailUrl(url),
    };
  },

  getThumbnailUrl,
};

export default ImagePlugin;
