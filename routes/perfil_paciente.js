const express = require('express');
const db = require('../db');
const router = express.Router();

// Obtener perfil del paciente autenticado
router.get('/getProfile', async (req, res) => {
    try {
        const userId = req.session.userId;

        const query = `
            SELECT 
                id,
                nombre, 
                aPaterno, 
                aMaterno,
                fechaNacimiento, 
                tipoTutor, 
                nombreTutor,
                genero, 
                lugar, 
                telefono, 
                email, 
                alergias,
                estado
            FROM pacientes 
            WHERE id = ?
        `;

        const [results] = await db.promise().query(query, [userId]);

        if (results.length === 0) {
            return res.status(404).json({ message: 'Perfil no encontrado' });
        }

        res.status(200).json(results[0]);
    } catch (error) {
        console.error('Error al obtener el perfil:', error);
        res.status(500).json({ message: 'Error en el servidor al obtener el perfil' });
    }
});

// Actualizar perfil del paciente
router.put('/updateProfile', async (req, res) => {
    try {
        const userId = req.session.userId;
        const {
            nombre,
            aPaterno,
            aMaterno,
            fechaNacimiento,
            tipoTutor,
            nombreTutor,
            genero,
            lugar,
            telefono,
            email,
            alergias
        } = req.body;

        // Validar campos requeridos
        if (!nombre || !aPaterno || !aMaterno || !email) {
            return res.status(400).json({ 
                message: 'Los campos nombre, apellidos y email son obligatorios' 
            });
        }

        const query = `
            UPDATE pacientes 
            SET 
                nombre = ?,
                aPaterno = ?,
                aMaterno = ?,
                fechaNacimiento = ?,
                tipoTutor = ?,
                nombreTutor = ?,
                genero = ?,
                lugar = ?,
                telefono = ?,
                email = ?,
                alergias = ?,
                ultima_actualizacion = CURRENT_TIMESTAMP
            WHERE id = ? AND estado = 'Activo'
        `;

        const [result] = await db.promise().query(query, [
            nombre,
            aPaterno,
            aMaterno,
            fechaNacimiento,
            tipoTutor || null,
            nombreTutor || null,
            genero || null,
            lugar || null,
            telefono || null,
            email,
            alergias || 'Ninguna',
            userId
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Perfil no encontrado o no autorizado' });
        }

        res.status(200).json({ 
            message: 'Perfil actualizado correctamente',
            updatedProfile: {
                nombre,
                aPaterno,
                aMaterno,
                fechaNacimiento,
                tipoTutor,
                nombreTutor,
                genero,
                lugar,
                telefono,
                email,
                alergias
            }
        });

    } catch (error) {
        console.error('Error al actualizar el perfil:', error);
        res.status(500).json({ message: 'Error en el servidor al actualizar el perfil' });
    }
});

// Verificar email único
router.post('/verificar-email', async (req, res) => {
    try {
        const { email } = req.body;
        const userId = req.session.userId;

        const query = `
            SELECT id FROM pacientes 
            WHERE email = ? AND id != ? AND estado = 'Activo'
        `;

        const [results] = await db.promise().query(query, [email, userId]);

        res.json({ 
            disponible: results.length === 0 
        });

    } catch (error) {
        console.error('Error al verificar email:', error);
        res.status(500).json({ message: 'Error al verificar disponibilidad del email' });
    }
});

// Marcar perfil como inactivo (eliminación lógica)
router.put('/deactivate', async (req, res) => {
    try {
        const userId = req.session.userId;

        const query = `
            UPDATE pacientes 
            SET 
                estado = 'Inactivo',
                ultima_actualizacion = CURRENT_TIMESTAMP 
            WHERE id = ?
        `;

        const [result] = await db.promise().query(query, [userId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Perfil no encontrado' });
        }

        res.status(200).json({ message: 'Perfil desactivado correctamente' });

    } catch (error) {
        console.error('Error al desactivar el perfil:', error);
        res.status(500).json({ message: 'Error al desactivar el perfil' });
    }
});

module.exports = router;