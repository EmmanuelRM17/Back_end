const express = require("express");
const router = express.Router();
const db = require("../db");
const logger = require("../utils/logger");
/**
 * Procesa el mensaje del usuario y busca coincidencias en la BD usando callbacks
 */
function procesarMensaje(mensaje, contexto, callback) {
  try {
    // Normalizar el mensaje (convertir a minúsculas y quitar espacios extra)
    const mensajeNormalizado = mensaje.toLowerCase().trim();

    // Buscar en la base de datos si hay un patrón que coincida exactamente
    let query = "SELECT * FROM chatbot WHERE pattern = ?";
    
    // Usando callbacks en lugar de promesas
    db.query(query, [mensajeNormalizado], (err, coincidencias) => {
      if (err) {
        logger.error(`Error en consulta SQL: ${err.message}`);
        return callback({
          respuesta: "Lo siento, ocurrió un error al procesar tu mensaje. Por favor, intenta nuevamente.",
          tipo: "error",
          subtipo: "error_sistema",
          entidades: {},
          contexto
        });
      }

      // Si no hay coincidencias exactas, buscar coincidencias parciales
      if (!coincidencias || coincidencias.length === 0) {
        // Buscar patrones que estén contenidos en el mensaje del usuario
        query = "SELECT * FROM chatbot WHERE ? LIKE CONCAT('%', pattern, '%')";
        
        db.query(query, [mensajeNormalizado], (err, coincidenciasParciales) => {
          if (err) {
            logger.error(`Error en consulta SQL (parcial): ${err.message}`);
            return callback({
              respuesta: "Lo siento, ocurrió un error al procesar tu mensaje. Por favor, intenta nuevamente.",
              tipo: "error",
              subtipo: "error_sistema",
              entidades: {},
              contexto
            });
          }
          
          // Procesar el resultado
          procesarResultados(coincidenciasParciales, contexto, callback);
        });
      } else {
        // Procesar el resultado
        procesarResultados(coincidencias, contexto, callback);
      }
    });
  } catch (error) {
    logger.error(`Error en procesarMensaje: ${error.message}`);
    callback({
      respuesta: "Lo siento, ocurrió un error al procesar tu mensaje. Por favor, intenta nuevamente.",
      tipo: "error",
      subtipo: "error_sistema",
      entidades: {},
      contexto
    });
  }
}

/**
 * Procesa los resultados de la consulta
 */
function procesarResultados(coincidencias, contexto, callback) {
  let respuesta;
  let tipo;
  let subtipo = null;

  if (coincidencias && coincidencias.length > 0) {
    // Seleccionar la primera coincidencia (más específica)
    const coincidencia = coincidencias[0];
    tipo = coincidencia.type;

    // Verificar ambos campos para compatibilidad
    const respuestaTexto = coincidencia.responses || coincidencia.response;
    
    if (respuestaTexto) {
      const opcionesRespuesta = respuestaTexto.split("||");
      // Seleccionar una respuesta aleatoria entre las disponibles
      const indiceRandom = Math.floor(Math.random() * opcionesRespuesta.length);
      respuesta = opcionesRespuesta[indiceRandom].trim();
    } else {
      // Si no se encuentra el campo, usar respuesta por defecto
      respuesta = "Lo siento, parece que hay un problema con mi configuración. Por favor, intenta nuevamente.";
      tipo = "error";
      console.error("Error: No se encontró el campo de respuesta en la coincidencia", coincidencia);
    }
  } else {
    // Respuesta por defecto si no hay coincidencias
    respuesta = "Lo siento, no entendí tu pregunta. ¿Podrías reformularla o preguntar algo sobre nuestros servicios dentales?";
    tipo = "desconocido";
  }

  callback({
    respuesta,
    tipo,
    subtipo,
    entidades: {}, // Puedes implementar extracción de entidades más adelante
    contexto: {
      ...contexto,
      ultimo_tipo: tipo,
    },
  });
}

// Endpoint principal para procesar mensajes del chatbot
router.post("/mensaje", (req, res) => {
  try {
    const { mensaje, contexto = {} } = req.body;

    // Validación básica
    if (!mensaje || mensaje.trim() === "") {
      return res.status(400).json({
        error: "El mensaje no puede estar vacío",
        status: "error",
      });
    }

    // Mejorar el manejo de contexto
    const contextoActualizado = {
      ...contexto,
      ultimas_entidades: contexto.entidades || {},
      ultimo_mensaje: contexto.mensaje || "",
      contador_interacciones: (contexto.contador_interacciones || 0) + 1,
    };

    // Procesamos el mensaje y obtenemos respuesta usando callback
    procesarMensaje(mensaje, contextoActualizado, (respuesta) => {
      // Actualizar contexto para la siguiente interacción
      const nuevoContexto = {
        ...respuesta.contexto,
        mensaje: mensaje,
        entidades: respuesta.entidades,
        tipo_respuesta: respuesta.tipo,
        timestamp: new Date().toISOString(),
      };

      logger.info(
        `Mensaje procesado: "${mensaje.substring(0, 50)}..." - Tipo: ${
          respuesta.tipo
        }`
      );

      return res.json({
        respuesta: respuesta.respuesta,
        tipo: respuesta.tipo,
        subtipo: respuesta.subtipo,
        contexto: nuevoContexto,
      });
    });
  } catch (error) {
    logger.error(`Error en /chatbot/mensaje: ${error.message}`);
    return res.status(500).json({
      error: "Error al procesar el mensaje",
      respuesta:
        "Lo siento, tuve un problema al procesar tu consulta. ¿Podrías intentarlo de nuevo?",
      tipo: "error",
      status: "error",
    });
  }
});
module.exports = router;
