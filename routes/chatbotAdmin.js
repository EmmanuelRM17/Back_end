const express = require("express");
const router = express.Router();
const db = require("../../db");
const logger = require("../../utils/logger");

// Middleware para verificar que el usuario sea administrador
const isAdmin = (req, res, next) => {
  if (!req.user || req.user.tipo !== "administrador") {
    return res.status(403).json({ error: "Acceso denegado. Se requieren permisos de administrador." });
  }
  next();
};

// Función para ejecutar consultas a la base de datos (Promise)
const executeQuery = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) {
        logger.error(`Error en consulta SQL: ${err.message}`);
        reject(err);
        return;
      }
      resolve(results);
    });
  });
};

/**
 * Obtener todas las intenciones del chatbot
 */
router.get("/intenciones", isAdmin, async (req, res) => {
  try {
    const query = "SELECT * FROM chatbot_intenciones ORDER BY categoria, prioridad DESC";
    const intenciones = await executeQuery(query);
    
    return res.json({ intenciones });
  } catch (error) {
    logger.error(`Error al obtener intenciones: ${error.message}`);
    return res.status(500).json({ error: "Error al obtener intenciones" });
  }
});

/**
 * Obtener una intención específica por ID
 */
router.get("/intenciones/:id", isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = "SELECT * FROM chatbot_intenciones WHERE id = ?";
    const intenciones = await executeQuery(query, [id]);
    
    if (intenciones.length === 0) {
      return res.status(404).json({ error: "Intención no encontrada" });
    }
    
    // Obtener respuestas asociadas a esta intención
    const queryRespuestas = "SELECT * FROM chatbot_respuestas WHERE intencion_id = ?";
    const respuestas = await executeQuery(queryRespuestas, [id]);
    
    return res.json({ 
      intencion: intenciones[0],
      respuestas: respuestas 
    });
  } catch (error) {
    logger.error(`Error al obtener intención: ${error.message}`);
    return res.status(500).json({ error: "Error al obtener intención" });
  }
});

/**
 * Crear una nueva intención
 */
router.post("/intenciones", isAdmin, async (req, res) => {
  try {
    const { 
      patron, 
      categoria, 
      tabla_consulta = null, 
      campo_consulta = null, 
      condicion = null,
      prioridad = 5
    } = req.body;
    
    // Validaciones
    if (!patron || !categoria) {
      return res.status(400).json({ error: "El patrón y la categoría son obligatorios" });
    }
    
    // Insertar la nueva intención
    const query = `
      INSERT INTO chatbot_intenciones
      (patron, categoria, tabla_consulta, campo_consulta, condicion, prioridad)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    const result = await executeQuery(
      query, 
      [patron, categoria, tabla_consulta, campo_consulta, condicion, prioridad]
    );
    
    return res.status(201).json({ 
      id: result.insertId,
      mensaje: "Intención creada con éxito" 
    });
  } catch (error) {
    logger.error(`Error al crear intención: ${error.message}`);
    return res.status(500).json({ error: "Error al crear intención" });
  }
});

/**
 * Actualizar una intención existente
 */
router.put("/intenciones/:id", isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      patron, 
      categoria, 
      tabla_consulta = null, 
      campo_consulta = null, 
      condicion = null,
      prioridad
    } = req.body;
    
    // Validaciones
    if (!patron || !categoria) {
      return res.status(400).json({ error: "El patrón y la categoría son obligatorios" });
    }
    
    // Verificar que la intención exista
    const checkQuery = "SELECT id FROM chatbot_intenciones WHERE id = ?";
    const checkResult = await executeQuery(checkQuery, [id]);
    
    if (checkResult.length === 0) {
      return res.status(404).json({ error: "Intención no encontrada" });
    }
    
    // Actualizar la intención
    const query = `
      UPDATE chatbot_intenciones
      SET patron = ?, categoria = ?, tabla_consulta = ?, 
          campo_consulta = ?, condicion = ?, prioridad = ?
      WHERE id = ?
    `;
    
    await executeQuery(
      query, 
      [patron, categoria, tabla_consulta, campo_consulta, condicion, prioridad, id]
    );
    
    return res.json({ mensaje: "Intención actualizada con éxito" });
  } catch (error) {
    logger.error(`Error al actualizar intención: ${error.message}`);
    return res.status(500).json({ error: "Error al actualizar intención" });
  }
});

/**
 * Eliminar una intención
 */
router.delete("/intenciones/:id", isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Eliminar primero las respuestas asociadas (por la restricción de clave foránea)
    const deleteRespuestasQuery = "DELETE FROM chatbot_respuestas WHERE intencion_id = ?";
    await executeQuery(deleteRespuestasQuery, [id]);
    
    // Luego eliminar la intención
    const deleteIntencionQuery = "DELETE FROM chatbot_intenciones WHERE id = ?";
    const result = await executeQuery(deleteIntencionQuery, [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Intención no encontrada" });
    }
    
    return res.json({ mensaje: "Intención eliminada con éxito" });
  } catch (error) {
    logger.error(`Error al eliminar intención: ${error.message}`);
    return res.status(500).json({ error: "Error al eliminar intención" });
  }
});

/**
 * Obtener todas las respuestas
 */
router.get("/respuestas", isAdmin, async (req, res) => {
  try {
    const query = `
      SELECT r.*, i.patron, i.categoria
      FROM chatbot_respuestas r
      JOIN chatbot_intenciones i ON r.intencion_id = i.id
      ORDER BY r.intencion_id, r.contexto
    `;
    
    const respuestas = await executeQuery(query);
    
    return res.json({ respuestas });
  } catch (error) {
    logger.error(`Error al obtener respuestas: ${error.message}`);
    return res.status(500).json({ error: "Error al obtener respuestas" });
  }
});

/**
 * Crear una nueva respuesta
 */
router.post("/respuestas", isAdmin, async (req, res) => {
  try {
    const { 
      intencion_id, 
      respuesta, 
      contexto = "default", 
      es_plantilla = 0,
      activo = 1
    } = req.body;
    
    // Validaciones
    if (!intencion_id || !respuesta) {
      return res.status(400).json({ error: "La intención y la respuesta son obligatorias" });
    }
    
    // Verificar que la intención exista
    const checkQuery = "SELECT id FROM chatbot_intenciones WHERE id = ?";
    const checkResult = await executeQuery(checkQuery, [intencion_id]);
    
    if (checkResult.length === 0) {
      return res.status(404).json({ error: "Intención no encontrada" });
    }
    
    // Insertar la nueva respuesta
    const query = `
      INSERT INTO chatbot_respuestas
      (intencion_id, respuesta, contexto, es_plantilla, activo)
      VALUES (?, ?, ?, ?, ?)
    `;
    
    const result = await executeQuery(
      query, 
      [intencion_id, respuesta, contexto, es_plantilla, activo]
    );
    
    return res.status(201).json({ 
      id: result.insertId,
      mensaje: "Respuesta creada con éxito" 
    });
  } catch (error) {
    logger.error(`Error al crear respuesta: ${error.message}`);
    return res.status(500).json({ error: "Error al crear respuesta" });
  }
});

/**
 * Actualizar una respuesta existente
 */
router.put("/respuestas/:id", isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      respuesta, 
      contexto, 
      es_plantilla,
      activo
    } = req.body;
    
    // Validaciones
    if (!respuesta) {
      return res.status(400).json({ error: "La respuesta es obligatoria" });
    }
    
    // Verificar que la respuesta exista
    const checkQuery = "SELECT id FROM chatbot_respuestas WHERE id = ?";
    const checkResult = await executeQuery(checkQuery, [id]);
    
    if (checkResult.length === 0) {
      return res.status(404).json({ error: "Respuesta no encontrada" });
    }
    
    // Actualizar la respuesta
    const query = `
      UPDATE chatbot_respuestas
      SET respuesta = ?, contexto = ?, es_plantilla = ?, activo = ?
      WHERE id = ?
    `;
    
    await executeQuery(
      query, 
      [respuesta, contexto, es_plantilla, activo, id]
    );
    
    return res.json({ mensaje: "Respuesta actualizada con éxito" });
  } catch (error) {
    logger.error(`Error al actualizar respuesta: ${error.message}`);
    return res.status(500).json({ error: "Error al actualizar respuesta" });
  }
});

/**
 * Eliminar una respuesta
 */
router.delete("/respuestas/:id", isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = "DELETE FROM chatbot_respuestas WHERE id = ?";
    const result = await executeQuery(query, [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Respuesta no encontrada" });
    }
    
    return res.json({ mensaje: "Respuesta eliminada con éxito" });
  } catch (error) {
    logger.error(`Error al eliminar respuesta: ${error.message}`);
    return res.status(500).json({ error: "Error al eliminar respuesta" });
  }
});

/**
 * Obtener estadísticas del chatbot
 */
router.get("/estadisticas", isAdmin, async (req, res) => {
  try {
    // Obtener estadísticas
    const stats = {};
    
    // Contar intenciones por categoría
    const intencionesQuery = `
      SELECT categoria, COUNT(*) as total 
      FROM chatbot_intenciones 
      GROUP BY categoria
    `;
    
    stats.intenciones = await executeQuery(intencionesQuery);
    
    // Contar respuestas por contexto
    const respuestasQuery = `
      SELECT contexto, COUNT(*) as total 
      FROM chatbot_respuestas 
      GROUP BY contexto
    `;
    
    stats.respuestas = await executeQuery(respuestasQuery);
    
    // Conteos generales
    const countQuery = `
      SELECT 
        (SELECT COUNT(*) FROM chatbot_intenciones) AS total_intenciones,
        (SELECT COUNT(*) FROM chatbot_respuestas) AS total_respuestas,
        (SELECT COUNT(DISTINCT contexto) FROM chatbot_respuestas) AS total_contextos
    `;
    
    const counts = await executeQuery(countQuery);
    stats.conteos = counts[0];
    
    return res.json(stats);
  } catch (error) {
    logger.error(`Error al obtener estadísticas: ${error.message}`);
    return res.status(500).json({ error: "Error al obtener estadísticas" });
  }
});

/**
 * Probar el chatbot con un mensaje específico
 */
router.post("/probar", isAdmin, async (req, res) => {
  try {
    const { mensaje, contexto = "default" } = req.body;
    
    if (!mensaje) {
      return res.status(400).json({ error: "El mensaje es obligatorio" });
    }
    
    // Normalizar el mensaje
    const mensajeNormalizado = mensaje.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    
    // Buscar intenciones que coincidan
    const intencionesQuery = `
      SELECT * FROM chatbot_intenciones 
      WHERE ? LIKE CONCAT('%', patron, '%') 
      ORDER BY prioridad DESC, LENGTH(patron) DESC
    `;
    
    const intenciones = await executeQuery(intencionesQuery, [mensajeNormalizado]);
    
    if (intenciones.length === 0) {
      return res.json({
        intencion: null,
        respuesta: "No se encontró ninguna intención que coincida con el mensaje",
        coincidencias: []
      });
    }
    
    // Obtener respuestas para la intención principal
    const respuestasQuery = `
      SELECT * FROM chatbot_respuestas
      WHERE intencion_id = ? AND contexto = ? AND activo = 1
      ORDER BY RAND() LIMIT 3
    `;
    
    const respuestas = await executeQuery(respuestasQuery, [intenciones[0].id, contexto]);
    
    // Si no hay respuestas para ese contexto, buscar en default
    let respuestasDefault = [];
    if (respuestas.length === 0 && contexto !== "default") {
      const defaultQuery = `
        SELECT * FROM chatbot_respuestas
        WHERE intencion_id = ? AND contexto = 'default' AND activo = 1
        ORDER BY RAND() LIMIT 3
      `;
      
      respuestasDefault = await executeQuery(defaultQuery, [intenciones[0].id]);
    }
    
    return res.json({
      intencion: intenciones[0],
      respuestas: respuestas.length > 0 ? respuestas : respuestasDefault,
      coincidencias: intenciones.slice(0, 5), // Mostrar hasta 5 coincidencias
      mensaje_normalizado: mensajeNormalizado
    });
  } catch (error) {
    logger.error(`Error al probar chatbot: ${error.message}`);
    return res.status(500).json({ error: "Error al probar chatbot" });
  }
});

/**
 * Importar datos del chatbot (como respaldo)
 */
router.post("/importar", isAdmin, async (req, res) => {
  try {
    const { intenciones, respuestas, reemplazar = false } = req.body;
    
    if (!intenciones || !Array.isArray(intenciones) || !respuestas || !Array.isArray(respuestas)) {
      return res.status(400).json({ error: "Formato inválido. Se requieren arrays de intenciones y respuestas" });
    }
    
    // Iniciar transacción
    await executeQuery("START TRANSACTION");
    
    try {
      // Si se indica reemplazar, eliminar datos existentes
      if (reemplazar) {
        await executeQuery("DELETE FROM chatbot_respuestas");
        await executeQuery("DELETE FROM chatbot_intenciones");
      }
      
      // Mapa para registrar los IDs nuevos
      const idMap = {};
      
      // Importar intenciones
      for (const intencion of intenciones) {
        const { id: oldId, patron, categoria, tabla_consulta, campo_consulta, condicion, prioridad } = intencion;
        
        const query = `
          INSERT INTO chatbot_intenciones
          (patron, categoria, tabla_consulta, campo_consulta, condicion, prioridad)
          VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        const result = await executeQuery(
          query, 
          [patron, categoria, tabla_consulta, campo_consulta, condicion, prioridad]
        );
        
        // Guardar mapeo de ID viejo a nuevo
        idMap[oldId] = result.insertId;
      }
      
      // Importar respuestas
      for (const respuesta of respuestas) {
        const { intencion_id, respuesta: textoRespuesta, contexto, es_plantilla, activo } = respuesta;
        
        // Usar el nuevo ID mapeado
        const nuevoIntencionId = idMap[intencion_id];
        
        if (!nuevoIntencionId) {
          continue; // Omitir si no hay mapeo (podría pasar si los datos son inconsistentes)
        }
        
        const query = `
          INSERT INTO chatbot_respuestas
          (intencion_id, respuesta, contexto, es_plantilla, activo)
          VALUES (?, ?, ?, ?, ?)
        `;
        
        await executeQuery(
          query, 
          [nuevoIntencionId, textoRespuesta, contexto, es_plantilla, activo]
        );
      }
      
      // Confirmar transacción
      await executeQuery("COMMIT");
      
      return res.json({ 
        mensaje: "Datos importados con éxito",
        intenciones_importadas: intenciones.length,
        respuestas_importadas: respuestas.length
      });
      
    } catch (error) {
      // Revertir transacción en caso de error
      await executeQuery("ROLLBACK");
      throw error;
    }
    
  } catch (error) {
    logger.error(`Error al importar datos: ${error.message}`);
    return res.status(500).json({ error: "Error al importar datos" });
  }
});

/**
 * Exportar datos del chatbot (como respaldo)
 */
router.get("/exportar", isAdmin, async (req, res) => {
  try {
    // Obtener todas las intenciones
    const intencionesQuery = "SELECT * FROM chatbot_intenciones ORDER BY id";
    const intenciones = await executeQuery(intencionesQuery);
    
    // Obtener todas las respuestas
    const respuestasQuery = "SELECT * FROM chatbot_respuestas ORDER BY intencion_id, id";
    const respuestas = await executeQuery(respuestasQuery);
    
    return res.json({
      fecha_exportacion: new Date().toISOString(),
      intenciones,
      respuestas,
      stats: {
        total_intenciones: intenciones.length,
        total_respuestas: respuestas.length
      }
    });
    
  } catch (error) {
    logger.error(`Error al exportar datos: ${error.message}`);
    return res.status(500).json({ error: "Error al exportar datos" });
  }
});

module.exports = router;