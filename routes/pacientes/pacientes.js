const express = require('express');
const db = require('../../db');
const router = express.Router();
const logger = require('../../utils/logger');
const xss = require('xss'); // Protección contra XSS
const moment = require('moment-timezone');

router.get('/exists', async (req, res) => {
    const { email } = req.query;

    if (!email) {
        return res.status(400).json({ message: 'El correo electrónico es obligatorio.' });
    }

    try {
        const sanitizedEmail = xss(email);

        // Consulta para obtener todos los datos del paciente por su correo
        const query = 'SELECT * FROM pacientes WHERE email = ? LIMIT 1';
        db.query(query, [sanitizedEmail], (err, result) => {
            if (err) {
                logger.error('Error al obtener el paciente en la BDD: ', err);
                return res.status(500).json({ message: 'Error al obtener el paciente en la base de datos.' });
            }

            if (result.length > 0) {
                // Si se encuentra un paciente, se devuelven todos sus datos
                res.json({ exists: true, data: result[0] });
            } else {
                // Si no se encuentra el paciente
                res.json({ exists: false, data: null });
            }
        });
    } catch (error) {
        logger.error('Error en el endpoint /pacientes/exists: ', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

// ✅ Obtener todos los pacientes
router.get('/all', async (req, res) => {
    try {
        const query = `
            SELECT * FROM pacientes
            ORDER BY fecha_creacion DESC;
        `;

        const [results] = await db.promise().query(query);

        if (!results || results.length === 0) {
            return res.status(404).json({ message: 'No hay pacientes registrados.' });
        }

        res.json(results);
    } catch (error) {
        logger.error('Error al obtener pacientes:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// ✅ Obtener un paciente por ID
router.get('/:id', async (req, res) => {
    const { id } = req.params;

    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID inválido.' });
    }

    try {
        const query = 'SELECT * FROM pacientes WHERE id = ? LIMIT 1';
        const [result] = await db.promise().query(query, [id]);

        if (result.length === 0) {
            return res.status(404).json({ message: 'Paciente no encontrado.' });
        }

        res.json(result[0]);
    } catch (error) {
        logger.error('Error al obtener paciente por ID:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// ✅ Crear un nuevo paciente
router.post('/create', async (req, res) => {
    const {
        nombre, aPaterno, aMaterno, tipoTutor, nombreTutor, genero, lugar,
        fechaNacimiento, telefono, email, alergias, estado
    } = req.body;

    if (!nombre || !aPaterno || !genero || !fechaNacimiento || !email) {
        return res.status(400).json({ message: 'Los campos obligatorios no están completos.' });
    }

    try {
        const fecha_creacion = moment().tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss');

        const insertQuery = `
            INSERT INTO pacientes (
                nombre, aPaterno, aMaterno, tipoTutor, nombreTutor, genero, lugar,
                fechaNacimiento, telefono, email, alergias, estado, fecha_creacion
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            xss(nombre), xss(aPaterno), xss(aMaterno) || null, xss(tipoTutor) || null,
            xss(nombreTutor) || null, xss(genero), xss(lugar) || null, fechaNacimiento,
            xss(telefono) || null, xss(email), xss(alergias) || null, xss(estado) || 'Pendiente',
            fecha_creacion
        ];

        const [result] = await db.promise().query(insertQuery, values);
        res.status(201).json({ message: 'Paciente creado correctamente.', paciente_id: result.insertId });
    } catch (error) {
        logger.error('Error al crear paciente:', error);
        res.status(500).json({ message: 'Error al registrar el paciente.' });
    }
});

// ✅ Actualizar datos de un paciente
router.put('/update/:id', async (req, res) => {
    const { id } = req.params;
    const {
        nombre, aPaterno, aMaterno, tipoTutor, nombreTutor, genero, lugar,
        fechaNacimiento, telefono, email, alergias, estado
    } = req.body;

    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID inválido.' });
    }

    try {
        const updateQuery = `
            UPDATE pacientes 
            SET 
                nombre = ?, aPaterno = ?, aMaterno = ?, tipoTutor = ?, nombreTutor = ?, 
                genero = ?, lugar = ?, fechaNacimiento = ?, telefono = ?, email = ?, 
                alergias = ?, estado = ?, ultima_actualizacion = CURRENT_TIMESTAMP
            WHERE id = ?
        `;

        const values = [
            xss(nombre), xss(aPaterno), xss(aMaterno) || null, xss(tipoTutor) || null,
            xss(nombreTutor) || null, xss(genero), xss(lugar) || null, fechaNacimiento,
            xss(telefono) || null, xss(email), xss(alergias) || null, xss(estado),
            parseInt(id)
        ];

        const [result] = await db.promise().query(updateQuery, values);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'No se encontró el paciente.' });
        }

        res.json({ message: 'Paciente actualizado correctamente.' });
    } catch (error) {
        logger.error('Error al actualizar paciente:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// ✅ Eliminar un paciente
router.delete('/delete/:id', async (req, res) => {
    const { id } = req.params;

    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID inválido.' });
    }

    try {
        const deleteQuery = 'DELETE FROM pacientes WHERE id = ?';
        const [result] = await db.promise().query(deleteQuery, [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'No se encontró el paciente.' });
        }

        res.json({ message: 'Paciente eliminado correctamente.' });
    } catch (error) {
        logger.error('Error al eliminar paciente:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// ✅ Verificar si un paciente existe por correo
router.get('/exists', async (req, res) => {
    const { email } = req.query;

    if (!email) {
        return res.status(400).json({ message: 'El correo electrónico es obligatorio.' });
    }

    try {
        const sanitizedEmail = xss(email);
        const query = 'SELECT * FROM pacientes WHERE email = ? LIMIT 1';
        const [result] = await db.promise().query(query, [sanitizedEmail]);

        if (result.length > 0) {
            res.json({ exists: true, data: result[0] });
        } else {
            res.json({ exists: false, data: null });
        }
    } catch (error) {
        logger.error('Error en el endpoint /pacientes/exists:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

module.exports = router;
