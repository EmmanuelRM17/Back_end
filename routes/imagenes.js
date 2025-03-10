
const express = require('express');
const router = express.Router();
const db = require('../db');
const logger = require('../utils/logger');
const multer = require('multer');
const cloudinary = require('../config/cloudinaryConfig');
const fs = require('fs');
const path = require('path');

// Configuración de almacenamiento temporal para multer
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

// Configuración de multer
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
        logger.error('Error al obtener resumen de imágenes:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Error al obtener resumen de imágenes'
        });
      }
      
      res.status(200).json({
        success: true,
        data: results[0] || { total: 0, con_imagen: 0, sin_imagen: 0 }
      });
    });
  } catch (error) {
    logger.error('Error en /api/imagenes/resumen:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor'
    });
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
        logger.error('Error al obtener servicios con imágenes:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Error al obtener servicios con imágenes'
        });
      }
      
      res.status(200).json({
        success: true,
        count: results.length,
        data: results
      });
    });
  } catch (error) {
    logger.error('Error en /api/imagenes/all:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor'
    });
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
        logger.error('Error al obtener servicios sin imágenes:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Error al obtener servicios sin imágenes'
        });
      }
      
      res.status(200).json({
        success: true,
        count: results.length,
        data: results
      });
    });
  } catch (error) {
    logger.error('Error en /api/imagenes/pendientes:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor'
    });
  }
});

/**
 * @route   POST /api/imagenes/upload
 * @desc    Subir imagen a Cloudinary
 */
router.post('/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No se ha enviado ninguna imagen válida' 
      });
    }

    // Opciones para subir a Cloudinary
    const uploadOptions = {
      folder: 'Imagenes',
      resource_type: 'image',
      quality: 'auto:good',
      fetch_format: 'auto'
    };

    // Subir a Cloudinary
    cloudinary.uploader.upload(req.file.path, uploadOptions, (error, result) => {
      // Eliminar archivo temporal
      fs.unlinkSync(req.file.path);
      
      if (error) {
        logger.error('Error al subir imagen a Cloudinary:', error);
        return res.status(500).json({ 
          success: false, 
          message: 'Error al subir la imagen a Cloudinary'
        });
      }

      res.status(200).json({
        success: true,
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
    // Si hay error, asegurarse de limpiar el archivo temporal si existe
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    logger.error('Error en /api/imagenes/upload:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor'
    });
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
    return res.status(400).json({ 
      success: false, 
      message: 'No se ha proporcionado la URL de la imagen' 
    });
  }

  try {
    // Verificar que el servicio existe
    db.query('SELECT id, title FROM servicios WHERE id = ?', [id], (err, servicios) => {
      if (err) {
        logger.error(`Error al verificar servicio ${id}:`, err);
        return res.status(500).json({ 
          success: false, 
          message: 'Error al verificar servicio'
        });
      }
      
      if (servicios.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'Servicio no encontrado' 
        });
      }

      // Actualizar servicio con la nueva imagen
      db.query('UPDATE servicios SET image_url = ? WHERE id = ?', [imageUrl, id], (err) => {
        if (err) {
          logger.error(`Error al asignar imagen al servicio ${id}:`, err);
          return res.status(500).json({ 
            success: false, 
            message: 'Error al asignar imagen al servicio'
          });
        }
        
        res.status(200).json({
          success: true,
          message: `Imagen asignada correctamente al servicio: ${servicios[0].title}`
        });
      });
    });
  } catch (error) {
    logger.error(`Error en /api/imagenes/asignar/${id}:`, error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor'
    });
  }
});

/**
 * @route   DELETE /api/imagenes/remover/:id
 * @desc    Remover imagen de un servicio
 */
router.delete('/remover/:id', (req, res) => {
  const { id } = req.params;

  try {
    // Verificar que el servicio existe y tiene imagen
    db.query('SELECT id, title, image_url FROM servicios WHERE id = ?', [id], (err, servicios) => {
      if (err) {
        logger.error(`Error al verificar servicio ${id}:`, err);
        return res.status(500).json({ 
          success: false, 
          message: 'Error al verificar servicio'
        });
      }
      
      if (servicios.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'Servicio no encontrado' 
        });
      }

      const servicio = servicios[0];
      
      if (!servicio.image_url) {
        return res.status(400).json({ 
          success: false, 
          message: 'El servicio no tiene ninguna imagen asignada' 
        });
      }

      // Eliminar referencia a la imagen
      db.query('UPDATE servicios SET image_url = NULL WHERE id = ?', [id], (err) => {
        if (err) {
          logger.error(`Error al remover imagen del servicio ${id}:`, err);
          return res.status(500).json({ 
            success: false, 
            message: 'Error al remover imagen del servicio'
          });
        }
        
        res.status(200).json({
          success: true,
          message: `Imagen removida correctamente del servicio: ${servicio.title}`
        });
      });
    });
  } catch (error) {
    logger.error(`Error en /api/imagenes/remover/${id}:`, error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor'
    });
  }
});

/**
 * @route   DELETE /api/imagenes/eliminar
 * @desc    Eliminar imagen de Cloudinary
 */
router.delete('/eliminar', (req, res) => {
  const { public_id } = req.body;

  if (!public_id) {
    return res.status(400).json({ 
      success: false, 
      message: 'No se ha proporcionado el ID público de la imagen' 
    });
  }

  try {
    // Eliminar imagen de Cloudinary
    cloudinary.uploader.destroy(public_id, { invalidate: true }, (error, result) => {
      if (error || result.result !== 'ok') {
        logger.error(`Error al eliminar imagen ${public_id} de Cloudinary:`, error || result);
        return res.status(500).json({ 
          success: false, 
          message: 'Error al eliminar imagen de Cloudinary'
        });
      }

      // Buscar servicios que usan esta imagen y actualizar
      const searchTerm = `%${public_id}%`;
      db.query('UPDATE servicios SET image_url = NULL WHERE image_url LIKE ?', [searchTerm], (err) => {
        if (err) {
          logger.error(`Error al actualizar servicios que usan la imagen ${public_id}:`, err);
          // Continuamos a pesar del error, ya que la imagen fue eliminada
        }
        
        res.status(200).json({
          success: true,
          message: 'Imagen eliminada correctamente'
        });
      });
    });
  } catch (error) {
    logger.error(`Error en /api/imagenes/eliminar:`, error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor'
    });
  }
});

/**
 * @route   GET /api/imagenes/cloudinary
 * @desc    Obtener todas las imágenes de Cloudinary
 */
router.get('/cloudinary', (req, res) => {
  try {
    cloudinary.search
      .expression('folder:Imagenes')
      .sort_by('created_at', 'desc')
      .max_results(100)
      .execute((error, result) => {
        if (error) {
          logger.error('Error al obtener imágenes de Cloudinary:', error);
          return res.status(500).json({ 
            success: false, 
            message: 'Error al obtener imágenes de Cloudinary'
          });
        }

        const images = result.resources.map(image => ({
          public_id: image.public_id,
          url: image.secure_url,
          format: image.format,
          created_at: new Date(image.created_at * 1000).toISOString().split('T')[0]
        }));

        res.status(200).json({
          success: true,
          count: images.length,
          data: images
        });
      });
  } catch (error) {
    logger.error('Error en /api/imagenes/cloudinary:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor'
    });
  }
});

// Manejo de errores para la ruta
router.use((err, req, res, next) => {
  logger.error('Error en ruta de imágenes:', err);
  
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: 'El archivo excede el tamaño máximo permitido (10MB)'
    });
  }
  
  res.status(500).json({
    success: false,
    message: 'Error interno del servidor'
  });
});

module.exports = router;