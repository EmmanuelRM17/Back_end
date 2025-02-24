// rutas/odontologos.js

const express = require('express');
const db = require('../../db');
const router = express.Router();
const logger = require('../../utils/logger');

// Obtener odontólogos activos con su imagen de perfil
router.get('/activos', async (req, res) => {
    try {
        const sql = `
            SELECT id, nombre, aPaterno, aMaterno, email, puesto, estado, imagen
            FROM empleados
            WHERE puesto = 'Odontólogo' AND estado = 'activo';
        `;

        db.query(sql, (err, result) => {
            if (err) {
                logger.error('Error al obtener odontólogos:', err);
                return res.status(500).json({ message: 'Error al obtener los odontólogos.' });
            }
            res.status(200).json(result);
        });
    } catch (error) {
        logger.error('Error en la ruta /odontologos/activos:', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

module.exports = router;
