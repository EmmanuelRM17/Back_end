// rutas/horarios.js

const express = require('express');
const db = require('../../db');
const router = express.Router();
const logger = require('../../utils/logger');

// Obtener horarios disponibles para un odontólogo en una fecha específica
router.get('/disponibilidad', async (req, res) => {
    const { odontologo_id, fecha } = req.query;

    if (!odontologo_id || !fecha) {
        return res.status(400).json({ message: 'El ID del odontólogo y la fecha son obligatorios.' });
    }

    try {
        const diaSemana = new Date(fecha).toLocaleString('es-ES', { weekday: 'long' });

        const sql = `
            SELECT h.id AS horario_id, h.hora_inicio, h.hora_fin, h.duracion
            FROM horarios h
            LEFT JOIN citas c ON c.horario_id = h.id AND DATE(c.fecha_hora) = ?
            WHERE h.empleado_id = ? 
            AND h.dia_semana = ?
            AND (c.id IS NULL OR c.estado IN ('Cancelada', 'Completada'))
            ORDER BY h.hora_inicio;
        `;

        db.query(sql, [fecha, odontologo_id, diaSemana], (err, result) => {
            if (err) {
                logger.error('Error al obtener horarios disponibles:', err);
                return res.status(500).json({ message: 'Error al obtener disponibilidad.' });
            }
            res.status(200).json(result);
        });
    } catch (error) {
        logger.error('Error en la ruta /horarios/disponibilidad:', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

module.exports = router;
