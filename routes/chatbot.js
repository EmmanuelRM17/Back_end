const express = require('express');
const db = require('../../db');
const router = express.Router();
const logger = require('../../utils/logger');
const xss = require('xss'); // Para sanitización de entradas
const moment = require('moment-timezone');

router.get("/response", async (req, res) => {
    // Obtener parámetros de la query string
    const { category, message } = req.query;

    // Validar que los parámetros estén presentes
    if (!category || !message) {
        logger.warn('Solicitud a /response sin categoría o mensaje');
        return res.status(400).json({ error: 'Se requieren categoría y mensaje' });
    }

    // Sanitizar las entradas del usuario
    const sanitizedCategory = xss(category);
    const sanitizedMessage = xss(message);

    try {
        // Consultar la base de datos para obtener preguntas y respuestas de la categoría
        const [rows] = await db.promise().query(
            'SELECT pregunta, respuesta FROM chatbot WHERE categoria = ?',
            [sanitizedCategory]
        );

        // Si no hay resultados, devolver una respuesta por defecto
        if (rows.length === 0) {
            logger.info(`No se encontraron respuestas para la categoría: ${sanitizedCategory}`);
            return res.json({ respuesta: getDefaultResponse() });
        }

        // Preprocesar el mensaje del usuario (convertir a minúsculas y dividir en palabras)
        const userWords = new Set(sanitizedMessage.toLowerCase().split(/\s+/));

        let bestMatch = null;
        let maxSimilarity = 0;

        // Calcular similitud entre el mensaje del usuario y las preguntas de la base de datos
        for (const row of rows) {
            const preguntaWords = new Set(row.pregunta.toLowerCase().split(/\s+/));
            const intersection = new Set([...userWords].filter(x => preguntaWords.has(x)));
            const union = new Set([...userWords, ...preguntaWords]);
            const similarity = intersection.size / union.size;

            if (similarity > maxSimilarity) {
                maxSimilarity = similarity;
                bestMatch = row.respuesta;
            }
        }

        // Umbral de similitud (ajustable)
        const threshold = 0.2;
        if (maxSimilarity > threshold) {
            logger.info(`Respuesta encontrada para categoría: ${sanitizedCategory}, similitud: ${maxSimilarity}`);
            return res.json({ respuesta: bestMatch });
        } else {
            logger.info(`No se encontró coincidencia suficiente para categoría: ${sanitizedCategory}`);
            return res.json({ respuesta: getDefaultResponse() });
        }
    } catch (error) {
        logger.error('Error al procesar solicitud en /response:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Función para obtener una respuesta por defecto aleatoria
function getDefaultResponse() {
    const defaults = [
        "Lo siento, no he comprendido tu consulta. ¿Podrías reformularla?",
        "Disculpa, no entendí. ¿Puedes ser más específico?",
        "No logro entender tu mensaje. ¿Podrías intentarlo de otra forma?"
    ];
    return defaults[Math.floor(Math.random() * defaults.length)];
}

router.get("/precio", async (req, res) => {
    const { nombre } = req.query;

    if (!nombre) {
        return res.status(400).json({ error: "Parámetro 'nombre' requerido" });
    }

    try {
        const [servicios] = await db.promise().query(
            'SELECT title, price FROM servicios WHERE title LIKE ?',
            [`%${nombre}%`]
        );

        if (servicios.length === 0) {
            return res.json({ error: "Servicio no encontrado" });
        }

        res.json({
            servicio: servicios[0].title,
            precio: servicios[0].price
        });

    } catch (error) {
        console.error('Error al buscar servicio:', error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

module.exports = router;