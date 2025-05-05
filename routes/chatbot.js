const express = require("express");
const router = express.Router();
const db = require("../db");
const logger = require("../utils/logger");

/**
 * Procesa el mensaje del usuario y busca coincidencias en la BD
 */
async function procesarMensaje(mensaje, contexto) {
  try {
    // Normalizar el mensaje (convertir a minúsculas y quitar espacios extra)
    const mensajeNormalizado = mensaje.toLowerCase().trim();

    // Buscar en la base de datos si hay un patrón que coincida exactamente
    let query = "SELECT * FROM chatbot WHERE pattern = ?";
    let [coincidencias] = await db.query(query, [mensajeNormalizado]);

    // Si no hay coincidencias exactas, buscar coincidencias parciales
    if (coincidencias.length === 0) {
      // Buscar patrones que estén contenidos en el mensaje del usuario
      query = "SELECT * FROM chatbot WHERE ? LIKE CONCAT('%', pattern, '%')";
      [coincidencias] = await db.query(query, [mensajeNormalizado]);
    }

    let respuesta;
    let tipo;
    let subtipo = null;

    if (coincidencias && coincidencias.length > 0) {
      // Seleccionar la primera coincidencia (más específica)
      const coincidencia = coincidencias[0];
      tipo = coincidencia.type;

      // Modifica esta línea
      const opcionesRespuesta = coincidencia.response.split("||");
            // Seleccionar una respuesta aleatoria entre las disponibles
      const indiceRandom = Math.floor(Math.random() * opcionesRespuesta.length);
      respuesta = opcionesRespuesta[indiceRandom].trim();
    } else {
      // Respuesta por defecto si no hay coincidencias
      respuesta =
        "Lo siento, no entendí tu pregunta. ¿Podrías reformularla o preguntar algo sobre nuestros servicios dentales?";
      tipo = "desconocido";
    }

    return {
      respuesta,
      tipo,
      subtipo,
      entidades: {}, // Puedes implementar extracción de entidades más adelante
      contexto: {
        ...contexto,
        ultimo_tipo: tipo,
      },
    };
  } catch (error) {
    logger.error(`Error en procesarMensaje: ${error.message}`);
    return {
      respuesta:
        "Lo siento, ocurrió un error al procesar tu mensaje. Por favor, intenta nuevamente.",
      tipo: "error",
      subtipo: "error_sistema",
      entidades: {},
      contexto,
    };
  }
}

// Endpoint principal para procesar mensajes del chatbot
router.post("/mensaje", async (req, res) => {
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

    // Procesamos el mensaje y obtenemos respuesta
    const respuesta = await procesarMensaje(mensaje, contextoActualizado);

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
