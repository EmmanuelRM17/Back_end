const express = require('express');
const db = require('../db');
const router = express.Router();
const logger = require('../utils/logger');

router.get('/all', async (req, res) => {
    try {
        const sql = 'SELECT id, title, description, category FROM servicios';
        db.query(sql, (err, result) => {
            if (err) {
                logger.error('Error al obtener servicios: ', err);
                return res.status(500).json({ message: 'Error al obtener los servicios.' });
            }
            res.status(200).json(result);
        });
    } catch (error) {
        logger.error('Error en la ruta /api/servicios: ', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

router.get('/get/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const sql = 'SELECT id, title, description, category FROM servicios WHERE id = ?';
        db.query(sql, [id], (err, result) => {
            if (err) {
                logger.error(`Error al obtener el servicio con ID ${id}: `, err);
                return res.status(500).json({ message: 'Error al obtener el servicio.' });
            }
            if (result.length === 0) {
                return res.status(404).json({ message: 'Servicio no encontrado.' });
            }
            res.status(200).json(result[0]);
        });
    } catch (error) {
        logger.error('Error en la ruta /api/servicios/:id: ', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

module.exports = router;
