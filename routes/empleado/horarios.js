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
            LEFT JOIN citas c ON c.horario_id = h.id AND DATE(c.fecha_consulta) = ?
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

// NUEVOS ENDPOINTS

// Obtener todos los horarios
router.get('/', (req, res) => {
    try {
        const sql = `
            SELECT * FROM horarios 
            ORDER BY empleado_id, 
            CASE dia_semana 
                WHEN 'Lunes' THEN 1 
                WHEN 'Martes' THEN 2 
                WHEN 'Miércoles' THEN 3 
                WHEN 'Jueves' THEN 4 
                WHEN 'Viernes' THEN 5 
                WHEN 'Sábado' THEN 6 
                WHEN 'Domingo' THEN 7 
            END, hora_inicio
        `;

        db.query(sql, (err, result) => {
            if (err) {
                logger.error('Error al obtener todos los horarios:', err);
                return res.status(500).json({ message: 'Error al obtener los horarios.' });
            }

            res.status(200).json(result);
        });
    } catch (error) {
        logger.error('Error en la ruta GET /horarios:', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

// Obtener horarios por ID de empleado (formato para el frontend)
router.get('/empleado/:empleadoId', (req, res) => {
    const empleadoId = req.params.empleadoId;

    try {
        const sql = `
            SELECT * FROM horarios 
            WHERE empleado_id = ? 
            ORDER BY CASE dia_semana 
                WHEN 'Lunes' THEN 1 
                WHEN 'Martes' THEN 2 
                WHEN 'Miércoles' THEN 3 
                WHEN 'Jueves' THEN 4 
                WHEN 'Viernes' THEN 5 
                WHEN 'Sábado' THEN 6 
                WHEN 'Domingo' THEN 7 
            END, hora_inicio
        `;

        db.query(sql, [empleadoId], (err, result) => {
            if (err) {
                logger.error('Error al obtener horarios por empleado:', err);
                return res.status(500).json({ message: 'Error al obtener los horarios del empleado.' });
            }

            // Organizar los datos por día de la semana para el frontend
            const horariosPorDia = {
                Lunes: { activo: false, franjas: [] },
                Martes: { activo: false, franjas: [] },
                Miércoles: { activo: false, franjas: [] },
                Jueves: { activo: false, franjas: [] },
                Viernes: { activo: false, franjas: [] },
                Sábado: { activo: false, franjas: [] },
                Domingo: { activo: false, franjas: [] },
            };

            result.forEach(horario => {
                const dia = horario.dia_semana;

                // Si hay franjas para este día, marcarlo como activo
                if (!horariosPorDia[dia].activo) {
                    horariosPorDia[dia].activo = true;
                }

                // Ajustar formato de hora (eliminar segundos)
                let horaInicio = horario.hora_inicio;
                let horaFin = horario.hora_fin;

                // Si las horas vienen como objetos Date o tienen formato con segundos
                if (typeof horaInicio === 'object') {
                    horaInicio = horaInicio.toTimeString().slice(0, 5);
                } else if (horaInicio.length > 5) {
                    horaInicio = horaInicio.slice(0, 5);
                }

                if (typeof horaFin === 'object') {
                    horaFin = horaFin.toTimeString().slice(0, 5);
                } else if (horaFin.length > 5) {
                    horaFin = horaFin.slice(0, 5);
                }

                // Agregar la franja horaria
                horariosPorDia[dia].franjas.push({
                    id: horario.id,
                    hora_inicio: horaInicio,
                    hora_fin: horaFin,
                    duracion: horario.duracion
                });
            });

            res.status(200).json({
                empleado_id: empleadoId,
                horarios: horariosPorDia
            });
        });
    } catch (error) {
        logger.error('Error en la ruta /horarios/empleado/:empleadoId:', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

// Eliminar horarios por empleado
router.delete('/delete-by-empleado/:empleadoId', (req, res) => {
    const empleadoId = req.params.empleadoId;

    try {
        // Primero verificar si hay citas activas para estos horarios
        const checkSql = `
            SELECT COUNT(*) AS citasActivas 
            FROM citas c
            JOIN horarios h ON c.horario_id = h.id
            WHERE h.empleado_id = ? 
            AND c.estado NOT IN ('Cancelada', 'Completada')
        `;

        db.query(checkSql, [empleadoId], (checkErr, checkResult) => {
            if (checkErr) {
                logger.error('Error al verificar citas activas:', checkErr);
                return res.status(500).json({ message: 'Error al verificar citas.' });
            }

            if (checkResult[0].citasActivas > 0) {
                return res.status(400).json({
                    message: 'No se pueden eliminar los horarios porque hay citas activas programadas.'
                });
            }

            // Si no hay citas activas, proceder con la eliminación
            const deleteSql = 'DELETE FROM horarios WHERE empleado_id = ?';

            db.query(deleteSql, [empleadoId], (deleteErr, deleteResult) => {
                if (deleteErr) {
                    logger.error('Error al eliminar horarios:', deleteErr);
                    return res.status(500).json({ message: 'Error al eliminar los horarios.' });
                }

                res.status(200).json({
                    message: 'Horarios eliminados correctamente',
                    affectedRows: deleteResult.affectedRows
                });
            });
        });
    } catch (error) {
        logger.error('Error en la ruta DELETE /horarios/delete-by-empleado/:empleadoId:', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

// Crear múltiples horarios
router.post('/create-multiple', (req, res) => {
    const horarios = req.body;

    if (!Array.isArray(horarios) || horarios.length === 0) {
        return res.status(400).json({ message: 'Se requiere un array de horarios.' });
    }

    try {
        // Validar cada horario
        for (const horario of horarios) {
            if (!horario.empleado_id || !horario.dia_semana ||
                !horario.hora_inicio || !horario.hora_fin || !horario.duracion) {
                return res.status(400).json({
                    message: 'Todos los campos son obligatorios: empleado_id, dia_semana, hora_inicio, hora_fin, duracion'
                });
            }
        }

        // Crear query para inserción múltiple
        const sql = 'INSERT INTO horarios (empleado_id, dia_semana, hora_inicio, hora_fin, duracion) VALUES ?';

        // Preparar valores para inserción múltiple
        const values = horarios.map(h => [
            h.empleado_id,
            h.dia_semana,
            h.hora_inicio,
            h.hora_fin,
            h.duracion
        ]);

        db.query(sql, [values], (err, result) => {
            if (err) {
                logger.error('Error al crear horarios:', err);
                return res.status(500).json({ message: 'Error al crear los horarios.' });
            }

            res.status(201).json({
                message: 'Horarios creados correctamente',
                insertedCount: result.affectedRows
            });
        });
    } catch (error) {
        logger.error('Error en la ruta POST /horarios/create-multiple:', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});


module.exports = router;