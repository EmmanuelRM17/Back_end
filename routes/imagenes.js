const express = require("express");
const router = express.Router();
const db = require("../db"); // Pool sin promesas
const logger = require("../utils/logger");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const ftp = require("basic-ftp");

// Configuración FTP
// Configuración de FTP para Hostinger (corregida)
const FTP_CONFIG = {
  host: "ftp.odontologiacarol.com", // Host correcto según tu imagen
  user: "u478151766.OdontologiaImg", // Usuario correcto según tu imagen
  password: "sP8+?;Vs:", // Tu contraseña actual
  secure: false,
  port: 21, // Puerto explícito según tu imagen
};
//Directorio de imágenes en tu servidor Hostinger (ruta completa)
const FTP_IMG_DIR = "/";
const IMAGE_URL_BASE = "https://odontologiacarol.com/Imagenes/";

const FTP_PROGRESS_DIR = "/Progresos";
const PROGRESS_URL_BASE = "https://odontologiacarol.com/Imagenes/Progresos/";

// Configuración para almacenar temporalmente las imágenes
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "../temp/uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const filename = file.originalname
      .replace(/[^\w\d\s.-]/g, "")
      .replace(/\s+/g, "_");
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + filename);
  },
});

// Filtro para asegurar que solo se suban imágenes
const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Formato de archivo no válido. Solo se permiten imágenes (JPG, PNG, GIF, WebP)"
      ),
      false
    );
  }
};

// Configuración de multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: fileFilter,
});

// Función para conectar al servidor FTP
async function connectToFTP() {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  await client.access(FTP_CONFIG);

  const currentDir = await client.pwd();
  console.log("Directorio actual tras conectarse:", currentDir);
  // Ejemplo: puede ser "/" o "/home/usuario" o "/public_html" etc.
  return client;
}

// Función corregida para evitar duplicación
async function ensureDirectoryExists(client) {
  try {
    // Como ya estás en /public_html, aseguras la carpeta "Imagenes"
    await client.ensureDir(FTP_IMG_DIR);
    // Cámbiate a esa carpeta para que la subida sea relativa
    await client.cd(FTP_IMG_DIR);
    return true;
  } catch (error) {
    console.error("Error al crear directorio:", error);
    return false;
  }
}

/**
 * @route   GET /api/imagenes/test-ftp
 * @desc    Probar conexión con servidor FTP
 * @access  Private
 */
router.get("/test-ftp", async (req, res) => {
  try {
    const client = await connectToFTP();
    await client.list(FTP_IMG_DIR);
    client.close();

    logger.info("Conexión FTP probada exitosamente");
    res.json({
      success: true,
      message: "Conexión con servidor FTP establecida correctamente",
    });
  } catch (error) {
    logger.error("Error al probar conexión FTP:", error);
    res.status(500).json({
      success: false,
      message: "Error al conectar con el servidor FTP",
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/imagenes/ftp-list
 * @desc    Obtener lista de imágenes del servidor FTP
 * @access  Private
 */
router.get("/ftp-list", async (req, res) => {
  try {
    const client = await connectToFTP();

    // Listar archivos en el directorio de imágenes
    const fileList = await client.list(FTP_IMG_DIR);
    console.log("fileList completo:", fileList);
    client.close();
    // Filtrar solo archivos de imágenes
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

    const imageFiles = fileList.filter(
      (file) =>
        !file.isDirectory &&
        imageExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))
    );

    logger.info(
      `Se encontraron ${imageFiles.length} imágenes en el servidor FTP`
    );
    res.json({
      success: true,
      files: imageFiles,
    });
  } catch (error) {
    logger.error("Error al listar imágenes FTP:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener la lista de imágenes",
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/imagenes/upload-ftp
 * @desc    Subir una imagen al servidor FTP
 * @access  Private
 */
router.post("/upload-ftp", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "No se proporcionó ninguna imagen",
    });
  }

  let client = null;

  try {
    // Preparar nombre de archivo limpio para FTP
    let filename = req.body.filename || req.file.originalname;
    filename = filename.replace(/[^\w\d\s.-]/g, "").replace(/\s+/g, "_");

    // Asegurar que tiene una extensión válida de imagen
    if (!filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      const originalExt = path.extname(req.file.originalname).toLowerCase();
      if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(originalExt)) {
        filename += originalExt;
      } else {
        filename += ".jpg"; // Default a jpg si no tiene extensión válida
      }
    }

    // Conectar al servidor FTP y subir el archivo
    client = await connectToFTP();
    await ensureDirectoryExists(client);
    await client.uploadFrom(req.file.path, filename);

    client.close();

    // Registrar éxito
    logger.info(`Imagen "${filename}" subida exitosamente al servidor FTP`);

    // Eliminar el archivo temporal
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      message: "Imagen subida correctamente",
      image: {
        name: filename,
        url: `${IMAGE_URL_BASE}${filename}`,
      },
    });
  } catch (error) {
    logger.error("Error al subir imagen a FTP:", error);

    // Eliminar el archivo temporal en caso de error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: "Error al subir la imagen al servidor",
      error: error.message,
    });
  } finally {
    if (client && client.close) client.close();
  }
});

/**
 * @route   DELETE /api/imagenes/eliminar-ftp
 * @desc    Eliminar una imagen del servidor FTP
 * @access  Private
 */
router.delete("/eliminar-ftp", async (req, res) => {
  const { filename } = req.body;

  if (!filename) {
    return res.status(400).json({
      success: false,
      message: "Se requiere el nombre del archivo",
    });
  }

  let client = null;

  try {
    client = await connectToFTP();

    // Verificar si el archivo existe antes de intentar eliminarlo
    const fileList = await client.list(FTP_IMG_DIR);
    const fileExists = fileList.some((file) => file.name === filename);

    if (!fileExists) {
      client.close();
      return res.status(404).json({
        success: false,
        message: "El archivo no existe en el servidor",
      });
    }

    // Eliminar el archivo
    await client.remove(`${FTP_IMG_DIR}/${filename}`);
    client.close();

    // Actualizar base de datos para eliminar referencias a esta imagen
    // Usando callback en lugar de await
    const imageUrl = `${IMAGE_URL_BASE}${filename}`;
    db.query(
      "UPDATE servicios SET image_url = NULL, image_name = NULL WHERE image_url = ?",
      [imageUrl],
      (err, result) => {
        if (err) {
          logger.error("Error al actualizar base de datos:", err);
          return res.status(500).json({
            success: false,
            message: "Error al eliminar la imagen del servidor",
            error: err.message,
          });
        }

        logger.info(
          `Imagen "${filename}" eliminada correctamente del servidor FTP`
        );
        res.json({
          success: true,
          message: "Imagen eliminada correctamente",
        });
      }
    );
  } catch (error) {
    logger.error("Error al eliminar imagen de FTP:", error);
    res.status(500).json({
      success: false,
      message: "Error al eliminar la imagen del servidor",
      error: error.message,
    });
  } finally {
    if (client && client.close) client.close();
  }
});

/**
 * @route   GET /api/imagenes/resumen
 * @desc    Obtener estadísticas de servicios con/sin imágenes
 * @access  Private
 */
router.get("/resumen", (req, res) => {
  const query = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN image_url IS NOT NULL THEN 1 ELSE 0 END) as con_imagen,
      SUM(CASE WHEN image_url IS NULL THEN 1 ELSE 0 END) as sin_imagen
    FROM servicios
  `;

  db.query(query, (err, results) => {
    if (err) {
      logger.error("Error al obtener resumen de servicios:", err);
      return res.status(500).json({
        success: false,
        message: "Error al obtener las estadísticas",
        error: err.message,
      });
    }

    logger.info("Estadísticas de servicios obtenidas correctamente");
    res.json(results[0] || { total: 0, con_imagen: 0, sin_imagen: 0 });
  });
});

/**
 * @route   GET /api/imagenes/all
 * @desc    Obtener todos los servicios con imágenes
 * @access  Private
 */
router.get("/all", (req, res) => {
  const query = `
    SELECT id, title, description, category, image_url, image_name
    FROM servicios
    WHERE image_url IS NOT NULL
    ORDER BY title
  `;

  db.query(query, (err, results) => {
    if (err) {
      logger.error("Error al obtener servicios con imágenes:", err);
      return res.status(500).json({
        success: false,
        message: "Error al obtener los servicios",
        error: err.message,
      });
    }

    logger.info(`Se encontraron ${results.length} servicios con imágenes`);
    res.json({
      success: true,
      data: results,
    });
  });
});

/**
 * @route   GET /api/imagenes/pendientes
 * @desc    Obtener servicios sin imágenes
 * @access  Private
 */
router.get("/pendientes", (req, res) => {
  const query = `
    SELECT id, title, description, category
    FROM servicios
    WHERE image_url IS NULL
    ORDER BY title
  `;

  db.query(query, (err, results) => {
    if (err) {
      logger.error("Error al obtener servicios sin imágenes:", err);
      return res.status(500).json({
        success: false,
        message: "Error al obtener los servicios",
        error: err.message,
      });
    }

    logger.info(`Se encontraron ${results.length} servicios sin imágenes`);
    res.json({
      success: true,
      data: results,
    });
  });
});

/**
 * @route   POST /api/imagenes/asignar/:id
 * @desc    Asignar una imagen a un servicio
 * @access  Private
 */
router.post("/asignar/:id", (req, res) => {
  const { id } = req.params;
  const { imageUrl, name } = req.body;

  if (!imageUrl) {
    return res.status(400).json({
      success: false,
      message: "Se requiere la URL de la imagen",
    });
  }

  const query =
    "UPDATE servicios SET image_url = ?, image_name = ? WHERE id = ?";
  const params = [imageUrl, name, id];

  db.query(query, params, (err, result) => {
    if (err) {
      logger.error(`Error al asignar imagen al servicio ID ${id}:`, err);
      return res.status(500).json({
        success: false,
        message: "Error al asignar la imagen",
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Servicio no encontrado",
      });
    }

    logger.info(`Imagen asignada al servicio ID: ${id}`);
    res.json({
      success: true,
      message: "Imagen asignada correctamente",
    });
  });
});

/**
 * @route   DELETE /api/imagenes/remover/:id
 * @desc    Remover imagen de un servicio
 * @access  Private
 */
router.delete("/remover/:id", (req, res) => {
  const { id } = req.params;

  const query =
    "UPDATE servicios SET image_url = NULL, image_name = NULL WHERE id = ?";

  db.query(query, [id], (err, result) => {
    if (err) {
      logger.error(`Error al remover imagen del servicio ID ${id}:`, err);
      return res.status(500).json({
        success: false,
        message: "Error al remover la imagen",
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Servicio no encontrado",
      });
    }

    logger.info(`Imagen removida del servicio ID: ${id}`);
    res.json({
      success: true,
      message: "Imagen removida correctamente",
    });
  });
});

/**
 * @route   GET /api/imagenes/:filename
 * @desc    Servir una imagen directamente desde el servidor
 * @access  Public
 */
router.get("/:filename", async (req, res) => {
  const { filename } = req.params;

  try {
    // Comprobar si el archivo existe en el servidor local
    const filePath = path.join(__dirname, "../temp/imagenes", filename);

    if (fs.existsSync(filePath)) {
      // Determinar el tipo MIME basado en la extensión
      const ext = path.extname(filename).toLowerCase();
      let contentType = "application/octet-stream"; // Por defecto

      if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
      else if (ext === ".png") contentType = "image/png";
      else if (ext === ".gif") contentType = "image/gif";
      else if (ext === ".webp") contentType = "image/webp";

      // Establecer el tipo de contenido y enviar el archivo
      res.setHeader("Content-Type", contentType);
      fs.createReadStream(filePath).pipe(res);
    } else {
      // Si no está disponible localmente, intentar descargarlo desde FTP
      const tempFilePath = path.join(
        __dirname,
        "../temp/temp_download",
        filename
      );

      // Crear directorio temporal si no existe
      if (!fs.existsSync(path.dirname(tempFilePath))) {
        fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
      }

      // Conectar a FTP y descargar
      const client = await connectToFTP();
      try {
        await client.downloadTo(tempFilePath, `${FTP_IMG_DIR}/${filename}`);
        client.close();

        // Determinar el tipo MIME
        const ext = path.extname(filename).toLowerCase();
        let contentType = "application/octet-stream"; // Por defecto

        if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
        else if (ext === ".png") contentType = "image/png";
        else if (ext === ".gif") contentType = "image/gif";
        else if (ext === ".webp") contentType = "image/webp";

        // Establecer el tipo de contenido y enviar el archivo
        res.setHeader("Content-Type", contentType);
        fs.createReadStream(tempFilePath).pipe(res);

        // Opcionalmente, eliminar el archivo temporal después
        // fs.unlinkSync(tempFilePath);
      } catch (error) {
        client.close();
        logger.error(`Imagen no encontrada: ${filename}`);
        res.status(404).json({
          success: false,
          message: "Imagen no encontrada",
        });
      }
    }
  } catch (error) {
    logger.error(`Error al servir la imagen ${filename}:`, error);
    res.status(500).json({
      success: false,
      message: "Error al servir la imagen",
      error: error.message,
    });
  }
});

// Función para asegurar que existe la carpeta de progreso
async function ensureProgressDirectoryExists(client, tratamientoId = null) {
  try {
    // Crear carpeta principal "Progresos" si no existe
    await client.ensureDir(FTP_PROGRESS_DIR);

    // Si se especifica un tratamiento, crear su subcarpeta
    if (tratamientoId) {
      const tratamientoDir = `${FTP_PROGRESS_DIR}/Tratamiento_${tratamientoId}`;
      await client.ensureDir(tratamientoDir);
      await client.cd(tratamientoDir);
      return tratamientoDir;
    } else {
      await client.cd(FTP_PROGRESS_DIR);
      return FTP_PROGRESS_DIR;
    }
  } catch (error) {
    console.error("Error al crear directorio de progreso:", error);
    return false;
  }
}

/**
 * @route   POST /api/imagenes/progreso/upload
 * @desc    Subir foto de progreso de tratamiento
 * @access  Private
 */
router.post("/progreso/upload", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "No se proporcionó ninguna imagen",
    });
  }

  const { tratamiento_id, paciente_id, tipo, descripcion } = req.body;

  if (!tratamiento_id || !paciente_id || !tipo) {
    return res.status(400).json({
      success: false,
      message: "Faltan datos requeridos: tratamiento_id, paciente_id, tipo",
    });
  }

  let client = null;

  try {
    // Crear nombre específico para foto de progreso
    const timestamp = Date.now();
    const filename = `${tipo}_${timestamp}.jpg`;

    // Conectar y crear estructura de carpetas
    client = await connectToFTP();
    const tratamientoDir = await ensureProgressDirectoryExists(
      client,
      tratamiento_id
    );

    if (!tratamientoDir) {
      throw new Error("No se pudo crear la estructura de directorios");
    }

    // Subir archivo (ahora ya estamos en la carpeta correcta)
    await client.uploadFrom(req.file.path, filename);
    client.close();

    // Construir URL completa
    const imageUrl = `${PROGRESS_URL_BASE}Tratamiento_${tratamiento_id}/${filename}`;

    // Guardar en base de datos
    const query = `
            INSERT INTO tratamiento_fotos 
            (tratamiento_id, paciente_id, imagen_url, imagen_nombre, tipo, descripcion, subido_por)
            VALUES (?, ?, ?, ?, ?, ?, 'doctor')
        `;

    db.query(
      query,
      [tratamiento_id, paciente_id, imageUrl, filename, tipo, descripcion],
      (err, result) => {
        if (err) {
          logger.error("Error al guardar foto de progreso:", err);
          return res.status(500).json({
            success: false,
            message: "Error al guardar la foto de progreso",
            error: err.message,
          });
        }

        // Eliminar archivo temporal
        fs.unlinkSync(req.file.path);

        logger.info(
          `Foto de progreso subida: Tratamiento_${tratamiento_id}/${filename}`
        );
        res.json({
          success: true,
          message: "Foto de progreso subida correctamente",
          foto: {
            id: result.insertId,
            url: imageUrl,
            nombre: filename,
            tipo: tipo,
            tratamiento_id: tratamiento_id,
          },
        });
      }
    );
  } catch (error) {
    logger.error("Error al subir foto de progreso:", error);

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: "Error al subir la foto de progreso",
      error: error.message,
    });
  } finally {
    if (client && client.close) client.close();
  }
});

/**
 * @route   GET /api/imagenes/progreso/tratamiento/:id
 * @desc    Obtener fotos de progreso de un tratamiento específico
 * @access  Private
 */
router.get("/progreso/tratamiento/:id", (req, res) => {
  const { id } = req.params;

  const query = `
        SELECT tf.*, t.nombre_tratamiento, 
               CONCAT(p.nombre, ' ', p.aPaterno, ' ', IFNULL(p.aMaterno, '')) as paciente_nombre
        FROM tratamiento_fotos tf
        JOIN tratamientos t ON tf.tratamiento_id = t.id
        LEFT JOIN pacientes p ON tf.paciente_id = p.id
        WHERE tf.tratamiento_id = ? AND tf.activa = TRUE
        ORDER BY 
            CASE tf.tipo 
                WHEN 'antes' THEN 1 
                WHEN 'durante' THEN 2 
                WHEN 'despues' THEN 3 
            END,
            tf.fecha_captura ASC
    `;

  db.query(query, [id], (err, results) => {
    if (err) {
      logger.error("Error al obtener fotos de progreso:", err);
      return res.status(500).json({
        success: false,
        message: "Error al obtener las fotos de progreso",
        error: err.message,
      });
    }

    // Organizar por tipo para facilitar el frontend
    const fotosPorTipo = {
      antes: [],
      durante: [],
      despues: [],
    };

    results.forEach((foto) => {
      fotosPorTipo[foto.tipo].push({
        id: foto.id,
        url: foto.imagen_url,
        nombre: foto.imagen_nombre,
        descripcion: foto.descripcion,
        fecha_captura: foto.fecha_captura,
        subido_por: foto.subido_por,
      });
    });

    res.json({
      success: true,
      data: {
        tratamiento_info:
          results.length > 0
            ? {
                id: id,
                nombre: results[0].nombre_tratamiento,
                paciente: results[0].paciente_nombre,
              }
            : null,
        fotos_por_tipo: fotosPorTipo,
        total_fotos: results.length,
      },
    });
  });
});

/**
 * @route   GET /api/imagenes/progreso/paciente/:id
 * @desc    Obtener todas las fotos de progreso de un paciente
 * @access  Private
 */
router.get("/progreso/paciente/:id", (req, res) => {
  const { id } = req.params;

  const query = `
        SELECT tf.*, t.nombre_tratamiento, t.estado as tratamiento_estado
        FROM tratamiento_fotos tf
        JOIN tratamientos t ON tf.tratamiento_id = t.id
        WHERE tf.paciente_id = ? AND tf.activa = TRUE
        ORDER BY tf.tratamiento_id, tf.fecha_captura DESC
    `;

  db.query(query, [id], (err, results) => {
    if (err) {
      logger.error("Error al obtener fotos del paciente:", err);
      return res.status(500).json({
        success: false,
        message: "Error al obtener las fotos del paciente",
        error: err.message,
      });
    }

    // Agrupar por tratamiento
    const fotosPorTratamiento = {};
    results.forEach((foto) => {
      if (!fotosPorTratamiento[foto.tratamiento_id]) {
        fotosPorTratamiento[foto.tratamiento_id] = {
          tratamiento_id: foto.tratamiento_id,
          nombre_tratamiento: foto.nombre_tratamiento,
          estado_tratamiento: foto.tratamiento_estado,
          fotos: {
            antes: [],
            durante: [],
            despues: [],
          },
        };
      }

      fotosPorTratamiento[foto.tratamiento_id].fotos[foto.tipo].push({
        id: foto.id,
        url: foto.imagen_url,
        nombre: foto.imagen_nombre,
        descripcion: foto.descripcion,
        fecha_captura: foto.fecha_captura,
        subido_por: foto.subido_por,
      });
    });

    res.json({
      success: true,
      data: Object.values(fotosPorTratamiento),
      total_fotos: results.length,
    });
  });
});

/**
 * @route   DELETE /api/imagenes/progreso/:id
 * @desc    Eliminar foto de progreso (soft delete)
 * @access  Private
 */
router.delete("/progreso/:id", (req, res) => {
  const { id } = req.params;

  // Primero obtener los datos de la foto
  db.query(
    "SELECT * FROM tratamiento_fotos WHERE id = ? AND activa = TRUE",
    [id],
    async (err, results) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Error al buscar la foto",
          error: err.message,
        });
      }

      if (results.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Foto no encontrada",
        });
      }

      const foto = results[0];

      try {
        // Eliminar del FTP
        const client = await connectToFTP();
        const fullPath = `${FTP_PROGRESS_DIR}/Tratamiento_${foto.tratamiento_id}/${foto.imagen_nombre}`;
        await client.remove(fullPath);
        client.close();

        // Marcar como inactiva en BD (soft delete)
        db.query(
          "UPDATE tratamiento_fotos SET activa = FALSE WHERE id = ?",
          [id],
          (err, result) => {
            if (err) {
              return res.status(500).json({
                success: false,
                message: "Error al eliminar la foto",
                error: err.message,
              });
            }

            logger.info(`Foto de progreso eliminada: ID ${id}`);
            res.json({
              success: true,
              message: "Foto eliminada correctamente",
            });
          }
        );
      } catch (error) {
        logger.error("Error al eliminar foto de FTP:", error);
        // Aún así marcamos como inactiva en BD
        db.query(
          "UPDATE tratamiento_fotos SET activa = FALSE WHERE id = ?",
          [id],
          (err, result) => {
            if (err) {
              return res.status(500).json({
                success: false,
                message: "Error al eliminar la foto",
                error: err.message,
              });
            }

            res.json({
              success: true,
              message:
                "Foto marcada como eliminada (puede requerir limpieza manual del servidor)",
            });
          }
        );
      }
    }
  );
});

/**
 * @route   GET /api/imagenes/progreso/stats/:tratamientoId
 * @desc    Obtener estadísticas de fotos de un tratamiento
 * @access  Private
 */
router.get("/progreso/stats/:tratamientoId", (req, res) => {
  const { tratamientoId } = req.params;

  const query = `
        SELECT 
            tipo,
            COUNT(*) as cantidad,
            MAX(fecha_captura) as ultima_foto
        FROM tratamiento_fotos 
        WHERE tratamiento_id = ? AND activa = TRUE
        GROUP BY tipo
    `;

  db.query(query, [tratamientoId], (err, results) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Error al obtener estadísticas",
        error: err.message,
      });
    }

    const stats = {
      antes: { cantidad: 0, ultima_foto: null },
      durante: { cantidad: 0, ultima_foto: null },
      despues: { cantidad: 0, ultima_foto: null },
      total: 0,
    };

    results.forEach((row) => {
      stats[row.tipo] = {
        cantidad: row.cantidad,
        ultima_foto: row.ultima_foto,
      };
      stats.total += row.cantidad;
    });

    res.json({
      success: true,
      data: stats,
    });
  });
});

module.exports = router;
