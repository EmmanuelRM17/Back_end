const express = require("express");
const router = express.Router();
const db = require("../db");
const logger = require("../utils/logger");

// Función para ejecutar consultas a la base de datos como Promesas
const executeQuery = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) {
        logger.error(`Error en consulta SQL: ${err.message}, Query: ${query.substring(0, 100)}...`);
        reject(err);
        return;
      }
      
      // Verificar si los resultados están vacíos y devolver un array vacío en lugar de undefined
      resolve(results || []);
    });
  });
};

// Función para buscar patrones en la BD - Modificada para buscar cualquier patrón
const buscarPatron = async (mensaje) => {
  try {
    // Normalizar el mensaje (minúsculas, sin espacios extras)
    const mensajeNormalizado = mensaje.toLowerCase().trim();
    
    // Consultar la tabla de chatbot para buscar coincidencias con cualquier patrón
    const query = `
      SELECT * FROM chatbot 
      WHERE 
        patron = ? OR 
        ? LIKE CONCAT('%', patron, '%')
      ORDER BY prioridad DESC, LENGTH(patron) DESC
      LIMIT 1
    `;
    
    const resultados = await executeQuery(query, [mensajeNormalizado, mensajeNormalizado]);
    
    // Si encontramos un patrón, devolver su información
    if (resultados && resultados.length > 0) {
      return resultados[0];
    }
    
    return null;
  } catch (error) {
    logger.error(`Error al buscar patrón: ${error.message}`);
    throw error;
  }
};

// Función para obtener una respuesta aleatoria del conjunto de respuestas
const obtenerRespuestaAleatoria = (respuestas) => {
  if (!respuestas) return "¡Hola! Bienvenido a Odontología Carol. ¿Cómo puedo ayudarte hoy?";
  
  // Dividir las respuestas (están separadas por |||)
  const arrayRespuestas = respuestas.split('|||').map(r => r.trim());
  
  // Elegir una respuesta aleatoria
  const indiceAleatorio = Math.floor(Math.random() * arrayRespuestas.length);
  return arrayRespuestas[indiceAleatorio];
};

// Función principal para procesar los mensajes - Modificada para manejar todos los tipos de patrones
const procesarMensaje = async (mensaje, contexto) => {
  try {
    // Por defecto, preparamos una respuesta genérica
    let respuesta = {
      respuesta: "Lo siento, no entiendo tu mensaje. ¿Puedo ayudarte con algo sobre Odontología Carol?",
      tipo: "General",
      subtipo: "no_entendido",
      contexto: contexto || {}
    };
    
    // Buscar si el mensaje coincide con algún patrón
    const patronEncontrado = await buscarPatron(mensaje);
    
    if (patronEncontrado) {
      // Si encontramos un patrón, generamos una respuesta
      const respuestaAleatoria = obtenerRespuestaAleatoria(patronEncontrado.respuestas);
      
      respuesta = {
        respuesta: respuestaAleatoria,
        tipo: patronEncontrado.categoria,
        subtipo: patronEncontrado.patron, // Usamos el patrón como subtipo
        datos: {
          patron_detectado: patronEncontrado.patron,
          prioridad: patronEncontrado.prioridad,
          categoria: patronEncontrado.categoria
        },
        contexto: {
          ...contexto,
          ultimo_patron: patronEncontrado.patron,
          ultima_categoria: patronEncontrado.categoria
        }
      };
      
      logger.info(`Patrón detectado: "${patronEncontrado.patron}" - Categoría: "${patronEncontrado.categoria}" - Respondiendo`);
    } else {
      logger.info(`No se detectó patrón en el mensaje: "${mensaje.substring(0, 30)}..."`);
    }
    
    return respuesta;
  } catch (error) {
    logger.error(`Error al procesar mensaje: ${error.message}`);
    throw error;
  }
};

// Endpoint principal para procesar mensajes del chatbot
router.post("/mensaje", async (req, res) => {
  try {
    const { mensaje, contexto = {} } = req.body;
    
    // Validación básica
    if (!mensaje || mensaje.trim() === "") {
      return res.status(400).json({
        error: "El mensaje no puede estar vacío",
        status: "error"
      });
    }
    
    // Mejorar el manejo de contexto
    const contextoActualizado = {
      ...contexto,
      ultimas_entidades: contexto.entidades || {},
      ultimo_mensaje: contexto.mensaje || "",
      contador_interacciones: (contexto.contador_interacciones || 0) + 1
    };
    
    // Procesamos el mensaje y obtenemos respuesta
    const respuesta = await procesarMensaje(mensaje, contextoActualizado);
    
    // Actualizar contexto para la siguiente interacción
    const nuevoContexto = {
      ...respuesta.contexto,
      mensaje: mensaje,
      entidades: respuesta.entidades,
      tipo_respuesta: respuesta.tipo,
      timestamp: new Date().toISOString()
    };
    
    logger.info(`Mensaje procesado: "${mensaje.substring(0, 50)}..." - Tipo: ${respuesta.tipo}`);
    
    return res.json({
      ...respuesta,
      contexto: nuevoContexto
    });
    
  } catch (error) {
    logger.error(`Error en /chatbot/mensaje: ${error.message}`);
    return res.status(500).json({
      error: "Error al procesar el mensaje",
      mensaje: "Lo siento, tuve un problema al procesar tu consulta. ¿Podrías intentarlo de nuevo?",
      status: "error"
    });
  }
});

// Endpoint adicional para obtener patrones disponibles (útil para pruebas)
router.get("/patrones", async (req, res) => {
  try {
    const query = `
      SELECT id, patron, categoria, prioridad 
      FROM chatbot 
      ORDER BY categoria, prioridad DESC, patron ASC
    `;
    
    const patrones = await executeQuery(query);
    
    return res.json({
      patrones,
      total: patrones.length,
      status: "success"
    });
  } catch (error) {
    logger.error(`Error en /chatbot/patrones: ${error.message}`);
    return res.status(500).json({
      error: "Error al consultar patrones",
      status: "error"
    });
  }
});

module.exports = router;