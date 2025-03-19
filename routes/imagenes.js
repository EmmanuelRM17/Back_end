const express = require('express');
const router = express.Router();
const db = require('../db');
const logger = require('../utils/logger');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const ftp = require('basic-ftp'); // Necesitas instalarlo: npm install basic-ftp

// Configuración de FTP para Hostinger
const FTP_CONFIG = {
  host: 'ftp.odontologiacarol.com',
  user: 'u478151766.Odontologialmg', // Tu usuario FTP
  password: 'sP8+?;Vs:', // Tu contraseña FTP
  secure: false // Cambia a true si usas FTPS
};

// Directorio de imágenes en tu servidor Hostinger
const FTP_IMG_DIR = '/Imagenes';
const IMAGE_URL_BASE = 'https://odontologiacarol.com/Imagenes/';

// Configuración para almacenar temporalmente las imágenes antes de subirlas por FTP
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Asegúrate de que este directorio exista en tu servidor
    const uploadDir = path.join(__dirname, '../temp/uploads');
    // Crear directorio si no existe
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Genera un nombre seguro para el archivo
    const filename = file.originalname.replace(/[^\w\d\s.-]/g, '').replace(/\s+/g, '_');
    // Asegura que sea único
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + filename);
  }
});

// Filtro para asegurar que solo se suban imágenes
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Formato de archivo no válido. Solo se permiten imágenes (JPG, PNG, GIF, WebP)'), false);
  }
};

// Configuración de multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: fileFilter
});

// Función para conectar al servidor FTP
async function connectToFTP() {
  const client = new ftp.Client();
  client.ftp.verbose = false; // Cambia a true para debugging
  
  try {
    await client.access(FTP_CONFIG);
    return client;
  } catch (err) {
    logger.error('Error al conectar con FTP:', err);
    throw new Error('No se pudo conectar al servidor FTP');
  }
}

/**
 * @route   GET /api/imagenes/test-ftp
 * @desc    Probar conexión con servidor FTP
 * @access  Private
 */
router.get('/test-ftp', async (req, res) => {
  try {
    const client = await connectToFTP();
    await client.list(FTP_IMG_DIR);
    client.close();
    
    logger.info('Conexión FTP probada exitosamente');
    res.json({
      success: true,
      message: 'Conexión con servidor FTP establecida correctamente'
    });
  } catch (error) {
    logger.error('Error al probar conexión FTP:', error);
    res.status(500).json({
      success: false,
      message: 'Error al conectar con el servidor FTP',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/imagenes/ftp-list
 * @desc    Obtener lista de imágenes del servidor FTP
 * @access  Private
 */
router.get('/ftp-list', async (req, res) => {
  try {
    const client = await connectToFTP();
    
    // Listar archivos en el directorio de imágenes
    const fileList = await client.list(FTP_IMG_DIR);
    client.close();
    
    // Filtrar solo archivos de imágenes
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const imageFiles = fileList.filter(file => 
      file.type === 1 && // Es un archivo, no un directorio
      imageExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
    );
    
    logger.info(`Se encontraron ${imageFiles.length} imágenes en el servidor FTP`);
    res.json({
      success: true,
      files: imageFiles
    });
  } catch (error) {
    logger.error('Error al listar imágenes FTP:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener la lista de imágenes',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/imagenes/upload-ftp
 * @desc    Subir una imagen al servidor FTP
 * @access  Private
 */
router.post('/upload-ftp', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No se proporcionó ninguna imagen'
    });
  }
  
  let client = null;
  
  try {
    // Preparar nombre de archivo limpio para FTP
    let filename = req.body.filename || req.file.originalname;
    filename = filename.replace(/[^\w\d\s.-]/g, '').replace(/\s+/g, '_');
    
    // Asegurar que tiene una extensión válida de imagen
    if (!filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      const originalExt = path.extname(req.file.originalname).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(originalExt)) {
        filename += originalExt;
      } else {
        filename += '.jpg'; // Default a jpg si no tiene extensión válida
      }
    }
    
    // Conectar al servidor FTP y subir el archivo
    client = await connectToFTP();
    await client.uploadFrom(req.file.path, `${FTP_IMG_DIR}/${filename}`);
    client.close();
    
    // Registrar éxito
    logger.info(`Imagen "${filename}" subida exitosamente al servidor FTP`);
    
    // Eliminar el archivo temporal
    fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      message: 'Imagen subida correctamente',
      image: {
        name: filename,
        url: `${IMAGE_URL_BASE}${filename}`
      }
    });
  } catch (error) {
    logger.error('Error al subir imagen a FTP:', error);
    
    // Eliminar el archivo temporal en caso de error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      success: false,
      message: 'Error al subir la imagen al servidor',
      error: error.message
    });
  } finally {
    if (client) client.close();
  }
});

/**
 * @route   DELETE /api/imagenes/eliminar-ftp
 * @desc    Eliminar una imagen del servidor FTP
 * @access  Private
 */
router.delete('/eliminar-ftp', async (req, res) => {
  const { filename } = req.body;
  
  if (!filename) {
    return res.status(400).json({
      success: false,
      message: 'Se requiere el nombre del archivo'
    });
  }
  
  let client = null;
  
  try {
    client = await connectToFTP();
    
    // Verificar si el archivo existe antes de intentar eliminarlo
    const fileList = await client.list(FTP_IMG_DIR);
    const fileExists = fileList.some(file => file.name === filename);
    
    if (!fileExists) {
      client.close();
      return res.status(404).json({
        success: false,
        message: 'El archivo no existe en el servidor'
      });
    }
    
    // Eliminar el archivo
    await client.remove(`${FTP_IMG_DIR}/${filename}`);
    client.close();
    
    // Actualizar base de datos para eliminar referencias a esta imagen
    const imageUrl = `${IMAGE_URL_BASE}${filename}`;
    await db.query('UPDATE services SET image_url = NULL, image_name = NULL WHERE image_url = ?', [imageUrl]);
    
    logger.info(`Imagen "${filename}" eliminada correctamente del servidor FTP`);
    
    res.json({
      success: true,
      message: 'Imagen eliminada correctamente'
    });
  } catch (error) {
    logger.error('Error al eliminar imagen de FTP:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar la imagen del servidor',
      error: error.message
    });
  } finally {
    if (client) client.close();
  }
});

/**
 * @route   GET /api/imagenes/resumen
 * @desc    Obtener estadísticas de servicios con/sin imágenes
 * @access  Private
 */
router.get('/resumen', async (req, res) => {
  try {
    const [results] = await db.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN image_url IS NOT NULL THEN 1 ELSE 0 END) as con_imagen,
        SUM(CASE WHEN image_url IS NULL THEN 1 ELSE 0 END) as sin_imagen
      FROM services
    `);
    
    logger.info('Estadísticas de servicios obtenidas correctamente');
    res.json(results[0] || { total: 0, con_imagen: 0, sin_imagen: 0 });
  } catch (error) {
    logger.error('Error al obtener resumen de servicios:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener las estadísticas',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/imagenes/all
 * @desc    Obtener todos los servicios con imágenes
 * @access  Private
 */
router.get('/all', async (req, res) => {
  try {
    const [results] = await db.query(`
      SELECT id, title, description, category, image_url, image_name
      FROM services
      WHERE image_url IS NOT NULL
      ORDER BY title
    `);
    
    logger.info(`Se encontraron ${results.length} servicios con imágenes`);
    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    logger.error('Error al obtener servicios con imágenes:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener los servicios',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/imagenes/pendientes
 * @desc    Obtener servicios sin imágenes
 * @access  Private
 */
router.get('/pendientes', async (req, res) => {
  try {
    const [results] = await db.query(`
      SELECT id, title, description, category
      FROM services
      WHERE image_url IS NULL
      ORDER BY title
    `);
    
    logger.info(`Se encontraron ${results.length} servicios sin imágenes`);
    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    logger.error('Error al obtener servicios sin imágenes:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener los servicios',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/imagenes/asignar/:id
 * @desc    Asignar una imagen a un servicio
 * @access  Private
 */
router.post('/asignar/:id', async (req, res) => {
  const { id } = req.params;
  const { imageUrl, name } = req.body;
  
  if (!imageUrl) {
    return res.status(400).json({
      success: false,
      message: 'Se requiere la URL de la imagen'
    });
  }
  
  try {
    const [result] = await db.query(
      'UPDATE services SET image_url = ?, image_name = ? WHERE id = ?',
      [imageUrl, name, id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Servicio no encontrado'
      });
    }
    
    logger.info(`Imagen asignada al servicio ID: ${id}`);
    res.json({
      success: true,
      message: 'Imagen asignada correctamente'
    });
  } catch (error) {
    logger.error(`Error al asignar imagen al servicio ID ${id}:`, error);
    res.status(500).json({
      success: false,
      message: 'Error al asignar la imagen',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/imagenes/remover/:id
 * @desc    Remover imagen de un servicio
 * @access  Private
 */
router.delete('/remover/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const [result] = await db.query(
      'UPDATE services SET image_url = NULL, image_name = NULL WHERE id = ?',
      [id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Servicio no encontrado'
      });
    }
    
    logger.info(`Imagen removida del servicio ID: ${id}`);
    res.json({
      success: true,
      message: 'Imagen removida correctamente'
    });
  } catch (error) {
    logger.error(`Error al remover imagen del servicio ID ${id}:`, error);
    res.status(500).json({
      success: false,
      message: 'Error al remover la imagen',
      error: error.message
    });
  }
});

module.exports = router;