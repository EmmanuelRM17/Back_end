const express = require('express');
const router = express.Router();
const db = require('../db');
const logger = require('../utils/logger');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

// Configuración de Cloudinary
cloudinary.config({
    cloud_name: 'dt797utcm',
    api_key: '154434954868491',
    api_secret: 'J-y97KOp8XsdsXB2k_ed2xPPuQE',
    secure: true
});

// Usar almacenamiento en memoria en lugar de disco para evitar problemas en Render
const storage = multer.memoryStorage();

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
 * @route   GET /api/imagenes/test-cloudinary
 * @desc    Verifica la conexión con Cloudinary
 */
router.get('/test-cloudinary', (req, res) => {
    cloudinary.api.ping((error, result) => {
        if (error) {
            console.error('Error conectando con Cloudinary:', error);
            return res.status(500).json({
                status: 'error',
                message: 'Error conectando con Cloudinary',
                error: error.message
            });
        }

        res.status(200).json({
            status: 'success',
            message: 'Conexión exitosa con Cloudinary',
            result: result
        });
    });
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
                return handleError(res, err, 'Error al obtener resumen de imágenes');
            }

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
        const query = 'SELECT id, title, description, category, price, image_url, image_public_id FROM servicios WHERE image_url IS NOT NULL';

        db.query(query, (err, results) => {
            if (err) {
                return handleError(res, err, 'Error al obtener servicios con imágenes');
            }

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

            const data = results || [];
            res.status(200).json({ data });
        });
    } catch (error) {
        handleError(res, error, 'Error interno del servidor al obtener servicios sin imágenes');
    }
});

/**
 * @route   POST /api/imagenes/upload
 * @desc    Subir imagen a Cloudinary usando base64 directamente
 */
router.post('/upload', upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No se ha enviado ninguna imagen válida' });
        }

        // Información de debug
        console.log('Archivo recibido:', {
            originalname: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype
        });

        if (req.file.size === 0) {
            return res.status(400).json({ message: 'Error: El archivo está vacío' });
        }

        // Usar directamente el buffer en memoria
        const base64Image = req.file.buffer.toString('base64');
        const dataURI = `data:${req.file.mimetype};base64,${base64Image}`;

        console.log('Imagen convertida a base64, iniciando subida a Cloudinary...');

        // Opciones para Cloudinary
        const uploadOptions = {
            folder: 'Imagenes',
            resource_type: 'image',
            timeout: 120000 // 2 minutos
        };

        // Subida directa con base64
        cloudinary.uploader.upload(dataURI, uploadOptions, (error, result) => {
            if (error) {
                console.error('Error al subir imagen a Cloudinary:', error);
                return res.status(500).json({
                    message: 'Error al subir la imagen a Cloudinary',
                    error: error.message || 'Error desconocido'
                });
            }

            console.log('Imagen subida con éxito, public_id:', result.public_id);

            res.status(200).json({
                message: 'Imagen subida correctamente',
                image: {
                    public_id: result.public_id,
                    url: result.secure_url,
                    format: result.format || 'jpg',
                    created_at: new Date().toISOString().split('T')[0]
                }
            });
        });
    } catch (error) {
        console.error('Error general en proceso de subida:', error);
        return res.status(500).json({
            message: 'Error interno del servidor al subir imagen',
            error: error.message || 'Error desconocido'
        });
    }
});

/**
 * @route   POST /api/imagenes/upload-base64
 * @desc    Subir imagen a Cloudinary usando base64 directamente desde el cliente
 */
router.post('/upload-base64', (req, res) => {
    try {
        const { image, name } = req.body;

        if (!image) {
            return res.status(400).json({ message: 'No se ha enviado ninguna imagen válida' });
        }

        console.log(`Recibida imagen base64 de ${name || 'desconocido'}`);

        // Eliminar cualquier parte de la cadena después de 100 caracteres para el log
        console.log('Base64 recibido (primeros 100 caracteres):', image.substring(0, 100) + '...');

        // Verificar que la cadena base64 sea válida
        if (!image.startsWith('data:image/')) {
            return res.status(400).json({ message: 'Formato de imagen no válido' });
        }

        // Opciones para Cloudinary
        const uploadOptions = {
            folder: 'Imagenes',
            resource_type: 'image',
            timeout: 120000, // 2 minutos
            public_id: name ? name.split('.')[0].replace(/\s+/g, '_') : undefined
        };

        // Subida directa con base64 que ya viene del cliente
        cloudinary.uploader.upload(image, uploadOptions, (error, result) => {
            if (error) {
                console.error('Error al subir imagen a Cloudinary:', error);
                return res.status(500).json({
                    message: 'Error al subir la imagen a Cloudinary',
                    error: error.message || 'Error desconocido'
                });
            }

            console.log('Imagen subida con éxito, public_id:', result.public_id);

            res.status(200).json({
                message: 'Imagen subida correctamente',
                image: {
                    public_id: result.public_id,
                    url: result.secure_url,
                    format: result.format || 'jpg',
                    created_at: new Date().toISOString().split('T')[0]
                }
            });
        });
    } catch (error) {
        console.error('Error general en proceso de subida base64:', error);
        return res.status(500).json({
            message: 'Error interno del servidor al subir imagen',
            error: error.message || 'Error desconocido'
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
        db.query('SELECT id, title, image_url, image_public_id FROM servicios WHERE id = ?', [id], (err, servicios) => {
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

            // Remover tanto la URL como el public_id
            db.query('UPDATE servicios SET image_url = NULL, image_public_id = NULL WHERE id = ?', [id], (updateErr) => {
                if (updateErr) {
                    return handleError(res, updateErr, `Error al remover imagen del servicio ${id}`);
                }

                res.status(200).json({
                    message: `Imagen removida correctamente del servicio: ${servicio.title}`,
                    public_id: servicio.image_public_id
                });
            });
        });
    } catch (error) {
        handleError(res, error, `Error interno del servidor al remover imagen del servicio ${id}`);
    }
});

/**
 * @route   DELETE /api/imagenes/eliminar
 * @desc    Eliminar imagen de Cloudinary usando el public_id
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

            // Actualizar servicios que usan esta imagen
            db.query('UPDATE servicios SET image_url = NULL, image_public_id = NULL WHERE image_public_id = ?',
                [public_id], (err) => {
                    if (err) {
                        logger.error(`Error al actualizar servicios que usan la imagen ${public_id}:`, err);
                    }

                    res.status(200).json({
                        message: 'Imagen eliminada correctamente',
                        public_id: public_id
                    });
                });
        });
    } catch (error) {
        handleError(res, error, `Error interno del servidor al eliminar imagen ${public_id}`);
    }
});

/**
 * @route   GET /api/imagenes/cloudinary
 * @desc    Obtener todas las imágenes de la carpeta Imagenes en Cloudinary
 */
router.get('/cloudinary', (req, res) => {
    try {
        // Obtener imágenes directamente de Cloudinary
        cloudinary.api.resources({
            type: 'upload',
            prefix: 'Imagenes/',
            max_results: 100
        }, (error, result) => {
            if (error) {
                console.error('Error al obtener imágenes de Cloudinary:', error);
                // Si falla Cloudinary, intentar obtener de la base de datos
                return getFallbackImages(res);
            }

            if (result && result.resources && result.resources.length > 0) {
                const images = result.resources.map(resource => ({
                    id: resource.public_id.split('/')[1],
                    public_id: resource.public_id,
                    url: resource.secure_url,
                    created_at: new Date(resource.created_at * 1000).toISOString().split('T')[0],
                    format: resource.format
                }));

                return res.status(200).json({ data: images });
            } else {
                // Si no hay imágenes en Cloudinary, intentar obtener de la base de datos
                return getFallbackImages(res);
            }
        });
    } catch (error) {
        console.error('Error al procesar imágenes:', error);
        return getFallbackImages(res);
    }
});

// Función auxiliar para obtener imágenes de la base de datos como fallback
function getFallbackImages(res) {
    const query = 'SELECT DISTINCT image_url, image_public_id FROM servicios WHERE image_url IS NOT NULL AND image_public_id IS NOT NULL';

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error al obtener imágenes desde la base de datos:', err);
            return res.status(200).json({ data: [] });
        }

        const images = results.map(row => {
            // Extraer ID de la URL o usar el public_id almacenado
            const publicId = row.image_public_id || '';
            const id = publicId.includes('/') ? publicId.split('/')[1] : publicId;

            return {
                id: id,
                public_id: row.image_public_id,
                url: row.image_url,
                created_at: new Date().toISOString().split('T')[0],
                format: 'jpg' // Valor por defecto
            };
        });

        res.status(200).json({
            data: images,
            message: 'Datos obtenidos desde la base de datos (fallback)'
        });
    });
}

/**
 * @route   GET /api/imagenes/by-id/:public_id
 * @desc    Obtener imagen específica por su public_id
 */
router.get('/by-id/:public_id', (req, res) => {
    const { public_id } = req.params;

    if (!public_id) {
        return res.status(400).json({ message: 'Public ID no proporcionado' });
    }

    // Construir el public_id completo con el prefijo "Imagenes/"
    const fullPublicId = public_id.includes('Imagenes/') ? public_id : `Imagenes/${public_id}`;

    try {
        cloudinary.api.resource(fullPublicId, (error, result) => {
            if (error) {
                return res.status(404).json({
                    message: 'Imagen no encontrada en Cloudinary',
                    error: error.message
                });
            }

            res.status(200).json({
                public_id: result.public_id,
                url: result.secure_url,
                format: result.format,
                created_at: new Date(result.created_at * 1000).toISOString().split('T')[0]
            });
        });
    } catch (error) {
        handleError(res, error, `Error al obtener imagen con ID ${public_id}`);
    }
});

// Middleware de manejo de errores
router.use((err, req, res, next) => {
    logger.error('Error en ruta de imágenes:', err);

    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
            message: 'El archivo excede el tamaño máximo permitido (10MB)'
        });
    }

    res.status(500).json({
        message: 'Error interno del servidor',
        error: err.message
    });
});


/**
 * @route   GET /api/imagenes/check-db
 * @desc    Verificar la estructura de la tabla servicios
 */
router.get('/check-db', (req, res) => {
    try {
        // Consulta que verifica si existe la columna image_public_id
        const query = `
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'servicios' 
            AND column_name = 'image_public_id'
        `;

        db.query(query, (err, results) => {
            if (err) {
                console.error('Error al verificar estructura de base de datos:', err);
                return res.status(500).json({
                    status: 'error',
                    message: 'Error al verificar estructura de base de datos',
                    error: err.message
                });
            }

            const hasImagePublicIdColumn = results && results.length > 0;

            if (!hasImagePublicIdColumn) {
                // Si no existe la columna, intentamos crearla
                const alterQuery = `ALTER TABLE servicios ADD COLUMN image_public_id VARCHAR(255)`;

                db.query(alterQuery, (alterErr) => {
                    if (alterErr) {
                        return res.status(500).json({
                            status: 'error',
                            message: 'La columna image_public_id no existe y no se pudo crear',
                            error: alterErr.message,
                            solution: 'Ejecuta manualmente: ALTER TABLE servicios ADD COLUMN image_public_id VARCHAR(255);'
                        });
                    }

                    // Columna creada exitosamente
                    res.status(200).json({
                        status: 'success',
                        message: 'Columna image_public_id creada exitosamente en la tabla servicios',
                        columnCreated: true
                    });
                });
            } else {
                // La columna ya existe
                res.status(200).json({
                    status: 'success',
                    message: 'La estructura de la base de datos es correcta',
                    hasImagePublicIdColumn: true
                });
            }
        });
    } catch (error) {
        console.error('Error al verificar base de datos:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error interno al verificar base de datos',
            error: error.message
        });
    }
});

module.exports = router;