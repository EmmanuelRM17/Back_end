const express = require('express');
const db = require('../../db');
const router = express.Router();
const logger = require('../../utils/logger');

// Mapeo correcto de días de la semana
const daysMap = {
    0: 'Domingo',
    1: 'Lunes',
    2: 'Martes',
    3: 'Miércoles',
    4: 'Jueves',
    5: 'Viernes',
    6: 'Sábado'
};

// Obtener horarios disponibles para un odontólogo en una fecha específica
router.get('/disponibilidad', async (req, res) => {
    const { odontologo_id, fecha } = req.query;

    if (!odontologo_id || !fecha) {
        return res.status(400).json({ message: 'El ID del odontólogo y la fecha son obligatorios.' });
    }

    try {
        // Convertir la fecha a día de la semana con el formato correcto
        const diaSemana = daysMap[new Date(fecha).getDay()];

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

            if (result.length === 0) {
                return res.status(404).json({ message: 'No hay horarios disponibles para la fecha seleccionada.' });
            }

            res.status(200).json(result);
        });
    } catch (error) {
        logger.error('Error en la ruta /horarios/disponibilidad:', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

// Obtener los días laborales dinámicamente para un odontólogo
router.get('/dias_laborales', async (req, res) => {
    const { odontologo_id } = req.query;

    if (!odontologo_id) {
        return res.status(400).json({ message: 'El ID del odontólogo es obligatorio.' });
    }

    try {
        const sql = `
            SELECT DISTINCT dia_semana 
            FROM horarios 
            WHERE empleado_id = ?
        `;

        db.query(sql, [odontologo_id], (err, result) => {
            if (err) {
                logger.error('Error al obtener los días laborales:', err);
                return res.status(500).json({ message: 'Error al obtener los días laborales.' });
            }

            // Devolver solo los nombres de los días laborales
            const diasLaborales = result.map(row => row.dia_semana);
            res.status(200).json(diasLaborales);
        });
    } catch (error) {
        logger.error('Error en la ruta /horarios/dias_laborales:', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

module.exports = router;
