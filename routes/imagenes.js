const express = require('express');
const router = express.Router();
const db = require('../db');
const logger = require('../utils/logger');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const fs = require('fs');
const path = require('path');

// Configuración de Cloudinary
cloudinary.config({
  cloud_name: 'dt797utcm',
  api_key: '154434954868491',
  api_secret: 'J-y97KOp8XsdsXB2k_ed2xPPuQE'
});

// Configuración de Multer para subida de archivos temporal
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

// Filtro para aceptar solo imágenes
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten archivos de imagen'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: fileFilter
});

/**
 * @route   GET /api/imagenes/all
 * @desc    Obtener todas las imágenes de los servicios
 * @access  Private
 */
router.get('/all', async (req, res) => {
  try {
    const sql = 'SELECT id, title, image_url FROM servicios WHERE image_url IS NOT NULL';
    db.query(sql, (err, result) => {
      if (err) {
        logger.error('Error al obtener imágenes de servicios: ', err);
        return res.status(500).json({ message: 'Error al obtener las imágenes.' });
      }
      res.status(200).json(result);
    });
  } catch (error) {
    logger.error('Error en la ruta /api/imagenes/all: ', error);
    res.status(500).json({ message: 'Error en el servidor.' });
  }
});

/**
 * @route   GET /api/imagenes/pendientes
 * @desc    Obtener servicios sin imágenes
 * @access  Private
 */
router.get('/pendientes', async (req, res) => {
  try {
    const sql = 'SELECT id, title, category FROM servicios WHERE image_url IS NULL';
    db.query(sql, (err, result) => {
      if (err) {
        logger.error('Error al obtener servicios sin imágenes: ', err);
        return res.status(500).json({ message: 'Error al obtener los servicios sin imágenes.' });
      }
      res.status(200).json(result);
    });
  } catch (error) {
    logger.error('Error en la ruta /api/imagenes/pendientes: ', error);
    res.status(500).json({ message: 'Error en el servidor.' });
  }
});

/**
 * @route   GET /api/imagenes/resumen
 * @desc    Obtener resumen de servicios con y sin imágenes
 * @access  Private
 */
router.get('/resumen', async (req, res) => {
  try {
    const sqlTotal = 'SELECT COUNT(*) as total FROM servicios';
    const sqlConImagen = 'SELECT COUNT(*) as con_imagen FROM servicios WHERE image_url IS NOT NULL';
    const sqlSinImagen = 'SELECT COUNT(*) as sin_imagen FROM servicios WHERE image_url IS NULL';

    db.query(sqlTotal, (err, totalResult) => {
      if (err) {
        logger.error('Error al obtener total de servicios: ', err);
        return res.status(500).json({ message: 'Error al obtener el resumen.' });
      }

      db.query(sqlConImagen, (err, conImagenResult) => {
        if (err) {
          logger.error('Error al obtener servicios con imagen: ', err);
          return res.status(500).json({ message: 'Error al obtener el resumen.' });
        }

        db.query(sqlSinImagen, (err, sinImagenResult) => {
          if (err) {
            logger.error('Error al obtener servicios sin imagen: ', err);
            return res.status(500).json({ message: 'Error al obtener el resumen.' });
          }

          res.status(200).json({
            total: totalResult[0].total,
            con_imagen: conImagenResult[0].con_imagen,
            sin_imagen: sinImagenResult[0].sin_imagen
          });
        });
      });
    });
  } catch (error) {
    logger.error('Error en la ruta /api/imagenes/resumen: ', error);
    res.status(500).json({ message: 'Error en el servidor.' });
  }
});

/**
 * @route   POST /api/imagenes/upload
 * @desc    Subir una imagen a Cloudinary
 * @access  Private
 */
router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No se ha seleccionado ninguna imagen.' });
    }

    // Ruta del archivo temporal
    const filePath = req.file.path;

    // Subir archivo a Cloudinary
    cloudinary.uploader.upload(filePath, {
      folder: 'Imagenes',
      resource_type: 'image'
    }, (error, result) => {
      // Eliminar archivo temporal después de subir
      fs.unlinkSync(filePath);

      if (error) {
        logger.error('Error al subir imagen a Cloudinary: ', error);
        return res.status(500).json({ message: 'Error al subir la imagen a Cloudinary.' });
      }

      // Devolver información de la imagen subida
      res.status(200).json({
        message: 'Imagen subida correctamente',
        image: {
          public_id: result.public_id,
          url: result.secure_url,
          format: result.format,
          created_at: result.created_at
        }
      });
    });
  } catch (error) {
    // Si hay un error, asegurarse de eliminar el archivo temporal si existe
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        logger.error('Error al eliminar archivo temporal: ', unlinkError);
      }
    }

    logger.error('Error en la ruta /api/imagenes/upload: ', error);
    res.status(500).json({ message: 'Error en el servidor.' });
  }
});

/**
 * @route   POST /api/imagenes/asignar/:id
 * @desc    Asignar imagen a un servicio
 * @access  Private
 */
router.post('/asignar/:id', async (req, res) => {
  const { id } = req.params;
  const { imageUrl } = req.body;

  if (!imageUrl) {
    return res.status(400).json({ message: 'No se ha proporcionado la URL de la imagen.' });
  }

  try {
    const updateQuery = 'UPDATE servicios SET image_url = ? WHERE id = ?';
    db.query(updateQuery, [imageUrl, id], (err, result) => {
      if (err) {
        logger.error(`Error al asignar imagen al servicio ${id}: `, err);
        return res.status(500).json({ message: 'Error al asignar la imagen al servicio.' });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Servicio no encontrado.' });
      }

      res.status(200).json({ message: 'Imagen asignada correctamente al servicio.' });
    });
  } catch (error) {
    logger.error(`Error en la ruta /api/imagenes/asignar/${id}: `, error);
    res.status(500).json({ message: 'Error en el servidor.' });
  }
});

/**
 * @route   DELETE /api/imagenes/remover/:id
 * @desc    Eliminar imagen de un servicio
 * @access  Private
 */
router.delete('/remover/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Primero obtenemos la URL actual para saber si tiene imagen
    const selectQuery = 'SELECT image_url FROM servicios WHERE id = ?';
    db.query(selectQuery, [id], (err, result) => {
      if (err) {
        logger.error(`Error al consultar imagen del servicio ${id}: `, err);
        return res.status(500).json({ message: 'Error al consultar la imagen del servicio.' });
      }

      if (result.length === 0) {
        return res.status(404).json({ message: 'Servicio no encontrado.' });
      }

      if (!result[0].image_url) {
        return res.status(400).json({ message: 'El servicio no tiene ninguna imagen asignada.' });
      }

      // Actualizar servicio para eliminar la referencia a la imagen
      const updateQuery = 'UPDATE servicios SET image_url = NULL WHERE id = ?';
      db.query(updateQuery, [id], (err, updateResult) => {
        if (err) {
          logger.error(`Error al eliminar imagen del servicio ${id}: `, err);
          return res.status(500).json({ message: 'Error al eliminar la imagen del servicio.' });
        }

        res.status(200).json({ message: 'Imagen eliminada correctamente del servicio.' });
      });
    });
  } catch (error) {
    logger.error(`Error en la ruta /api/imagenes/remover/${id}: `, error);
    res.status(500).json({ message: 'Error en el servidor.' });
  }
});

/**
 * @route   DELETE /api/imagenes/eliminar
 * @desc    Eliminar una imagen de Cloudinary
 * @access  Private
 */
router.delete('/eliminar', async (req, res) => {
  const { public_id } = req.body;

  if (!public_id) {
    return res.status(400).json({ message: 'No se ha proporcionado el ID público de la imagen.' });
  }

  try {
    // Eliminar la imagen de Cloudinary
    cloudinary.uploader.destroy(public_id, (error, result) => {
      if (error) {
        logger.error(`Error al eliminar imagen de Cloudinary (${public_id}): `, error);
        return res.status(500).json({ message: 'Error al eliminar la imagen de Cloudinary.' });
      }

      if (result.result !== 'ok') {
        return res.status(400).json({ message: 'No se pudo eliminar la imagen de Cloudinary.' });
      }

      // Verificar si la imagen está siendo utilizada por algún servicio
      const updateQuery = 'UPDATE servicios SET image_url = NULL WHERE image_url LIKE ?';
      db.query(updateQuery, [`%${public_id}%`], (err, updateResult) => {
        if (err) {
          logger.error(`Error al actualizar servicios que usan la imagen ${public_id}: `, err);
          // Continuamos a pesar del error, ya que la imagen ya fue eliminada de Cloudinary
        }

        res.status(200).json({
          message: 'Imagen eliminada correctamente',
          servicios_actualizados: updateResult ? updateResult.affectedRows : 0
        });
      });
    });
  } catch (error) {
    logger.error('Error en la ruta /api/imagenes/eliminar: ', error);
    res.status(500).json({ message: 'Error en el servidor.' });
  }
});

/**
 * @route   GET /api/imagenes/cloudinary
 * @desc    Obtener todas las imágenes de Cloudinary
 * @access  Private
 */
router.get('/cloudinary', async (req, res) => {
  try {
    cloudinary.search
      .expression('folder:Imagenes')
      .sort_by('created_at', 'desc')
      .max_results(100)
      .execute((error, result) => {
        if (error) {
          logger.error('Error al obtener imágenes de Cloudinary: ', error);
          return res.status(500).json({ message: 'Error al obtener las imágenes de Cloudinary.' });
        }

        const images = result.resources.map(image => ({
          public_id: image.public_id,
          url: image.secure_url,
          format: image.format,
          created_at: new Date(image.created_at * 1000).toISOString().split('T')[0],
          bytes: image.bytes,
          width: image.width,
          height: image.height
        }));

        res.status(200).json(images);
      });
  } catch (error) {
    logger.error('Error en la ruta /api/imagenes/cloudinary: ', error);
    res.status(500).json({ message: 'Error en el servidor.' });
  }
});

module.exports = router;