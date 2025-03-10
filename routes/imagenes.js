const express = require('express');
const router = express.Router();
const db = require('../db');
const logger = require('../utils/logger');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

// Configuración de Cloudinary (directamente aquí para evitar problemas de importación)
cloudinary.config({
  cloud_name: 'dt797utcm',
  api_key: '154434954868491',
  api_secret: 'J-y97KOp8XsdsXB2k_ed2xPPuQE',
  secure: true
});

// Configuración de multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB máximo
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de imagen'), false);
    }
  }
});

// Helper para manejar errores
const handleError = (res, error, message) => {
  logger.error(message, error);
  return res.status(500).json({ message });
};

/**
 * @route   GET /api/imagenes/resumen
 * @desc    Obtener estadísticas de imágenes y servicios
 */
router.get('/resumen', (req, res) => {
  try {
    const query = `
      SELECT 
        (SELECT COUNT(*) FROM servicios) AS total,
        (SELECT COUNT(*) FROM servicios WHERE image_url IS NOT NULL) AS con_imagen,
        (SELECT COUNT(*) FROM servicios WHERE image_url IS NULL) AS sin_imagen
    `;
    
    db.query(query, (err, results) => {
      if (err) {
        return handleError(res, err, 'Error al obtener resumen de imágenes');
      }
      
      // Enviar directamente los resultados como objeto (no como array)
      const data = results && results.length > 0 ? results[0] : { total: 0, con_imagen: 0, sin_imagen: 0 };
      res.status(200).json(data);
    });
  } catch (error) {
    handleError(res, error, 'Error interno del servidor al obtener resumen');
  }
});

/**
 * @route   GET /api/imagenes/all
 * @desc    Obtener todos los servicios con imágenes
 */
router.get('/all', (req, res) => {
  try {
    const query = 'SELECT id, title, description, category, price, image_url FROM servicios WHERE image_url IS NOT NULL';
    
    db.query(query, (err, results) => {
      if (err) {
        return handleError(res, err, 'Error al obtener servicios con imágenes');
      }
      
      // Asegurar que results sea un array
      const data = results || [];
      res.status(200).json({ data });
    });
  } catch (error) {
    handleError(res, error, 'Error interno del servidor al obtener servicios con imágenes');
  }
});

/**
 * @route   GET /api/imagenes/pendientes
 * @desc    Obtener todos los servicios sin imágenes
 */
router.get('/pendientes', (req, res) => {
  try {
    const query = 'SELECT id, title, description, category, price FROM servicios WHERE image_url IS NULL';
    
    db.query(query, (err, results) => {
      if (err) {
        return handleError(res, err, 'Error al obtener servicios sin imágenes');
      }
      
      // Asegurar que results sea un array
      const data = results || [];
      res.status(200).json({ data });
    });
  } catch (error) {
    handleError(res, error, 'Error interno del servidor al obtener servicios sin imágenes');
  }
});

/**
 * @route   POST /api/imagenes/upload
 * @desc    Subir imagen a Cloudinary
 */
router.post('/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No se ha enviado ninguna imagen válida' });
    }

    const uploadOptions = {
      folder: 'Imagenes',
      resource_type: 'image',
      quality: 'auto:good',
      fetch_format: 'auto'
    };

    // Verificar que el archivo existe
    if (!fs.existsSync(req.file.path)) {
      return res.status(400).json({ message: 'Error: No se pudo acceder al archivo subido' });
    }

    cloudinary.uploader.upload(req.file.path, uploadOptions, (error, result) => {
      // Eliminar archivo temporal
      try {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch (unlinkError) {
        logger.error('Error al eliminar archivo temporal:', unlinkError);
      }
      
      if (error) {
        logger.error('Error al subir imagen a Cloudinary:', error);
        return res.status(500).json({ message: 'Error al subir la imagen a Cloudinary' });
      }

      res.status(200).json({
        message: 'Imagen subida correctamente',
        image: {
          public_id: result.public_id,
          url: result.secure_url,
          format: result.format,
          created_at: new Date(result.created_at * 1000).toISOString().split('T')[0]
        }
      });
    });
  } catch (error) {
    // Eliminar archivo temporal si hay un error
    try {
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      logger.error('Error al eliminar archivo temporal:', unlinkError);
    }

    handleError(res, error, 'Error interno del servidor al subir imagen');
  }
});

/**
 * @route   POST /api/imagenes/asignar/:id
 * @desc    Asignar imagen a un servicio
 */
router.post('/asignar/:id', (req, res) => {
  const { id } = req.params;
  const { imageUrl } = req.body;

  if (!imageUrl) {
    return res.status(400).json({ message: 'No se ha proporcionado la URL de la imagen' });
  }

  try {
    db.query('SELECT id, title FROM servicios WHERE id = ?', [id], (err, servicios) => {
      if (err) {
        return handleError(res, err, `Error al verificar servicio ${id}`);
      }
      
      if (!servicios || servicios.length === 0) {
        return res.status(404).json({ message: 'Servicio no encontrado' });
      }

      db.query('UPDATE servicios SET image_url = ? WHERE id = ?', [imageUrl, id], (updateErr) => {
        if (updateErr) {
          return handleError(res, updateErr, `Error al asignar imagen al servicio ${id}`);
        }
        
        res.status(200).json({ message: `Imagen asignada correctamente al servicio: ${servicios[0].title}` });
      });
    });
  } catch (error) {
    handleError(res, error, `Error interno del servidor al asignar imagen al servicio ${id}`);
  }
});

/**
 * @route   DELETE /api/imagenes/remover/:id
 * @desc    Remover imagen de un servicio
 */
router.delete('/remover/:id', (req, res) => {
  const { id } = req.params;

  try {
    db.query('SELECT id, title, image_url FROM servicios WHERE id = ?', [id], (err, servicios) => {
      if (err) {
        return handleError(res, err, `Error al verificar servicio ${id}`);
      }
      
      if (!servicios || servicios.length === 0) {
        return res.status(404).json({ message: 'Servicio no encontrado' });
      }

      const servicio = servicios[0];
      
      if (!servicio.image_url) {
        return res.status(400).json({ message: 'El servicio no tiene ninguna imagen asignada' });
      }

      db.query('UPDATE servicios SET image_url = NULL WHERE id = ?', [id], (updateErr) => {
        if (updateErr) {
          return handleError(res, updateErr, `Error al remover imagen del servicio ${id}`);
        }
        
        res.status(200).json({ message: `Imagen removida correctamente del servicio: ${servicio.title}` });
      });
    });
  } catch (error) {
    handleError(res, error, `Error interno del servidor al remover imagen del servicio ${id}`);
  }
});

/**
 * @route   DELETE /api/imagenes/eliminar
 * @desc    Eliminar imagen de Cloudinary
 */
router.delete('/eliminar', (req, res) => {
  const { public_id } = req.body;

  if (!public_id) {
    return res.status(400).json({ message: 'No se ha proporcionado el ID público de la imagen' });
  }

  try {
    cloudinary.uploader.destroy(public_id, { invalidate: true }, (error, result) => {
      if (error || (result && result.result !== 'ok')) {
        return handleError(res, error || result, `Error al eliminar imagen ${public_id} de Cloudinary`);
      }

      const searchTerm = `%${public_id}%`;
      db.query('UPDATE servicios SET image_url = NULL WHERE image_url LIKE ?', [searchTerm], (err) => {
        if (err) {
          logger.error(`Error al actualizar servicios que usan la imagen ${public_id}:`, err);
          // Continuamos a pesar del error, ya que la imagen ya fue eliminada
        }
        
        res.status(200).json({ message: 'Imagen eliminada correctamente' });
      });
    });
  } catch (error) {
    handleError(res, error, `Error interno del servidor al eliminar imagen ${public_id}`);
  }
});

/**
 * @route   GET /api/imagenes/cloudinary
 * @desc    Obtener todas las imágenes de Cloudinary
 */
router.get('/cloudinary', (req, res) => {
  try {
    // Verificar que cloudinary está configurado
    if (!cloudinary.config().cloud_name) {
      return res.status(500).json({ 
        message: 'Error: Cloudinary no está configurado correctamente', 
        config: 'Falta configuración' 
      });
    }

    cloudinary.search
      .expression('folder:Imagenes')
      .sort_by('created_at', 'desc')
      .max_results(100)
      .execute((error, result) => {
        if (error) {
          return handleError(res, error, 'Error al obtener imágenes de Cloudinary');
        }

        if (!result || !result.resources) {
          return res.status(200).json({ data: [] });
        }

        const images = result.resources.map(image => ({
          public_id: image.public_id,
          url: image.secure_url,
          format: image.format,
          created_at: new Date(image.created_at * 1000).toISOString().split('T')[0]
        }));

        res.status(200).json({ data: images });
      });
  } catch (error) {
    handleError(res, error, 'Error interno del servidor al obtener imágenes de Cloudinary');
  }
});

// Manejo de errores para la ruta
router.use((err, req, res, next) => {
  logger.error('Error en ruta de imágenes:', err);
  
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      message: 'El archivo excede el tamaño máximo permitido (10MB)'
    });
  }
  
  res.status(500).json({
    message: 'Error interno del servidor',
    error: process.env.NODE_ENV === 'production' ? 'Error en el servidor' : err.message
  });
});

module.exports = router;