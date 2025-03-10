const cloudinary = require('cloudinary').v2;

// Configuración básica
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dt797utcm',
  api_key: process.env.CLOUDINARY_API_KEY || '154434954868491',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'J-y97KOp8XsdsXB2k_ed2xPPuQE',
  secure: true // Usar HTTPS
});

// Configuración para transformaciones por defecto
const defaultOptions = {
  quality: 'auto:good',     // Calidad automática buena
  fetch_format: 'auto',     // Formato automático (webp cuando es posible)
  secure: true,             // URLs con HTTPS
  folder: 'Imagenes'        // Carpeta por defecto
};

/**
 * Obtiene URL optimizada para una imagen
 * @param {string} publicId - ID público de la imagen
 * @param {Object} options - Opciones adicionales de transformación
 * @returns {string} URL optimizada
 */
const getOptimizedUrl = (publicId, options = {}) => {
  return cloudinary.url(publicId, { 
    ...defaultOptions, 
    ...options 
  });
};

/**
 * Sube una imagen a Cloudinary con opciones optimizadas
 * @param {string} imagePath - Ruta de la imagen local
 * @param {Object} options - Opciones adicionales
 * @returns {Promise} Resultado de la subida
 */
const uploadImage = (imagePath, options = {}) => {
  const uploadOptions = {
    ...defaultOptions,
    resource_type: 'image',
    responsive_breakpoints: {
      create_derived: true,
      min_width: 200,
      max_width: 1000,
      max_images: 3
    },
    eager: [
      { width: 400, height: 300, crop: 'fill' },
      { width: 800, height: 600, crop: 'fill' }
    ],
    eager_async: true,
    tags: ['servicio', 'dental'],
    ...options
  };

  return cloudinary.uploader.upload(imagePath, uploadOptions);
};

/**
 * Elimina una imagen de Cloudinary
 * @param {string} publicId - ID público de la imagen
 * @param {Object} options - Opciones adicionales
 * @returns {Promise} Resultado de la eliminación
 */
const deleteImage = (publicId, options = {}) => {
  return cloudinary.uploader.destroy(publicId, { 
    invalidate: true, 
    resource_type: 'image',
    ...options 
  });
};

/**
 * Busca imágenes en Cloudinary
 * @param {Object} options - Opciones de búsqueda
 * @returns {Promise} Resultado de la búsqueda
 */
const searchImages = (options = {}) => {
  const searchOptions = {
    expression: 'folder=Imagenes',
    sort_by: 'created_at:desc',
    max_results: 100,
    with_field: 'tags,context',
    ...options
  };

  return cloudinary.search
    .expression(searchOptions.expression)
    .sort_by(searchOptions.sort_by)
    .max_results(searchOptions.max_results)
    .with_field(searchOptions.with_field)
    .execute();
};

// Exportar la instancia de cloudinary y las funciones auxiliares
module.exports = {
  cloudinary,
  getOptimizedUrl,
  uploadImage,
  deleteImage,
  searchImages,
  defaultOptions
};